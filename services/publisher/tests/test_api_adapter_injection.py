from pathlib import Path

from fastapi.testclient import TestClient

from reviewflow_publisher.adapters.base import ExecutionCondition, ExecutionResult
from reviewflow_publisher.api import create_app
from reviewflow_publisher.models import Platform
from reviewflow_publisher.storage import Store


class InjectedAccountAdapter:
    def runtime_available(self) -> bool:
        return True

    async def check(self, _account: str) -> ExecutionResult:
        return ExecutionResult(
            return_code=0,
            stdout="fixture account ready",
            stderr="",
            condition=ExecutionCondition.success,
        )


class InjectedRegistry:
    def __init__(self) -> None:
        self.adapter = InjectedAccountAdapter()

    def get(self, _platform: Platform) -> InjectedAccountAdapter:
        return self.adapter

    def capabilities(self) -> list[object]:
        return []


def test_create_app_uses_the_injected_adapter_registry(tmp_path: Path, monkeypatch) -> None:
    token = "adapter-injection-session-token"
    monkeypatch.setenv("REVIEWFLOW_SESSION_TOKEN", token)

    with TestClient(
        create_app(Store(tmp_path / "publisher.sqlite3"), adapters=InjectedRegistry())
    ) as client:
        response = client.post(
            "/v1/accounts/check",
            json={"platform": "xiaohongshu", "accountId": "creator"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "platform": "xiaohongshu",
        "accountId": "creator",
        "runtimeAvailable": True,
        "authenticated": True,
        "message": "fixture account ready",
    }
