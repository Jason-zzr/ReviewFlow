import type {
  BenchmarkSample,
  BucketProbability,
  ContentKind,
  MetricName,
  NormalizedMetrics,
  Platform,
  Prediction,
} from "./types.js";

const metricNames: MetricName[] = ["views", "likes", "saves", "comments", "shares", "followersGained"];

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const coldBuckets: BucketProbability[] = [
  { bucket: "very_low", probability: 0.3, label: "低于 100" },
  { bucket: "below_baseline", probability: 0.4, label: "100–1,000" },
  { bucket: "baseline", probability: 0.2, label: "1,000–10,000" },
  { bucket: "strong", probability: 0.08, label: "10,000–100,000" },
  { bucket: "breakout", probability: 0.02, label: "高于 100,000" },
];

const calibratedBuckets: BucketProbability[] = [
  { bucket: "very_low", probability: 0.1, label: "低于 0.3× 基线" },
  { bucket: "below_baseline", probability: 0.24, label: "0.3–1× 基线" },
  { bucket: "baseline", probability: 0.42, label: "1–3× 基线" },
  { bucket: "strong", probability: 0.19, label: "3–10× 基线" },
  { bucket: "breakout", probability: 0.05, label: "高于 10× 基线" },
];

const metricValues = (rows: NormalizedMetrics[], metric: MetricName): number[] =>
  rows.flatMap((row) => {
    const value = row[metric];
    return value === null || value < 0 ? [] : [value];
  });

export const buildPrediction = (input: {
  id: string;
  contentId: string;
  platform: Platform;
  accountId: string;
  kind: ContentKind;
  history: NormalizedMetrics[];
  benchmarks: BenchmarkSample[];
  scoreComposite?: number;
  generatedAt?: string;
  model?: string;
  promptVersion?: string;
}): Prediction => {
  const matchingBenchmarks = input.benchmarks.filter(
    (item) => item.platform === input.platform && item.kind === input.kind,
  );
  const sourceRows = input.history.length >= 3
    ? input.history
    : matchingBenchmarks.map((item) => item.metrics);
  const baselineSource = input.history.length >= 3
    ? "account_history"
    : matchingBenchmarks.length > 0
      ? "benchmarks"
      : "cold_start";
  const sampleSize = sourceRows.length;
  const uplift = input.scoreComposite === undefined
    ? 1
    : Math.min(1.45, Math.max(0.65, 0.72 + input.scoreComposite * 0.065));
  const ranges: Prediction["ranges"] = {};

  for (const metric of metricNames) {
    const values = metricValues(sourceRows, metric);
    if (values.length === 0) continue;
    const center = Math.max(0, median(values) * uplift);
    ranges[metric] = {
      p10: Math.round(center * 0.35),
      p50: Math.round(center),
      p90: Math.round(center * 3),
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
    ranges,
    bucketProbabilities: baselineSource === "cold_start" ? coldBuckets : calibratedBuckets,
    confidence,
    baselineSource,
    baselineSampleSize: sampleSize,
    rationale: [
      baselineSource === "cold_start" ? "暂无可用样本，使用公开冷启动先验。" : `使用 ${sampleSize} 条同类样本的中位数作为基线。`,
      input.scoreComposite === undefined ? "未使用内容评分修正。" : `内容评分 ${input.scoreComposite.toFixed(1)}，用于有限幅度修正中枢。`,
      "预测是区间判断，不承诺具体播放或互动结果。",
    ],
    model: input.model ?? "deterministic-baseline",
    promptVersion: input.promptVersion ?? "prediction-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
};

export const freezePrediction = (prediction: Prediction, at = new Date().toISOString()): Prediction => {
  if (prediction.frozenAt) throw new Error("Prediction is already frozen");
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
