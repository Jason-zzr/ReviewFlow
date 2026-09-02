const fixedPaths = new Set([
  "/health",
  "/v1/adapters",
  "/v1/accounts/check",
  "/v1/publications",
  "/v1/publish/preview",
  "/v1/publish/execute",
  "/v1/metrics/import",
  "/v1/metrics/schedule",
  "/v1/metrics/tasks",
  "/v1/metrics/fetch",
]);

export const isAllowedSidecarPath = (path: string): boolean =>
  fixedPaths.has(path)
  || /^\/v1\/publications\/[a-zA-Z0-9._-]+$/.test(path)
  || /^\/v1\/publications\/[a-zA-Z0-9._-]+\/confirm$/.test(path)
  || /^\/v1\/metrics\/latest\/[a-zA-Z0-9._:-]+$/.test(path);
