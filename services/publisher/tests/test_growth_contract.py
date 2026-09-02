from datetime import datetime, timezone

from reviewflow_publisher.growth import build_retro


def test_retro_preserves_a_detached_copy_of_actual_metrics() -> None:
    prediction = {
        "id": "prediction-actual-metrics",
        "frozenAt": "2026-01-01T00:00:00Z",
        "ranges": {"views": {"p10": 100, "p50": 1_000, "p90": 10_000}},
    }
    snapshot = {
        "id": "snapshot-actual-metrics",
        "publicationId": "publication-actual-metrics",
        "capturedAt": "2026-01-04T00:00:00Z",
        "metrics": {
            "views": 1_200,
            "likes": 120,
            "saves": 42,
            "comments": 18,
            "shares": 9,
            "followersGained": 7,
        },
    }

    report = build_retro(
        prediction,
        snapshot,
        "2026-01-01T00:00:00Z",
        datetime(2026, 1, 4, tzinfo=timezone.utc),
        publication_id="publication-actual-metrics",
    )
    snapshot["metrics"]["views"] = 999_999

    assert report["actualMetrics"] == {
        "views": 1_200,
        "likes": 120,
        "saves": 42,
        "comments": 18,
        "shares": 9,
        "followersGained": 7,
    }
