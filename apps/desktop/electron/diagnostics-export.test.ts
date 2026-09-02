import { describe, expect, it } from "vitest";
import { buildDiagnosticsSnapshot } from "./diagnostics-export.js";

describe("diagnostics export allowlist", () => {
  it("emits only approved fields even when the runtime input has sensitive extras", () => {
    const runtimeInput = {
      generatedAt: "2026-09-02T08:00:00.000Z",
      appVersion: "0.1.0",
      platform: "win32" as const,
      architecture: "x64",
      packaged: false,
      sidecarConfigured: true,
      sidecarStatus: "ready" as const,
      databasePresent: true,
      credentials: "secret-account-token",
      cookies: "private-cookie-value",
      apiKey: "sk-private-value",
      contentBody: "private-draft-body",
      mediaPath: "C:/private/video.mp4",
      rawPlatformPayload: { author: "private-account" },
    };

    const snapshot = buildDiagnosticsSnapshot(runtimeInput);
    expect(Object.keys(snapshot).sort()).toEqual([
      "appVersion",
      "architecture",
      "databasePresent",
      "generatedAt",
      "note",
      "packaged",
      "platform",
      "sidecarConfigured",
      "sidecarStatus",
    ]);
    const serialized = JSON.stringify(snapshot);
    for (const sensitiveValue of [
      runtimeInput.credentials,
      runtimeInput.cookies,
      runtimeInput.apiKey,
      runtimeInput.contentBody,
      runtimeInput.mediaPath,
      runtimeInput.rawPlatformPayload.author,
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
  });
});
