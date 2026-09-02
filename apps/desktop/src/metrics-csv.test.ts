import { describe, expect, it } from "vitest";
import { parseMetricsCsv } from "./metrics-csv.js";

describe("metrics CSV import", () => {
  it("parses one record when a quoted field contains commas, escaped quotes, and newlines", () => {
    const result = parseMetricsCsv(
      "\uFEFFpublicationId,views,likes,saves,comments,shares,followersGained,note\r\n"
        + "publication-1,1200,120,42,18,9,7,\"first line\r\nsecond line, with \"\"evidence\"\"\"",
      "",
    );

    expect(result).toEqual({
      publicationId: "publication-1",
      metrics: {
        views: 1200,
        likes: 120,
        saves: 42,
        comments: 18,
        shares: 9,
        followersGained: 7,
      },
    });
  });

  it("rejects an unclosed quoted field", () => {
    expect(() => parseMetricsCsv(
      "publicationId,views,note\npublication-1,1200,\"unfinished",
      "publication-1",
    )).toThrow("CSV 第 2 行存在未闭合的引号");
  });

  it("rejects data rows whose column count differs from the header", () => {
    expect(() => parseMetricsCsv(
      "publicationId,views,likes\npublication-1,1200",
      "publication-1",
    )).toThrow("CSV 第 2 行有 2 列，表头有 3 列");
  });

  it("rejects duplicate headers instead of choosing one silently", () => {
    expect(() => parseMetricsCsv(
      "publicationId,views,views\npublication-1,1200,9999",
      "publication-1",
    )).toThrow("CSV 表头存在重复列：views");
  });

  it("rejects a file that contains no supported metric columns", () => {
    expect(() => parseMetricsCsv(
      "publicationId,note\npublication-1,hello",
      "publication-1",
    )).toThrow("CSV 至少需要一个支持的指标列");
  });

  it("selects exactly one matching publication from a multi-row export", () => {
    const result = parseMetricsCsv(
      "publicationId,views,likes\npublication-1,100,10\npublication-2,250,25",
      "publication-2",
    );

    expect(result).toEqual({
      publicationId: "publication-2",
      metrics: { views: 250, likes: 25 },
    });
  });
});
