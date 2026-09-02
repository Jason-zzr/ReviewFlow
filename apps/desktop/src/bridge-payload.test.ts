import { reactive } from "vue";
import { describe, expect, it } from "vitest";
import { toBridgePayload } from "./bridge-payload.js";

describe("Electron bridge payloads", () => {
  it("turns nested Vue proxies into detached JSON-compatible values", () => {
    const source = reactive({
      content: {
        kind: "video",
        mediaPaths: ["C:/managed/video.mp4"],
      },
      metrics: { views: 1200 },
    });

    const payload = toBridgePayload(source);
    source.content.mediaPaths.push("C:/managed/later.mp4");
    source.metrics.views = 9999;

    expect(payload).toEqual({
      content: {
        kind: "video",
        mediaPaths: ["C:/managed/video.mp4"],
      },
      metrics: { views: 1200 },
    });
  });
});
