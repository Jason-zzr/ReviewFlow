import type { MetricName } from "@reviewflow/domain";

const metricNames: MetricName[] = [
  "views",
  "likes",
  "saves",
  "comments",
  "shares",
  "followersGained",
];

export interface MetricsCsvImport {
  publicationId?: string;
  metrics: Partial<Record<MetricName, number>>;
}

const parseCsvTable = (input: string): string[][] => {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let physicalLine = 1;
  let quotedStartLine = 1;

  const finishField = (): void => {
    row.push(field.trim());
    field = "";
  };
  const finishRow = (): void => {
    finishField();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] as string;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else if (character === "\r") {
        if (text[index + 1] === "\n") index += 1;
        field += "\n";
        physicalLine += 1;
      } else if (character === "\n") {
        field += character;
        physicalLine += 1;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.trim() === "") {
      field = "";
      quoted = true;
      quotedStartLine = physicalLine;
    } else if (character === ",") {
      finishField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
      physicalLine += 1;
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error(`CSV 第 ${quotedStartLine} 行存在未闭合的引号`);
  if (field !== "" || row.length > 0) finishRow();
  return rows;
};

export const parseMetricsCsv = (input: string, expectedPublicationId: string): MetricsCsvImport => {
  const [headerRow, ...dataRows] = parseCsvTable(input);
  if (!headerRow || dataRows.length === 0) throw new Error("CSV 至少需要表头和一行数据");
  const seenHeaders = new Set<string>();
  for (const header of headerRow) {
    if (seenHeaders.has(header)) throw new Error(`CSV 表头存在重复列：${header || "（空列）"}`);
    seenHeaders.add(header);
  }
  if (!metricNames.some((metric) => seenHeaders.has(metric))) {
    throw new Error("CSV 至少需要一个支持的指标列");
  }
  dataRows.forEach((values, index) => {
    if (values.length !== headerRow.length) {
      throw new Error(`CSV 第 ${index + 2} 行有 ${values.length} 列，表头有 ${headerRow.length} 列`);
    }
  });

  const publicationIdIndex = headerRow.indexOf("publicationId");
  const expected = expectedPublicationId.trim();
  let values: string[];
  if (dataRows.length === 1) {
    values = dataRows[0] as string[];
    const rowPublicationId = publicationIdIndex >= 0 ? values[publicationIdIndex]?.trim() ?? "" : "";
    if (expected && rowPublicationId && rowPublicationId !== expected) {
      throw new Error(`CSV publicationId 与当前复盘不一致：${rowPublicationId}`);
    }
  } else {
    if (publicationIdIndex < 0) throw new Error("多行 CSV 必须包含 publicationId 列");
    if (!expected) throw new Error("导入多行 CSV 前请先填写当前 publicationId");
    const matches = dataRows.filter((candidate) => candidate[publicationIdIndex]?.trim() === expected);
    if (matches.length === 0) throw new Error(`CSV 中未找到 publicationId=${expected}`);
    if (matches.length > 1) throw new Error(`CSV 中 publicationId=${expected} 存在重复行`);
    values = matches[0] as string[];
  }

  const publicationId = publicationIdIndex >= 0 ? values[publicationIdIndex]?.trim() : undefined;
  const metrics: Partial<Record<MetricName, number>> = {};
  for (const metric of metricNames) {
    const index = headerRow.indexOf(metric);
    const value = index >= 0 ? values[index] : undefined;
    if (value === undefined || value === "") continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${metric} 必须是非负数字`);
    metrics[metric] = Math.round(parsed);
  }
  return {
    ...(publicationId ? { publicationId } : {}),
    metrics,
  };
};
