import { describe, expect, it } from "vitest";
import type { Prediction } from "@reviewflow/domain";
import {
  resolvePublicationContext,
  type PublicationContextRecord,
} from "./publication-contexts.js";

const context = (publicationId: string, contentId: string): PublicationContextRecord => ({
  publicationId,
  jobId: `job-${publicationId}`,
  contentId,
  platform: "xiaohongshu",
  accountId: "creator-xhs",
  kind: "video",
  publishedAt: "2026-01-01T00:00:00.000Z",
  prediction: {
    id: `prediction-${publicationId}`,
    contentId,
    platform: "xiaohongshu",
    accountId: "creator-xhs",
    frozenAt: "2026-01-01T00:00:00.000Z",
  } as Prediction,
  assessments: [],
});

describe("publication retrospective context", () => {
  it("resolves the frozen context captured for the selected historical publication", () => {
    const records = [context("publication-1", "content-old"), context("publication-2", "content-current")];

    const resolved = resolvePublicationContext(records, "publication-1", "xiaohongshu");

    expect(resolved.contentId).toBe("content-old");
    expect(resolved.prediction.id).toBe("prediction-publication-1");
  });

  it("rejects a publication selected under the wrong platform", () => {
    expect(() => resolvePublicationContext(
      [context("publication-1", "content-old")],
      "publication-1",
      "douyin",
    )).toThrow(/platform/i);
  });

  it("rejects publication context without a frozen prediction", () => {
    const record = context("publication-1", "content-old");
    delete record.prediction.frozenAt;

    expect(() => resolvePublicationContext(
      [record],
      "publication-1",
      "xiaohongshu",
    )).toThrow(/frozen/i);
  });

  it("rejects a prediction whose content or account identity differs from the publication", () => {
    const record = context("publication-1", "content-old");
    record.accountId = "creator-other";

    expect(() => resolvePublicationContext(
      [record],
      "publication-1",
      "xiaohongshu",
    )).toThrow(/prediction.*identity/i);
  });
});
