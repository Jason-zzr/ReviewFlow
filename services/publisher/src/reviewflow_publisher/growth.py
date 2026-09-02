from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import floor, isfinite
from typing import Any

DIMENSION_CODES = ("ER", "HP", "QL", "NA", "AB", "SR", "SAT")
METRIC_NAMES = ("views", "likes", "saves", "comments", "shares", "followersGained")
COLD_BUCKETS = (
    {"bucket": "very_low", "probability": 0.3, "label": "低于 100"},
    {"bucket": "below_baseline", "probability": 0.4, "label": "100–1,000"},
    {"bucket": "baseline", "probability": 0.2, "label": "1,000–10,000"},
    {"bucket": "strong", "probability": 0.08, "label": "10,000–100,000"},
    {"bucket": "breakout", "probability": 0.02, "label": "高于 100,000"},
)
OBSERVED_BUCKET_DEFINITIONS = (
    {"bucket": "very_low", "label": "低于 0.3× 基线"},
    {"bucket": "below_baseline", "label": "0.3–1× 基线"},
    {"bucket": "baseline", "label": "1–3× 基线"},
    {"bucket": "strong", "label": "3–10× 基线"},
    {"bucket": "breakout", "label": "高于 10× 基线"},
)


def score_assessments(assessments: list[dict[str, Any]]) -> dict[str, Any]:
    by_code = {item.get("code"): item for item in assessments}
    if len(assessments) != len(DIMENSION_CODES) or set(by_code) != set(DIMENSION_CODES):
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


def _usable_metric(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value) and value >= 0


def _usable_row(row: dict[str, Any]) -> bool:
    return any(_usable_metric(row.get(metric)) for metric in METRIC_NAMES)


def _validate_score(score: float | None) -> None:
    if score is not None and (
        not isinstance(score, (int, float))
        or isinstance(score, bool)
        or not isfinite(score)
        or not 0 <= score <= 10
    ):
        raise ValueError("Content score must be finite and between 0 and 10")


def _confidence(sample_size: int) -> str:
    return "high" if sample_size >= 20 else "medium" if sample_size >= 10 else "low"


def _uplift(score: float | None) -> float:
    return 1 if score is None else min(1.45, max(0.65, 0.72 + score * 0.065))


def _round_like_javascript(value: float) -> int:
    return floor(value + 0.5)


def _quantile(values: list[float], percentile: float) -> float:
    sorted_values = sorted(values)
    if not sorted_values:
        return 0
    position = (len(sorted_values) - 1) * percentile
    lower_index = floor(position)
    upper_index = min(lower_index + 1, len(sorted_values) - 1)
    lower = sorted_values[lower_index]
    upper = sorted_values[upper_index]
    return lower + (upper - lower) * (position - lower_index)


def _observed_bucket_probabilities(values: list[float]) -> list[dict[str, Any]]:
    baseline = _quantile(values, 0.5)
    counts = [0, 0, 0, 0, 0]
    for value in values:
        ratio = 1 if baseline == 0 and value == 0 else float("inf") if baseline == 0 else value / baseline
        index = 0 if ratio < 0.3 else 1 if ratio < 1 else 2 if ratio < 3 else 3 if ratio < 10 else 4
        counts[index] += 1
    return [
        {**definition, "probability": counts[index] / len(values)}
        for index, definition in enumerate(OBSERVED_BUCKET_DEFINITIONS)
    ]


