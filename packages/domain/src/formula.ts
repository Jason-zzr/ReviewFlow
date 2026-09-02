import type {
  ContentKind,
  DimensionAssessment,
  Platform,
  RetroReport,
  RubricDimensionCode,
  RubricVersion,
} from "./types.js";
import { calculateComposite } from "./scoring.js";

export interface RubricBumpEvaluation {
  eligible: boolean;
  sampleSize: number;
  rankingConsistency: number;
  pairwiseRegressions: number;
  reason: string;
}

export interface FormulaCalibrationSample {
  id: string;
  platform: Platform;
  accountId: string;
  kind: ContentKind;
  assessments: DimensionAssessment[];
  observedPerformance: number;
}

export interface RubricExperiment {
  candidate: RubricVersion;
  evaluation: RubricBumpEvaluation;
  correlations: Record<RubricDimensionCode, number>;
}

export interface RubricExperimentContext {
  platform: Platform;
  accountId: string;
  kind: ContentKind;
}

export interface RubricExperimentRecord {
  readonly id: string;
  readonly experiment: RubricExperiment;
  readonly context: RubricExperimentContext;
  readonly sampleIds: readonly string[];
  readonly status: "pending" | "accepted";
  readonly createdAt: string;
  readonly acceptedAt?: string;
  readonly activatedRubricId?: string;
}

export const createRubricExperimentRecord = (input: {
  id: string;
  experiment: RubricExperiment;
  context: RubricExperimentContext;
  sampleIds: string[];
}): RubricExperimentRecord => {
  const id = input.id.trim();
  const accountId = input.context.accountId.trim();
  const sampleIds = input.sampleIds.map((sampleId) => sampleId.trim());
  if (!id || !accountId) throw new Error("Formula experiment record requires an ID and account context");
  if (sampleIds.some((sampleId) => !sampleId) || new Set(sampleIds).size !== sampleIds.length) {
    throw new Error("Formula experiment record requires unique non-blank sample IDs");
  }
  const candidate = Object.freeze({
    ...input.experiment.candidate,
    dimensions: Object.freeze(input.experiment.candidate.dimensions.map((dimension) =>
      Object.freeze({ ...dimension }))),
  }) as RubricVersion;
  const experiment = Object.freeze({
    candidate,
    evaluation: Object.freeze({ ...input.experiment.evaluation }),
    correlations: Object.freeze({ ...input.experiment.correlations }),
  }) as RubricExperiment;
  return Object.freeze({
    id,
    experiment,
    context: Object.freeze({ ...input.context, accountId }),
    sampleIds: Object.freeze(sampleIds),
    status: "pending" as const,
    createdAt: candidate.createdAt,
  });
};

const ranks = (values: number[]): number[] => {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const result = Array(values.length).fill(0) as number[];
  let start = 0;
  while (start < ordered.length) {
    let end = start + 1;
    while (end < ordered.length && ordered[end]!.value === ordered[start]!.value) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) result[ordered[index]!.index] = averageRank;
    start = end;
  }
  return result;
};

const spearman = (left: number[], right: number[]): number => {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftRanks = ranks(left);
  const rightRanks = ranks(right);
  const leftMean = leftRanks.reduce((sum, rank) => sum + rank, 0) / leftRanks.length;
  const rightMean = rightRanks.reduce((sum, rank) => sum + rank, 0) / rightRanks.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < leftRanks.length; index += 1) {
    const leftDifference = leftRanks[index]! - leftMean;
    const rightDifference = rightRanks[index]! - rightMean;
    covariance += leftDifference * rightDifference;
    leftVariance += leftDifference * leftDifference;
    rightVariance += rightDifference * rightDifference;
  }
  if (leftVariance === 0 || rightVariance === 0) return 0;
  return Math.max(-1, Math.min(1, covariance / Math.sqrt(leftVariance * rightVariance)));
};

