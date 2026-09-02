from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError
from typer.testing import CliRunner

from reviewflow_publisher.adapters.base import ExecutionCondition, ExecutionResult
from reviewflow_publisher.adapters.sau import SauAdapter
from reviewflow_publisher.digests import manifest_digest
from reviewflow_publisher.growth import build_retro, predict_views, score_assessments
from reviewflow_publisher.cli import app, publish_summary
from reviewflow_publisher.models import (
    MetricImportRequest,
    MetricScheduleRequest,
    NormalizedMetrics,
    Platform,
    PublicationConfirmRequest,
    PublicationStatus,
    PublishExecuteRequest,
    PublishManifest,
)
from reviewflow_publisher.service import PublishService
from reviewflow_publisher.security import redact
from reviewflow_publisher.sau_runtime import (
    _install_upstream_config,
    account_session,
    build_parser,
    cleanup_stale_sessions,
    resolve_biliup_executable,
    resolve_chromium_executable,
)
from reviewflow_publisher.storage import SCHEMA_VERSION, Store


FIXTURES = Path(__file__).parent / "fixtures" / "uploader_outcomes.json"


@pytest.mark.parametrize("fixture", json.loads(FIXTURES.read_text(encoding="utf-8")))
def test_uploader_outcome_contract(fixture: dict) -> None:
    result = SauAdapter.execution_result(
        fixture["returnCode"],
        fixture["stdout"],
        fixture["stderr"],
    )
    assert result.condition.value == fixture["condition"], fixture["name"]


def test_cookie_paths_are_redacted() -> None:
    output = redact(r"cookie expired: C:\Users\creator\AppData\cookies\xiaohongshu_creator.json")
    assert "C:\\Users" not in output
    assert "[REDACTED_COOKIE_PATH]" in output


