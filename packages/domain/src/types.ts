export const platforms = ["xiaohongshu", "douyin", "bilibili"] as const;
export type Platform = (typeof platforms)[number];

export type ContentKind = "video" | "image_text";
export type MetricName =
  | "views"
  | "likes"
  | "saves"
  | "comments"
  | "shares"
  | "followersGained";

export type PublicationStatus =
  | "draft"
  | "awaiting_confirmation"
  | "submitted"
  | "processing"
  | "published"
  | "failed"
  | "unknown";

export interface ContentItem {
  id: string;
  title: string;
  body: string;
  kind: ContentKind;
  topic: string;
  audiencePain: string;
  emotionalHook: string;
  mediaPaths: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlatformVariant {
  id: string;
  contentId: string;
  platform: Platform;
  accountId: string;
  title: string;
  body: string;
  tags: string[];
  mediaPaths: string[];
  scheduledAt?: string;
  bilibiliTid?: number;
}

export interface BenchmarkSample {
  id: string;
  platform: Platform;
  kind: ContentKind;
  sourceUrl?: string;
  title: string;
  metrics: NormalizedMetrics;
  importedAt: string;
}

export type RubricDimensionCode = "ER" | "HP" | "QL" | "NA" | "AB" | "SR" | "SAT";

export interface RubricDimension {
  code: RubricDimensionCode;
  name: string;
  description: string;
  weight: number;
}

export interface RubricVersion {
  id: string;
  version: number;
  name: string;
  dimensions: RubricDimension[];
  status: "active" | "experimental" | "retired";
  createdAt: string;
  basedOn?: string;
}

export interface DimensionAssessment {
  code: RubricDimensionCode;
  score: number;
  evidence: string;
  suggestion?: string;
}

export interface ScoreCard {
  id: string;
  contentId: string;
  rubricVersionId: string;
  dimensions: DimensionAssessment[];
  composite: number;
  generatedAt: string;
  model?: string;
  promptVersion?: string;
}

export interface MetricRange {
  p10: number;
  p50: number;
  p90: number;
}

export interface BucketProbability {
  bucket: "very_low" | "below_baseline" | "baseline" | "strong" | "breakout";
  probability: number;
  label: string;
}

export interface Prediction {
  id: string;
  contentId: string;
  platform: Platform;
  accountId: string;
  kind: ContentKind;
  ranges: Partial<Record<MetricName, MetricRange>>;
  bucketProbabilities: BucketProbability[];
  confidence: "low" | "medium" | "high";
  baselineSource: "account_history" | "benchmarks" | "cold_start";
  baselineSampleSize: number;
  rationale: string[];
  model: string;
  promptVersion: string;
  generatedAt: string;
  frozenAt?: string;
}

export interface PublishManifest {
  id: string;
  contentId: string;
  variants: PlatformVariant[];
  createdAt: string;
  digest?: string;
}

export interface PublicationAttempt {
  id: string;
  manifestId: string;
  variantId: string;
  platform: Platform;
  idempotencyKey: string;
  status: PublicationStatus;
  submittedAt?: string;
  publishedAt?: string;
  externalId?: string;
  externalUrl?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface NormalizedMetrics {
  views: number | null;
  likes: number | null;
  saves: number | null;
  comments: number | null;
  shares: number | null;
  followersGained: number | null;
}

export interface PerformanceSnapshot {
  id: string;
  publicationId: string;
  capturedAt: string;
  source: "adapter" | "manual" | "csv";
  metrics: NormalizedMetrics;
  raw?: Record<string, unknown>;
}

export interface PredictionHistorySample {
  snapshotId: string;
  platform: Platform;
  accountId: string;
  kind: ContentKind;
  metrics: NormalizedMetrics;
}

export interface RetroReport {
  id: string;
  publicationId: string;
  predictionId: string;
  snapshotId: string;
  actualMetrics: NormalizedMetrics;
  dueAt: string;
  completedAt: string;
  intervalHits: Partial<Record<MetricName, boolean>>;
  relativeErrors: Partial<Record<MetricName, number>>;
  insights: string[];
  nextActions: string[];
}

export interface MvpPublicationRecord {
  publicationId: string;
  platform: Platform;
  accountId: string;
  kind: ContentKind;
  publishedAt: string;
  retroCompletedAt?: string;
}

export interface MvpValidationProgress {
  windowDays: 30;
  targetPublicationCount: 8;
  targetRetroCompletionRate: 0.8;
  publicationCount: number;
  retroDueCount: number;
  retroCompletedCount: number;
  retroCompletionRate: number | null;
  publicationTargetMet: boolean;
  retroTargetMet: boolean;
  validationTargetMet: boolean;
}
