<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  buildPrediction,
  buildRetroReport,
  calculateMvpValidationProgress,
  activateExperimentalRubric,
  createScoreCard,
  createStarterRubric,
  freezePrediction,
  sealManifest,
  suggestExperimentalRubric,
  type ContentItem,
  type BenchmarkSample,
  type DimensionAssessment,
  type MetricName,
  type MvpPublicationRecord,
  type NormalizedMetrics,
  type PerformanceSnapshot,
  type Platform,
  type Prediction,
  type PredictionHistorySample,
  type PublishManifest,
  type PlatformVariant,
  type RetroReport,
  type RubricExperiment,
  type RubricVersion,
  type ScoreCard,
} from "@reviewflow/domain";
import PredictionTape from "./components/PredictionTape.vue";
import PublishDialog from "./components/PublishDialog.vue";
import ScoreLedger from "./components/ScoreLedger.vue";
import OnboardingDialog from "./components/OnboardingDialog.vue";
import { recoverOnboardingState } from "./onboarding-state.js";
import {
  refreshPublishJobs,
  upsertPublishJob,
  type PublishJobRecord,
} from "./publication-jobs.js";
import {
  resolvePublicationContext,
  type PublicationContextRecord,
} from "./publication-contexts.js";

type ViewName = "today" | "studio" | "retro" | "benchmarks" | "accounts" | "settings";

interface MetricTaskRecord {
  id: string;
  platform: Platform;
  publicationId: string;
  externalRef: string;
  publishedAt: string;
  dueAt: string;
  nextAttemptAt: string;
  status: "pending" | "collected" | "manual_required";
  attempts: number;
  lastError?: string | null;
}

