import type {
  ContentKind,
  DimensionAssessment,
  Platform,
  Prediction,
} from "@reviewflow/domain";

export interface PublicationContextRecord {
  publicationId: string;
  jobId: string;
  contentId: string;
  platform: Platform;
  accountId: string;
  kind: ContentKind;
  publishedAt: string;
  prediction: Prediction;
  assessments: DimensionAssessment[];
}

export const resolvePublicationContext = (
  records: PublicationContextRecord[],
  publicationId: string,
  _platform: Platform,
): PublicationContextRecord => {
  const record = records.find((item) => item.publicationId === publicationId);
  if (!record) throw new Error("Confirmed publication context not found");
  if (record.platform !== _platform) throw new Error("Publication context platform does not match");
  if (!record.prediction.frozenAt) throw new Error("Publication context requires a frozen prediction");
  if (
    record.prediction.contentId !== record.contentId
    || record.prediction.platform !== record.platform
    || record.prediction.accountId !== record.accountId
  ) {
    throw new Error("Prediction identity does not match publication context");
  }
  return record;
};
