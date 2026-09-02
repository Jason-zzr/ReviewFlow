import { describe, expect, it } from "vitest";
import { isAllowedSidecarPath } from "./sidecar-request-policy.js";

describe("Sidecar request path policy", () => {
  it("allows the collection endpoints required to recover persisted work", () => {
    expect(isAllowedSidecarPath("/v1/publications")).toBe(true);
    expect(isAllowedSidecarPath("/v1/metrics/tasks")).toBe(true);
  });

  it("rejects paths outside the exact allowlist", () => {
    expect(isAllowedSidecarPath("/v1/publications-export")).toBe(false);
    expect(isAllowedSidecarPath("/v1/metrics/tasks/private")).toBe(false);
    expect(isAllowedSidecarPath("/v1/publications?limit=999999")).toBe(false);
  });
});
