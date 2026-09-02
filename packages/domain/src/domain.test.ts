import { describe, expect, it } from "vitest";
import {
  buildPrediction,
  buildRetroReport,
  calculateComposite,
  calculateMvpValidationProgress,
  activateRubricExperimentRecord,
  createRubricExperimentRecord,
  createScoreCard,
  createStarterRubric,
  suggestExperimentalRubric,
  evaluateRubricBump,
  freezePrediction,
  sealManifest,
  transitionPublication,
  type DimensionAssessment,
  type NormalizedMetrics,
  type PerformanceSnapshot,
  type PredictionHistorySample,
  type MvpPublicationRecord,
} from "./index.js";

const assessments: DimensionAssessment[] = ["ER", "HP", "QL", "NA", "AB", "SR", "SAT"].map((code) => ({
  code: code as DimensionAssessment["code"],
  score: 4,
  evidence: "可定位到稿件中的明确证据",
}));

const calibrationContext = (index: number) => ({
  id: `retro-${index}`,
  platform: "xiaohongshu" as const,
  accountId: "account-1",
  kind: "video" as const,
});

describe("scoring", () => {
  it("uses the equal-weight starter rubric", () => {
    expect(calculateComposite(createStarterRubric().dimensions, assessments)).toBe(8);
  });

  it("rejects scores outside the 0-5 integer range", () => {
    const invalid = assessments.map((item) => ({ ...item }));
    invalid[0]!.score = 5.5;
    expect(() => calculateComposite(createStarterRubric().dimensions, invalid)).toThrow(RangeError);
  });

  it("rejects a rubric with duplicate dimension codes", () => {
    const dimensions = createStarterRubric().dimensions.map((item) => ({ ...item }));
    dimensions[1] = { ...dimensions[0]! };
    const duplicateAssessments = assessments.map((item) => ({ ...item }));
    duplicateAssessments[1]!.code = duplicateAssessments[0]!.code;
    expect(() => calculateComposite(dimensions, duplicateAssessments)).toThrow(/unique/i);
  });

  it("creates an immutable score-card snapshot instead of retaining assessment aliases", () => {
    const source = assessments.map((assessment) => ({ ...assessment }));
    const card = createScoreCard({
      id: "score-card-immutable",
      contentId: "content-1",
      rubric: createStarterRubric(),
      assessments: source,
    });

    source[0]!.score = 0;
    expect(card.dimensions[0]!.score).toBe(4);
    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.dimensions)).toBe(true);
    expect(() => {
      card.dimensions[0]!.score = 1;
    }).toThrow(TypeError);
  });
});

