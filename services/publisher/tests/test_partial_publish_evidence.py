from __future__ import annotations

import asyncio
from pathlib import Path

from reviewflow_publisher.adapters.base import ExecutionCondition, ExecutionResult
from reviewflow_publisher.digests import manifest_digest
from reviewflow_publisher.models import (
    Platform,
    PublicationStatus,
    PublishExecuteRequest,
    PublishManifest,
)
from reviewflow_publisher.service import PublishService
from reviewflow_publisher.storage import Store


class FixtureAdapter:
    def __init__(self, platform: Platform, result: ExecutionResult):
        self.platform = platform
        self.result = result
        self.publish_calls = 0

    def validate(self, _variant) -> list[str]:
        return []

    def preview(self, _variant) -> list[str]:
        return ["sau", self.platform.value, "upload-video"]

    def runtime_available(self) -> bool:
        return True

    async def publish(self, _variant) -> ExecutionResult:
        self.publish_calls += 1
        return self.result


class FixtureRegistry:
    def __init__(self, adapters: list[FixtureAdapter]):
        self.adapters = {adapter.platform: adapter for adapter in adapters}

    def get(self, platform: Platform) -> FixtureAdapter:
        return self.adapters[platform]


def test_partial_multi_platform_failure_preserves_commands_and_is_idempotent(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("REVIEWFLOW_LIVE_PUBLISH", "1")
    media = tmp_path / "partial.mp4"
    media.write_bytes(b"partial publication fixture")
    manifest = PublishManifest.model_validate({
        "id": "manifest-partial-evidence",
        "contentId": "content-partial-evidence",
        "createdAt": "2026-01-01T00:00:00Z",
        "variants": [
            {
                "id": "variant-partial-xhs",
                "contentId": "content-partial-evidence",
                "platform": "xiaohongshu",
                "accountId": "creator-xhs",
                "title": "多平台部分提交证据",
                "body": "第一项可能已提交，第二项遇到风控后必须停止。",
                "tags": ["复盘"],
                "mediaPaths": [str(media.resolve())],
            },
            {
                "id": "variant-partial-douyin",
                "contentId": "content-partial-evidence",
                "platform": "douyin",
                "accountId": "creator-dy",
                "title": "多平台部分提交证据",
                "body": "第一项可能已提交，第二项遇到风控后必须停止。",
                "tags": ["复盘"],
                "mediaPaths": [str(media.resolve())],
            },
        ],
    })
    manifest.digest = manifest_digest(manifest)
    first = FixtureAdapter(
        Platform.xiaohongshu,
        ExecutionResult(0, '{"condition":"success"}', "", ExecutionCondition.success),
    )
    second = FixtureAdapter(
        Platform.douyin,
        ExecutionResult(21, "检测到验证弹窗", "", ExecutionCondition.challenge),
    )
    service = PublishService(
        Store(tmp_path / "partial.sqlite3"),
        FixtureRegistry([first, second]),
    )
    request = PublishExecuteRequest(
        manifest=manifest,
        confirmationDigest=manifest.digest,
        idempotencyKey="partial-evidence-idempotency",
    )

    job = asyncio.run(service.execute(request))

    assert job.status is PublicationStatus.unknown
    assert job.details["commands"] == [
        ["sau", "xiaohongshu", "upload-video"],
        ["sau", "douyin", "upload-video"],
    ]
    assert job.details["partialSubmissionPossible"] is True
    assert job.details["userActionRequired"] is True
    assert [result["status"] for result in job.details["results"]] == ["unknown", "failed"]
    assert [first.publish_calls, second.publish_calls] == [1, 1]

    retried = asyncio.run(service.execute(request))

    assert retried.id == job.id
    assert retried.details == job.details
    assert [first.publish_calls, second.publish_calls] == [1, 1]