@pytest.mark.skipif(sys.platform != "win32", reason="Windows DPAPI contract")
def test_account_session_keeps_cookie_encrypted_at_rest(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("REVIEWFLOW_PUBLISHER_DATA_DIR", str(tmp_path))
    marker = b'{"cookie":"plain-secret-marker"}'
    with account_session("xiaohongshu", "creator") as account_file:
        account_file.write_bytes(marker)

    protected = tmp_path / "credentials" / "xiaohongshu_creator.dpapi"
    assert protected.is_file()
    assert marker not in protected.read_bytes()
    assert not any((tmp_path / "sessions").iterdir())

    with account_session("xiaohongshu", "creator") as account_file:
        assert account_file.read_bytes() == marker


def test_explicit_chromium_path_has_priority(tmp_path: Path, monkeypatch) -> None:
    browser = tmp_path / "portable-browser.exe"
    browser.write_bytes(b"browser fixture")
    monkeypatch.setenv("REVIEWFLOW_CHROME_EXECUTABLE", str(browser))
    assert resolve_chromium_executable() == browser.resolve()


def test_explicit_biliup_path_has_priority(tmp_path: Path, monkeypatch) -> None:
    biliup = tmp_path / "biliup.exe"
    biliup.write_bytes(b"biliup fixture")
    monkeypatch.setenv("REVIEWFLOW_BILIUP_EXECUTABLE", str(biliup))
    assert resolve_biliup_executable() == biliup.resolve()


def test_upstream_base_dir_remains_a_path(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delitem(sys.modules, "conf", raising=False)
    _install_upstream_config(tmp_path)
    assert sys.modules["conf"].BASE_DIR == tmp_path
    assert sys.modules["conf"].BASE_DIR / "utils" == tmp_path / "utils"


def test_offline_doctor_command_is_available() -> None:
    args = build_parser().parse_args(["doctor"])
    assert args.platform == "doctor"


def test_stale_plaintext_sessions_are_cleaned_without_touching_other_files(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("REVIEWFLOW_PUBLISHER_DATA_DIR", str(tmp_path))
    stale = tmp_path / "sessions" / "reviewflow-abandoned" / "cookies"
    stale.mkdir(parents=True)
    (stale / "account.json").write_text('{"cookie":"stale"}', encoding="utf-8")
    preserved = tmp_path / "sessions" / "operator-note"
    preserved.mkdir()

    assert cleanup_stale_sessions() == 1
    assert not stale.parent.exists()
    assert preserved.is_dir()


def make_manifest(media_path: Path, platform: Platform, *, bilibili_tid: int | None = None) -> PublishManifest:
    value = PublishManifest.model_validate({
        "id": f"manifest-{platform.value}-{media_path.stem}",
        "contentId": f"content-{media_path.stem}",
        "createdAt": "2026-01-01T00:00:00Z",
        "variants": [{
            "id": f"variant-{platform.value}-{media_path.stem}",
            "contentId": f"content-{media_path.stem}",
            "platform": platform.value,
            "accountId": "creator",
            "title": "可验证的测试标题",
            "body": "内容正文",
            "tags": ["复盘"],
            "mediaPaths": [str(media_path.resolve())],
            "bilibiliTid": bilibili_tid,
        }],
    })
    value.digest = manifest_digest(value)
    return value


@pytest.mark.parametrize(
    ("platform", "suffix", "expected_action", "bilibili_tid"),
    [
        (Platform.xiaohongshu, ".png", "upload-note", None),
        (Platform.douyin, ".mp4", "upload-video", None),
        (Platform.bilibili, ".mp4", "upload-video", 171),
    ],
)
def test_platform_command_mapping(
    tmp_path: Path,
    platform: Platform,
    suffix: str,
    expected_action: str,
    bilibili_tid: int | None,
) -> None:
    media = tmp_path / f"asset{suffix}"
    media.write_bytes(b"fixed uploader fixture")
    variant = make_manifest(media, platform, bilibili_tid=bilibili_tid).variants[0]
    command = SauAdapter(platform).preview(variant)
    assert command[:3] == ["sau", platform.value, expected_action]
    assert command[command.index("--account") + 1] == "creator"
    if platform is Platform.bilibili:
        assert command[command.index("--tid") + 1] == "171"
        assert "--headed" not in command
    else:
        assert "--headed" in command


def test_native_schedule_uses_local_wall_clock_and_rejects_naive_timestamps(tmp_path: Path) -> None:
    media = tmp_path / "scheduled.mp4"
    media.write_bytes(b"scheduled uploader fixture")
    manifest_payload = make_manifest(media, Platform.douyin).model_dump(mode="json")
    scheduled_at = datetime.now(timezone.utc) + timedelta(hours=3)
    manifest_payload["variants"][0]["scheduledAt"] = scheduled_at.isoformat()
    manifest = PublishManifest.model_validate(manifest_payload)
    command = SauAdapter(Platform.douyin).preview(manifest.variants[0])
    assert command[command.index("--schedule") + 1] == scheduled_at.astimezone().strftime("%Y-%m-%d %H:%M")

    manifest_payload["variants"][0]["scheduledAt"] = "2026-01-02T12:00:00"
    with pytest.raises(ValidationError, match="timezone offset"):
        PublishManifest.model_validate(manifest_payload)
    with pytest.raises(ValidationError, match="timezone offset"):
        MetricScheduleRequest(
            platform=Platform.douyin,
            publicationId="publication-naive",
            externalRef="https://www.douyin.com/video/fixture",
            publishedAt=datetime(2026, 1, 2, 12, 0),
        )


def test_cli_publish_summary_excludes_absolute_media_paths(tmp_path: Path) -> None:
    media = tmp_path / "private-folder" / "clip.mp4"
    media.parent.mkdir()
    media.write_bytes(b"summary fixture")
    summary = publish_summary(make_manifest(media, Platform.douyin))
    serialized = json.dumps(summary)
    assert summary["targets"][0]["media"] == ["clip.mp4"]
    assert str(tmp_path) not in serialized


def test_cli_preview_uses_service_level_manifest_rules(tmp_path: Path) -> None:
    media = tmp_path / "duplicate.mp4"
    media.write_bytes(b"duplicate platform fixture")
    value = make_manifest(media, Platform.douyin)
    duplicate = value.variants[0].model_copy(deep=True)
    duplicate.id = "variant-duplicate"
    value.variants.append(duplicate)
    value.digest = manifest_digest(value)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(value.model_dump_json(indent=2), encoding="utf-8")

    result = CliRunner().invoke(
        app,
        ["publish", "preview", str(manifest_path)],
        env={"REVIEWFLOW_DATA_DIR": str(tmp_path / "cli-data")},
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["valid"] is False
    assert any("不能重复同一平台" in warning for warning in payload["warnings"])


def test_bilibili_capability_matches_automatic_metric_collection() -> None:
    assert SauAdapter(Platform.bilibili).capability().supportsAutomaticMetrics is True
    assert SauAdapter(Platform.xiaohongshu).capability().supportsAutomaticMetrics is False


def test_raw_metric_snapshot_is_redacted_and_size_limited() -> None:
    request = MetricImportRequest(
        publicationId="publication-redacted",
        source="adapter",
        metrics=NormalizedMetrics(views=1),
        raw={
            "Authorization": "Bearer should-not-survive",
            "nested": {"cookie": "plain-cookie", "message": "api_key=plain-key"},
        },
    )
    serialized = json.dumps(request.raw)
    assert "should-not-survive" not in serialized
    assert "plain-cookie" not in serialized
    assert "plain-key" not in serialized
    assert "[REDACTED]" in serialized

    with pytest.raises(ValidationError, match="64 KiB"):
        MetricImportRequest(
            publicationId="publication-too-large",
            source="adapter",
            metrics=NormalizedMetrics(views=1),
            raw={f"field-{index}": "x" * 4_000 for index in range(20)},
        )


def test_publisher_store_records_its_schema_version(tmp_path: Path) -> None:
    database_path = tmp_path / "schema.sqlite3"
    Store(database_path)
    with sqlite3.connect(database_path) as connection:
        version = connection.execute("SELECT version FROM schema_meta LIMIT 1").fetchone()
    assert version == (SCHEMA_VERSION,)


class FakeAdapter:
    def __init__(self, platform: Platform, result: ExecutionResult | Exception):
        self.platform = platform
        self.result = result
        self.publish_calls = 0

    def validate(self, _variant) -> list[str]:
        return []

    def preview(self, variant) -> list[str]:
        action = "upload-note" if Path(variant.mediaPaths[0]).suffix == ".png" else "upload-video"
        return ["reviewflow-sau", variant.platform.value, action]

    def runtime_available(self) -> bool:
        return True

    async def publish(self, _variant) -> ExecutionResult:
        self.publish_calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeRegistry:
    def __init__(self, adapter: FakeAdapter):
        self.adapter = adapter

    def get(self, _platform: Platform) -> FakeAdapter:
        return self.adapter


def test_live_job_enters_processing_before_uploader_runs(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("REVIEWFLOW_LIVE_PUBLISH", "1")
    media = tmp_path / "processing.mp4"
    media.write_bytes(b"processing fixture")
    manifest = make_manifest(media, Platform.douyin)
    store = Store(tmp_path / "processing.sqlite3")
    observed: list[PublicationStatus] = []

    class InspectingAdapter(FakeAdapter):
        async def publish(self, _variant) -> ExecutionResult:
            job = store.get_job_by_idempotency("processing-state-fixture")
            assert job is not None
            observed.append(job.status)
            return ExecutionResult(0, '{"condition":"success"}', "")

    adapter = InspectingAdapter(Platform.douyin, ExecutionResult(0, "", ""))
    job = asyncio.run(PublishService(store, FakeRegistry(adapter)).execute(PublishExecuteRequest(
        manifest=manifest,
        confirmationDigest=manifest.digest or "",
        idempotencyKey="processing-state-fixture",
    )))
    assert observed == [PublicationStatus.processing]
    assert job.status is PublicationStatus.unknown


@pytest.mark.parametrize(
    ("platform", "suffix", "bilibili_tid"),
    [
        (Platform.xiaohongshu, ".png", None),
        (Platform.bilibili, ".mp4", 171),
    ],
)
def test_full_local_score_predict_publish_metrics_retro_flow(
    tmp_path: Path,
    monkeypatch,
    platform: Platform,
    suffix: str,
    bilibili_tid: int | None,
) -> None:
    monkeypatch.setenv("REVIEWFLOW_LIVE_PUBLISH", "1")
    assessments = [
        {"code": code, "score": 4, "evidence": f"fixture evidence for {code}"}
        for code in ("ER", "HP", "QL", "NA", "AB", "SR", "SAT")
    ]
    score = score_assessments(assessments)
    prediction = predict_views([{"views": value} for value in range(800, 1_800, 100)], score["composite"])
    prediction.update({
        "id": f"prediction-{platform.value}",
        "frozenAt": "2026-01-01T00:00:00Z",
        "ranges": {"views": prediction["views"]},
    })

    media = tmp_path / f"content{suffix}"
    media.write_bytes(b"reviewflow e2e fixture")
    manifest = make_manifest(media, platform, bilibili_tid=bilibili_tid)
    adapter = FakeAdapter(platform, ExecutionResult(0, "发布成功", ""))
    store = Store(tmp_path / f"{platform.value}.sqlite3")
    service = PublishService(store, FakeRegistry(adapter))
    preview = service.preview(manifest)
    assert preview.valid is True

    job = asyncio.run(service.execute(PublishExecuteRequest(
        manifest=manifest,
        confirmationDigest=preview.manifestDigest,
        idempotencyKey=f"e2e-{platform.value}-fixture",
    )))
    assert job.status is PublicationStatus.unknown
    assert adapter.publish_calls == 1

    snapshot = store.import_metrics(MetricImportRequest(
        publicationId=job.id,
        source="manual",
        metrics=NormalizedMetrics(views=prediction["views"]["p50"] + 100, likes=80, saves=25),
        raw={"fixture": platform.value},
    ))
    report = build_retro(
        prediction,
        snapshot.model_dump(mode="json"),
        "2026-01-01T00:00:00Z",
        datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(hours=72),
    )
    assert report["intervalHits"]["views"] is True


def test_process_crash_is_recoverable_without_duplicate_publish(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("REVIEWFLOW_LIVE_PUBLISH", "1")
    media = tmp_path / "crash.mp4"
    media.write_bytes(b"reviewflow crash fixture")
    manifest = make_manifest(media, Platform.douyin)
    adapter = FakeAdapter(Platform.douyin, RuntimeError("browser process crashed"))
    store_path = tmp_path / "resume.sqlite3"
    service = PublishService(Store(store_path), FakeRegistry(adapter))
    request = PublishExecuteRequest(
        manifest=manifest,
        confirmationDigest=manifest.digest or "",
        idempotencyKey="recover-after-process-crash",
    )

    first = asyncio.run(service.execute(request))
    resumed = asyncio.run(PublishService(Store(store_path), FakeRegistry(adapter)).execute(request))
    assert first.status is PublicationStatus.unknown
    assert resumed.id == first.id
    assert adapter.publish_calls == 1


def test_challenge_stops_and_requires_user_action(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("REVIEWFLOW_LIVE_PUBLISH", "1")
    media = tmp_path / "challenge.mp4"
    media.write_bytes(b"reviewflow challenge fixture")
    manifest = make_manifest(media, Platform.douyin)
    adapter = FakeAdapter(
        Platform.douyin,
        ExecutionResult(21, "检测到验证弹窗", "", ExecutionCondition.challenge),
    )
    job = asyncio.run(PublishService(Store(tmp_path / "challenge.sqlite3"), FakeRegistry(adapter)).execute(
        PublishExecuteRequest(
            manifest=manifest,
            confirmationDigest=manifest.digest or "",
            idempotencyKey="challenge-user-action-required",
        )
    ))
    assert job.status is PublicationStatus.failed
    assert job.details["userActionRequired"] is True


def test_each_platform_requires_operator_verification_before_batch_is_published(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("REVIEWFLOW_LIVE_PUBLISH", "1")
    media = tmp_path / "multi-platform.mp4"
    media.write_bytes(b"multi platform fixture")
    manifest = make_manifest(media, Platform.xiaohongshu)
    manifest.id = "manifest-multi-platform"
    second = manifest.variants[0].model_copy(deep=True)
    second.id = "variant-douyin-multi"
    second.platform = Platform.douyin
    manifest.variants.append(second)
    manifest.digest = manifest_digest(manifest)
    adapter = FakeAdapter(Platform.xiaohongshu, ExecutionResult(0, "发布成功", ""))
    service = PublishService(Store(tmp_path / "multi.sqlite3"), FakeRegistry(adapter))
    job = asyncio.run(service.execute(PublishExecuteRequest(
        manifest=manifest,
        confirmationDigest=manifest.digest,
        idempotencyKey="multi-platform-verification",
    )))
    assert job.status is PublicationStatus.unknown

    published_at = datetime(2026, 1, 2, tzinfo=timezone.utc)
    first = service.confirm_publication(job.id, PublicationConfirmRequest(
        platform=Platform.xiaohongshu,
        externalRef="https://www.xiaohongshu.com/explore/fixture",
        publishedAt=published_at,
    ))
    assert first.job.status is PublicationStatus.unknown
    assert first.publicationId.endswith(":xiaohongshu")
    assert first.metricTask.dueAt == published_at + timedelta(hours=72)

    duplicate = service.confirm_publication(job.id, PublicationConfirmRequest(
        platform=Platform.xiaohongshu,
        externalRef="https://www.xiaohongshu.com/explore/fixture",
        publishedAt=published_at,
    ))
    assert duplicate.metricTask.id == first.metricTask.id
    assert duplicate.job.updatedAt == first.job.updatedAt

    second_confirmation = service.confirm_publication(job.id, PublicationConfirmRequest(
        platform=Platform.douyin,
        externalRef="https://www.douyin.com/video/fixture",
        publishedAt=published_at,
    ))
    assert second_confirmation.job.status is PublicationStatus.published
    assert second_confirmation.publicationId.endswith(":douyin")
