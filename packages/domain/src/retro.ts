import type { MetricName, PerformanceSnapshot, Prediction, RetroReport } from "./types.js";

const metricNames: MetricName[] = ["views", "likes", "saves", "comments", "shares", "followersGained"];

export const retroDueAt = (publishedAt: string): string =>
  new Date(new Date(publishedAt).getTime() + 72 * 60 * 60 * 1_000).toISOString();

export const isRetroDue = (publishedAt: string, now = new Date()): boolean =>
  now.getTime() >= new Date(retroDueAt(publishedAt)).getTime();

export const buildRetroReport = (input: {
  id: string;
  publicationId: string;
  publishedAt: string;
  prediction: Prediction;
  snapshot: PerformanceSnapshot;
  completedAt?: string;
}): RetroReport => {
  if (!input.prediction.frozenAt) throw new Error("Only frozen predictions can be reviewed");
  if (input.snapshot.publicationId !== input.publicationId) {
    throw new Error("Snapshot publication does not match retrospective publication");
  }
  const completedAt = input.completedAt ?? new Date().toISOString();
  const completedAtTime = new Date(completedAt).getTime();
  const dueAt = retroDueAt(input.publishedAt);
  const dueAtTime = new Date(dueAt).getTime();
  const capturedAtTime = new Date(input.snapshot.capturedAt).getTime();
  if (!Number.isFinite(completedAtTime)) throw new Error("Retrospective completion time is invalid");
  if (!Number.isFinite(capturedAtTime)) throw new Error("Snapshot capture time is invalid");
  if (completedAtTime < dueAtTime) {
    throw new Error("Retrospective is available 72 hours after publication");
  }
  if (capturedAtTime < dueAtTime) throw new Error("Snapshot must be captured at least 72 hours after publication");
  if (capturedAtTime > completedAtTime) throw new Error("Snapshot cannot be captured after the retrospective is completed");
  const intervalHits: RetroReport["intervalHits"] = {};
  const relativeErrors: RetroReport["relativeErrors"] = {};
  const insights: string[] = [];
  for (const metric of metricNames) {
    const range = input.prediction.ranges[metric];
    const actual = input.snapshot.metrics[metric];
    if (!range || actual === null) continue;
    intervalHits[metric] = actual >= range.p10 && actual <= range.p90;
    relativeErrors[metric] = range.p50 === 0 ? 0 : Number(((actual - range.p50) / range.p50).toFixed(4));
  }
  const viewsError = relativeErrors.views;
  if (viewsError !== undefined) {
    insights.push(
      Math.abs(viewsError) <= 0.3
        ? "播放中枢误差控制在 30% 内，当前基线可继续观察。"
        : viewsError > 0
          ? "实际播放显著高于预测，检查选题、开场和传播触发点。"
          : "实际播放低于预测，检查冷启动分发、封面标题和前段留存。",
    );
  }
  if (insights.length === 0) insights.push("当前指标不足，补录可用数据后再形成判断。");
  return {
    id: input.id,
    publicationId: input.publicationId,
    predictionId: input.prediction.id,
    snapshotId: input.snapshot.id,
    actualMetrics: { ...input.snapshot.metrics },
    dueAt,
    completedAt,
    intervalHits,
    relativeErrors,
    insights,
    nextActions: ["保留预测原文", "把可复用观察加入公式实验池", "用下一条同类内容验证，而不是立即改公式"],
  };
};
