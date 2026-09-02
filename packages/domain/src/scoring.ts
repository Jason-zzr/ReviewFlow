import type {
  DimensionAssessment,
  RubricDimension,
  RubricDimensionCode,
  RubricVersion,
  ScoreCard,
} from "./types.js";

const dimensionDefinitions: Array<[RubricDimensionCode, string, string]> = [
  ["ER", "情绪共鸣", "是否让目标用户感到被理解，并产生继续阅读或观看的冲动。"],
  ["HP", "情绪钩子", "开场是否快速建立悬念、冲突、收益或损失感。"],
  ["QL", "表达质量", "标题、结构和语言是否清楚、具体、易于消费。"],
  ["NA", "叙事推进", "内容是否持续提供新信息，而不是重复同一观点。"],
  ["AB", "受众收益", "用户能否带走可执行的方法、判断或情绪价值。"],
  ["SR", "传播潜力", "是否具备值得收藏、转发、讨论或引用的表达。"],
  ["SAT", "主题契合", "内容是否符合账号定位、平台语境与目标受众预期。"],
];

export const createStarterRubric = (createdAt = new Date().toISOString()): RubricVersion => ({
  id: "starter-v1",
  version: 1,
  name: "个人创作者冷启动公式",
  status: "active",
  createdAt,
  dimensions: dimensionDefinitions.map(([code, name, description]) => ({
    code,
    name,
    description,
    weight: 1,
  })),
});

const assertAssessment = (assessment: DimensionAssessment): void => {
  if (!Number.isInteger(assessment.score) || assessment.score < 0 || assessment.score > 5) {
    throw new RangeError(`${assessment.code} must be an integer between 0 and 5`);
  }
  if (!assessment.evidence.trim()) {
    throw new Error(`${assessment.code} requires evidence`);
  }
};

export const calculateComposite = (
  dimensions: RubricDimension[],
  assessments: DimensionAssessment[],
): number => {
  if (dimensions.length === 0 || dimensions.length !== assessments.length) {
    throw new Error("Rubric and assessment dimensions must have the same non-zero length");
  }
  if (new Set(dimensions.map((item) => item.code)).size !== dimensions.length) {
    throw new Error("Rubric dimension codes must be unique");
  }
  if (new Set(assessments.map((item) => item.code)).size !== assessments.length) {
    throw new Error("Assessment dimension codes must be unique");
  }
  const assessmentByCode = new Map(assessments.map((item) => [item.code, item]));
  let weightedScore = 0;
  let totalWeight = 0;
  for (const dimension of dimensions) {
    const assessment = assessmentByCode.get(dimension.code);
    if (!assessment) throw new Error(`Missing assessment for ${dimension.code}`);
    assertAssessment(assessment);
    if (dimension.weight <= 0) throw new Error(`${dimension.code} weight must be positive`);
    weightedScore += assessment.score * dimension.weight;
    totalWeight += dimension.weight;
  }
  return Number(((weightedScore / totalWeight) * 2).toFixed(2));
};

export const createScoreCard = (input: {
  id: string;
  contentId: string;
  rubric: RubricVersion;
  assessments: DimensionAssessment[];
  generatedAt?: string;
  model?: string;
  promptVersion?: string;
}): ScoreCard => {
  const base: ScoreCard = {
    id: input.id,
    contentId: input.contentId,
    rubricVersionId: input.rubric.id,
    dimensions: input.assessments,
    composite: calculateComposite(input.rubric.dimensions, input.assessments),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
  if (input.model !== undefined) base.model = input.model;
  if (input.promptVersion !== undefined) base.promptVersion = input.promptVersion;
  return base;
};
