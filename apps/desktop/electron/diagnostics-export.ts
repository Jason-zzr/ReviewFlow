export type DiagnosticSidecarStatus = "starting" | "ready" | "missing" | "stopped";

export interface DiagnosticsInput {
  generatedAt: string;
  appVersion: string;
  platform: NodeJS.Platform;
  architecture: string;
  packaged: boolean;
  sidecarConfigured: boolean;
  sidecarStatus: DiagnosticSidecarStatus;
  databasePresent: boolean;
}

export interface DiagnosticsSnapshot extends DiagnosticsInput {
  note: string;
}

export const buildDiagnosticsSnapshot = (input: DiagnosticsInput): DiagnosticsSnapshot => ({
  generatedAt: input.generatedAt,
  appVersion: input.appVersion,
  platform: input.platform,
  architecture: input.architecture,
  packaged: input.packaged,
  sidecarConfigured: input.sidecarConfigured,
  sidecarStatus: input.sidecarStatus,
  databasePresent: input.databasePresent,
  note: "Credentials, cookies, API keys, content bodies, media paths, and raw platform payloads are excluded.",
});
