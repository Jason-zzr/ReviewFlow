from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from reviewflow_publisher.api import create_app
from reviewflow_publisher.digests import manifest_digest
from reviewflow_publisher.models import MetricScheduleRequest, PublishManifest
from reviewflow_publisher.metrics import fetch_metrics
from reviewflow_publisher.models import MetricFetchRequest
from reviewflow_publisher.growth import build_retro, predict_views, score_assessments
from reviewflow_publisher.storage import Store
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


def test_cli_growth_rules_match_starter_contract():
    assessments = [
        {"code": code, "score": 4, "evidence": "evidence"}
        for code in ("ER", "HP", "QL", "NA", "AB", "SR", "SAT")
    ]
    assert score_assessments(assessments)["composite"] == 8
    prediction = predict_views([{"views": 1000}] * 10, score=8)
    assert prediction["confidence"] == "medium"
    assert prediction["views"]["p50"] > 1000


def test_cli_retro_enforces_t_plus_three():
    prediction = {
        "id": "prediction-1",
        "frozenAt": "2026-01-01T00:00:00Z",
        "ranges": {"views": {"p10": 100, "p50": 1000, "p90": 3000}},
    }
    snapshot = {"id": "snapshot-1", "metrics": {"views": 1200}}
    report = build_retro(
        prediction,
        snapshot,
        "2026-01-01T00:00:00Z",
        datetime(2026, 1, 4, tzinfo=timezone.utc),
    )
    assert report["intervalHits"]["views"] is True


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

    monkeypatch.setattr("reviewflow_publisher.scheduler.fetch_metrics", fail_collection)
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
