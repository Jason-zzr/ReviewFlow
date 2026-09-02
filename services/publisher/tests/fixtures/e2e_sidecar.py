from __future__ import annotations

import ipaddress
import os
from pathlib import Path
import socket


def _assert_fixture_environment() -> None:
    root_value = os.getenv("REVIEWFLOW_E2E_ROOT")
    data_value = os.getenv("REVIEWFLOW_DATA_DIR")
    token = os.getenv("REVIEWFLOW_SESSION_TOKEN", "")
    if not root_value or not data_value:
        raise RuntimeError("Fixture Sidecar requires isolated E2E data paths")
    root = Path(root_value).resolve()
    data_dir = Path(data_value).resolve()
    if not data_dir.is_relative_to(root):
        raise RuntimeError("Fixture Sidecar data must remain inside the isolated E2E root")
    if os.getenv("REVIEWFLOW_LIVE_PUBLISH") != "1":
        raise RuntimeError("Fixture Sidecar must exercise the non-dry-run state machine")
    if len(token) != 64 or any(character not in "0123456789abcdef" for character in token):
        raise RuntimeError("Fixture Sidecar requires the production random session-token shape")


def _is_loopback_host(host: object) -> bool:
    if host is None:
        return True
    if isinstance(host, bytes):
        host = host.decode("ascii", errors="ignore")
    normalized = str(host).strip().lower().strip("[]").split("%", 1)[0]
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def _install_loopback_only_network_guard() -> None:
    original_getaddrinfo = socket.getaddrinfo
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def assert_loopback(host: object) -> None:
        if not _is_loopback_host(host):
            raise PermissionError("Fixture Sidecar blocks non-loopback network access")

    def guarded_getaddrinfo(host, *args, **kwargs):
        assert_loopback(host)
        return original_getaddrinfo(host, *args, **kwargs)

    def guarded_connect(instance, address):
        if isinstance(address, tuple) and address:
            assert_loopback(address[0])
        return original_connect(instance, address)

    def guarded_connect_ex(instance, address):
        if isinstance(address, tuple) and address:
            assert_loopback(address[0])
        return original_connect_ex(instance, address)

    socket.getaddrinfo = guarded_getaddrinfo
    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex

    try:
        socket.getaddrinfo("reviewflow-fixture-must-not-resolve.invalid", 443)
    except PermissionError:
        return
    raise RuntimeError("Fixture Sidecar network guard did not block an external host")


_assert_fixture_environment()
_install_loopback_only_network_guard()

import uvicorn

from reviewflow_publisher.adapters.base import (
    ExecutionCondition,
    ExecutionResult,
    PublisherAdapter,
)
from reviewflow_publisher.adapters.sau import SauAdapter
from reviewflow_publisher.api import create_app
from reviewflow_publisher.models import (
    AdapterCapability,
    MetricFetchRequest,
    MetricFetchResult,
    Platform,
    PlatformVariant,
    PublicationStatus,
)
from reviewflow_publisher.parent_watchdog import start_parent_watchdog


class FixtureAdapter(PublisherAdapter):
    def __init__(self, platform: Platform):
        self.platform = platform
        self._command_adapter = SauAdapter(platform)

    def capability(self) -> AdapterCapability:
        return AdapterCapability(
            platform=self.platform,
            supportsVideo=True,
            supportsImageText=self.platform in {Platform.xiaohongshu, Platform.douyin},
            supportsNativeSchedule=True,
            supportsAutomaticMetrics=False,
            liveRuntimeAvailable=True,
        )

    async def login(self, account: str, *, headed: bool = False) -> ExecutionResult:
        del account, headed
        return ExecutionResult(
            return_code=20,
            stdout='{"condition":"account_auth_required","authenticated":false}',
            stderr="",
            condition=ExecutionCondition.account_auth_required,
        )

    async def check(self, account: str) -> ExecutionResult:
        return await self.login(account)

    def validate(self, variant: PlatformVariant) -> list[str]:
        return self._command_adapter.validate(variant)

    def preview(self, variant: PlatformVariant) -> list[str]:
        return self._command_adapter.preview(variant)

    async def publish(self, variant: PlatformVariant) -> ExecutionResult:
        del variant
        return ExecutionResult(
            return_code=0,
            stdout='{"condition":"success","evidence":"fixture-only; non-loopback network is blocked"}',
            stderr="",
            condition=ExecutionCondition.success,
        )

    def status(self, external_ref: str) -> PublicationStatus:
        if not external_ref.strip():
            raise ValueError("External publication reference is required")
        return PublicationStatus.unknown

    def fetch_metrics(self, request: MetricFetchRequest) -> MetricFetchResult:
        if request.platform is not self.platform:
            raise ValueError("Metric request platform does not match adapter")
        return MetricFetchResult(
            status="manual_required",
            platform=self.platform,
            publicationId=request.publicationId,
            message="Fixture metrics require manual or CSV import",
        )

    def runtime_available(self) -> bool:
        return True


class FixtureRegistry:
    def __init__(self) -> None:
        self._adapters = {platform: FixtureAdapter(platform) for platform in Platform}

    def get(self, platform: Platform) -> FixtureAdapter:
        return self._adapters[platform]

    def capabilities(self) -> list[AdapterCapability]:
        return [adapter.capability() for adapter in self._adapters.values()]


def run() -> None:
    start_parent_watchdog()
    uvicorn.run(
        create_app(adapters=FixtureRegistry()),
        host="127.0.0.1",
        port=int(os.getenv("REVIEWFLOW_SIDECAR_PORT", "43117")),
        log_level="warning",
    )


if __name__ == "__main__":
    run()
