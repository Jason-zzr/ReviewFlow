const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const electronPath = require("electron");
const temporaryRoot = mkdtempSync(join(tmpdir(), "reviewflow-renderer-e2e-"));
const resultRoot = join(__dirname, "..", "test-results");
const videoPath = join(temporaryRoot, "video.mp4");
const imagePath = join(temporaryRoot, "image.png");

for (const scenario of ["video", "image_text", "challenge"]) {
  rmSync(join(resultRoot, `renderer-${scenario}-failure.png`), { force: true });
  rmSync(join(resultRoot, `renderer-${scenario}-failure.html`), { force: true });
}

writeFileSync(videoPath, Buffer.from([
  0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50,
  0, 0, 0, 0, 109, 112, 52, 50, 105, 115, 111, 109,
]));
writeFileSync(
  imagePath,
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
);

let exitCode = 1;
try {
  const result = spawnSync(
    electronPath,
    [
      join(__dirname, "electron-harness.cjs"),
      `--reviewflow-e2e-root=${encodeURIComponent(temporaryRoot)}`,
    ],
    {
      cwd: join(__dirname, "..", "..", ".."),
      encoding: "utf8",
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
} finally {
  try {
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    process.stderr.write(`Unable to remove isolated E2E data: ${error instanceof Error ? error.message : String(error)}\n`);
    if (exitCode === 0) exitCode = 1;
  }
}

process.exit(exitCode);
