/// <reference types="vite/client" />

interface Window {
  reviewflow?: {
    pickMedia(): Promise<string[]>;
    pickMetricsCsv(): Promise<string | null>;
    copyLoginCommand(input: { platform: string; accountId: string }): Promise<string>;
    openLogin(input: { platform: string; accountId: string }): Promise<{ opened: boolean }>;
    loadWorkspace(): Promise<unknown>;
    saveWorkspace(payload: unknown): Promise<{ saved: boolean }>;
    exportWorkspace(): Promise<string | null>;
    importWorkspace(): Promise<boolean>;
    exportDiagnostics(): Promise<string | null>;
    runtimeStatus(): Promise<{ sidecar: "starting" | "ready" | "missing" | "stopped"; livePublishingEnabled: boolean }>;
    setPublisherEnabled(enabled: boolean): Promise<{ enabled: boolean; sidecar: "starting" | "ready" | "missing" | "stopped" }>;
    sidecarRequest(input: { path: string; method?: string; body?: unknown }): Promise<unknown>;
    getAiConfig(): Promise<{ baseUrl: string; model: string; hasKey: boolean }>;
    saveAiConfig(input: { baseUrl: string; model: string; apiKey?: string }): Promise<unknown>;
    scoreWithAi(content: Record<string, unknown>): Promise<unknown>;
  };
}
