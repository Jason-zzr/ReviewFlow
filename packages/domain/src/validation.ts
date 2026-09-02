import type { MvpPublicationRecord, MvpValidationProgress } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const WINDOW_DAYS = 30;
const RETRO_DELAY_DAYS = 3;
const TARGET_PUBLICATIONS = 8;
const TARGET_RETRO_RATE = 0.8;

const validTimestamp = (value: string | undefined): number | null => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const calculateMvpValidationProgress = (
  records: MvpPublicationRecord[],
  now = new Date(),
): MvpValidationProgress => {
  const nowTimestamp = now.getTime();
  if (!Number.isFinite(nowTimestamp)) throw new RangeError("Validation time must be a valid date");
  const windowStart = nowTimestamp - WINDOW_DAYS * DAY_MS;
  const publications = new Map<string, { publishedAt: number; retroCompletedAt: number | null }>();

  for (const record of records) {
    const publishedAt = validTimestamp(record.publishedAt);
    if (publishedAt === null || publishedAt < windowStart || publishedAt > nowTimestamp) continue;
    const retroCompletedAt = validTimestamp(record.retroCompletedAt);
    const current = publications.get(record.publicationId);
    if (!current || (current.retroCompletedAt === null && retroCompletedAt !== null)) {
      publications.set(record.publicationId, { publishedAt, retroCompletedAt });
    }
  }

  const inWindow = [...publications.values()];
  const due = inWindow.filter((record) => record.publishedAt + RETRO_DELAY_DAYS * DAY_MS <= nowTimestamp);
  const completed = due.filter((record) => record.retroCompletedAt !== null
    && record.retroCompletedAt >= record.publishedAt + RETRO_DELAY_DAYS * DAY_MS
    && record.retroCompletedAt <= nowTimestamp);
  const retroCompletionRate = due.length === 0
    ? null
    : Number((completed.length / due.length).toFixed(4));
  const publicationTargetMet = inWindow.length >= TARGET_PUBLICATIONS;
  const retroTargetMet = retroCompletionRate !== null && retroCompletionRate >= TARGET_RETRO_RATE;

  return {
    windowDays: WINDOW_DAYS,
    targetPublicationCount: TARGET_PUBLICATIONS,
    targetRetroCompletionRate: TARGET_RETRO_RATE,
    publicationCount: inWindow.length,
    retroDueCount: due.length,
    retroCompletedCount: completed.length,
    retroCompletionRate,
    publicationTargetMet,
    retroTargetMet,
    validationTargetMet: publicationTargetMet && retroTargetMet,
  };
};
