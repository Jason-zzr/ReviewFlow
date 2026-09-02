import { describe, expect, it } from "vitest";
import {
  buildPrediction,
  buildRetroReport,
  calculateComposite,
  calculateMvpValidationProgress,
  createStarterRubric,
  suggestExperimentalRubric,
  evaluateRubricBump,
  freezePrediction,
  sealManifest,
  transitionPublication,
  type DimensionAssessment,
  type NormalizedMetrics,
  type PerformanceSnapshot,
  type MvpPublicationRecord,
} from "./index.js";

const assessments: DimensionAssessment[] = ["ER", "HP", "QL", "NA", "AB", "SR", "SAT"].map((code) => ({
  code: code as DimensionAssessment["code"],
  score: 4,
  evidence: "可定位到稿件中的明确证据",
}));

describe("scoring", () => {
  it("uses the equal-weight starter rubric", () => {
    expect(calculateComposite(createStarterRubric().dimensions, assessments)).toBe(8);
  });

  it("rejects scores outside the 0-5 integer range", () => {
    const invalid = assessments.map((item) => ({ ...item }));
    invalid[0]!.score = 5.5;
    expect(() => calculateComposite(createStarterRubric().dimensions, invalid)).toThrow(RangeError);
  });
});

describe("prediction and retro", () => {
  const history: NormalizedMetrics[] = Array.from({ length: 10 }, (_, index) => ({
    views: 800 + index * 40,
    likes: 60,
    saves: 12,
    comments: 8,
    shares: 5,
    followersGained: 2,
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
      capturedAt: new Date().toISOString(),
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

  it("produces only an experimental rubric after ten calibrated retros", () => {
    const current = createStarterRubric("2026-01-01T00:00:00.000Z");
    const retros = Array.from({ length: 10 }, (_, index) => ({ id: `retro-${index}` })) as never[];
    const samples = Array.from({ length: 10 }, (_, index) => ({
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
