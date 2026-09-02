from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from .models import PublishManifest


def _canonicalize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _canonicalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonicalize(item) for item in value]
    return value


def manifest_digest(manifest: PublishManifest) -> str:
    payload = _canonicalize(manifest.model_dump(mode="python", exclude={"digest"}, exclude_none=True))
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def assert_confirmed(manifest: PublishManifest, confirmation_digest: str) -> str:
    expected = manifest_digest(manifest)
    if manifest.digest != expected or confirmation_digest != expected:
        raise ValueError("Publish manifest changed after preview; generate and confirm a new preview")
    return expected
