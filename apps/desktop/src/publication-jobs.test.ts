import { describe, expect, it } from "vitest";
import {
  refreshPublishJobs,
  upsertPublishJob,
  type PublishJobRecord,
} from "./publication-jobs.js";

const job = (id: string, status: PublishJobRecord["status"]): PublishJobRecord => ({
  id,
  manifestId: `manifest-${id}`,
  status,
  dryRun: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("publication job recovery", () => {
  it("keeps multiple publication jobs instead of overwriting the prior one", () => {
    const first = upsertPublishJob([], job("job-1", "processing"));
    const second = upsertPublishJob(first, job("job-2", "submitted"));

    expect(second.map((item) => item.id)).toEqual(["job-2", "job-1"]);
  });

  it("replaces a matching job with its latest status", () => {
    const refreshed = {
      ...job("job-1", "unknown"),
      updatedAt: "2026-01-01T00:05:00.000Z",
    };

    const records = upsertPublishJob([job("job-1", "processing")], refreshed);

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(refreshed);
  });

  it("refreshes authoritative status and preserves jobs while the sidecar is unavailable", async () => {
    const records = [job("job-1", "processing"), job("job-2", "unknown")];

    const refreshed = await refreshPublishJobs(records, async (id) => {
      if (id === "job-1") return { ...records[0]!, status: "unknown" };
      throw new Error("sidecar unavailable");
    });

    expect(refreshed.map((item) => [item.id, item.status])).toEqual([
      ["job-1", "unknown"],
      ["job-2", "unknown"],
    ]);
  });
});
