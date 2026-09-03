import { describe, expect, it } from "vitest";

import {
  buildPrediction,
  freezePrediction,
  restoreFrozenPrediction,
} from "./index.js";

describe("frozen prediction restoration", () => {
  it("re-establishes deep immutability after JSON persistence", () => {
    const frozenAt = "2026-01-04T00:00:00.000Z";
    const frozen = freezePrediction(buildPrediction({
      id: "prediction-restored",
      contentId: "content-restored",
      platform: "xiaohongshu",
      accountId: "creator-xhs",
      kind: "video",
      history: [],
      benchmarks: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    }), frozenAt);
    const persisted = JSON.parse(JSON.stringify(frozen));

    expect(Object.isFrozen(persisted)).toBe(false);

    const restored = restoreFrozenPrediction(persisted);

    expect(restored.frozenAt).toBe(frozenAt);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.ranges)).toBe(true);
    expect(Object.isFrozen(restored.ranges.views)).toBe(true);
    expect(Object.isFrozen(restored.bucketProbabilities)).toBe(true);
    expect(Object.isFrozen(restored.bucketProbabilities[0])).toBe(true);
    expect(Object.isFrozen(restored.rationale)).toBe(true);
  });
});