def build_prediction(input_value: dict[str, Any]) -> dict[str, Any]:
    """Build the full Prediction contract used by the desktop domain module."""
    required = ("id", "contentId", "platform", "accountId", "kind")
    missing = [name for name in required if not str(input_value.get(name) or "").strip()]
    if missing:
        raise ValueError(f"Structured prediction requires: {', '.join(missing)}")

    history = input_value.get("history", [])
    benchmarks = input_value.get("benchmarks", [])
    if not isinstance(history, list) or not all(isinstance(row, dict) for row in history):
        raise ValueError("Prediction history must be an array of sample objects")
    if not isinstance(benchmarks, list) or not all(isinstance(row, dict) for row in benchmarks):
        raise ValueError("Prediction benchmarks must be an array of sample objects")

    score = input_value.get("scoreComposite")
    _validate_score(score)
    platform = input_value["platform"]
    account_id = input_value["accountId"]
    kind = input_value["kind"]
    seen_snapshot_ids: set[str] = set()
    valid_history: list[dict[str, Any]] = []
    for sample in history:
        snapshot_id_value = sample.get("snapshotId")
        snapshot_id = snapshot_id_value.strip() if isinstance(snapshot_id_value, str) else ""
        metrics = sample.get("metrics")
        if (
            not snapshot_id
            or snapshot_id in seen_snapshot_ids
            or sample.get("platform") != platform
            or sample.get("accountId") != account_id
            or sample.get("kind") != kind
            or not isinstance(metrics, dict)
            or not _usable_row(metrics)
        ):
            continue
        seen_snapshot_ids.add(snapshot_id)
        valid_history.append(metrics)

    matching_benchmarks: list[dict[str, Any]] = []
    for sample in benchmarks:
        metrics = sample.get("metrics")
        if (
            sample.get("platform") == platform
            and sample.get("kind") == kind
            and isinstance(metrics, dict)
            and _usable_row(metrics)
        ):
            matching_benchmarks.append(metrics)

    if len(valid_history) >= 3:
        baseline_source = "account_history"
        source_rows = valid_history
    elif matching_benchmarks:
        baseline_source = "benchmarks"
        source_rows = matching_benchmarks
    else:
        baseline_source = "cold_start"
        source_rows = []

    ranges: dict[str, dict[str, int]] = {}
    uplift = _uplift(score)
    for metric in METRIC_NAMES:
        values = [row[metric] for row in source_rows if _usable_metric(row.get(metric))]
        if not values:
            continue
        ranges[metric] = {
            "p10": _round_like_javascript(max(0, _quantile(values, 0.1) * uplift)),
            "p50": _round_like_javascript(max(0, _quantile(values, 0.5) * uplift)),
            "p90": _round_like_javascript(max(0, _quantile(values, 0.9) * uplift)),
        }
    if not ranges:
        ranges["views"] = {"p10": 100, "p50": 1_000, "p90": 10_000}

    sample_size = len(source_rows)
    representative_metric = max(
        METRIC_NAMES,
        key=lambda metric: sum(_usable_metric(row.get(metric)) for row in source_rows),
    )
    representative_values = [
        row[representative_metric]
        for row in source_rows
        if _usable_metric(row.get(representative_metric))
    ]
    model = input_value.get("model")
    prompt_version = input_value.get("promptVersion")
    generated_at = input_value.get("generatedAt")
    return {
        "id": input_value["id"],
        "contentId": input_value["contentId"],
        "platform": platform,
        "accountId": account_id,
        "kind": kind,
        "ranges": ranges,
        "bucketProbabilities": [dict(item) for item in COLD_BUCKETS]
        if baseline_source == "cold_start"
        else _observed_bucket_probabilities(representative_values),
        "confidence": _confidence(sample_size),
        "baselineSource": baseline_source,
        "baselineSampleSize": sample_size,
        "rationale": [
            "暂无可用样本，使用公开冷启动先验。"
            if baseline_source == "cold_start"
            else (
                f"使用 {sample_size} 条同类样本的经验分位数构建区间，"
                f"档位分布按 {representative_metric} 的相对中位数统计。"
            ),
            "未使用内容评分修正。" if score is None else f"内容评分 {score:.1f}，用于有限幅度修正中枢。",
            "预测是区间判断，不承诺具体播放或互动结果。",
        ],
        "model": "deterministic-baseline" if model is None else model,
        "promptVersion": "prediction-v2" if prompt_version is None else prompt_version,
        "generatedAt": generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def predict_views(
    history: list[dict[str, Any]],
    score: float | None = None,
    benchmarks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    _validate_score(score)
    valid_history = [row for row in history if _usable_row(row)]
    valid_benchmarks = [row for row in (benchmarks or []) if _usable_row(row)]
    if len(valid_history) >= 3:
        baseline_source = "account_history"
        source_rows = valid_history
    elif valid_benchmarks:
        baseline_source = "benchmarks"
        source_rows = valid_benchmarks
    else:
        baseline_source = "cold_start"
        source_rows = []
    values = [row["views"] for row in source_rows if _usable_metric(row.get("views"))]
    sample_size = len(source_rows)
    if not values:
        return {
            "baselineSource": baseline_source,
            "sampleSize": sample_size,
            "confidence": _confidence(sample_size),
            "views": {"p10": 100, "p50": 1000, "p90": 10000},
        }
    uplift = _uplift(score)
    return {
        "baselineSource": baseline_source,
        "sampleSize": sample_size,
        "confidence": _confidence(sample_size),
        "views": {
            "p10": _round_like_javascript(_quantile(values, 0.1) * uplift),
            "p50": _round_like_javascript(_quantile(values, 0.5) * uplift),
            "p90": _round_like_javascript(_quantile(values, 0.9) * uplift),
        },
    }


def build_retro(
    prediction: dict[str, Any],
    snapshot: dict[str, Any],
    published_at: str,
    completed_at: datetime | None = None,
    *,
    publication_id: str | None = None,
) -> dict[str, Any]:
    if not prediction.get("frozenAt"):
        raise ValueError("Only frozen predictions can be reviewed")
    if publication_id is not None:
        if not publication_id.strip():
            raise ValueError("Publication ID is required")
        if snapshot.get("publicationId") != publication_id:
            raise ValueError("Snapshot publication does not match the retrospective")
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
    actual_metrics = {
        metric: metrics.get(metric) if _usable_metric(metrics.get(metric)) else None
        for metric in METRIC_NAMES
    }
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
        "publicationId": publication_id or snapshot.get("publicationId"),
        "actualMetrics": actual_metrics,
        "dueAt": due_at.isoformat().replace("+00:00", "Z"),
        "completedAt": completed.isoformat().replace("+00:00", "Z"),
        "intervalHits": interval_hits,
        "relativeErrors": relative_errors,
    }