const view = ref<ViewName>("studio");
const activeRubric = ref<RubricVersion>(createStarterRubric("2026-09-01T00:00:00.000Z"));
const nowIso = () => new Date().toISOString();
const content = ref<ContentItem>({
  id: crypto.randomUUID(),
  title: "为什么你写了 100 条内容，账号还是没有记忆点？",
  body: "多数人复盘时只看播放量，却没有记录发布前究竟相信什么。真正可复用的增长，不是追热点，而是把每次判断留下来，再用真实数据校准。",
  kind: "video",
  topic: "内容复盘方法",
  audiencePain: "持续更新却无法判断什么真正有效",
  emotionalHook: "努力很多却没有形成自己的方法",
  mediaPaths: [],
  createdAt: nowIso(),
  updatedAt: nowIso(),
});
const scoreCard = ref<ScoreCard | null>(null);
const scoredFingerprint = ref("");
const predictions = ref<Partial<Record<Platform, Prediction>>>({});
const predictionPlatform = ref<Platform>("xiaohongshu");
const retro = ref<RetroReport | null>(null);
const selectedPlatforms = ref<Platform[]>(["xiaohongshu", "douyin", "bilibili"]);
const accountIds = ref<Record<Platform, string>>({ xiaohongshu: "creator-xhs", douyin: "creator-dy", bilibili: "creator-bili" });
const scoreBusy = ref(false);
const publishBusy = ref(false);
const publishDialogOpen = ref(false);
const manifest = ref<PublishManifest | null>(null);
const publishWarnings = ref<string[]>([]);
const liveEnabled = ref(false);
const statusMessage = ref("草稿已保存在本地工作台");
const aiConfig = ref({ baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", apiKey: "", hasKey: false });
const retroPlatform = ref<Platform>("xiaohongshu");
const lastPublishJobId = ref("");
const publishJobs = ref<PublishJobRecord[]>([]);
const publicationContexts = ref<PublicationContextRecord[]>([]);
const retroPublicationId = ref("");
const retroPublishedAt = ref("");
const retroExternalRef = ref("");
const metricSource = ref<"manual" | "csv">("manual");
const metricBusy = ref(false);
const metricTasks = ref<MetricTaskRecord[]>([]);
const metricDraft = ref<Record<MetricName, number>>({
  views: 0,
  likes: 0,
  saves: 0,
  comments: 0,
  shares: 0,
  followersGained: 0,
});
const workspaceReady = ref(false);
const onboardingOpen = ref(false);
const onboardingComplete = ref(false);
const runtimeStatus = ref<"starting" | "ready" | "missing" | "stopped">("starting");
const accountStatus = ref<Record<Platform, string>>({ xiaohongshu: "未检查", douyin: "未检查", bilibili: "未检查" });
const benchmarkDraft = ref({
  platform: "xiaohongshu" as Platform,
  title: "",
  sourceUrl: "",
  views: 1000,
  likes: 0,
  saves: 0,
  comments: 0,
  shares: 0,
  followersGained: 0,
});
const benchmarks = ref<BenchmarkSample[]>([]);
const historySamples = ref<PredictionHistorySample[]>([]);
const publicationRecords = ref<MvpPublicationRecord[]>([]);
const calibrationSamples = ref<Array<{
  retro: RetroReport;
  platform: Platform;
  accountId: string;
  kind: ContentItem["kind"];
  assessments: DimensionAssessment[];
  observedPerformance: number;
}>>([]);
const formulaExperiment = ref<RubricExperiment | null>(null);
interface PlatformVariantDraft {
  title: string;
  body: string;
  tagsText: string;
  scheduledAt: string;
  bilibiliTid: number;
}
const platformVariantDrafts = ref<Partial<Record<Platform, PlatformVariantDraft>>>({});
const variantEditorPlatform = ref<Platform>("xiaohongshu");

const navItems: Array<{ id: ViewName; label: string; meta: string }> = [
  { id: "today", label: "今日", meta: "" },
  { id: "studio", label: "内容工作台", meta: "" },
  { id: "retro", label: "复盘队列", meta: "" },
  { id: "benchmarks", label: "对标样本", meta: "" },
  { id: "accounts", label: "平台账号", meta: "3" },
  { id: "settings", label: "模型设置", meta: "" },
];

const platformLabel = (platform: Platform): string =>
  platform === "xiaohongshu" ? "小红书" : platform === "douyin" ? "抖音" : "B 站";

const newVariantDraft = (platform: Platform): PlatformVariantDraft => ({
  title: content.value.title,
  body: content.value.body,
  tagsText: platform === "bilibili" ? "内容复盘,创作者成长" : "内容复盘,创作者成长",
  scheduledAt: "",
  bilibiliTid: 249,
});

const ensureVariantDraft = (platform: Platform, force = false): PlatformVariantDraft => {
  if (force || !platformVariantDrafts.value[platform]) {
    platformVariantDrafts.value[platform] = newVariantDraft(platform);
  }
  return platformVariantDrafts.value[platform] as PlatformVariantDraft;
};

const syncPlatformVariants = (force = false): void => {
  for (const platform of selectedPlatforms.value) ensureVariantDraft(platform, force);
  if (!selectedPlatforms.value.includes(variantEditorPlatform.value)) {
    variantEditorPlatform.value = selectedPlatforms.value[0] ?? "xiaohongshu";
  }
  statusMessage.value = force
    ? "平台版本已从主内容刷新，请逐个平台检查"
    : statusMessage.value;
};

const contentFingerprint = (): string => JSON.stringify({
  title: content.value.title,
  body: content.value.body,
  kind: content.value.kind,
  topic: content.value.topic,
  audiencePain: content.value.audiencePain,
  emotionalHook: content.value.emotionalHook,
});

const predictionIsCurrent = (platform: Platform): boolean => {
  const prediction = predictions.value[platform];
  return Boolean(
    prediction
    && prediction.contentId === content.value.id
    && prediction.accountId === accountIds.value[platform],
  );
};

const activePrediction = computed(() => predictions.value[predictionPlatform.value] ?? null);
const activeVariantDraft = computed(() => platformVariantDrafts.value[variantEditorPlatform.value] ?? null);
const mvpValidation = computed(() => calculateMvpValidationProgress(publicationRecords.value));
const confirmablePublishJobs = computed(() => publishJobs.value.filter((job) => !job.dryRun));
const selectedPublishJob = computed(() =>
  publishJobs.value.find((job) => job.id === lastPublishJobId.value) ?? null);
const selectedMetricTask = computed(() =>
  metricTasks.value.find((task) => task.publicationId === retroPublicationId.value) ?? null);
const selectedPublicationContext = computed(() =>
  publicationContexts.value.find((item) => item.publicationId === retroPublicationId.value) ?? null);

const upsertPublicationRecord = (record: MvpPublicationRecord): void => {
  const index = publicationRecords.value.findIndex((item) => item.publicationId === record.publicationId);
  if (index >= 0) publicationRecords.value[index] = { ...publicationRecords.value[index], ...record };
  else publicationRecords.value.push(record);
};

const upsertMetricTask = (task: MetricTaskRecord): void => {
  metricTasks.value = [task, ...metricTasks.value.filter((item) => item.id !== task.id)];
};

const upsertPublicationContext = (record: PublicationContextRecord): void => {
  publicationContexts.value = [
    record,
    ...publicationContexts.value.filter((item) => item.publicationId !== record.publicationId),
  ];
};

const readiness = computed(() => {
  if (!scoreCard.value) return "先完成评分";
  if (scoredFingerprint.value !== contentFingerprint()) return "内容已变化，请重新评分";
  if (!selectedPlatforms.value.length || !selectedPlatforms.value.every(predictionIsCurrent)) {
    return "评分完成，等待逐平台预测";
  }
  return scoreCard.value.composite >= 7 ? "可以进入发布预览" : "建议继续打磨";
});

const heuristicAssessments = (): DimensionAssessment[] => {
  const text = `${content.value.title}${content.value.body}`;
  const lengthScore = text.length > 100 ? 4 : text.length > 45 ? 3 : 2;
  const hookScore = /为什么|如何|别再|真正|没有|却/.test(content.value.title) ? 4 : 3;
  return [
    { code: "ER", score: content.value.audiencePain.length > 8 ? 4 : 3, evidence: content.value.audiencePain || "未填写用户痛点", suggestion: "让用户在前两句认出自己的处境" },
    { code: "HP", score: hookScore, evidence: content.value.title, suggestion: "把冲突提前到标题或开场" },
    { code: "QL", score: lengthScore, evidence: "标题与正文结构可读", suggestion: "删除重复说明" },
    { code: "NA", score: 3, evidence: "正文包含判断与方法", suggestion: "加入一个更具体的转折" },
    { code: "AB", score: /方法|记录|校准/.test(text) ? 4 : 3, evidence: "用户可带走复盘动作", suggestion: "补一个可立即执行的步骤" },
    { code: "SR", score: /真正|不是|而是/.test(text) ? 4 : 3, evidence: "包含可引用的对比句", suggestion: "压缩成一句更鲜明的主张" },
    { code: "SAT", score: 4, evidence: content.value.topic || "内容增长", suggestion: "保持与账号主线一致" },
  ];
};

const scoreContent = async (): Promise<void> => {
  scoreBusy.value = true;
  try {
    let assessments = heuristicAssessments();
    let model = "local-rules";
    if (window.reviewflow && aiConfig.value.hasKey) {
      const result = await window.reviewflow.scoreWithAi(content.value) as {
        assessments: DimensionAssessment[];
        model: string;
        promptVersion: string;
      };
      assessments = result.assessments;
      model = result.model;
    }
    scoreCard.value = createScoreCard({
      id: crypto.randomUUID(),
      contentId: content.value.id,
      rubric: activeRubric.value,
      assessments,
      model,
      promptVersion: "score-v1",
    });
    scoredFingerprint.value = contentFingerprint();
    predictions.value = {};
    statusMessage.value = `评分完成：${scoreCard.value.composite.toFixed(1)} / 10`;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "评分失败";
  } finally {
    scoreBusy.value = false;
  }
};

const predictContent = (): void => {
  if (!scoreCard.value || selectedPlatforms.value.length === 0) return;
  if (scoredFingerprint.value !== contentFingerprint()) {
    statusMessage.value = "内容已修改，请重新评分";
    return;
  }
  const next: Partial<Record<Platform, Prediction>> = { ...predictions.value };
  for (const platform of selectedPlatforms.value) {
    next[platform] = buildPrediction({
      id: crypto.randomUUID(),
      contentId: content.value.id,
      platform,
      accountId: accountIds.value[platform],
      kind: content.value.kind,
      history: historySamples.value,
      benchmarks: benchmarks.value,
      scoreComposite: scoreCard.value.composite,
    });
  }
  predictions.value = next;
  syncPlatformVariants();
  predictionPlatform.value = selectedPlatforms.value[0] ?? "xiaohongshu";
  statusMessage.value = `已为 ${selectedPlatforms.value.length} 个平台生成独立盲预测`;
};

const pickMedia = async (): Promise<void> => {
  if (!window.reviewflow) {
    statusMessage.value = "浏览器预览不能选择本地文件，请在桌面端运行";
    return;
  }
  content.value.mediaPaths = await window.reviewflow.pickMedia();
  if (content.value.mediaPaths.length) {
    statusMessage.value = `${content.value.mediaPaths.length} 个素材已复制到 ReviewFlow 本地媒体库`;
  }
};

const togglePlatform = (platform: Platform): void => {
  selectedPlatforms.value = selectedPlatforms.value.includes(platform)
    ? selectedPlatforms.value.filter((item) => item !== platform)
    : [...selectedPlatforms.value, platform];
  if (!selectedPlatforms.value.includes(predictionPlatform.value)) {
    predictionPlatform.value = selectedPlatforms.value[0] ?? "xiaohongshu";
  }
  if (selectedPlatforms.value.includes(platform)) {
    ensureVariantDraft(platform);
    variantEditorPlatform.value = platform;
  }
};

const presentPublishManifest = async (value: PublishManifest): Promise<void> => {
  manifest.value = value;
  publishWarnings.value = value.variants.some((variant) => variant.mediaPaths.length === 0)
    ? ["请选择至少一个本地素材文件"]
    : [];
  if (window.reviewflow) {
    try {
      const preview = await window.reviewflow.sidecarRequest({
        path: "/v1/publish/preview",
        method: "POST",
        body: { manifest: value },
      }) as { warnings: string[]; livePublishingEnabled: boolean };
      publishWarnings.value = preview.warnings;
      liveEnabled.value = preview.livePublishingEnabled;
    } catch {
      publishWarnings.value.push("发布 sidecar 尚未就绪；当前只能查看本地摘要");
    }
  }
  publishDialogOpen.value = true;
};

const openPublishPreview = async (): Promise<void> => {
  if (!selectedPlatforms.value.every(predictionIsCurrent)) {
    statusMessage.value = "发布目标已变化，请重新生成逐平台预测";
    return;
  }
  const next = { ...predictions.value };
  for (const platform of selectedPlatforms.value) {
    const item = next[platform];
    if (item && !item.frozenAt) next[platform] = freezePrediction(item);
  }
  predictions.value = next;
  syncPlatformVariants();
  const variants: PlatformVariant[] = selectedPlatforms.value.map((platform) => {
    const variant = ensureVariantDraft(platform);
    const tags = [...new Set(variant.tagsText.split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];
    return {
      id: crypto.randomUUID(),
      contentId: content.value.id,
      platform,
      accountId: accountIds.value[platform],
      title: variant.title,
      body: variant.body,
      tags,
      mediaPaths: content.value.mediaPaths,
      ...(variant.scheduledAt ? { scheduledAt: new Date(variant.scheduledAt).toISOString() } : {}),
      ...(platform === "bilibili" ? { bilibiliTid: variant.bilibiliTid } : {}),
    };
  });
  const draft: PublishManifest = {
    id: crypto.randomUUID(),
    contentId: content.value.id,
    createdAt: nowIso(),
    variants,
  };
  await presentPublishManifest(await sealManifest(draft));
};

const resumePublishPreview = async (): Promise<void> => {
  if (!manifest.value) return;
  await presentPublishManifest(manifest.value);
};

const confirmPublish = async (): Promise<void> => {
  if (!manifest.value?.digest) return;
  publishBusy.value = true;
  try {
    if (!window.reviewflow) throw new Error("真实发布只能在 ReviewFlow 桌面端执行");
    const job = await window.reviewflow.sidecarRequest({
      path: "/v1/publish/execute",
      method: "POST",
      body: {
        manifest: manifest.value,
        confirmationDigest: manifest.value.digest,
        idempotencyKey: `${manifest.value.id}:${manifest.value.digest.slice(0, 16)}`,
      },
    }) as PublishJobRecord;
    publishJobs.value = upsertPublishJob(publishJobs.value, job);
    if (!job.dryRun) lastPublishJobId.value = job.id;
    statusMessage.value = job.dryRun
      ? "摘要已确认；安全预览模式未执行真实发布"
      : `发布任务 ${job.id.slice(0, 8)}：${job.status}，请到平台后台核验`;
    publishDialogOpen.value = false;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "发布任务提交失败";
  } finally {
    publishBusy.value = false;
  }
};

const completeRetro = (snapshot: PerformanceSnapshot): void => {
  if (!retroPublicationId.value.trim()) throw new Error("请填写发布记录 ID");
  const publicationContext = resolvePublicationContext(
    publicationContexts.value,
    retroPublicationId.value.trim(),
    retroPlatform.value,
  );
  const publishedAt = publicationContext.publishedAt;
  retro.value = buildRetroReport({
    id: crypto.randomUUID(),
    publicationId: retroPublicationId.value.trim(),
    publishedAt,
    prediction: publicationContext.prediction,
    snapshot,
  });
  if (!historySamples.value.some((sample) => sample.snapshotId === snapshot.id)) {
    historySamples.value.push({
      snapshotId: snapshot.id,
      platform: publicationContext.platform,
      accountId: publicationContext.accountId,
      kind: publicationContext.kind,
      metrics: snapshot.metrics,
    });
  }
  if (snapshot.metrics.views !== null
    && !calibrationSamples.value.some((sample) => sample.retro.snapshotId === snapshot.id)) {
    calibrationSamples.value.push({
      retro: retro.value,
      platform: publicationContext.platform,
      accountId: publicationContext.accountId,
      kind: publicationContext.kind,
      assessments: publicationContext.assessments,
      observedPerformance: snapshot.metrics.views,
    });
  }
  upsertPublicationRecord({
    publicationId: retro.value.publicationId,
    platform: publicationContext.platform,
    accountId: publicationContext.accountId,
    kind: publicationContext.kind,
    publishedAt,
    retroCompletedAt: retro.value.completedAt,
  });
  statusMessage.value = "T+3 复盘已生成，预测原文保持不变";
};

const validateRetroContext = (): PublicationContextRecord => {
  if (!retroPublicationId.value.trim()) throw new Error("请填写发布记录 ID");
  return resolvePublicationContext(
    publicationContexts.value,
    retroPublicationId.value.trim(),
    retroPlatform.value,
  );
};

const confirmPublishedAndSchedule = async (): Promise<void> => {
  metricBusy.value = true;
  try {
    if (!window.reviewflow) throw new Error("发布确认仅在 ReviewFlow 桌面端可用");
    if (!/^[a-zA-Z0-9._-]+$/.test(lastPublishJobId.value)) throw new Error("请填写有效的 ReviewFlow 发布任务 ID");
    if (!retroExternalRef.value.trim()) throw new Error("请填写已在平台后台核验的内容链接或 BV 号");
    if (!retroPublishedAt.value) throw new Error("请填写平台显示的真实发布时间");
    const prediction = predictions.value[retroPlatform.value];
    if (
      !prediction?.frozenAt
      || prediction.contentId !== content.value.id
      || prediction.accountId !== accountIds.value[retroPlatform.value]
    ) {
      throw new Error(`请先冻结当前内容的${platformLabel(retroPlatform.value)}预测`);
    }
    if (!scoreCard.value || scoreCard.value.contentId !== content.value.id) {
      throw new Error("当前发布内容缺少对应的评分卡");
    }
    const publishedAt = new Date(retroPublishedAt.value).toISOString();
    const confirmation = await window.reviewflow.sidecarRequest({
      path: `/v1/publications/${lastPublishJobId.value}/confirm`,
      method: "POST",
      body: {
        platform: retroPlatform.value,
        externalRef: retroExternalRef.value.trim(),
        publishedAt,
      },
    }) as { publicationId: string; job: PublishJobRecord; metricTask: MetricTaskRecord };
    retroPublicationId.value = confirmation.publicationId;
    publishJobs.value = upsertPublishJob(publishJobs.value, confirmation.job);
    upsertMetricTask(confirmation.metricTask);
    upsertPublicationContext({
      publicationId: confirmation.publicationId,
      jobId: confirmation.job.id,
      contentId: content.value.id,
      platform: retroPlatform.value,
      accountId: accountIds.value[retroPlatform.value],
      kind: content.value.kind,
      publishedAt,
      prediction,
      assessments: scoreCard.value.dimensions.map((assessment) => ({ ...assessment })),
    });
    upsertPublicationRecord({
      publicationId: confirmation.publicationId,
      platform: retroPlatform.value,
      accountId: accountIds.value[retroPlatform.value],
      kind: content.value.kind,
      publishedAt,
    });
    statusMessage.value = `已确认${platformLabel(retroPlatform.value)}发布；T+3 到期时间 ${new Date(confirmation.metricTask.dueAt).toLocaleString()}`;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "平台发布确认失败";
  } finally {
    metricBusy.value = false;
  }
};

const importMetricsAndRunRetro = async (): Promise<void> => {
  metricBusy.value = true;
  try {
    if (!window.reviewflow) throw new Error("指标导入仅在 ReviewFlow 桌面端可用");
    validateRetroContext();
    const snapshot = await window.reviewflow.sidecarRequest({
      path: "/v1/metrics/import",
      method: "POST",
      body: {
        publicationId: retroPublicationId.value.trim(),
        source: metricSource.value,
        metrics: metricDraft.value,
      },
    }) as PerformanceSnapshot;
    completeRetro(snapshot);
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "复盘生成失败";
  } finally {
    metricBusy.value = false;
  }
};

const fetchMetricsAndRunRetro = async (): Promise<void> => {
  metricBusy.value = true;
  try {
    if (!window.reviewflow) throw new Error("自动采集仅在 ReviewFlow 桌面端可用");
    validateRetroContext();
    if (!retroExternalRef.value.trim()) throw new Error("请填写平台内容链接或 BV 号");
    try {
      const stored = await window.reviewflow.sidecarRequest({
        path: `/v1/metrics/latest/${retroPublicationId.value.trim()}`,
      }) as PerformanceSnapshot;
      completeRetro(stored);
      return;
    } catch {
      // No scheduled snapshot is available yet; continue with a live adapter attempt.
    }
    const fetched = await window.reviewflow.sidecarRequest({
      path: "/v1/metrics/fetch",
      method: "POST",
      body: {
        platform: retroPlatform.value,
        publicationId: retroPublicationId.value.trim(),
        externalRef: retroExternalRef.value.trim(),
      },
    }) as { status: "collected" | "manual_required"; metrics?: NormalizedMetrics; raw?: Record<string, unknown>; message: string };
    if (fetched.status !== "collected" || !fetched.metrics) {
      statusMessage.value = fetched.message;
      return;
    }
    const snapshot = await window.reviewflow.sidecarRequest({
      path: "/v1/metrics/import",
      method: "POST",
      body: {
        publicationId: retroPublicationId.value.trim(),
        source: "adapter",
        metrics: fetched.metrics,
        raw: fetched.raw,
      },
    }) as PerformanceSnapshot;
    completeRetro(snapshot);
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "指标采集失败";
  } finally {
    metricBusy.value = false;
  }
};

const scheduleMetrics = async (): Promise<void> => {
  metricBusy.value = true;
  try {
    if (!window.reviewflow) throw new Error("采集队列仅在 ReviewFlow 桌面端可用");
    const publicationContext = validateRetroContext();
    if (!retroExternalRef.value.trim()) throw new Error("请填写平台内容链接或 BV 号");
    const task = await window.reviewflow.sidecarRequest({
      path: "/v1/metrics/schedule",
      method: "POST",
      body: {
        platform: retroPlatform.value,
        publicationId: retroPublicationId.value.trim(),
        externalRef: retroExternalRef.value.trim(),
        publishedAt: publicationContext.publishedAt,
      },
    }) as MetricTaskRecord;
    upsertMetricTask(task);
    statusMessage.value = `已加入 T+3 队列：${new Date(task.dueAt).toLocaleString()} 自动尝试`;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "采集任务创建失败";
  } finally {
    metricBusy.value = false;
  }
};

const parseCsvRow = (line: string): string[] => {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else current += character;
  }
  values.push(current.trim());
  return values;
};

const importMetricsCsv = async (): Promise<void> => {
  try {
    const csv = await window.reviewflow?.pickMetricsCsv();
    if (!csv) return;
    const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error("CSV 至少需要表头和一行数据");
    const headers = parseCsvRow(lines[0] as string);
    const rows = lines.slice(1).map((line) => parseCsvRow(line));
    const publicationIdIndex = headers.indexOf("publicationId");
    const expectedPublicationId = retroPublicationId.value.trim();
    let values: string[];
    if (rows.length === 1) {
      values = rows[0] as string[];
      const rowPublicationId = publicationIdIndex >= 0 ? values[publicationIdIndex]?.trim() : "";
      if (expectedPublicationId && rowPublicationId && rowPublicationId !== expectedPublicationId) {
        throw new Error(`CSV publicationId 与当前复盘不一致：${rowPublicationId}`);
      }
      if (!expectedPublicationId && rowPublicationId) retroPublicationId.value = rowPublicationId;
    } else {
      if (publicationIdIndex < 0) throw new Error("多行 CSV 必须包含 publicationId 列");
      if (!expectedPublicationId) throw new Error("导入多行 CSV 前请先填写当前 publicationId");
      const matches = rows.filter((row) => row[publicationIdIndex]?.trim() === expectedPublicationId);
      if (matches.length === 0) throw new Error(`CSV 中未找到 publicationId=${expectedPublicationId}`);
      if (matches.length > 1) throw new Error(`CSV 中 publicationId=${expectedPublicationId} 存在重复行`);
      values = matches[0] as string[];
    }
    const supported: MetricName[] = ["views", "likes", "saves", "comments", "shares", "followersGained"];
    for (const metric of supported) {
      const index = headers.indexOf(metric);
      if (index >= 0 && values[index] !== undefined && values[index] !== "") {
        const parsed = Number(values[index]);
        if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${metric} 必须是非负数字`);
        metricDraft.value[metric] = Math.round(parsed);
      }
    }
    metricSource.value = "csv";
    statusMessage.value = "CSV 指标已载入，请核对后生成复盘";
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "CSV 导入失败";
  }
};

const importBenchmark = (): void => {
  if (!benchmarkDraft.value.title.trim()) {
    statusMessage.value = "请填写对标内容标题";
    return;
  }
  benchmarks.value.unshift({
    id: crypto.randomUUID(),
    platform: benchmarkDraft.value.platform,
    kind: content.value.kind,
    ...(benchmarkDraft.value.sourceUrl ? { sourceUrl: benchmarkDraft.value.sourceUrl } : {}),
    title: benchmarkDraft.value.title,
    metrics: {
      views: Math.max(0, benchmarkDraft.value.views),
      likes: Math.max(0, benchmarkDraft.value.likes),
      saves: Math.max(0, benchmarkDraft.value.saves),
      comments: Math.max(0, benchmarkDraft.value.comments),
      shares: Math.max(0, benchmarkDraft.value.shares),
      followersGained: Math.max(0, benchmarkDraft.value.followersGained),
    },
    importedAt: nowIso(),
  });
  benchmarkDraft.value = { ...benchmarkDraft.value, title: "", sourceUrl: "" };
  statusMessage.value = "对标样本已保存；系统不会自动追踪该账号";
};

const checkAccount = async (platform: Platform): Promise<void> => {
  if (!window.reviewflow) {
    statusMessage.value = "账号状态检查仅在桌面端可用";
    return;
  }
  try {
    const result = await window.reviewflow.sidecarRequest({
      path: "/v1/accounts/check",
      method: "POST",
      body: { platform, accountId: accountIds.value[platform] },
    }) as { runtimeAvailable: boolean; authenticated?: boolean; message: string };
    accountStatus.value[platform] = !result.runtimeAvailable
      ? "需安装 live 运行时"
      : result.authenticated
        ? "登录有效"
        : "未登录或 Cookie 已失效";
    statusMessage.value = `${platformLabel(platform)}账号检查完成`;
  } catch {
    statusMessage.value = "发布 sidecar 尚未就绪";
  }
};

const copyLoginCommand = async (platform: Platform): Promise<void> => {
  try {
    if (!window.reviewflow) throw new Error("复制登录命令仅在桌面端可用");
    await window.reviewflow.copyLoginCommand({ platform, accountId: accountIds.value[platform] });
    statusMessage.value = `${platformLabel(platform)}登录命令已复制，请在可见终端运行`;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "命令复制失败";
  }
};

const openLogin = async (platform: Platform): Promise<void> => {
  try {
    if (!window.reviewflow) throw new Error("账号登录仅在桌面端可用");
    await window.reviewflow.openLogin({ platform, accountId: accountIds.value[platform] });
    statusMessage.value = `${platformLabel(platform)}登录终端已打开，请自行扫码或处理验证`;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "登录终端启动失败";
  }
};

const saveAiConfig = async (): Promise<void> => {
  if (!window.reviewflow) return;
  try {
    const saved = await window.reviewflow.saveAiConfig({
      baseUrl: aiConfig.value.baseUrl,
      model: aiConfig.value.model,
      ...(aiConfig.value.apiKey ? { apiKey: aiConfig.value.apiKey } : {}),
    }) as typeof aiConfig.value;
    aiConfig.value = { ...aiConfig.value, ...saved, apiKey: "" };
    statusMessage.value = "模型设置已加密保存";
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "模型设置保存失败";
  }
};

const toggleLivePublishing = async (): Promise<void> => {
  try {
    if (!window.reviewflow) throw new Error("真实发布设置仅在桌面端可用");
    runtimeStatus.value = "starting";
    const result = await window.reviewflow.setPublisherEnabled(!liveEnabled.value);
    liveEnabled.value = result.enabled;
    runtimeStatus.value = result.sidecar;
    statusMessage.value = result.enabled
      ? "真实发布已启用；每次仍需核对并确认不可变发布摘要"
      : "真实发布已关闭；评分、预测和复盘不受影响";
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "真实发布设置失败";
  }
};

const exportWorkspace = async (): Promise<void> => {
  try {
    const path = await window.reviewflow?.exportWorkspace();
    if (path) statusMessage.value = "工作区已导出，密钥与 Cookie 未包含在内";
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "工作区导出失败";
  }
};

const importWorkspace = async (): Promise<void> => {
  try {
    if (await window.reviewflow?.importWorkspace()) window.location.reload();
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "工作区导入失败";
  }
};

const exportDiagnostics = async (): Promise<void> => {
  try {
    const path = await window.reviewflow?.exportDiagnostics();
    if (path) statusMessage.value = "脱敏诊断包已导出";
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "诊断包导出失败";
  }
};

const currentCalibrationSamples = (): typeof calibrationSamples.value => calibrationSamples.value.filter(
  (sample) => sample.platform === retroPlatform.value
    && sample.accountId === accountIds.value[retroPlatform.value]
    && sample.kind === content.value.kind,
);

const prepareFormulaExperiment = (): void => {
  try {
    const samples = currentCalibrationSamples();
    formulaExperiment.value = suggestExperimentalRubric({
      current: activeRubric.value,
      retros: samples.map((sample) => sample.retro),
      samples: samples.map((sample) => ({
        id: sample.retro.id,
        platform: sample.platform,
        accountId: sample.accountId,
        kind: sample.kind,
        assessments: sample.assessments,
        observedPerformance: sample.observedPerformance,
      })),
    });
    statusMessage.value = formulaExperiment.value.evaluation.eligible
      ? "公式回测通过，等待你明确接受"
      : formulaExperiment.value.evaluation.reason;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "公式实验生成失败";
  }
};

const acceptFormulaExperiment = (): void => {
  if (!formulaExperiment.value) return;
  try {
    activeRubric.value = activateExperimentalRubric(
      activeRubric.value,
      formulaExperiment.value.candidate,
      formulaExperiment.value.evaluation,
      true,
    );
    formulaExperiment.value = null;
    scoreCard.value = null;
    scoredFingerprint.value = "";
    predictions.value = {};
    statusMessage.value = `评分公式 v${activeRubric.value.version} 已启用，旧评分保持不变`;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "公式版本启用失败";
  }
};

const finishOnboarding = (): void => {
  onboardingComplete.value = true;
  onboardingOpen.value = false;
  statusMessage.value = "入门完成：从第一条内容的发布前判断开始";
};

const navigateFromOnboarding = (target: "settings" | "accounts" | "studio"): void => {
  view.value = target;
  onboardingOpen.value = false;
};

onMounted(async () => {
  if (window.reviewflow) {
    try {
      aiConfig.value = { ...aiConfig.value, ...(await window.reviewflow.getAiConfig()) };
      const saved = await window.reviewflow.loadWorkspace() as {
        content?: ContentItem;
        scoreCard?: ScoreCard | null;
        scoredFingerprint?: string;
        predictions?: Partial<Record<Platform, Prediction>>;
        prediction?: Prediction | null;
        selectedPlatforms?: Platform[];
        accountIds?: Record<Platform, string>;
        benchmarks?: BenchmarkSample[];
        historySamples?: typeof historySamples.value;
        publicationRecords?: MvpPublicationRecord[];
        activeRubric?: RubricVersion;
        calibrationSamples?: typeof calibrationSamples.value;
        platformVariantDrafts?: typeof platformVariantDrafts.value;
        variantEditorPlatform?: Platform;
        retro?: RetroReport | null;
        retroPlatform?: Platform;
        retroPublicationId?: string;
        retroPublishedAt?: string;
        retroExternalRef?: string;
        metricSource?: "manual" | "csv";
        metricDraft?: Record<MetricName, number>;
        formulaExperiment?: RubricExperiment | null;
        onboardingComplete?: boolean;
        lastPublishJobId?: string;
        manifest?: PublishManifest | null;
        publishJobs?: PublishJobRecord[];
        metricTasks?: MetricTaskRecord[];
        publicationContexts?: PublicationContextRecord[];
      } | null;
      const recoveredOnboarding = recoverOnboardingState(saved);
      onboardingOpen.value = recoveredOnboarding.open;
      if (saved?.content) content.value = saved.content;
      if (saved?.scoreCard) {
        scoreCard.value = saved.scoreCard;
        scoredFingerprint.value = saved.scoredFingerprint ?? contentFingerprint();
      }
      if (saved?.predictions) predictions.value = saved.predictions;
      else if (saved?.prediction) predictions.value = { [saved.prediction.platform]: saved.prediction };
      if (saved?.selectedPlatforms) selectedPlatforms.value = saved.selectedPlatforms;
      if (saved?.accountIds) accountIds.value = saved.accountIds;
      if (saved?.benchmarks) benchmarks.value = saved.benchmarks;
      if (saved?.historySamples) historySamples.value = saved.historySamples;
      if (saved?.publicationRecords) publicationRecords.value = saved.publicationRecords;
      if (saved?.activeRubric) activeRubric.value = saved.activeRubric;
      if (saved?.calibrationSamples) calibrationSamples.value = saved.calibrationSamples;
      if (saved?.platformVariantDrafts) platformVariantDrafts.value = saved.platformVariantDrafts;
      if (saved?.variantEditorPlatform) variantEditorPlatform.value = saved.variantEditorPlatform;
      if (saved?.retro) retro.value = saved.retro;
      if (saved?.retroPlatform) retroPlatform.value = saved.retroPlatform;
      if (saved?.retroPublicationId) retroPublicationId.value = saved.retroPublicationId;
      if (saved?.retroPublishedAt) retroPublishedAt.value = saved.retroPublishedAt;
      if (saved?.retroExternalRef) retroExternalRef.value = saved.retroExternalRef;
      if (saved?.metricSource) metricSource.value = saved.metricSource;
      if (saved?.metricDraft) metricDraft.value = saved.metricDraft;
      if (saved?.formulaExperiment) formulaExperiment.value = saved.formulaExperiment;
      if (saved?.lastPublishJobId) lastPublishJobId.value = saved.lastPublishJobId;
      if (saved?.manifest) manifest.value = saved.manifest;
      if (saved?.publishJobs) publishJobs.value = saved.publishJobs;
      if (saved?.metricTasks) metricTasks.value = saved.metricTasks;
      if (saved?.publicationContexts) publicationContexts.value = saved.publicationContexts;
      if (!saved?.publicationRecords?.length) {
        for (const sample of calibrationSamples.value) {
          const dueAt = new Date(sample.retro.dueAt).getTime();
          if (!Number.isFinite(dueAt)) continue;
          upsertPublicationRecord({
            publicationId: sample.retro.publicationId,
            platform: sample.platform,
            accountId: sample.accountId,
            kind: sample.kind,
            publishedAt: new Date(dueAt - 72 * 60 * 60 * 1_000).toISOString(),
            retroCompletedAt: sample.retro.completedAt,
          });
        }
      }
      onboardingComplete.value = recoveredOnboarding.complete;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const runtime = await window.reviewflow.runtimeStatus();
        runtimeStatus.value = runtime.sidecar;
        liveEnabled.value = runtime.livePublishingEnabled;
        if (runtime.sidecar !== "starting") break;
        await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 150));
      }
      if (runtimeStatus.value === "ready") {
        try {
          const persistedJobs = await window.reviewflow.sidecarRequest({
            path: "/v1/publications",
          }) as PublishJobRecord[];
          const persistedIds = new Set(persistedJobs.map((job) => job.id));
          publishJobs.value = [
            ...persistedJobs,
            ...publishJobs.value.filter((job) => !persistedIds.has(job.id)),
          ];
        } catch {
          publishJobs.value = await refreshPublishJobs(publishJobs.value, async (jobId) =>
            await window.reviewflow!.sidecarRequest({
              path: `/v1/publications/${encodeURIComponent(jobId)}`,
            }) as PublishJobRecord);
        }
        try {
          const persistedTasks = await window.reviewflow.sidecarRequest({
            path: "/v1/metrics/tasks",
          }) as MetricTaskRecord[];
          const persistedTaskIds = new Set(persistedTasks.map((task) => task.id));
          metricTasks.value = [
            ...persistedTasks,
            ...metricTasks.value.filter((task) => !persistedTaskIds.has(task.id)),
          ];
        } catch {
          // Keep workspace task snapshots until the Sidecar is available again.
        }
      }
      if (!lastPublishJobId.value) {
        lastPublishJobId.value = confirmablePublishJobs.value[0]?.id ?? "";
      }
      if (runtimeStatus.value === "missing") statusMessage.value = "发布运行时组件缺失，请重新安装 ReviewFlow";
      else if (runtimeStatus.value === "stopped") statusMessage.value = "发布运行时已停止，请重启 ReviewFlow";
    } catch {
      statusMessage.value = "桌面安全存储尚未就绪";
    }
  }
  workspaceReady.value = true;
});

let saveTimer: number | undefined;
watch([content, scoreCard, predictions, selectedPlatforms, accountIds, benchmarks, historySamples, publicationRecords, activeRubric, calibrationSamples, onboardingComplete, lastPublishJobId, manifest, publishJobs, metricTasks, publicationContexts, platformVariantDrafts, variantEditorPlatform, retro, retroPlatform, retroPublicationId, retroPublishedAt, retroExternalRef, metricSource, metricDraft, formulaExperiment], () => {
  if (!workspaceReady.value || !window.reviewflow) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void window.reviewflow?.saveWorkspace({
      content: content.value,
      scoreCard: scoreCard.value,
      scoredFingerprint: scoredFingerprint.value,
      predictions: predictions.value,
      selectedPlatforms: selectedPlatforms.value,
      accountIds: accountIds.value,
      benchmarks: benchmarks.value,
      historySamples: historySamples.value,
      publicationRecords: publicationRecords.value,
      activeRubric: activeRubric.value,
      calibrationSamples: calibrationSamples.value,
      platformVariantDrafts: platformVariantDrafts.value,
      variantEditorPlatform: variantEditorPlatform.value,
      retro: retro.value,
      retroPlatform: retroPlatform.value,
      retroPublicationId: retroPublicationId.value,
      retroPublishedAt: retroPublishedAt.value,
      retroExternalRef: retroExternalRef.value,
      metricSource: metricSource.value,
      metricDraft: metricDraft.value,
      formulaExperiment: formulaExperiment.value,
      onboardingComplete: onboardingComplete.value,
      lastPublishJobId: lastPublishJobId.value,
      manifest: manifest.value,
      publishJobs: publishJobs.value,
      metricTasks: metricTasks.value,
      publicationContexts: publicationContexts.value,
    });
  }, 350);
}, { deep: true });
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand-lockup">
        <div class="brand-mark"><i /><i /><i /></div>
        <div><strong>ReviewFlow</strong><span>creator calibration desk</span></div>
      </div>
      <nav aria-label="主导航">
        <button
          v-for="item in navItems"
          :key="item.id"
          :class="{ active: view === item.id }"
          @click="view = item.id"
        >
          <span>{{ item.label }}</span><em v-if="item.meta">{{ item.meta }}</em>
        </button>
      </nav>
      <div class="account-strip">
        <span class="avatar">林</span>
        <div><strong>个人工作区</strong><small>数据仅保存在本机</small></div>
      </div>
    </aside>

    <main>
      <header class="topbar">
        <div class="breadcrumb"><span>ReviewFlow</span><b>/</b><strong>{{ navItems.find((item) => item.id === view)?.label }}</strong></div>
        <div class="save-state"><i />{{ statusMessage }}</div>
      </header>

      <div v-if="runtimeStatus === 'missing' || runtimeStatus === 'stopped'" class="runtime-alert" role="alert">
        <strong>发布运行时不可用</strong>
        <span>{{ runtimeStatus === 'missing' ? '安装包缺少必要组件，请重新安装。评分、预测和复盘仍可使用。' : '本地发布进程已停止，请重启应用后再发布。' }}</span>
      </div>

      <div v-if="view === 'studio'" class="studio-view">
        <section class="studio-heading">
          <div><span class="eyebrow">Content no. 024</span><h1>把判断留在发布之前</h1></div>
          <div class="readiness"><span>当前状态</span><strong>{{ readiness }}</strong></div>
        </section>

        <div class="studio-grid">
          <section class="editor-sheet">
            <div class="sheet-toolbar">
              <div class="kind-switch">
                <button :class="{ active: content.kind === 'video' }" @click="content.kind = 'video'">视频</button>
                <button :class="{ active: content.kind === 'image_text' }" @click="content.kind = 'image_text'">图文</button>
              </div>
              <span>{{ content.body.length }} 字</span>
            </div>
            <label>选题<input v-model="content.topic" /></label>
            <label class="title-field">标题<textarea v-model="content.title" rows="2" /></label>
            <label>正文<textarea v-model="content.body" rows="8" /></label>
            <div class="brief-fields">
              <label>用户痛点<input v-model="content.audiencePain" /></label>
              <label>情绪钩子<input v-model="content.emotionalHook" /></label>
            </div>
            <button class="media-drop" @click="pickMedia">
              <span>{{ content.mediaPaths.length ? `${content.mediaPaths.length} 个素材已选择` : "选择视频或图片素材" }}</span>
              <small>选择后复制到 ReviewFlow 本地媒体库，原文件不会被修改</small>
            </button>
          </section>
          <ScoreLedger :rubric="activeRubric" :score-card="scoreCard" :busy="scoreBusy" @score="scoreContent" />
        </div>

        <div class="prediction-stack">
          <div v-if="Object.keys(predictions).length" class="prediction-tabs" aria-label="选择平台预测">
            <button
              v-for="platform in selectedPlatforms"
              :key="platform"
              :class="{ active: predictionPlatform === platform }"
              :disabled="!predictions[platform]"
              @click="predictionPlatform = platform"
            >
              {{ platformLabel(platform) }}
            </button>
          </div>
          <PredictionTape :prediction="activePrediction" />
        </div>

        <section v-if="selectedPlatforms.length" class="platform-variant-sheet">
          <div class="variant-head">
            <div><span class="eyebrow">Platform variants</span><h2>逐平台调整发布版本</h2></div>
            <button class="text-action" @click="syncPlatformVariants(true)">从主内容重新生成</button>
          </div>
          <div class="variant-tabs" aria-label="选择平台版本">
            <button
              v-for="platform in selectedPlatforms"
              :key="platform"
              :class="{ active: variantEditorPlatform === platform }"
              @click="ensureVariantDraft(platform); variantEditorPlatform = platform"
            >{{ platformLabel(platform) }}</button>
          </div>
          <div v-if="activeVariantDraft" class="variant-fields">
            <label>平台标题<input v-model="activeVariantDraft.title" /></label>
            <label>平台正文<textarea v-model="activeVariantDraft.body" rows="4" /></label>
            <div class="variant-meta">
              <label>标签（逗号分隔）<input v-model="activeVariantDraft.tagsText" /></label>
              <label>平台原生定时（可选）<input v-model="activeVariantDraft.scheduledAt" type="datetime-local" /></label>
              <label v-if="variantEditorPlatform === 'bilibili'">B 站分区 tid<input v-model.number="activeVariantDraft.bilibiliTid" type="number" min="1" /></label>
            </div>
            <small>账号：{{ accountIds[variantEditorPlatform] }} · 素材沿用主内容的 {{ content.mediaPaths.length }} 个本地文件</small>
          </div>
        </section>

        <section class="launch-strip">
          <div class="platform-select">
            <span>发布目标</span>
            <button
              v-for="platform in (['xiaohongshu', 'douyin', 'bilibili'] as Platform[])"
              :key="platform"
              :class="{ active: selectedPlatforms.includes(platform) }"
              @click="togglePlatform(platform)"
            >
              {{ platform === 'xiaohongshu' ? '小红书' : platform === 'douyin' ? '抖音' : 'B 站' }}
            </button>
          </div>
          <div class="launch-actions">
            <button class="text-action" :disabled="!scoreCard" @click="predictContent">生成区间预测</button>
            <button v-if="manifest" class="text-action" :disabled="publishBusy" @click="resumePublishPreview">恢复上次发布清单</button>
            <button class="primary-action" :disabled="selectedPlatforms.length === 0 || !selectedPlatforms.every(predictionIsCurrent)" @click="openPublishPreview">进入发布预览</button>
          </div>
        </section>
      </div>

      <div v-else-if="view === 'retro'" class="secondary-view retro-view">
        <div class="page-heading"><span class="eyebrow">T+3 review</span><h1>复盘不是总结，是校准</h1><p>预测保持原样，真实表现只追加在后面。</p></div>
        <section class="retro-card">
          <div class="retro-context">
            <label>平台<select v-model="retroPlatform"><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option><option value="bilibili">B 站</option></select></label>
            <label>
              ReviewFlow 发布任务 ID
              <input v-model="lastPublishJobId" list="reviewflow-publish-jobs" placeholder="发布后自动填入，也可粘贴历史任务 ID" />
              <datalist id="reviewflow-publish-jobs">
                <option
                  v-for="job in confirmablePublishJobs"
                  :key="job.id"
                  :value="job.id"
                  :label="`${job.status} · ${new Date(job.updatedAt).toLocaleString()}`"
                />
              </datalist>
              <small v-if="selectedPublishJob">当前任务状态：{{ selectedPublishJob.status }}{{ selectedPublishJob.dryRun ? '（安全预览，不能确认发布）' : '' }}</small>
            </label>
            <label>
              平台发布记录 ID
              <input v-model="retroPublicationId" list="reviewflow-metric-tasks" placeholder="核验平台发布后自动生成" />
              <datalist id="reviewflow-metric-tasks">
                <option
                  v-for="task in metricTasks"
                  :key="task.id"
                  :value="task.publicationId"
                  :label="`${task.status} · T+3 ${new Date(task.dueAt).toLocaleString()}`"
                />
              </datalist>
              <small v-if="selectedMetricTask">采集状态：{{ selectedMetricTask.status }} · 已尝试 {{ selectedMetricTask.attempts }} 次</small>
              <small v-if="retroPublicationId && !selectedPublicationContext">缺少这条发布的冻结预测与评分上下文，无法安全复盘</small>
            </label>
            <label>真实发布时间<input v-model="retroPublishedAt" type="datetime-local" /></label>
            <label>内容链接 / BV 号<input v-model="retroExternalRef" placeholder="B 站可自动采集；其他平台用于追溯" /></label>
          </div>
          <div class="metrics-grid">
            <label v-for="metric in (['views', 'likes', 'saves', 'comments', 'shares', 'followersGained'] as MetricName[])" :key="metric">
              {{ metric }}<input v-model.number="metricDraft[metric]" type="number" min="0" />
            </label>
          </div>
          <div class="actual-input">
            <button class="text-action" @click="importMetricsCsv">导入 CSV</button>
            <button class="text-action" :disabled="metricBusy" @click="confirmPublishedAndSchedule">确认已发布并加入 T+3</button>
            <button class="text-action" :disabled="metricBusy" @click="scheduleMetrics">加入 T+3 队列</button>
            <button class="text-action" :disabled="metricBusy" @click="fetchMetricsAndRunRetro">尝试自动采集</button>
            <button class="primary-action" :disabled="metricBusy" @click="importMetricsAndRunRetro">保存指标并生成复盘</button>
          </div>
          <small class="form-note">CSV 表头：views, likes, saves, comments, shares, followersGained。未满发布后 72 小时会被领域规则拒绝。</small>
          <div v-if="retro" class="retro-result">
            <span class="result-flag" :class="retro.intervalHits.views ? 'hit' : 'miss'">{{ retro.intervalHits.views ? '命中预测区间' : '超出预测区间' }}</span>
            <h2>{{ retro.insights[0] }}</h2>
            <ul><li v-for="action in retro.nextActions" :key="action">{{ action }}</li></ul>
          </div>
          <div v-else class="empty-state"><strong>等待第一份真实数据</strong><p>完成发布预览并补录 T+3 指标后，这里会显示预测误差与下一步实验。</p></div>
        </section>
      </div>

      <div v-else-if="view === 'settings'" class="secondary-view settings-view">
        <div class="page-heading"><span class="eyebrow">BYOK model</span><h1>模型服务留在你的控制里</h1><p>API Key 使用 Windows DPAPI 加密，渲染页面无法读取。</p></div>
        <section class="settings-card">
          <label>OpenAI-compatible Base URL<input v-model="aiConfig.baseUrl" /></label>
          <label>模型名称<input v-model="aiConfig.model" /></label>
          <label>API Key<input v-model="aiConfig.apiKey" type="password" :placeholder="aiConfig.hasKey ? '已加密保存；留空则不修改' : 'sk-…'" /></label>
          <button class="primary-action" @click="saveAiConfig">保存模型设置</button>
          <div class="publisher-safety">
            <div>
              <strong>真实平台发布</strong>
              <small>{{ liveEnabled ? '已启用；执行前仍需确认摘要' : '默认关闭；可安全进行评分与预览' }}</small>
            </div>
            <button class="text-action" @click="toggleLivePublishing">{{ liveEnabled ? '关闭真实发布' : '明确启用真实发布' }}</button>
          </div>
          <div class="data-actions">
            <button class="text-action" @click="onboardingOpen = true">重新查看入门</button>
            <button class="text-action" @click="exportWorkspace">导出工作区</button>
            <button class="text-action" @click="importWorkspace">导入工作区</button>
            <button class="text-action" @click="exportDiagnostics">导出脱敏诊断包</button>
          </div>
        </section>
      </div>

      <div v-else-if="view === 'benchmarks'" class="secondary-view benchmarks-view">
        <div class="page-heading"><span class="eyebrow">Reference library</span><h1>只导入你主动选择的样本</h1><p>保留来源与真实指标，不批量抓取、不自动追踪账号。</p></div>
        <div class="benchmarks-grid">
          <section class="settings-card benchmark-form">
            <label>平台<select v-model="benchmarkDraft.platform"><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option><option value="bilibili">B 站</option></select></label>
            <label>内容标题<input v-model="benchmarkDraft.title" placeholder="为什么这条内容值得作为对标" /></label>
            <label>来源 URL<input v-model="benchmarkDraft.sourceUrl" placeholder="可选，仅用于追溯" /></label>
            <label>播放 / 阅读<input v-model.number="benchmarkDraft.views" type="number" min="0" /></label>
            <div class="metrics-grid compact">
              <label>点赞<input v-model.number="benchmarkDraft.likes" type="number" min="0" /></label>
              <label>收藏<input v-model.number="benchmarkDraft.saves" type="number" min="0" /></label>
              <label>评论<input v-model.number="benchmarkDraft.comments" type="number" min="0" /></label>
              <label>分享<input v-model.number="benchmarkDraft.shares" type="number" min="0" /></label>
              <label>涨粉<input v-model.number="benchmarkDraft.followersGained" type="number" min="0" /></label>
            </div>
            <button class="primary-action" @click="importBenchmark">保存样本</button>
          </section>
          <section class="sample-list">
            <article v-for="sample in benchmarks" :key="sample.id">
              <span>{{ sample.platform }}</span><strong>{{ sample.title }}</strong>
              <small>{{ sample.metrics.views?.toLocaleString() ?? '—' }} 播放 · {{ new Date(sample.importedAt).toLocaleDateString() }}</small>
            </article>
          </section>
        </div>
      </div>

      <div v-else-if="view === 'accounts'" class="secondary-view accounts-view">
        <div class="page-heading"><span class="eyebrow">Local accounts</span><h1>账号凭证不离开本机</h1><p>登录由可见终端中的 `sau login` 完成；ReviewFlow 不接管验证码或平台风控。</p></div>
        <section class="account-list">
          <article v-for="platform in (['xiaohongshu', 'douyin', 'bilibili'] as Platform[])" :key="platform">
            <div class="platform-token">{{ platform === 'xiaohongshu' ? 'RED' : platform === 'douyin' ? 'DY' : 'B' }}</div>
            <div><strong>{{ platform === 'xiaohongshu' ? '小红书' : platform === 'douyin' ? '抖音' : 'B 站' }}</strong><small>{{ accountStatus[platform] }}</small></div>
            <label>账号别名<input v-model="accountIds[platform]" /></label>
            <div class="account-actions">
              <button class="primary-action" @click="openLogin(platform)">打开登录终端</button>
              <button class="text-action" @click="copyLoginCommand(platform)">复制登录命令</button>
              <button class="text-action" @click="checkAccount(platform)">检查登录</button>
            </div>
          </article>
        </section>
      </div>

      <div v-else-if="view === 'today'" class="secondary-view formula-view">
        <div class="page-heading"><span class="eyebrow">30-day validation</span><h1>把 MVP 验证目标放在每天都能看见的地方</h1><p>只统计最近 30 天已由你在平台后台确认的发布；复盘率只计算已经到达 T+3 的内容。</p></div>
        <section class="validation-grid" aria-label="MVP 验证进度">
          <article class="validation-card">
            <span>30 天已发布</span>
            <strong>{{ mvpValidation.publicationCount }} / {{ mvpValidation.targetPublicationCount }}</strong>
            <small>{{ mvpValidation.publicationTargetMet ? '发布样本目标已达到' : '继续积累已核验的真实发布' }}</small>
            <div class="validation-meter"><i :style="{ width: `${Math.min(100, mvpValidation.publicationCount / mvpValidation.targetPublicationCount * 100)}%` }" /></div>
          </article>
          <article class="validation-card">
            <span>T+3 复盘完成率</span>
            <strong>{{ mvpValidation.retroCompletionRate === null ? '等待到期' : `${Math.round(mvpValidation.retroCompletionRate * 100)}%` }}</strong>
            <small>已完成 {{ mvpValidation.retroCompletedCount }} / 已到期 {{ mvpValidation.retroDueCount }}</small>
            <div class="validation-meter"><i :style="{ width: `${(mvpValidation.retroCompletionRate ?? 0) * 100}%` }" /></div>
          </article>
          <article class="validation-card validation-status" :class="{ met: mvpValidation.validationTargetMet }">
            <span>核心验证状态</span>
            <strong>{{ mvpValidation.validationTargetMet ? '目标达成' : '继续验证' }}</strong>
            <small>门槛：8 条真实发布，已到期内容复盘率不低于 80%</small>
          </article>
        </section>
        <div class="page-heading formula-heading"><span class="eyebrow">Rubric lab</span><h2>让公式跟着你的样本进化</h2><p>同平台、同账号、同内容类型满 10 条复盘后才提出实验；回测不退化并由你接受后才升级。</p></div>
        <section class="formula-card">
          <div class="formula-version"><span>当前公式</span><strong>v{{ activeRubric.version }}</strong><small>{{ activeRubric.name }}</small></div>
          <div class="formula-progress">
            <span>{{ platformLabel(retroPlatform) }} · {{ content.kind === 'video' ? '视频' : '图文' }}</span>
            <strong>{{ currentCalibrationSamples().length }} / 10</strong>
            <div><i :style="{ width: `${Math.min(100, currentCalibrationSamples().length * 10)}%` }" /></div>
          </div>
          <button class="text-action" :disabled="currentCalibrationSamples().length < 10" @click="prepareFormulaExperiment">生成实验权重</button>
          <div v-if="formulaExperiment" class="formula-proposal">
            <span :class="formulaExperiment.evaluation.eligible ? 'pass' : 'hold'">
              {{ formulaExperiment.evaluation.eligible ? '回测通过' : '暂不升级' }}
            </span>
            <strong>排序一致性 {{ formulaExperiment.evaluation.rankingConsistency.toFixed(2) }}</strong>
            <small>{{ formulaExperiment.evaluation.reason }}</small>
            <button class="primary-action" :disabled="!formulaExperiment.evaluation.eligible" @click="acceptFormulaExperiment">接受并创建 v{{ activeRubric.version + 1 }}</button>
          </div>
        </section>
      </div>

      <div v-else class="secondary-view">
        <div class="page-heading"><span class="eyebrow">{{ view }}</span><h1>{{ navItems.find((item) => item.id === view)?.label }}</h1><p>这个模块已进入 MVP 数据模型，当前界面将在真实样本接入后展开。</p></div>
        <section class="empty-state large"><strong>保持范围克制</strong><p>先完成内容闭环，再增加更多平台与运营面板。</p></section>
      </div>
    </main>

    <PublishDialog
      :open="publishDialogOpen"
      :manifest="manifest"
      :warnings="publishWarnings"
      :live-enabled="liveEnabled"
      :busy="publishBusy"
      @close="publishDialogOpen = false"
      @confirm="confirmPublish"
    />
    <OnboardingDialog
      :open="onboardingOpen"
      :runtime-status="runtimeStatus"
      @finish="finishOnboarding"
      @navigate="navigateFromOnboarding"
    />
  </div>
</template>
