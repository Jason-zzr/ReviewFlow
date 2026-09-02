from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any

DIMENSION_CODES = ("ER", "HP", "QL", "NA", "AB", "SR", "SAT")


def score_assessments(assessments: list[dict[str, Any]]) -> dict[str, Any]:
    by_code = {item.get("code"): item for item in assessments}
    if set(by_code) != set(DIMENSION_CODES):
        raise ValueError("Assessments must contain each starter dimension exactly once")
    scores: list[int] = []
    for code in DIMENSION_CODES:
        item = by_code[code]
        score = item.get("score")
        if not isinstance(score, int) or not 0 <= score <= 5:
            raise ValueError(f"{code} score must be an integer from 0 to 5")
        if not str(item.get("evidence") or "").strip():
            raise ValueError(f"{code} requires evidence")
        scores.append(score)
    return {"composite": round(sum(scores) / len(scores) * 2, 2), "assessments": assessments}


def predict_views(history: list[dict[str, Any]], score: float | None = None) -> dict[str, Any]:
    values = [row["views"] for row in history if isinstance(row.get("views"), int) and row["views"] >= 0]
    if not values:
        return {
            "baselineSource": "cold_start",
            "sampleSize": 0,
            "confidence": "low",
            "views": {"p10": 100, "p50": 1000, "p90": 10000},
        }
    uplift = 1 if score is None else min(1.45, max(0.65, 0.72 + score * 0.065))
    center = median(values) * uplift
    sample_size = len(values)
    return {
        "baselineSource": "account_history",
        "sampleSize": sample_size,
        "confidence": "high" if sample_size >= 20 else "medium" if sample_size >= 10 else "low",
        "views": {"p10": round(center * 0.35), "p50": round(center), "p90": round(center * 3)},
    }


def build_retro(
    prediction: dict[str, Any],
    snapshot: dict[str, Any],
    published_at: str,
    completed_at: datetime | None = None,
) -> dict[str, Any]:
    if not prediction.get("frozenAt"):
        raise ValueError("Only frozen predictions can be reviewed")
    published = datetime.fromisoformat(published_at.replace("Z", "+00:00")).astimezone(timezone.utc)
    completed = (completed_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    due_at = published + timedelta(hours=72)
    if completed < due_at:
        raise ValueError("Retrospective is available 72 hours after publication")
    captured_at_value = snapshot.get("capturedAt")
    if not isinstance(captured_at_value, str):
        raise ValueError("Snapshot capture time is required")
    try:
        captured_at = datetime.fromisoformat(captured_at_value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Snapshot capture time is invalid") from error
    if captured_at.tzinfo is None:
        raise ValueError("Snapshot capture time must include a timezone")
    captured_at = captured_at.astimezone(timezone.utc)
    if captured_at < due_at:
        raise ValueError("Snapshot must be captured at least 72 hours after publication")
    if captured_at > completed:
        raise ValueError("Snapshot cannot be captured after the retrospective is completed")
    interval_hits: dict[str, bool] = {}
    relative_errors: dict[str, float] = {}
    ranges = prediction.get("ranges") or {}
    metrics = snapshot.get("metrics") or {}
    for metric in ("views", "likes", "saves", "comments", "shares", "followersGained"):
        range_value = ranges.get(metric)
        actual = metrics.get(metric)
        if not isinstance(range_value, dict) or not isinstance(actual, (int, float)):
            continue
        interval_hits[metric] = range_value["p10"] <= actual <= range_value["p90"]
        relative_errors[metric] = 0 if range_value["p50"] == 0 else round(
            (actual - range_value["p50"]) / range_value["p50"], 4
        )
    return {
        "predictionId": prediction.get("id"),
        "snapshotId": snapshot.get("id"),
        "dueAt": due_at.isoformat().replace("+00:00", "Z"),
        "completedAt": completed.isoformat().replace("+00:00", "Z"),
        "intervalHits": interval_hits,
        "relativeErrors": relative_errors,
    }