describe("prediction and retro", () => {
  const history: PredictionHistorySample[] = Array.from({ length: 10 }, (_, index) => ({
    snapshotId: `history-${index}`,
    platform: "xiaohongshu",
    accountId: "account-1",
    kind: "video",
    metrics: {
      views: 800 + index * 40,
      likes: 60,
      saves: 12,
      comments: 8,
      shares: 5,
      followersGained: 2,
    },
  }));

  it("uses account history and reports medium confidence after ten samples", () => {
    const prediction = buildPrediction({
      id: "prediction-1",
      contentId: "content-1",
      platform: "xiaohongshu",
      accountId: "account-1",
      kind: "video",
      history,
      benchmarks: [],
      scoreComposite: 8,
    });
    expect(prediction.baselineSource).toBe("account_history");
    expect(prediction.confidence).toBe("medium");
    expect(prediction.ranges.views?.p50).toBeGreaterThan(1_000);
  });

  it("preserves the requested content kind in the prediction contract", () => {
    const prediction = buildPrediction({
      id: "prediction-kind",
      contentId: "content-1",
      platform: "xiaohongshu",
      accountId: "account-1",
      kind: "image_text",
      history: [],
      benchmarks: [],
    });

    expect(prediction.kind).toBe("image_text");
  });

  it("uses only history from the requested account-platform-kind context", () => {
    const contextualHistory = [
      ...[1_000, 1_000, 1_000].map((views, index) => ({
        snapshotId: `matching-${index}`,
        platform: "xiaohongshu",
        accountId: "account-1",
        kind: "video",
        metrics: { ...history[0]!.metrics, views },
      })),
      ...[100_000, 100_000, 100_000].map((views, index) => ({
        snapshotId: `other-${index}`,
        platform: "douyin",
        accountId: "account-2",
        kind: "image_text",
        metrics: { ...history[0]!.metrics, views },
      })),
    ];

    const prediction = buildPrediction({
      id: "prediction-context-filter",
      contentId: "content-1",
      platform: "xiaohongshu",
      accountId: "account-1",
      kind: "video",
      history: contextualHistory as never,
      benchmarks: [],
    });

    expect(prediction.baselineSource).toBe("account_history");
    expect(prediction.baselineSampleSize).toBe(3);
    expect(prediction.ranges.views?.p50).toBe(1_000);
  });

  it("falls back to valid benchmarks when account history has no usable metrics", () => {
    const emptyMetrics = (): NormalizedMetrics => ({
      views: null,
      likes: null,
      saves: null,
      comments: null,
      shares: null,
      followersGained: null,
    });
    const prediction = buildPrediction({
      id: "prediction-valid-baseline",
      contentId: "content-1",
      platform: "xiaohongshu",
      accountId: "account-1",
      kind: "video",
      history: [
        emptyMetrics(),
        { ...emptyMetrics(), views: Number.NaN },
        { ...emptyMetrics(), likes: -1 },
      ].map((metrics, index) => ({
        snapshotId: `invalid-history-${index}`,
        platform: "xiaohongshu" as const,
        accountId: "account-1",
        kind: "video" as const,
        metrics,
      })),
      benchmarks: [1_000, 2_000].map((views, index) => ({
        id: `benchmark-${index}`,
        platform: "xiaohongshu" as const,
        kind: "video" as const,
        title: `对标 ${index}`,
        metrics: { ...emptyMetrics(), views },
        importedAt: "2026-01-01T00:00:00.000Z",
      })),
    });
    expect(prediction.baselineSource).toBe("benchmarks");
    expect(prediction.baselineSampleSize).toBe(2);
    expect(prediction.ranges.views?.p50).toBe(1_500);
  });

  it("rejects a non-finite content score before building ranges", () => {
    expect(() => buildPrediction({
      id: "prediction-invalid-score",
      contentId: "content-1",
      platform: "douyin",
      accountId: "account-1",
      kind: "video",
      history,
      benchmarks: [],
      scoreComposite: Number.NaN,
    })).toThrow(/finite.*0.*10/i);
  });

  it("requires a frozen prediction before retrospective", () => {
    const prediction = freezePrediction(buildPrediction({
      id: "prediction-1",
      contentId: "content-1",
      platform: "douyin",
      accountId: "account-1",
      kind: "video",
      history,
      benchmarks: [],
    }));
    const snapshot: PerformanceSnapshot = {
      id: "snapshot-1",
      publicationId: "publication-1",
      capturedAt: "2026-01-04T00:00:00.000Z",
      source: "manual",
      metrics: { views: 1_100, likes: 80, saves: 20, comments: 9, shares: 7, followersGained: 3 },
    };
    expect(buildRetroReport({
      id: "retro-1",
      publicationId: "publication-1",
      publishedAt: "2026-01-01T00:00:00.000Z",
      prediction,
      snapshot,
      completedAt: "2026-01-04T00:00:00.000Z",
    }).intervalHits.views).toBe(true);
  });

  it("rejects metrics captured for a different publication", () => {
    const prediction = freezePrediction(buildPrediction({
      id: "prediction-publication-link",
      contentId: "content-1",
      platform: "xiaohongshu",
      accountId: "account-1",
      kind: "video",
      history,
      benchmarks: [],
    }), "2026-01-01T00:00:00.000Z");
    const snapshot: PerformanceSnapshot = {
      id: "snapshot-wrong-publication",
      publicationId: "publication-2",
      capturedAt: "2026-01-04T00:00:00.000Z",
      source: "manual",
      metrics: { views: 1_100, likes: 80, saves: 20, comments: 9, shares: 7, followersGained: 3 },
    };

    expect(() => buildRetroReport({
      id: "retro-wrong-publication",
      publicationId: "publication-1",
      publishedAt: "2026-01-01T00:00:00.000Z",
      prediction,
      snapshot,
      completedAt: "2026-01-04T00:00:00.000Z",
    })).toThrow(/snapshot.*publication/i);
  });

  it("deep-freezes metric ranges", () => {
    const prediction = freezePrediction(buildPrediction({
      id: "prediction-frozen",
      contentId: "content-1",
      platform: "bilibili",
      accountId: "account-1",
      kind: "video",
      history,
      benchmarks: [],
    }));
    expect(Object.isFrozen(prediction.ranges.views)).toBe(true);
    expect(() => {
      if (prediction.ranges.views) prediction.ranges.views.p50 = 999_999;
    }).toThrow(TypeError);
  });

  it("rejects an invalid or timezone-naive prediction freeze time", () => {
    const prediction = buildPrediction({
      id: "prediction-invalid-freeze-time",
      contentId: "content-1",
      platform: "bilibili",
      accountId: "account-1",
      kind: "video",
      history,
      benchmarks: [],
    });

    expect(() => freezePrediction(prediction, "not-a-date")).toThrow(/freeze time/i);
    expect(() => freezePrediction(prediction, "2026-01-01T00:00:00")).toThrow(/timezone/i);
  });

  it("rejects retrospective before T+3", () => {
    const prediction = freezePrediction(buildPrediction({
      id: "prediction-early",
      contentId: "content-1",
      platform: "douyin",
      accountId: "account-1",
      kind: "video",
      history,
      benchmarks: [],
    }), "2026-01-01T00:00:00.000Z");
    const snapshot: PerformanceSnapshot = {
      id: "snapshot-early",
      publicationId: "publication-early",
      capturedAt: "2026-01-02T00:00:00.000Z",
      source: "manual",
      metrics: { views: 100, likes: 10, saves: 2, comments: 1, shares: 1, followersGained: 0 },
    };
    expect(() => buildRetroReport({
      id: "retro-early",
      publicationId: "publication-early",
      publishedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-03T23:59:59.000Z",
      prediction,
      snapshot,
    })).toThrow(/72 hours/);
  });

  it("rejects a snapshot captured before T+3 even when the review happens later", () => {
    const prediction = freezePrediction(buildPrediction({
      id: "prediction-early-snapshot",
      contentId: "content-1",
      platform: "douyin",
      accountId: "account-1",
      kind: "video",
      history,
      benchmarks: [],
    }), "2026-01-01T00:00:00.000Z");
    const snapshot: PerformanceSnapshot = {
      id: "snapshot-before-due",
      publicationId: "publication-before-due",
      capturedAt: "2026-01-03T23:59:59.000Z",
      source: "manual",
      metrics: { views: 100, likes: 10, saves: 2, comments: 1, shares: 1, followersGained: 0 },
    };
    expect(() => buildRetroReport({
      id: "retro-after-due",
      publicationId: "publication-before-due",
      publishedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-05T00:00:00.000Z",
      prediction,
      snapshot,
    })).toThrow(/snapshot.*72 hours/i);
  });
});

