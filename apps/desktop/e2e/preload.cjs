const { contextBridge } = require("electron");

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
};

const mediaPath = argumentValue("reviewflow-e2e-media");
const scenario = argumentValue("reviewflow-e2e-scenario") || "video";
const mode = argumentValue("reviewflow-e2e-mode") || "complete";
let savedWorkspace = null;
const sidecarCalls = [];
let publishJob = null;
let lastSidecarError = "";

const nowIso = () => new Date().toISOString();
const publicationId = `publication-e2e-${scenario}`;

const clone = (value) => JSON.parse(JSON.stringify(value));

const handleSidecarRequest = (input) => {
  if (input.path === "/v1/publications" || input.path === "/v1/metrics/tasks") return [];
  if (input.path === "/v1/publish/preview" && input.method === "POST") {
    if (!input.body?.manifest?.digest) throw new Error("E2E preview requires a sealed manifest");
    if (input.body.manifest.variants.some((variant) => !variant.mediaPaths.includes(mediaPath))) {
      throw new Error("E2E preview requires the selected media path");
    }
    return { warnings: [], livePublishingEnabled: true };
  }
  if (input.path === "/v1/publish/execute" && input.method === "POST") {
    if (mode === "challenge") {
      throw new Error("userActionRequired: platform challenge detected; complete verification manually");
    }
    const { manifest, confirmationDigest, idempotencyKey } = input.body ?? {};
    if (!manifest?.digest || confirmationDigest !== manifest.digest) {
      throw new Error("E2E publish confirmation digest does not match");
    }
    if (idempotencyKey !== `${manifest.id}:${manifest.digest.slice(0, 16)}`) {
      throw new Error("E2E publish idempotency key is not digest-bound");
    }
    publishJob ??= {
      id: `job-e2e-${scenario}`,
      manifestId: manifest.id,
      status: "unknown",
      dryRun: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      details: { evidence: "fixture-only; no platform request was made" },
    };
    return clone(publishJob);
  }
  const confirmation = input.path.match(/^\/v1\/publications\/([^/]+)\/confirm$/);
  if (confirmation && input.method === "POST") {
    if (!publishJob || confirmation[1] !== publishJob.id) throw new Error("E2E publish job was not submitted");
    const publishedAt = input.body?.publishedAt;
    if (!publishedAt) throw new Error("E2E publication confirmation requires publishedAt");
    publishJob = { ...publishJob, status: "published", updatedAt: nowIso() };
    const dueAt = new Date(new Date(publishedAt).getTime() + 72 * 60 * 60 * 1_000).toISOString();
    return {
      publicationId,
      job: clone(publishJob),
      metricTask: {
        id: `metric-task-e2e-${scenario}`,
        platform: input.body.platform,
        publicationId,
        externalRef: input.body.externalRef,
        publishedAt,
        dueAt,
        nextAttemptAt: dueAt,
        status: "pending",
        attempts: 0,
        lastError: null,
      },
    };
  }
  if (input.path === "/v1/metrics/import" && input.method === "POST") {
    if (input.body?.publicationId !== publicationId) throw new Error("E2E metric publication does not match");
    return {
      id: `snapshot-e2e-${scenario}`,
      publicationId,
      capturedAt: nowIso(),
      source: input.body.source,
      metrics: clone(input.body.metrics),
      raw: { fixture: true },
    };
  }
  throw new Error(`E2E Sidecar adapter does not implement ${input.path}`);
};

contextBridge.exposeInMainWorld("reviewflow", {
  pickMedia: async () => [mediaPath],
  pickMetricsCsv: async () => null,
  copyLoginCommand: async () => "",
  openLogin: async () => ({ opened: false }),
  loadWorkspace: async () => ({ onboardingComplete: true }),
  saveWorkspace: async (payload) => {
    savedWorkspace = payload;
    return { saved: true };
  },
  exportWorkspace: async () => null,
  importWorkspace: async () => false,
  exportDiagnostics: async () => null,
  runtimeStatus: async () => ({ sidecar: "ready", livePublishingEnabled: true }),
  setPublisherEnabled: async () => ({ enabled: true, sidecar: "ready" }),
  sidecarRequest: async (input) => {
    try {
      sidecarCalls.push(clone(input));
      return clone(handleSidecarRequest(input));
    } catch (error) {
      lastSidecarError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  },
  getAiConfig: async () => ({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    hasKey: false,
  }),
  saveAiConfig: async () => ({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    hasKey: false,
  }),
  scoreWithAi: async () => {
    throw new Error("The E2E renderer uses deterministic local scoring");
  },
});

contextBridge.exposeInMainWorld("__reviewflowE2E", {
  snapshot: () => clone({ savedWorkspace, sidecarCalls, lastSidecarError }),
});
