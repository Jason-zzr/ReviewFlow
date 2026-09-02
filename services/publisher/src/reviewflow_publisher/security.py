from __future__ import annotations

import hmac
import json
import os
import re
from typing import Any

from fastapi import HTTPException, Request, status

ALLOWED_ORIGINS = {
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "app://reviewflow",
}

SECRET_PATTERN = re.compile(
    r"(?i)(cookie|authorization|api[_-]?key|token)(\s*[:=]\s*)([^\r\n,;]+)"
)
COOKIE_PATH_PATTERN = re.compile(
    r"(?i)(?:[a-z]:[\\/]|/)[^\r\n\"']*?[\\/]cookies[\\/][^\s\"']+"
)
SENSITIVE_FIELD_PATTERN = re.compile(
    r"(?i)(authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)"
)
MAX_RAW_SNAPSHOT_BYTES = 64 * 1024
MAX_RAW_DEPTH = 8
MAX_RAW_ITEMS = 200
MAX_RAW_STRING = 4_000


def session_token() -> str:
    token = os.getenv("REVIEWFLOW_SESSION_TOKEN", "")
    if len(token) < 16:
        raise RuntimeError("REVIEWFLOW_SESSION_TOKEN must contain at least 16 characters")
    return token


def require_session(request: Request) -> None:
    supplied = request.headers.get("authorization", "")
    expected = f"Bearer {session_token()}"
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid sidecar session")


def validate_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin and origin not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origin is not allowed")


def redact(value: Any) -> str:
    without_secrets = SECRET_PATTERN.sub(
        lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]",
        str(value),
    )
    return COOKIE_PATH_PATTERN.sub("[REDACTED_COOKIE_PATH]", without_secrets)


def sanitize_raw_snapshot(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None

    def sanitize(item: Any, depth: int) -> Any:
        if depth > MAX_RAW_DEPTH:
            return "[TRUNCATED_DEPTH]"
        if isinstance(item, dict):
            cleaned: dict[str, Any] = {}
            for index, (key, nested) in enumerate(item.items()):
                if index >= MAX_RAW_ITEMS:
                    cleaned["_truncatedItems"] = True
                    break
                safe_key = str(key)[:200]
                cleaned[safe_key] = (
                    "[REDACTED]"
                    if SENSITIVE_FIELD_PATTERN.search(safe_key)
                    else sanitize(nested, depth + 1)
                )
            return cleaned
        if isinstance(item, (list, tuple)):
            cleaned = [sanitize(nested, depth + 1) for nested in item[:MAX_RAW_ITEMS]]
            if len(item) > MAX_RAW_ITEMS:
                cleaned.append("[TRUNCATED_ITEMS]")
            return cleaned
        if isinstance(item, str):
            return redact(item)[:MAX_RAW_STRING]
        if item is None or isinstance(item, (bool, int, float)):
            return item
        return redact(item)[:MAX_RAW_STRING]

    cleaned = sanitize(value, 0)
    if not isinstance(cleaned, dict):
        raise ValueError("Raw metric snapshot must be a JSON object")
    encoded = json.dumps(cleaned, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_RAW_SNAPSHOT_BYTES:
        raise ValueError("Raw metric snapshot exceeds the 64 KiB safety limit")
    return cleaned