export const canSuggestRubricUpdate = (retros: RetroReport[]): boolean => {
  const ids = retros.map((retro) => retro.id.trim()).filter(Boolean);
  return new Set(ids).size >= 10;
};

export const evaluateRubricBump = (input: {
  retros: RetroReport[];
  oldScores: number[];
  newScores: number[];
  observedPerformance: number[];
}): RubricBumpEvaluation => {
  const sampleSize = input.oldScores.length;
  if (sampleSize < 10 || input.newScores.length !== sampleSize || input.observedPerformance.length !== sampleSize) {
    return { eligible: false, sampleSize, rankingConsistency: 0, pairwiseRegressions: 0, reason: "校准池至少需要 10 条完整样本" };
  }
  if (!canSuggestRubricUpdate(input.retros)) {
    return { eligible: false, sampleSize, rankingConsistency: 0, pairwiseRegressions: 0, reason: "同类复盘未满 10 条" };
  }
  const hasInvalidValue = [...input.oldScores, ...input.newScores].some((value) => !Number.isFinite(value))
    || input.observedPerformance.some((value) => !Number.isFinite(value) || value < 0);
  if (hasInvalidValue) {
    return {
      eligible: false,
      sampleSize,
      rankingConsistency: 0,
      pairwiseRegressions: 0,
      reason: "Backtest requires finite scores and finite non-negative observed performance",
    };
  }
  const consistency = spearman(input.oldScores, input.newScores);
  let regressions = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    for (let j = i + 1; j < sampleSize; j += 1) {
      const performanceOrder = Math.sign((input.observedPerformance[i] ?? 0) - (input.observedPerformance[j] ?? 0));
      if (performanceOrder === 0) continue;
      const oldOrder = Math.sign((input.oldScores[i] ?? 0) - (input.oldScores[j] ?? 0));
      const newOrder = Math.sign((input.newScores[i] ?? 0) - (input.newScores[j] ?? 0));
      if (oldOrder === performanceOrder && newOrder !== performanceOrder) regressions += 1;
    }
  }
  const eligible = consistency >= 0.8 && regressions === 0;
  return {
    eligible,
    sampleSize,
    rankingConsistency: Number(consistency.toFixed(4)),
    pairwiseRegressions: regressions,
    reason: eligible ? "回测通过，等待用户确认新公式版本" : "排序一致性或成对比较未通过",
  };
};

export const activateExperimentalRubric = (
  current: RubricVersion,
  candidate: RubricVersion,
  evaluation: RubricBumpEvaluation,
  userConfirmed: boolean,
): RubricVersion => {
  if (!evaluation.eligible || !userConfirmed) {
    throw new Error("Rubric bump requires a passing backtest and explicit user confirmation");
  }
  return {
    ...candidate,
    version: current.version + 1,
    status: "active",
    basedOn: current.id,
  };
};

