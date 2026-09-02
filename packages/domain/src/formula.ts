import type { DimensionAssessment, RetroReport, RubricDimensionCode, RubricVersion } from "./types.js";

export interface RubricBumpEvaluation {
  eligible: boolean;
  sampleSize: number;
  rankingConsistency: number;
  pairwiseRegressions: number;
  reason: string;
}

export interface FormulaCalibrationSample {
  assessments: DimensionAssessment[];
  observedPerformance: number;
}

export interface RubricExperiment {
  candidate: RubricVersion;
  evaluation: RubricBumpEvaluation;
  correlations: Record<RubricDimensionCode, number>;
}

const ranks = (values: number[]): number[] => {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const result = Array(values.length).fill(0) as number[];
  ordered.forEach((item, rank) => { result[item.index] = rank + 1; });
  return result;
};

const spearman = (left: number[], right: number[]): number => {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftRanks = ranks(left);
  const rightRanks = ranks(right);
  const squaredDifference = leftRanks.reduce((sum, rank, index) => {
    const difference = rank - (rightRanks[index] ?? 0);
    return sum + difference * difference;
  }, 0);
  const n = left.length;
  return 1 - (6 * squaredDifference) / (n * (n * n - 1));
};

export const canSuggestRubricUpdate = (retros: RetroReport[]): boolean => retros.length >= 10;

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
  const consistency = spearman(input.oldScores, input.newScores);
  let oldAligned = 0;
  let newAligned = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    for (let j = i + 1; j < sampleSize; j += 1) {
      const performanceOrder = Math.sign((input.observedPerformance[i] ?? 0) - (input.observedPerformance[j] ?? 0));
      if (performanceOrder === 0) continue;
      if (Math.sign((input.oldScores[i] ?? 0) - (input.oldScores[j] ?? 0)) === performanceOrder) oldAligned += 1;
      if (Math.sign((input.newScores[i] ?? 0) - (input.newScores[j] ?? 0)) === performanceOrder) newAligned += 1;
    }
  }
  const regressions = Math.max(0, oldAligned - newAligned);
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

export const suggestExperimentalRubric = (input: {
  current: RubricVersion;
  retros: RetroReport[];
  samples: FormulaCalibrationSample[];
  createdAt?: string;
}): RubricExperiment => {
  if (input.retros.length < 10 || input.samples.length < 10) {
    throw new Error("同类复盘满 10 条后才能生成公式实验");
  }
  const performance = input.samples.map((sample) => Math.log1p(Math.max(0, sample.observedPerformance)));
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
    oldScores: input.samples.map((sample) => scoreWith(input.current, sample)),
    newScores: input.samples.map((sample) => scoreWith(candidate, sample)),
    observedPerformance: input.samples.map((sample) => sample.observedPerformance),
  });
  return { candidate, evaluation, correlations };
};
