from __future__ import annotations

import argparse
import asyncio
import ctypes
import json
import os
import re
import shutil
import subprocess
import sys
import types
from contextlib import contextmanager
from ctypes import wintypes
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterator

from .security import redact


SCHEDULE_FORMAT = "%Y-%m-%d %H:%M"
ACCOUNT_PATTERN = re.compile(r"^[\w.-]{1,80}$", re.UNICODE)


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def data_root() -> Path:
    configured = os.getenv("REVIEWFLOW_PUBLISHER_DATA_DIR")
    root = Path(configured) if configured else Path.home() / ".reviewflow" / "publisher"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def resolve_chromium_executable() -> Path | None:
    configured = os.getenv("REVIEWFLOW_CHROME_EXECUTABLE")
    candidates = [
        Path(configured) if configured else None,
        Path(os.getenv("PROGRAMFILES", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
        Path(os.getenv("PROGRAMFILES(X86)", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
        Path(os.getenv("LOCALAPPDATA", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
        Path(os.getenv("PROGRAMFILES(X86)", "")) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        Path(os.getenv("PROGRAMFILES", "")) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate.resolve()
    return None


def cleanup_stale_sessions() -> int:
    sessions = data_root() / "sessions"
    if not sessions.is_dir():
        return 0
    resolved_sessions = sessions.resolve()
    removed = 0
    for candidate in sessions.iterdir():
        if not candidate.name.startswith("reviewflow-"):
            continue
        resolved_candidate = candidate.resolve()
        if resolved_candidate.parent != resolved_sessions:
            continue
        if resolved_candidate.is_dir():
            shutil.rmtree(resolved_candidate)
        else:
            resolved_candidate.unlink()
        removed += 1
    return removed


def _patch_browser_launch(executable: Path) -> None:
    from patchright.async_api import BrowserType

    original_launch = BrowserType.launch

    async def launch_with_reviewflow_browser(self, *args, **kwargs):
        if kwargs.get("channel") == "chrome":
            kwargs.pop("channel", None)
            kwargs["executable_path"] = str(executable)
        return await original_launch(self, *args, **kwargs)

    BrowserType.launch = launch_with_reviewflow_browser


def resolve_biliup_executable() -> Path | None:
    configured = os.getenv("REVIEWFLOW_BILIUP_EXECUTABLE")
    sibling = Path(sys.executable).with_name("biliup.exe") if getattr(sys, "frozen", False) else None
    candidates = [Path(configured) if configured else None, sibling]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate.resolve()
    return None


def _run_biliup(executable: Path, arguments: list[str], *, interactive: bool = False) -> subprocess.CompletedProcess[str]:
    command = [str(executable), *arguments]
    if interactive:
        return subprocess.run(command, check=False)
    return subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def _dpapi(value: bytes, *, protect: bool) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("ReviewFlow's protected publisher credentials require Windows DPAPI")
    source = ctypes.create_string_buffer(value)
    source_blob = DataBlob(len(value), ctypes.cast(source, ctypes.POINTER(ctypes.c_char)))
    destination_blob = DataBlob()
    crypt32 = ctypes.windll.crypt32
    function = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    description = "ReviewFlow publisher credential" if protect else None
    arguments = (
        ctypes.byref(source_blob),
        description,
        None,
        None,
        None,
        0x01,
        ctypes.byref(destination_blob),
    ) if protect else (
        ctypes.byref(source_blob),
        None,
        None,
        None,
        None,
        0x01,
        ctypes.byref(destination_blob),
    )
    if not function(*arguments):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(destination_blob.pbData, destination_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(destination_blob.pbData)


def _credential_path(platform: str, account: str) -> Path:
    if platform not in {"xiaohongshu", "douyin", "bilibili"}:
        raise ValueError("Unsupported platform")
    if not ACCOUNT_PATTERN.fullmatch(account):
        raise ValueError("Account alias must contain only letters, numbers, dot, underscore, or dash")
    return data_root() / "credentials" / f"{platform}_{account}.dpapi"


def _install_upstream_config(runtime_home: Path) -> None:
    module = types.ModuleType("conf")
    # omnipost joins BASE_DIR with pathlib's `/` operator at import time.
    module.BASE_DIR = runtime_home
    module.DEBUG_MODE = os.getenv("REVIEWFLOW_PUBLISHER_DEBUG", "0") == "1"
    module.LOCAL_CHROME_HEADLESS = True
    module.LOCAL_CHROME_PATH = os.getenv("REVIEWFLOW_CHROME_EXECUTABLE", "")
    module.XHS_SERVER = os.getenv("REVIEWFLOW_XHS_SERVER", "")
    sys.modules["conf"] = module


def _close_upstream_loggers() -> None:
    if "utils.log" not in sys.modules:
        return
    from loguru import logger

    logger.remove()


@contextmanager
def account_session(platform: str, account: str) -> Iterator[Path]:
    root = data_root()
    sessions = root / "sessions"
    sessions.mkdir(parents=True, exist_ok=True)
    protected_path = _credential_path(platform, account)
    protected_path.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="reviewflow-", dir=sessions) as directory:
        runtime_home = Path(directory)
        account_file = runtime_home / "cookies" / f"{platform}_{account}.json"
        account_file.parent.mkdir(parents=True, exist_ok=True)
        if protected_path.is_file():
            account_file.write_bytes(_dpapi(protected_path.read_bytes(), protect=False))
        _install_upstream_config(runtime_home)
        try:
            yield account_file
        finally:
            if account_file.is_file():
                protected = _dpapi(account_file.read_bytes(), protect=True)
                temporary = protected_path.with_suffix(".tmp")
                temporary.write_bytes(protected)
                temporary.replace(protected_path)
            # Upstream registers file sinks inside this temporary directory.
            # Close them before TemporaryDirectory removes the session tree.
            _close_upstream_loggers()


def _tags(raw: str | None) -> list[str]:
    return [item.strip().lstrip("#") for item in (raw or "").split(",") if item.strip().lstrip("#")]


def _schedule(raw: str | None) -> datetime | int:
    return datetime.strptime(raw, SCHEDULE_FORMAT) if raw else 0


def _emit(payload: dict, *, error: bool = False) -> None:
    stream = sys.stderr if error else sys.stdout
    stream.write(json.dumps(payload, ensure_ascii=False) + "\n")
    stream.flush()


async def _xiaohongshu(args: argparse.Namespace, account_file: Path) -> int:
    from uploader.xiaohongshu_uploader.main import (
        XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE,
        XIAOHONGSHU_PUBLISH_STRATEGY_SCHEDULED,
        XiaoHongShuNote,
        XiaoHongShuVideo,
        cookie_auth,
        xiaohongshu_setup,
    )

    if args.action == "login":
        result = await xiaohongshu_setup(
            str(account_file),
            handle=True,
            return_detail=True,
            headless=not args.headed,
        )
        _emit({"condition": "success" if result.get("success") else "account_auth_required", **result})
        return 0 if result.get("success") else 20
    if args.action == "check":
        authenticated = account_file.is_file() and await cookie_auth(str(account_file))
        _emit({"condition": "success" if authenticated else "account_auth_required", "authenticated": authenticated})
        return 0 if authenticated else 20

    scheduled = bool(args.schedule)
    strategy = XIAOHONGSHU_PUBLISH_STRATEGY_SCHEDULED if scheduled else XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE
    common = {
        "title": args.title,
        "tags": _tags(args.tags),
        "publish_date": _schedule(args.schedule),
        "account_file": str(account_file),
        "publish_strategy": strategy,
        "debug": args.debug,
        "headless": not args.headed,
    }
    if args.action == "upload-video":
        uploader = XiaoHongShuVideo(file_path=str(args.file), desc=args.desc, thumbnail_path=None, **common)
    else:
        uploader = XiaoHongShuNote(
            image_paths=[str(path) for path in args.images],
            note=args.note,
            desc=args.note,
            **common,
        )
    await uploader.main()
    _emit({"condition": "success", "message": "Uploader workflow completed"})
    return 0


async def _douyin(args: argparse.Namespace, account_file: Path) -> int:
    from uploader.douyin_uploader.main import (
        DOUYIN_PUBLISH_STRATEGY_IMMEDIATE,
        DOUYIN_PUBLISH_STRATEGY_SCHEDULED,
        DouYinNote,
        DouYinVideo,
        cookie_auth,
        douyin_setup,
    )

    if args.action == "login":
        result = await douyin_setup(
            str(account_file),
            handle=True,
            return_detail=True,
            headless=not args.headed,
        )
        _emit({"condition": "success" if result.get("success") else "account_auth_required", **result})
        return 0 if result.get("success") else 20
    if args.action == "check":
        authenticated = account_file.is_file() and await cookie_auth(str(account_file))
        _emit({"condition": "success" if authenticated else "account_auth_required", "authenticated": authenticated})
        return 0 if authenticated else 20

    scheduled = bool(args.schedule)
    strategy = DOUYIN_PUBLISH_STRATEGY_SCHEDULED if scheduled else DOUYIN_PUBLISH_STRATEGY_IMMEDIATE
    common = {
        "title": args.title,
        "tags": _tags(args.tags),
        "publish_date": _schedule(args.schedule),
        "account_file": str(account_file),
        "publish_strategy": strategy,
        "debug": args.debug,
        "headless": not args.headed,
    }
    if args.action == "upload-video":
        uploader = DouYinVideo(
            file_path=str(args.file),
            desc=args.desc,
            thumbnail_portrait_path=None,
            productLink="",
            productTitle="",
            **common,
        )
        await uploader.douyin_upload_video()
    else:
        uploader = DouYinNote(
            image_paths=[str(path) for path in args.images],
            note=args.note,
            **common,
        )
        await uploader.douyin_upload_note()
    _emit({"condition": "success", "message": "Uploader workflow completed"})
    return 0


async def _patchright_doctor() -> None:
    from patchright.async_api import async_playwright

    runtime = await async_playwright().start()
    await runtime.stop()


def _doctor() -> int:
    if resolve_chromium_executable() is None:
        raise RuntimeError("No supported Chrome or Microsoft Edge executable was found")
    executable = resolve_biliup_executable()
    if executable is None:
        raise RuntimeError("Pinned biliup v1.2.4 runtime is unavailable")
    asyncio.run(_patchright_doctor())
    result = _run_biliup(executable, ["--version"])
    if result.returncode != 0:
        raise RuntimeError(redact(result.stderr or result.stdout or "biliup version check failed"))
    version = (result.stdout or result.stderr).strip().splitlines()[-1]
    _emit({"condition": "success", "patchright": "ready", "browser": "ready", "biliup": version})
    return 0


def _bilibili(args: argparse.Namespace, account_file: Path) -> int:
    executable = resolve_biliup_executable()
    if executable is None:
        raise RuntimeError("Pinned biliup v1.2.4 runtime is unavailable")

    if args.action == "login":
        if not (sys.stdin.isatty() and sys.stdout.isatty()):
            _emit({
                "condition": "account_auth_required",
                "message": "Bilibili login must be run from ReviewFlow CLI in an interactive terminal",
            }, error=True)
            return 20
        result = _run_biliup(executable, ["-u", str(account_file), "login"], interactive=True)
        return result.returncode
    if args.action == "check":
        if not account_file.is_file():
            _emit({"condition": "account_auth_required", "authenticated": False})
            return 20
        result = _run_biliup(executable, ["-u", str(account_file), "renew"])
        _emit({
            "condition": "success" if result.returncode == 0 else "account_auth_required",
            "authenticated": result.returncode == 0,
            "message": redact(result.stderr or result.stdout),
        })
        return result.returncode
    if not account_file.is_file():
        _emit({"condition": "account_auth_required", "message": "Bilibili account login is required"}, error=True)
        return 20
    command = [
        "-u", str(account_file), "upload", str(args.file),
        "--title", args.title, "--desc", args.desc, "--tid", str(args.tid), "--copyright", "1",
    ]
    tags = _tags(args.tags)
    if tags:
        command.extend(["--tag", ",".join(tags)])
    if args.schedule:
        command.extend(["--dtime", str(int(_schedule(args.schedule).timestamp()))])
    result = _run_biliup(executable, command)
    if result.stdout:
        sys.stdout.write(redact(result.stdout))
    if result.stderr:
        sys.stderr.write(redact(result.stderr))
    if result.returncode == 0:
        _emit({"condition": "success", "message": "Uploader workflow completed"})
    return result.returncode


def _media_options(parser: argparse.ArgumentParser, *, note: bool = False) -> None:
    if note:
        parser.add_argument("--images", required=True, nargs="+", type=Path)
        parser.add_argument("--note", default="")
    else:
        parser.add_argument("--file", required=True, type=Path)
        parser.add_argument("--desc", default="")
    parser.add_argument("--title", required=True)
    parser.add_argument("--tags", default="")
    parser.add_argument("--schedule")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--headed", action="store_true")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="reviewflow-sau", description="Pinned ReviewFlow publisher runtime")
    platforms = parser.add_subparsers(dest="platform", required=True)
    platforms.add_parser("doctor", help="verify bundled publishing dependencies without accessing platform pages")
    for platform in ("xiaohongshu", "douyin"):
        platform_parser = platforms.add_parser(platform)
        actions = platform_parser.add_subparsers(dest="action", required=True)
        for action in ("login", "check"):
            account_parser = actions.add_parser(action)
            account_parser.add_argument("--account", required=True)
            if action == "login":
                account_parser.add_argument("--headed", action="store_true")
        video = actions.add_parser("upload-video")
        video.add_argument("--account", required=True)
        _media_options(video)
        note = actions.add_parser("upload-note")
        note.add_argument("--account", required=True)
        _media_options(note, note=True)

    bilibili = platforms.add_parser("bilibili")
    bili_actions = bilibili.add_subparsers(dest="action", required=True)
    for action in ("login", "check"):
        account_parser = bili_actions.add_parser(action)
        account_parser.add_argument("--account", required=True)
    video = bili_actions.add_parser("upload-video")
    video.add_argument("--account", required=True)
    _media_options(video)
    video.add_argument("--tid", required=True, type=int)
    return parser


def run(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        cleanup_stale_sessions()
        if args.platform == "doctor":
            return _doctor()
        if args.platform in {"xiaohongshu", "douyin"}:
            browser = resolve_chromium_executable()
            if browser is None:
                raise RuntimeError("No supported Chrome or Microsoft Edge executable was found")
            os.environ["REVIEWFLOW_CHROME_EXECUTABLE"] = str(browser)
            _patch_browser_launch(browser)
        with account_session(args.platform, args.account) as account_file:
            if args.platform == "xiaohongshu":
                return asyncio.run(_xiaohongshu(args, account_file))
            if args.platform == "douyin":
                return asyncio.run(_douyin(args, account_file))
            return _bilibili(args, account_file)
    except Exception as error:
        text = redact(error)
        lowered = text.lower()
        if "cookie" in lowered or "login" in lowered or "登录" in text:
            condition, code = "account_auth_required", 20
        elif any(marker in lowered for marker in ("captcha", "challenge", "verification")) or "验证码" in text or "安全验证" in text:
            condition, code = "challenge", 21
        elif "locator" in lowered or "selector" in lowered or "timeout" in lowered:
            condition, code = "selector_drift", 22
        else:
            condition, code = "runtime_error", 23
        _emit({"condition": condition, "message": text}, error=True)
        return code


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