export const activateRubricExperimentRecord = (input: {
  current: RubricVersion;
  record: RubricExperimentRecord;
  versions: RubricVersion[];
  acceptedAt?: string;
}): {
  activeRubric: RubricVersion;
  versions: RubricVersion[];
  record: RubricExperimentRecord;
} => {
  if (input.record.status !== "pending") throw new Error("Only a pending formula experiment can be accepted");
  const acceptedAt = input.acceptedAt ?? new Date().toISOString();
  if (!Number.isFinite(new Date(acceptedAt).getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(acceptedAt)) {
    throw new Error("Formula experiment acceptance time must be a timezone-aware timestamp");
  }
  const activeRubric = activateExperimentalRubric(
    input.current,
    input.record.experiment.candidate,
    input.record.experiment.evaluation,
    true,
  );
  const versionsById = new Map(input.versions.map((version) => [version.id, { ...version }]));
  versionsById.set(input.current.id, { ...input.current, status: "retired" });
  versionsById.set(activeRubric.id, activeRubric);
  const versions = [...versionsById.values()].sort((left, right) =>
    left.version - right.version || left.createdAt.localeCompare(right.createdAt));
  const record = Object.freeze({
    ...input.record,
    status: "accepted" as const,
    acceptedAt,
    activatedRubricId: activeRubric.id,
  });
  return { activeRubric, versions, record };
};

export const suggestExperimentalRubric = (input: {
  current: RubricVersion;
  retros: RetroReport[];
  samples: FormulaCalibrationSample[];
  createdAt?: string;
}): RubricExperiment => {
  if (input.retros.length < 10 || input.samples.length < 10) {
    throw new Error("同类复盘满 10 条后才能生成公式实验");
  }
  if (!canSuggestRubricUpdate(input.retros)) {
    throw new Error("At least 10 unique retrospective records are required for formula calibration");
  }
  const sampleIds = input.samples.map((sample) => sample.id.trim());
  if (sampleIds.some((id) => !id) || new Set(sampleIds).size !== sampleIds.length) {
    throw new Error("Unique non-blank sample IDs are required for formula calibration");
  }
  const retrospectiveIds = new Set(input.retros.map((retro) => retro.id.trim()));
  if (retrospectiveIds.size !== sampleIds.length || sampleIds.some((id) => !retrospectiveIds.has(id))) {
    throw new Error("Calibration samples must correspond one-to-one with retrospective records");
  }
  const firstSample = input.samples[0]!;
  const sameContext = input.samples.every((sample) =>
    sample.platform === firstSample.platform
    && sample.accountId === firstSample.accountId
    && sample.kind === firstSample.kind);
  if (!firstSample.accountId.trim() || !sameContext) {
    throw new Error("All calibration samples must share the same account-platform-kind context");
  }
  const oldScores = input.samples.map((sample) =>
    calculateComposite(input.current.dimensions, sample.assessments));
  if (input.samples.some((sample) => !Number.isFinite(sample.observedPerformance) || sample.observedPerformance < 0)) {
    throw new RangeError("Finite non-negative observed performance is required");
  }
  const performance = input.samples.map((sample) => Math.log1p(sample.observedPerformance));
  const correlations = Object.fromEntries(input.current.dimensions.map((dimension) => {
    const scores = input.samples.map((sample) =>
      sample.assessments.find((assessment) => assessment.code === dimension.code)?.score ?? 0);
    return [dimension.code, Number(spearman(scores, performance).toFixed(4))];
  })) as Record<RubricDimensionCode, number>;
  const positiveTotal = Object.values(correlations).reduce((sum, value) => sum + Math.max(0, value), 0);
  const dimensions = input.current.dimensions.map((dimension) => {
    const learnedWeight = positiveTotal === 0
      ? dimension.weight
      : Math.max(0, correlations[dimension.code]) / positiveTotal;
    return { ...dimension, weight: Number((dimension.weight * 0.7 + learnedWeight * 0.3).toFixed(6)) };
  });
  const weightTotal = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  const normalizedDimensions = dimensions.map((dimension) => ({
    ...dimension,
    weight: Number((dimension.weight / weightTotal).toFixed(6)),
  }));
  const scoreWith = (rubric: RubricVersion, sample: FormulaCalibrationSample): number =>
    rubric.dimensions.reduce((sum, dimension) => {
      const score = sample.assessments.find((assessment) => assessment.code === dimension.code)?.score ?? 0;
      return sum + score * dimension.weight * 2;
    }, 0);
  const candidate: RubricVersion = {
    id: `${input.current.id}-experiment-${input.current.version + 1}`,
    version: input.current.version + 1,
    name: `${input.current.name} · 实验 ${input.current.version + 1}`,
    dimensions: normalizedDimensions,
    status: "experimental",
    createdAt: input.createdAt ?? new Date().toISOString(),
    basedOn: input.current.id,
  };
  const evaluation = evaluateRubricBump({
    retros: input.retros,
    oldScores,
    newScores: input.samples.map((sample) => scoreWith(candidate, sample)),
    observedPerformance: input.samples.map((sample) => sample.observedPerformance),
  });
  return { candidate, evaluation, correlations };
};
