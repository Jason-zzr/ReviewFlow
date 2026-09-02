import type {
  BenchmarkSample,
  BucketProbability,
  ContentKind,
  MetricName,
  NormalizedMetrics,
  Platform,
  Prediction,
  PredictionHistorySample,
} from "./types.js";

const metricNames: MetricName[] = ["views", "likes", "saves", "comments", "shares", "followersGained"];

const quantile = (values: number[], percentile: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
};

const coldBuckets: BucketProbability[] = [
  { bucket: "very_low", probability: 0.3, label: "低于 100" },
  { bucket: "below_baseline", probability: 0.4, label: "100–1,000" },
  { bucket: "baseline", probability: 0.2, label: "1,000–10,000" },
  { bucket: "strong", probability: 0.08, label: "10,000–100,000" },
  { bucket: "breakout", probability: 0.02, label: "高于 100,000" },
];

const observedBucketDefinitions: Array<Omit<BucketProbability, "probability">> = [
  { bucket: "very_low", label: "低于 0.3× 基线" },
  { bucket: "below_baseline", label: "0.3–1× 基线" },
  { bucket: "baseline", label: "1–3× 基线" },
  { bucket: "strong", label: "3–10× 基线" },
  { bucket: "breakout", label: "高于 10× 基线" },
];

const isUsableMetricValue = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value >= 0;

const hasUsableMetrics = (row: NormalizedMetrics): boolean =>
  metricNames.some((metric) => isUsableMetricValue(row[metric]));

const metricValues = (rows: NormalizedMetrics[], metric: MetricName): number[] =>
  rows.flatMap((row) => {
    const value = row[metric];
    return isUsableMetricValue(value) ? [value] : [];
  });

const observedBucketProbabilities = (values: number[]): BucketProbability[] => {
  const baseline = quantile(values, 0.5);
  const counts = [0, 0, 0, 0, 0];
  for (const value of values) {
    const ratio = baseline === 0 ? (value === 0 ? 1 : Number.POSITIVE_INFINITY) : value / baseline;
    const index = ratio < 0.3 ? 0 : ratio < 1 ? 1 : ratio < 3 ? 2 : ratio < 10 ? 3 : 4;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return observedBucketDefinitions.map((definition, index) => ({
    ...definition,
    probability: (counts[index] ?? 0) / values.length,
  }));
};

export const buildPrediction = (input: {
  id: string;
  contentId: string;
  platform: Platform;
  accountId: string;
  kind: ContentKind;
  history: PredictionHistorySample[];
  benchmarks: BenchmarkSample[];
  scoreComposite?: number;
  generatedAt?: string;
  model?: string;
  promptVersion?: string;
}): Prediction => {
  if (
    input.scoreComposite !== undefined
    && (!Number.isFinite(input.scoreComposite) || input.scoreComposite < 0 || input.scoreComposite > 10)
  ) {
    throw new RangeError("Content score must be finite and between 0 and 10");
  }
  const seenHistoryIds = new Set<string>();
  const validHistory = input.history.filter((sample) => {
    const snapshotId = sample.snapshotId.trim();
    if (
      !snapshotId
      || seenHistoryIds.has(snapshotId)
      || sample.platform !== input.platform
      || sample.accountId !== input.accountId
      || sample.kind !== input.kind
      || !hasUsableMetrics(sample.metrics)
    ) {
      return false;
    }
    seenHistoryIds.add(snapshotId);
    return true;
  }).map((sample) => sample.metrics);
  const matchingBenchmarks = input.benchmarks.filter(
    (item) => item.platform === input.platform
      && item.kind === input.kind
      && hasUsableMetrics(item.metrics),
  );
  const sourceRows = validHistory.length >= 3
    ? validHistory
    : matchingBenchmarks.map((item) => item.metrics);
  const baselineSource = validHistory.length >= 3
    ? "account_history"
    : matchingBenchmarks.length > 0
      ? "benchmarks"
      : "cold_start";
  const sampleSize = sourceRows.length;
  const representativeMetric = metricNames.reduce((mostComplete, metric) =>
    metricValues(sourceRows, metric).length > metricValues(sourceRows, mostComplete).length
      ? metric
      : mostComplete,
  "views");
  const representativeValues = metricValues(sourceRows, representativeMetric);
  const uplift = input.scoreComposite === undefined
    ? 1
    : Math.min(1.45, Math.max(0.65, 0.72 + input.scoreComposite * 0.065));
  const ranges: Prediction["ranges"] = {};

  for (const metric of metricNames) {
    const values = metricValues(sourceRows, metric);
    if (values.length === 0) continue;
    ranges[metric] = {
      p10: Math.round(Math.max(0, quantile(values, 0.1) * uplift)),
      p50: Math.round(Math.max(0, quantile(values, 0.5) * uplift)),
      p90: Math.round(Math.max(0, quantile(values, 0.9) * uplift)),
    };
  }

  if (Object.keys(ranges).length === 0) {
    ranges.views = { p10: 100, p50: 1_000, p90: 10_000 };
  }

  const confidence: Prediction["confidence"] = sampleSize >= 20 ? "high" : sampleSize >= 10 ? "medium" : "low";
  return {
    id: input.id,
    contentId: input.contentId,
    platform: input.platform,
    accountId: input.accountId,
    kind: input.kind,
    ranges,
    bucketProbabilities: baselineSource === "cold_start"
      ? coldBuckets
      : observedBucketProbabilities(representativeValues),
    confidence,
    baselineSource,
    baselineSampleSize: sampleSize,
    rationale: [
      baselineSource === "cold_start"
        ? "暂无可用样本，使用公开冷启动先验。"
        : `使用 ${sampleSize} 条同类样本的经验分位数构建区间，档位分布按 ${representativeMetric} 的相对中位数统计。`,
      input.scoreComposite === undefined ? "未使用内容评分修正。" : `内容评分 ${input.scoreComposite.toFixed(1)}，用于有限幅度修正中枢。`,
      "预测是区间判断，不承诺具体播放或互动结果。",
    ],
    model: input.model ?? "deterministic-baseline",
    promptVersion: input.promptVersion ?? "prediction-v2",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
};

export const freezePrediction = (prediction: Prediction, at = new Date().toISOString()): Prediction => {
  if (prediction.frozenAt) throw new Error("Prediction is already frozen");
  if (!Number.isFinite(new Date(at).getTime())) throw new Error("Prediction freeze time is invalid");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(at)) throw new Error("Prediction freeze time must include a timezone");
  const ranges = Object.fromEntries(
    Object.entries(prediction.ranges).map(([metric, range]) => [
      metric,
      range ? Object.freeze({ ...range }) : range,
    ]),
  ) as Prediction["ranges"];
  const frozen = {
    ...prediction,
    ranges: Object.freeze(ranges),
    bucketProbabilities: Object.freeze(prediction.bucketProbabilities.map((item) => Object.freeze({ ...item }))),
    rationale: Object.freeze([...prediction.rationale]),
    frozenAt: at,
  };
  return Object.freeze(frozen) as Prediction;
};