describe("publishing", () => {
  it("seals manifests with a stable digest", async () => {
    const manifest = await sealManifest({
      id: "manifest-1",
      contentId: "content-1",
      variants: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses the cross-language canonical digest contract", async () => {
    const manifest = await sealManifest({
      id: "m1",
      contentId: "c1",
      createdAt: "2026-01-01T00:00:00.000Z",
      variants: [{
        id: "v1",
        contentId: "c1",
        platform: "xiaohongshu",
        accountId: "a1",
        title: "T",
        body: "B",
        tags: ["x"],
        mediaPaths: ["C:/demo.mp4"],
      }],
    });
    expect(manifest.digest).toBe("f00397dbaa3f214630a7776f9663071e37e996fadf520dc6540b6f9fbd7ca3d7");
  });

  it("does not treat submitted work as published", () => {
    expect(transitionPublication("awaiting_confirmation", "submitted")).toBe("submitted");
    expect(() => transitionPublication("submitted", "published")).toThrow();
  });
});

describe("rubric evolution", () => {
  it("requires ten retros and preserves ranking consistency", () => {
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const evaluation = evaluateRubricBump({
      retros,
      oldScores: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
      newScores: [2.1, 4.2, 6.1, 8.2, 9.8, 12.2, 14.1, 16.2, 18.1, 19.8],
      observedPerformance: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    });
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.rankingConsistency).toBe(1);
  });

  it("rejects a formula experiment with only nine complete calibration samples", () => {
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const evaluation = evaluateRubricBump({
      retros,
      oldScores: [2, 4, 6, 8, 10, 12, 14, 16, 18],
      newScores: [2.1, 4.2, 6.1, 8.2, 9.8, 12.2, 14.1, 16.2, 18.1],
      observedPerformance: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    });
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reason).toContain("10");
    expect(evaluation.sampleSize).toBe(9);
  });

  it("rejects a candidate when any previously correct pairwise ranking regresses", () => {
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const evaluation = evaluateRubricBump({
      retros,
      oldScores: [1, 2, 4, 3, 5, 6, 7, 8, 9, 10],
      newScores: [2, 1, 3, 4, 5, 6, 7, 8, 9, 10],
      observedPerformance: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });

    expect(evaluation.pairwiseRegressions).toBe(1);
    expect(evaluation.eligible).toBe(false);
  });

  it("rejects a backtest containing non-finite scores or performance", () => {
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const evaluation = evaluateRubricBump({
      retros,
      oldScores: [Number.NaN, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      newScores: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      observedPerformance: [1, 2, 3, 4, 5, 6, 7, 8, 9, Number.POSITIVE_INFINITY],
    });

    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reason).toMatch(/finite/i);
  });

  it("produces only an experimental rubric after ten calibrated retros", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      ...calibrationContext(index),
      assessments: assessments.map((item, dimensionIndex) => ({
        ...item,
        score: Math.min(5, Math.max(0, Math.round(index / 2) + (dimensionIndex === 0 ? 0 : 1))),
      })),
      observedPerformance: 100 + index * 100,
    }));
    const experiment = suggestExperimentalRubric({ current, retros, samples });
    expect(experiment.candidate.status).toBe("experimental");
    expect(experiment.candidate.basedOn).toBe(current.id);
    expect(experiment.candidate.dimensions.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 4);
  });

  it("records an immutable pending formula experiment with its exact calibration context", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      ...calibrationContext(index),
      assessments: assessments.map((item, dimensionIndex) => ({
        ...item,
        score: Math.min(5, Math.max(0, Math.round(index / 2) + (dimensionIndex === 0 ? 0 : 1))),
      })),
      observedPerformance: 100 + index * 100,
    }));
    const experiment = suggestExperimentalRubric({
      current,
      retros,
      samples,
      createdAt: "2026-02-01T00:00:00.000Z",
    });

    const record = createRubricExperimentRecord({
      id: "experiment-record-1",
      experiment,
      context: { platform: "xiaohongshu", accountId: "account-1", kind: "video" },
      sampleIds: samples.map((sample) => sample.id),
    });
    experiment.candidate.dimensions[0]!.weight = 0;

    expect(record.status).toBe("pending");
    expect(record.context).toEqual({ platform: "xiaohongshu", accountId: "account-1", kind: "video" });
    expect(record.sampleIds).toHaveLength(10);
    expect(record.experiment.candidate.dimensions[0]!.weight).not.toBe(0);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("accepts a passing experiment into an auditable version history without mutating its pending record", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      ...calibrationContext(index),
      assessments: assessments.map((item) => ({
        ...item,
        score: Math.min(5, Math.max(0, Math.round(index / 2))),
      })),
      observedPerformance: 100 + index * 100,
    }));
    const experiment = suggestExperimentalRubric({
      current,
      retros,
      samples,
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    const pending = createRubricExperimentRecord({
      id: "experiment-record-accepted",
      experiment,
      context: { platform: "xiaohongshu", accountId: "account-1", kind: "video" },
      sampleIds: samples.map((sample) => sample.id),
    });

    const accepted = activateRubricExperimentRecord({
      current,
      record: pending,
      versions: [current, experiment.candidate],
      acceptedAt: "2026-02-02T00:00:00.000Z",
    });

    expect(accepted.activeRubric.status).toBe("active");
    expect(accepted.activeRubric.version).toBe(2);
    expect(accepted.versions).toHaveLength(2);
    expect(accepted.versions.find((version) => version.id === current.id)?.status).toBe("retired");
    expect(accepted.versions.find((version) => version.id === accepted.activeRubric.id)?.status).toBe("active");
    expect(accepted.record).toMatchObject({
      status: "accepted",
      acceptedAt: "2026-02-02T00:00:00.000Z",
      activatedRubricId: accepted.activeRubric.id,
    });
    expect(pending.status).toBe("pending");
  });

  it("does not infer correlation from a dimension whose scores are all tied", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      ...calibrationContext(index),
      assessments: assessments.map((item) => ({ ...item })),
      observedPerformance: 100 + index * 100,
    }));

    const experiment = suggestExperimentalRubric({ current, retros, samples });
    expect(Object.values(experiment.correlations)).toEqual(Array(7).fill(0));
  });

  it("rejects calibration samples with missing or duplicate rubric dimensions", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      ...calibrationContext(index),
      assessments: assessments.map((item) => ({ ...item })),
      observedPerformance: 100 + index * 100,
    }));
    samples[0]!.assessments[6]!.code = "ER";

    expect(() => suggestExperimentalRubric({ current, retros, samples })).toThrow(/complete|unique/i);
  });

  it("rejects duplicate calibration sample IDs", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      ...calibrationContext(index),
      assessments: assessments.map((item) => ({ ...item })),
      observedPerformance: 100 + index * 100,
    }));
    samples[9]!.id = samples[0]!.id;

    expect(() => suggestExperimentalRubric({ current, retros, samples })).toThrow(/unique.*sample/i);
  });

  it("rejects calibration samples from mixed account-platform-kind contexts", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      ...calibrationContext(index),
      accountId: index === 9 ? "account-2" : "account-1",
      assessments: assessments.map((item) => ({ ...item })),
      observedPerformance: 100 + index * 100,
    }));

    expect(() => suggestExperimentalRubric({ current, retros, samples })).toThrow(/same.*context/i);
  });

  it("rejects repeated retrospective records masquerading as ten samples", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, () => ({ id: "retro-repeated" })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      ...calibrationContext(index),
      assessments: assessments.map((item) => ({ ...item })),
      observedPerformance: 100 + index * 100,
    }));

    expect(() => suggestExperimentalRubric({ current, retros, samples })).toThrow(/unique.*retro/i);
  });

  it("rejects calibration samples that do not correspond to the retrospective pool", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      ...calibrationContext(index),
      id: index === 9 ? "retro-outside-pool" : `retro-${index}`,
      assessments: assessments.map((item) => ({ ...item })),
      observedPerformance: 100 + index * 100,
    }));

    expect(() => suggestExperimentalRubric({ current, retros, samples })).toThrow(/correspond.*retro/i);
  });

  it("rejects non-finite observed performance before calibrating weights", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      ...calibrationContext(index),
      assessments: assessments.map((item) => ({ ...item })),
      observedPerformance: index === 0 ? Number.NaN : 100 + index * 100,
    }));

    expect(() => suggestExperimentalRubric({ current, retros, samples })).toThrow(/finite.*performance/i);
  });
});

