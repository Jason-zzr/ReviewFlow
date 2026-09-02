from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier, BrokenBarrierError, Lock

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from reviewflow_publisher.api import create_app
from reviewflow_publisher.adapters.base import ExecutionCondition, ExecutionResult
from reviewflow_publisher.cli import app
from reviewflow_publisher.digests import manifest_digest
from reviewflow_publisher.models import (
    MetricFetchResult,
    MetricImportRequest,
    MetricScheduleRequest,
    NormalizedMetrics,
    Platform,
    PublicationStatus,
    PublishExecuteRequest,
    PublishManifest,
)
from reviewflow_publisher.metrics import fetch_metrics
from reviewflow_publisher.models import MetricFetchRequest
from reviewflow_publisher.growth import build_retro, predict_views, score_assessments
from reviewflow_publisher.service import PublishService
from reviewflow_publisher.storage import StaleMetricClaim, Store
from reviewflow_publisher.scheduler import MetricScheduler


def manifest(media_path: Path) -> PublishManifest:
    media_path.write_bytes(b"reviewflow test media")
    value = PublishManifest.model_validate({
        "id": "manifest-1",
        "contentId": "content-1",
        "createdAt": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "variants": [{
            "id": "variant-1",
            "contentId": "content-1",
            "platform": "xiaohongshu",
            "accountId": "creator",
            "title": "测试标题",
            "body": "测试正文",
            "tags": ["测试"],
            "mediaPaths": [str(media_path.resolve())],
        }],
    })
    value.digest = manifest_digest(value)
    return value


def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("REVIEWFLOW_SESSION_TOKEN", "test-session-token-1234")
    monkeypatch.setenv("REVIEWFLOW_LIVE_PUBLISH", "0")
    return TestClient(create_app(Store(tmp_path / "reviewflow.sqlite3")))


def auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-session-token-1234"}


def test_manifest_digest_matches_typescript_contract():
    value = PublishManifest.model_validate({
        "id": "m1",
        "contentId": "c1",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "variants": [{
            "id": "v1",
            "contentId": "c1",
            "platform": "xiaohongshu",
            "accountId": "a1",
            "title": "T",
            "body": "B",
            "tags": ["x"],
            "mediaPaths": ["C:/demo.mp4"],
        }],
    })
    assert manifest_digest(value) == "f00397dbaa3f214630a7776f9663071e37e996fadf520dc6540b6f9fbd7ca3d7"


def test_publish_manifest_created_at_requires_timezone():
    with pytest.raises(ValueError, match="createdAt must include a timezone offset"):
        PublishManifest.model_validate({
            "id": "manifest-naive-created-at",
            "contentId": "content-1",
            "createdAt": "2026-01-01T00:00:00",
            "variants": [],
        })


def test_rejects_missing_session(tmp_path, monkeypatch):
    response = client(tmp_path, monkeypatch).get("/v1/adapters")
    assert response.status_code == 401


def test_rejects_unknown_origin(tmp_path, monkeypatch):
    response = client(tmp_path, monkeypatch).get(
        "/v1/adapters",
        headers={**auth(), "Origin": "https://attacker.example"},
    )
    assert response.status_code == 403


