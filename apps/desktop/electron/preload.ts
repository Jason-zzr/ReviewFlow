import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("reviewflow", {
  pickMedia: (): Promise<string[]> => ipcRenderer.invoke("media:pick"),
  pickMetricsCsv: (): Promise<string | null> => ipcRenderer.invoke("metrics:pick-csv"),
  copyLoginCommand: (input: { platform: string; accountId: string }): Promise<string> =>
    ipcRenderer.invoke("account:copy-login", input),
  openLogin: (input: { platform: string; accountId: string }): Promise<{ opened: boolean }> =>
    ipcRenderer.invoke("account:open-login", input),
  loadWorkspace: (): Promise<unknown> => ipcRenderer.invoke("workspace:load"),
  saveWorkspace: (payload: unknown): Promise<{ saved: boolean }> => ipcRenderer.invoke("workspace:save", payload),
  exportWorkspace: (): Promise<string | null> => ipcRenderer.invoke("workspace:export"),
  importWorkspace: (): Promise<boolean> => ipcRenderer.invoke("workspace:import"),
  exportDiagnostics: (): Promise<string | null> => ipcRenderer.invoke("diagnostics:export"),
  runtimeStatus: (): Promise<{ sidecar: "starting" | "ready" | "missing" | "stopped"; livePublishingEnabled: boolean }> =>
    ipcRenderer.invoke("runtime:status"),
  setPublisherEnabled: (enabled: boolean): Promise<{ enabled: boolean; sidecar: "starting" | "ready" | "missing" | "stopped" }> =>
    ipcRenderer.invoke("publisher:set-enabled", enabled),
  sidecarRequest: (input: { path: string; method?: string; body?: unknown }): Promise<unknown> =>
    ipcRenderer.invoke("sidecar:request", input),
  getAiConfig: (): Promise<{ baseUrl: string; model: string; hasKey: boolean }> => ipcRenderer.invoke("ai:get-config"),
  saveAiConfig: (input: { baseUrl: string; model: string; apiKey?: string }): Promise<unknown> =>
    ipcRenderer.invoke("ai:save-config", input),
  scoreWithAi: (content: Record<string, unknown>): Promise<unknown> => ipcRenderer.invoke("ai:score", content),
});