describe("MVP validation progress", () => {
  const record = (
    publicationId: string,
    publishedAt: string,
    retroCompletedAt?: string,
  ): MvpPublicationRecord => ({
    publicationId,
    platform: "xiaohongshu",
    accountId: "creator",
    kind: "video",
    publishedAt,
    ...(retroCompletedAt ? { retroCompletedAt } : {}),
  });

  it("meets the target with eight recent publications and eighty percent of due retros", () => {
    const records = [
      record("p1", "2026-08-03T00:00:00Z", "2026-08-06T00:00:00Z"),
      record("p2", "2026-08-05T00:00:00Z", "2026-08-08T00:00:00Z"),
      record("p3", "2026-08-10T00:00:00Z", "2026-08-13T00:00:00Z"),
      record("p4", "2026-08-20T00:00:00Z", "2026-08-23T00:00:00Z"),
      record("p5", "2026-08-25T00:00:00Z"),
      record("p6", "2026-08-30T00:00:00Z"),
      record("p7", "2026-08-31T00:00:00Z"),
      record("p8", "2026-09-01T00:00:00Z"),
    ];
    const progress = calculateMvpValidationProgress(records, new Date("2026-09-01T12:00:00Z"));
    expect(progress.publicationCount).toBe(8);
    expect(progress.retroDueCount).toBe(5);
    expect(progress.retroCompletedCount).toBe(4);
    expect(progress.retroCompletionRate).toBe(0.8);
    expect(progress.validationTargetMet).toBe(true);
  });

  it("deduplicates publication IDs and excludes records outside the thirty-day window", () => {
    const progress = calculateMvpValidationProgress([
      record("duplicate", "2026-08-15T00:00:00Z"),
      record("duplicate", "2026-08-15T00:00:00Z", "2026-08-18T00:00:00Z"),
      record("old", "2026-07-31T23:59:59Z", "2026-08-04T00:00:00Z"),
    ], new Date("2026-09-01T00:00:00Z"));
    expect(progress.publicationCount).toBe(1);
    expect(progress.retroDueCount).toBe(1);
    expect(progress.retroCompletedCount).toBe(1);
  });

  it("does not claim the retro target before any publication reaches T+3", () => {
    const progress = calculateMvpValidationProgress([
      record("new", "2026-09-01T00:00:00Z"),
    ], new Date("2026-09-02T00:00:00Z"));
    expect(progress.retroCompletionRate).toBeNull();
    expect(progress.retroTargetMet).toBe(false);
    expect(progress.validationTargetMet).toBe(false);
  });
});