def test_dry_run_never_reports_published(tmp_path, monkeypatch):
    value = manifest(tmp_path / "demo.mp4")
    payload = {
        "manifest": value.model_dump(mode="json"),
        "confirmationDigest": value.digest,
        "idempotencyKey": "idem-manifest-1",
    }
    response = client(tmp_path, monkeypatch).post("/v1/publish/execute", headers=auth(), json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "awaiting_confirmation"
    assert response.json()["dryRun"] is True


def test_idempotency_returns_same_job(tmp_path, monkeypatch):
    value = manifest(tmp_path / "demo.mp4")
    payload = {
        "manifest": value.model_dump(mode="json"),
        "confirmationDigest": value.digest,
        "idempotencyKey": "idem-manifest-2",
    }
    test_client = client(tmp_path, monkeypatch)
    first = test_client.post("/v1/publish/execute", headers=auth(), json=payload).json()
    second = test_client.post("/v1/publish/execute", headers=auth(), json=payload).json()
    assert first["id"] == second["id"]


def test_publication_job_list_recovers_all_persisted_jobs(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEWFLOW_SESSION_TOKEN", "test-session-token-1234")
    store_path = tmp_path / "publication-list.sqlite3"
    store = Store(store_path)
    first = store.create_job(
        "manifest-1",
        "digest-1",
        "idempotency-list-1",
        PublicationStatus.processing,
        False,
        {},
    )
    second = store.create_job(
        "manifest-2",
        "digest-2",
        "idempotency-list-2",
        PublicationStatus.unknown,
        False,
        {},
    )

    response = TestClient(create_app(Store(store_path))).get("/v1/publications", headers=auth())

    assert response.status_code == 200
    assert {item["id"] for item in response.json()} == {first.id, second.id}


def test_concurrent_live_execution_claims_one_publish_job(tmp_path, monkeypatch):
    initial_reads = Barrier(2)
    read_lock = Lock()

    class RacingStore(Store):
        initial_read_count = 0

        def get_job_by_idempotency(self, key):
            with read_lock:
                synchronize = self.initial_read_count < 2
                if synchronize:
                    self.initial_read_count += 1
            result = super().get_job_by_idempotency(key)
            if synchronize:
                initial_reads.wait(timeout=5)
            return result

    class CountingAdapter:
        def __init__(self):
            self.publish_count = 0
            self.lock = Lock()

        def validate(self, _variant):
            return []

        def preview(self, _variant):
            return ["sau", "xiaohongshu", "upload-video"]

        def runtime_available(self):
            return True

        async def publish(self, _variant):
            with self.lock:
                self.publish_count += 1
            return ExecutionResult(0, "发布成功", "", ExecutionCondition.success)

    class Registry:
        def __init__(self, adapter):
            self.adapter = adapter

        def get(self, _platform):
            return self.adapter

    monkeypatch.setenv("REVIEWFLOW_LIVE_PUBLISH", "1")
    value = manifest(tmp_path / "concurrent.mp4")
    request = PublishExecuteRequest(
        manifest=value,
        confirmationDigest=value.digest,
        idempotencyKey="idem-concurrent-live",
    )
    adapter = CountingAdapter()
    service = PublishService(RacingStore(tmp_path / "concurrent.sqlite3"), Registry(adapter))

    with ThreadPoolExecutor(max_workers=2) as executor:
        jobs = list(executor.map(lambda _: asyncio.run(service.execute(request)), range(2)))

    assert jobs[0].id == jobs[1].id
    assert adapter.publish_count == 1


def test_modified_manifest_requires_new_preview(tmp_path, monkeypatch):
    value = manifest(tmp_path / "demo.mp4")
    digest = value.digest
    value.variants[0].title = "已被修改"
    response = client(tmp_path, monkeypatch).post(
        "/v1/publish/execute",
        headers=auth(),
        json={
            "manifest": value.model_dump(mode="json"),
            "confirmationDigest": digest,
            "idempotencyKey": "idem-manifest-3",
        },
    )
    assert response.status_code == 422


def test_idempotency_key_is_bound_to_manifest(tmp_path, monkeypatch):
    first_manifest = manifest(tmp_path / "first.mp4")
    first_payload = {
        "manifest": first_manifest.model_dump(mode="json"),
        "confirmationDigest": first_manifest.digest,
        "idempotencyKey": "idem-bound-manifest",
    }
    test_client = client(tmp_path, monkeypatch)
    assert test_client.post(
        "/v1/publish/execute", headers=auth(), json=first_payload
    ).status_code == 200

    second_manifest = manifest(tmp_path / "second.mp4")
    second_manifest.id = "manifest-2"
    second_manifest.digest = manifest_digest(second_manifest)
    second_payload = {
        "manifest": second_manifest.model_dump(mode="json"),
        "confirmationDigest": second_manifest.digest,
        "idempotencyKey": "idem-bound-manifest",
    }
    response = test_client.post(
        "/v1/publish/execute", headers=auth(), json=second_payload
    )
    assert response.status_code == 409


def test_preview_rejects_missing_media(tmp_path, monkeypatch):
    value = PublishManifest.model_validate({
        "id": "manifest-missing",
        "contentId": "content-1",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "variants": [{
            "id": "variant-1",
            "contentId": "content-1",
            "platform": "xiaohongshu",
            "accountId": "creator",
            "title": "测试标题",
            "body": "测试正文",
            "tags": [],
            "mediaPaths": [str(tmp_path / "missing.mp4")],
        }],
    })
    value.digest = manifest_digest(value)
    response = client(tmp_path, monkeypatch).post(
        "/v1/publish/preview",
        headers=auth(),
        json={"manifest": value.model_dump(mode="json")},
    )
    assert response.status_code == 200
    assert response.json()["valid"] is False
    assert "不存在" in response.json()["warnings"][0]


def test_preview_rejects_multiple_video_files(tmp_path, monkeypatch):
    value = manifest(tmp_path / "first.mp4")
    second = tmp_path / "second.mp4"
    second.write_bytes(b"second reviewflow test video")
    value.variants[0].mediaPaths = [
        str((tmp_path / "first.mp4").resolve()),
        str(second.resolve()),
    ]

    preview = PublishService(Store(tmp_path / "multiple-videos.sqlite3")).preview(value)

    assert preview.valid is False
    assert any("只能包含一个视频" in warning for warning in preview.warnings)


def test_bilibili_metrics_are_normalized():
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "code": 0,
                "data": {
                    "bvid": "BV1234567890",
                    "aid": 42,
                    "title": "demo",
                    "stat": {"view": 1000, "like": 90, "favorite": 30, "reply": 12, "share": 8},
                },
            }

    result = fetch_metrics(
        MetricFetchRequest(platform="bilibili", publicationId="p1", externalRef="BV1234567890"),
        get=lambda *_args, **_kwargs: FakeResponse(),
    )
    assert result.status == "collected"
    assert result.metrics is not None
    assert result.metrics.views == 1000
    assert result.metrics.saves == 30


def test_other_platform_metrics_fall_back_to_manual():
    result = fetch_metrics(
        MetricFetchRequest(platform="douyin", publicationId="p1", externalRef="https://example.invalid"),
    )
    assert result.status == "manual_required"


def test_metrics_import_rejects_an_unknown_publication(tmp_path, monkeypatch):
    response = client(tmp_path, monkeypatch).post(
        "/v1/metrics/import",
        headers=auth(),
        json={
            "publicationId": "publication-does-not-exist",
            "source": "manual",
            "metrics": {"views": 100},
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Confirmed publication not found"


def test_metric_schedule_rejects_an_unknown_publication(tmp_path, monkeypatch):
    response = client(tmp_path, monkeypatch).post(
        "/v1/metrics/schedule",
        headers=auth(),
        json={
            "platform": "bilibili",
            "publicationId": "publication-does-not-exist",
            "externalRef": "BV1234567890",
            "publishedAt": "2026-01-01T00:00:00Z",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Confirmed publication not found"


def test_metric_fetch_rejects_an_unknown_publication(tmp_path, monkeypatch):
    response = client(tmp_path, monkeypatch).post(
        "/v1/metrics/fetch",
        headers=auth(),
        json={
            "platform": "bilibili",
            "publicationId": "publication-does-not-exist",
            "externalRef": "BV1234567890",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Confirmed publication not found"


def test_metric_fetch_rejects_evidence_from_another_confirmed_post(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEWFLOW_SESSION_TOKEN", "test-session-token-1234")
    store = Store(tmp_path / "mismatched-metric-evidence.sqlite3")
    job = store.create_job(
        "manifest-metric-evidence",
        "digest-metric-evidence",
        "idempotency-metric-evidence",
        PublicationStatus.published,
        False,
        {
            "results": [{
                "platform": "bilibili",
                "status": "published",
                "operatorVerified": True,
                "externalRef": "BV1234567890",
            }],
        },
    )
    monkeypatch.setattr(
        "reviewflow_publisher.adapters.sau.SauAdapter.fetch_metrics",
        lambda _adapter, request: MetricFetchResult(
            status="manual_required",
            platform=request.platform,
            publicationId=request.publicationId,
            message="fixture should not be reached",
        ),
    )

    response = TestClient(create_app(store)).post(
        "/v1/metrics/fetch",
        headers=auth(),
        json={
            "platform": "bilibili",
            "publicationId": f"{job.id}:bilibili",
            "externalRef": "BV0987654321",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Confirmed publication evidence does not match"


def test_confirmed_publication_accepts_metric_schedule_and_import(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEWFLOW_SESSION_TOKEN", "test-session-token-1234")
    store = Store(tmp_path / "confirmed-metrics.sqlite3")
    job = store.create_job(
        "manifest-confirmed",
        "digest-confirmed",
        "idempotency-confirmed",
        PublicationStatus.published,
        False,
        {
            "results": [{
                "platform": "bilibili",
                "status": "published",
                "operatorVerified": True,
                "externalRef": "BV1234567890",
            }],
        },
    )
    publication_id = f"{job.id}:bilibili"
    test_client = TestClient(create_app(store))
    schedule = test_client.post(
        "/v1/metrics/schedule",
        headers=auth(),
        json={
            "platform": "bilibili",
            "publicationId": publication_id,
            "externalRef": "BV1234567890",
            "publishedAt": datetime.now(timezone.utc).isoformat(),
        },
    )
    imported = test_client.post(
        "/v1/metrics/import",
        headers=auth(),
        json={
            "publicationId": publication_id,
            "source": "manual",
            "metrics": {"views": 100},
        },
    )

    assert schedule.status_code == 200
    assert imported.status_code == 200
    assert imported.json()["publicationId"] == publication_id


def test_metric_schedule_cannot_rewrite_a_completed_task(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEWFLOW_SESSION_TOKEN", "test-session-token-1234")
    store = Store(tmp_path / "completed-metric-task.sqlite3")
    job = store.create_job(
        "manifest-completed-task",
        "digest-completed-task",
        "idempotency-completed-task",
        PublicationStatus.published,
        False,
        {
            "results": [{
                "platform": "bilibili",
                "status": "published",
                "operatorVerified": True,
                "externalRef": "BV1234567890",
            }],
        },
    )
    publication_id = f"{job.id}:bilibili"
    published_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    original = store.schedule_metrics(MetricScheduleRequest(
        platform="bilibili",
        publicationId=publication_id,
        externalRef="BV1234567890",
        publishedAt=published_at,
    ))
    store.update_metric_task(original.id, "collected")

    response = TestClient(create_app(store)).post(
        "/v1/metrics/schedule",
        headers=auth(),
        json={
            "platform": "bilibili",
            "publicationId": publication_id,
            "externalRef": "BV0987654321",
            "publishedAt": published_at.isoformat(),
        },
    )

    assert response.status_code == 409
    current = store.get_metric_task(Platform.bilibili, publication_id)
    assert current is not None
    assert current.status == "collected"
    assert current.externalRef == "BV1234567890"


def test_cli_growth_rules_match_starter_contract():
    assessments = [
        {"code": code, "score": 4, "evidence": "evidence"}
        for code in ("ER", "HP", "QL", "NA", "AB", "SR", "SAT")
    ]
    assert score_assessments(assessments)["composite"] == 8
    prediction = predict_views([{"views": 1000}] * 10, score=8)
    assert prediction["confidence"] == "medium"
    assert prediction["views"]["p50"] > 1000


def test_cli_scoring_rejects_duplicate_dimensions():
    assessments = [
        {"code": code, "score": 4, "evidence": "evidence"}
        for code in ("ER", "HP", "QL", "NA", "AB", "SR", "SAT")
    ]
    assessments.append({"code": "ER", "score": 5, "evidence": "duplicate"})
    with pytest.raises(ValueError, match="exactly once"):
        score_assessments(assessments)


def test_cli_prediction_falls_back_to_valid_benchmarks():
    prediction = predict_views(
        [{"views": None}, {"views": float("nan")}, {"views": -1}],
        benchmarks=[{"views": 1_000}, {"views": 2_000}],
    )
    assert prediction["baselineSource"] == "benchmarks"
    assert prediction["sampleSize"] == 2
    assert prediction["views"]["p50"] == 1_500


def test_content_predict_cli_accepts_history_and_benchmark_payload(tmp_path: Path):
    input_file = tmp_path / "prediction-input.json"
    input_file.write_text(json.dumps({
        "history": [{"views": None}, {"views": -1}, {"likes": -1}],
        "benchmarks": [{"views": 1_000}, {"views": 2_000}],
    }), encoding="utf-8")

    result = CliRunner().invoke(app, ["content", "predict", str(input_file)])

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["baselineSource"] == "benchmarks"
    assert payload["sampleSize"] == 2


def test_cli_prediction_rejects_a_non_finite_content_score():
    with pytest.raises(ValueError, match="finite.*0.*10"):
        predict_views([{"views": 1_000}] * 3, score=float("nan"))


def test_cli_retro_enforces_t_plus_three():
    prediction = {
        "id": "prediction-1",
        "frozenAt": "2026-01-01T00:00:00Z",
        "ranges": {"views": {"p10": 100, "p50": 1000, "p90": 3000}},
    }
    snapshot = {
        "id": "snapshot-1",
        "capturedAt": "2026-01-04T00:00:00Z",
        "metrics": {"views": 1200},
    }
    report = build_retro(
        prediction,
        snapshot,
        "2026-01-01T00:00:00Z",
        datetime(2026, 1, 4, tzinfo=timezone.utc),
    )
    assert report["intervalHits"]["views"] is True


def test_cli_retro_rejects_a_snapshot_captured_before_t_plus_three():
    prediction = {
        "id": "prediction-early-snapshot",
        "frozenAt": "2026-01-01T00:00:00Z",
        "ranges": {"views": {"p10": 100, "p50": 1000, "p90": 3000}},
    }
    snapshot = {
        "id": "snapshot-before-due",
        "capturedAt": "2026-01-03T23:59:59Z",
        "metrics": {"views": 1200},
    }
    with pytest.raises(ValueError, match="Snapshot.*72 hours"):
        build_retro(
            prediction,
            snapshot,
            "2026-01-01T00:00:00Z",
            datetime(2026, 1, 5, tzinfo=timezone.utc),
        )


def test_t_plus_three_queue_resumes_and_requests_manual_fallback(tmp_path):
    store = Store(tmp_path / "queue.sqlite3")
    task = store.schedule_metrics(MetricScheduleRequest(
        platform="douyin",
        publicationId="publication-queued",
        externalRef="https://www.douyin.com/video/demo",
        publishedAt=datetime.now(timezone.utc) - timedelta(hours=73),
    ))
    assert task.status == "pending"
    assert len(store.due_metric_tasks()) == 1
    assert asyncio.run(MetricScheduler(store).collect_due()) == 1
    assert store.due_metric_tasks() == []


def test_metric_task_list_recovers_all_persisted_queue_items(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEWFLOW_SESSION_TOKEN", "test-session-token-1234")
    store_path = tmp_path / "metric-task-list.sqlite3"
    store = Store(store_path)
    first = store.schedule_metrics(MetricScheduleRequest(
        platform="douyin",
        publicationId="publication-task-list-1",
        externalRef="https://www.douyin.com/video/one",
        publishedAt=datetime.now(timezone.utc),
    ))
    second = store.schedule_metrics(MetricScheduleRequest(
        platform="bilibili",
        publicationId="publication-task-list-2",
        externalRef="BV1234567890",
        publishedAt=datetime.now(timezone.utc),
    ))

    response = TestClient(create_app(Store(store_path))).get("/v1/metrics/tasks", headers=auth())

    assert response.status_code == 200
    assert {item["id"] for item in response.json()} == {first.id, second.id}


def test_concurrent_metric_schedulers_claim_a_due_task_once(tmp_path, monkeypatch):
    store = Store(tmp_path / "concurrent-metrics.sqlite3")
    store.schedule_metrics(MetricScheduleRequest(
        platform="bilibili",
        publicationId="publication-concurrent-metrics",
        externalRef="BV1234567890",
        publishedAt=datetime.now(timezone.utc) - timedelta(hours=73),
    ))
    fetch_barrier = Barrier(2)
    fetch_lock = Lock()
    fetch_count = 0

    def collect_fixture(request):
        nonlocal fetch_count
        with fetch_lock:
            fetch_count += 1
        try:
            fetch_barrier.wait(timeout=0.5)
        except BrokenBarrierError:
            pass
        return MetricFetchResult(
            status="collected",
            platform=request.platform,
            publicationId=request.publicationId,
            metrics=NormalizedMetrics(views=100),
            message="fixture collected",
        )

    monkeypatch.setattr(
        "reviewflow_publisher.adapters.sau.SauAdapter.fetch_metrics",
        lambda _adapter, request: collect_fixture(request),
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        processed = list(executor.map(
            lambda _: asyncio.run(MetricScheduler(store).collect_due()),
            range(2),
        ))

    assert sum(processed) == 1
    assert fetch_count == 1
    assert store.latest_metrics("publication-concurrent-metrics") is not None


def test_abandoned_metric_claim_becomes_due_after_its_lease(tmp_path):
    store = Store(tmp_path / "metric-lease.sqlite3")
    now = datetime(2026, 1, 5, tzinfo=timezone.utc)
    store.schedule_metrics(MetricScheduleRequest(
        platform="bilibili",
        publicationId="publication-metric-lease",
        externalRef="BV1234567890",
        publishedAt=now - timedelta(hours=73),
    ))

    assert len(store.claim_due_metric_tasks(now, lease=timedelta(seconds=30))) == 1
    assert store.claim_due_metric_tasks(now + timedelta(seconds=29)) == []
    assert len(store.claim_due_metric_tasks(now + timedelta(seconds=31))) == 1


def test_stale_metric_claim_cannot_complete_after_lease_reassignment(tmp_path):
    store = Store(tmp_path / "stale-metric-claim.sqlite3")
    now = datetime(2026, 1, 5, tzinfo=timezone.utc)
    store.schedule_metrics(MetricScheduleRequest(
        platform="bilibili",
        publicationId="publication-stale-claim",
        externalRef="BV1234567890",
        publishedAt=now - timedelta(hours=73),
    ))
    first = store.claim_due_metric_tasks(now, lease=timedelta(seconds=30))[0]
    second = store.claim_due_metric_tasks(now + timedelta(seconds=31))[0]
    assert first.token != second.token
    metrics = MetricImportRequest(
        publicationId="publication-stale-claim",
        source="adapter",
        metrics=NormalizedMetrics(views=100),
    )

    with pytest.raises(StaleMetricClaim):
        store.record_collected_metrics(first.task.id, first.token, metrics)
    snapshot = store.record_collected_metrics(second.task.id, second.token, metrics)

    assert snapshot.publicationId == "publication-stale-claim"
    task = store.get_metric_task(Platform.bilibili, "publication-stale-claim")
    assert task is not None
    assert task.status == "collected"


def test_metric_collection_stops_after_three_errors_and_requests_manual_input(tmp_path, monkeypatch):
    store = Store(tmp_path / "retry-limit.sqlite3")
    task = store.schedule_metrics(MetricScheduleRequest(
        platform="bilibili",
        publicationId="publication-retry-limit",
        externalRef="BV1234567890",
        publishedAt=datetime.now(timezone.utc) - timedelta(hours=73),
    ))

    def fail_collection(_request):
        raise RuntimeError("Authorization: Bearer secret-retry-token")

    monkeypatch.setattr(
        "reviewflow_publisher.adapters.sau.SauAdapter.fetch_metrics",
        lambda _adapter, request: fail_collection(request),
    )
    for attempt in range(3):
        if attempt:
            with store.connect() as connection:
                connection.execute(
                    "UPDATE metric_collection_queue SET next_attempt_at=? WHERE id=?",
                    ((datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(), task.id),
                )
        assert asyncio.run(MetricScheduler(store).collect_due()) == 1

    final = store.get_metric_task(task.platform, task.publicationId)
    assert final is not None
    assert final.status == "manual_required"
    assert final.attempts == 3
    assert final.lastError is not None
    assert "secret-retry-token" not in final.lastError
    assert store.due_metric_tasks(now=datetime.now(timezone.utc) + timedelta(days=30)) == []
