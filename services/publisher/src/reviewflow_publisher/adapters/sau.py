from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
from pathlib import Path

from .base import ExecutionCondition, ExecutionResult, PublisherAdapter
from ..metrics import fetch_metrics as collect_metrics
from ..models import (
    AdapterCapability,
    ContentKind,
    MetricFetchRequest,
    MetricFetchResult,
    Platform,
    PlatformVariant,
    PublicationStatus,
)
from ..security import redact


CHALLENGE_MARKERS = (
    "captcha",
    "challenge",
    "检测到验证弹窗",
    "请输入验证码",
    "安全验证",
    "请完成验证",
    "风控",
    "risk control",
)


class SauAdapter(PublisherAdapter):
    def __init__(self, platform: Platform):
        self.platform = platform

    def capability(self) -> AdapterCapability:
        return AdapterCapability(
            platform=self.platform,
            supportsVideo=True,
            supportsImageText=self.platform in {Platform.xiaohongshu, Platform.douyin},
            supportsNativeSchedule=True,
            supportsAutomaticMetrics=self.platform is Platform.bilibili,
            liveRuntimeAvailable=self.runtime_available(),
        )

    @staticmethod
    def _runtime_environment() -> dict[str, str]:
        return {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}

    def validate(self, variant: PlatformVariant) -> list[str]:
        warnings: list[str] = []
        for media_path in variant.mediaPaths:
            path = Path(media_path).expanduser()
            try:
                resolved = path.resolve(strict=True)
            except (OSError, RuntimeError):
                warnings.append(f"素材文件不存在或无权访问：{path.name or media_path}")
                continue
            if not path.is_absolute() or path.is_symlink() or not resolved.is_file():
                warnings.append(f"素材必须是用户选择的本地普通文件：{path.name or media_path}")
        suffixes = {Path(path).suffix.lower() for path in variant.mediaPaths}
        image_suffixes = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
        video_suffixes = {".mp4", ".mov", ".avi", ".mkv", ".m4v", ".webm", ".flv", ".wmv"}
        kind = self._kind(variant)
        if not variant.mediaPaths:
            warnings.append("至少需要一个本地素材文件")
        if kind is ContentKind.video and len(variant.mediaPaths) > 1:
            warnings.append("视频版本只能包含一个视频素材")
        if kind is ContentKind.video and not suffixes.issubset(video_suffixes):
            warnings.append("视频素材格式不受支持")
        if kind is ContentKind.image_text and not suffixes.issubset(image_suffixes):
            warnings.append("图文素材格式不受支持")
        if kind is ContentKind.image_text and self.platform is Platform.bilibili:
            warnings.append("B 站 MVP 仅支持视频")
        if self.platform is Platform.douyin and kind is ContentKind.image_text and len(variant.mediaPaths) > 35:
            warnings.append("抖音图文最多支持 35 张图片")
        if self.platform is Platform.bilibili and not variant.bilibiliTid:
            warnings.append("B 站视频必须提供分区 tid")
        if variant.scheduledAt:
            remaining = variant.scheduledAt.astimezone(timezone.utc) - datetime.now(timezone.utc)
            if remaining.total_seconds() < 2 * 60 * 60:
                warnings.append("平台定时发布时间必须至少晚于当前时间 2 小时")
        return warnings

    def preview(self, variant: PlatformVariant) -> list[str]:
        kind = self._kind(variant)
        command = ["sau", self.platform.value]
        command.append("upload-video" if kind is ContentKind.video else "upload-note")
        command += ["--account", variant.accountId]
        if kind is ContentKind.video:
            command += ["--file", variant.mediaPaths[0] if variant.mediaPaths else "<missing>"]
            command += ["--title", variant.title, "--desc", variant.body]
        else:
            command += ["--images", *variant.mediaPaths, "--title", variant.title, "--note", variant.body]
        if variant.tags:
            command += ["--tags", ",".join(variant.tags)]
        if variant.scheduledAt:
            command += ["--schedule", variant.scheduledAt.astimezone().strftime("%Y-%m-%d %H:%M")]
        if self.platform is Platform.bilibili and variant.bilibiliTid:
            command += ["--tid", str(variant.bilibiliTid)]
        if self.platform in {Platform.xiaohongshu, Platform.douyin}:
            command.append("--headed")
        return command

    async def publish(self, variant: PlatformVariant) -> ExecutionResult:
        command = self.preview(variant)
        executable = self.runtime_executable()
        if executable is None:
            raise RuntimeError("Pinned omnipost runtime is unavailable")
        command[0] = executable
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=self._runtime_environment(),
        )
        stdout, stderr = await self._communicate_for_publish(process)
        return self.execution_result(process.returncode or 0, stdout, stderr, limit=4_000)

    @classmethod
    async def _communicate_for_publish(
        cls,
        process: asyncio.subprocess.Process,
    ) -> tuple[bytes, bytes]:
        if process.stdout is None or process.stderr is None:
            raise RuntimeError("Publisher process pipes are unavailable")
        challenge = asyncio.Event()
        stdout_parts: list[bytes] = []
        stderr_parts: list[bytes] = []

        async def drain(stream: asyncio.StreamReader, parts: list[bytes]) -> None:
            observed = ""
            while chunk := await stream.read(1_024):
                parts.append(chunk)
                observed = (observed + chunk.decode("utf-8", errors="replace"))[-8_000:]
                if cls._has_challenge_marker(observed):
                    challenge.set()

        readers = [
            asyncio.create_task(drain(process.stdout, stdout_parts)),
            asyncio.create_task(drain(process.stderr, stderr_parts)),
        ]
        process_wait = asyncio.create_task(process.wait())
        challenge_wait = asyncio.create_task(challenge.wait())
        try:
            done, _ = await asyncio.wait(
                {process_wait, challenge_wait},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if challenge_wait in done and challenge.is_set() and process.returncode is None:
                await cls._stop_process_tree(process)
            else:
                await process_wait
            await asyncio.gather(*readers)
        finally:
            challenge_wait.cancel()
            await asyncio.gather(challenge_wait, return_exceptions=True)
        return b"".join(stdout_parts), b"".join(stderr_parts)

    @staticmethod
    async def _stop_process_tree(process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        if os.name == "nt":
            killer = await asyncio.create_subprocess_exec(
                "taskkill.exe",
                "/PID",
                str(process.pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await killer.communicate()
        else:
            process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except TimeoutError:
            process.kill()
            await process.wait()

    @staticmethod
    def _has_challenge_marker(output: str) -> bool:
        lowered = output.lower()
        return any(marker in lowered for marker in CHALLENGE_MARKERS)

    def account_command(self, action: str, account: str, *, headed: bool = False) -> list[str]:
        if action not in {"login", "check"}:
            raise ValueError("Unsupported account action")
        if not account.strip():
            raise ValueError("Account alias is required")
        command = ["sau", self.platform.value, action, "--account", account]
        if action == "login" and headed and self.platform is not Platform.bilibili:
            command.append("--headed")
        return command

    async def _run_account_action(
        self,
        action: str,
        account: str,
        *,
        headed: bool = False,
    ) -> ExecutionResult:
        executable = self.runtime_executable()
        if executable is None:
            raise RuntimeError("Pinned omnipost runtime is unavailable")
        command = self.account_command(action, account, headed=headed)
        command[0] = executable
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=self._runtime_environment(),
        )
        stdout, stderr = await process.communicate()
        return self.execution_result(process.returncode or 0, stdout, stderr, limit=2_000)

    async def login(self, account: str, *, headed: bool = False) -> ExecutionResult:
        return await self._run_account_action("login", account, headed=headed)

    async def check(self, account: str) -> ExecutionResult:
        return await self._run_account_action("check", account)

    async def check_account(self, account: str) -> ExecutionResult:
        return await self.check(account)

    def status(self, external_ref: str) -> PublicationStatus:
        if not external_ref.strip():
            raise ValueError("External publication reference is required")
        return PublicationStatus.unknown

    def fetch_metrics(self, request: MetricFetchRequest) -> MetricFetchResult:
        if request.platform is not self.platform:
            raise ValueError("Metric request platform does not match adapter")
        return collect_metrics(request)

    @staticmethod
    def execution_result(
        return_code: int,
        stdout: bytes | str,
        stderr: bytes | str,
        *,
        limit: int = 4_000,
    ) -> ExecutionResult:
        def decode(value: bytes | str) -> str:
            return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value

        safe_stdout = redact(decode(stdout))[-limit:]
        safe_stderr = redact(decode(stderr))[-limit:]
        combined = f"{safe_stdout}\n{safe_stderr}".lower()
        success_markers = ("发布成功", '"condition": "success"', '"condition":"success"')
        auth_markers = (
            "cookie is missing or expired",
            "cookie file is missing",
            "cookie_invalid",
            "cookie文件不存在",
            "cookie文件已失效",
            "cookie 失效",
            "请先完成登录",
        )
        selector_markers = (
            "selector",
            "strict mode violation",
            "waiting for locator",
            "locator.click",
            "未找到可点击的发布按钮",
            "发布超时",
        )
        if any(marker in combined for marker in auth_markers):
            condition = ExecutionCondition.account_auth_required
        elif SauAdapter._has_challenge_marker(combined):
            condition = ExecutionCondition.challenge
        elif any(marker in combined for marker in selector_markers):
            condition = ExecutionCondition.selector_drift
        elif return_code == 0 and any(marker in combined for marker in success_markers):
            condition = ExecutionCondition.success
        elif return_code == 0:
            condition = ExecutionCondition.runtime_error
        else:
            condition = ExecutionCondition.runtime_error
        return ExecutionResult(
            return_code=return_code,
            stdout=safe_stdout,
            stderr=safe_stderr,
            condition=condition,
        )

    @staticmethod
    def _kind(variant: PlatformVariant) -> ContentKind:
        if variant.mediaPaths and all(
            Path(path).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
            for path in variant.mediaPaths
        ):
            return ContentKind.image_text
        return ContentKind.video


class AdapterRegistry:
    def __init__(self):
        self._adapters = {platform: SauAdapter(platform) for platform in Platform}

    def get(self, platform: Platform) -> SauAdapter:
        return self._adapters[platform]

    def capabilities(self) -> list[AdapterCapability]:
        return [adapter.capability() for adapter in self._adapters.values()]
