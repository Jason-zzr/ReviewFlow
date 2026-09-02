const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, sep } = require("node:path");

const electronPath = require("electron");
const temporaryRoot = mkdtempSync(join(tmpdir(), "reviewflow-production-flow-e2e-"));
const resultRoot = join(__dirname, "..", "test-results");
const videoPath = join(temporaryRoot, "video.mp4");
const imagePath = join(temporaryRoot, "image.png");
const metricsCsvPath = join(temporaryRoot, "metrics.csv");

writeFileSync(videoPath, Buffer.from([
  0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50,
  0, 0, 0, 0, 109, 112, 52, 50, 105, 115, 111, 109,
]));
writeFileSync(
  imagePath,
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
);
writeFileSync(
  metricsCsvPath,
  "\uFEFFviews,likes,saves,comments,shares,followersGained,note\r\n"
    + "1200,120,42,18,9,7,\"first line\r\nsecond line, with \"\"evidence\"\"\"",
  "utf8",
);
rmSync(join(resultRoot, "production-video-failure.png"), { force: true });
rmSync(join(resultRoot, "production-image_text-failure.png"), { force: true });
rmSync(join(resultRoot, "production-recover-failure.png"), { force: true });
rmSync(join(resultRoot, "production-schedule-failure.png"), { force: true });

const terminateProcessTree = (child) => {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGKILL");
};

const runPhase = (phase) => new Promise((resolvePhase, rejectPhase) => {
  const child = spawn(
    electronPath,
    [
      join(__dirname, "production-flow-harness.cjs"),
      `--reviewflow-e2e-root=${encodeURIComponent(temporaryRoot)}`,
      `--reviewflow-e2e-phase=${phase}`,
    ],
    {
      cwd: join(__dirname, "..", "..", ".."),
      env: { ...process.env, REVIEWFLOW_LIVE_PUBLISH: "1" },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  let settled = false;
  let timeout;
  const settle = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (error) rejectPhase(error);
    else resolvePhase();
  };
  timeout = setTimeout(() => {
    terminateProcessTree(child);
    settle(new Error(`Production bridge ${phase} phase timed out after 60 seconds`));
  }, 60_000);
  child.once("error", settle);
  child.once("exit", (code, signal) => {
    if (code === 0) settle();
    else settle(new Error(`Production bridge ${phase} phase exited with ${code ?? signal ?? "unknown"}`));
  });
});

const removeTemporaryRoot = () => {
  const temporaryParent = `${tmpdir()}${sep}`.toLocaleLowerCase();
  const resolvedRoot = `${temporaryRoot}${sep}`.toLocaleLowerCase();
  const safeTemporaryRoot = resolvedRoot.startsWith(temporaryParent)
    && basename(temporaryRoot).startsWith("reviewflow-production-flow-e2e-");
  if (!safeTemporaryRoot) throw new Error(`Refusing to remove unexpected E2E path: ${temporaryRoot}`);
  rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
};

const main = async () => {
  let exitCode = 1;
  try {
    for (const phase of ["video", "image_text", "recover", "schedule"]) await runPhase(phase);
    exitCode = 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  } finally {
    try {
      removeTemporaryRoot();
    } catch (error) {
      process.stderr.write(`Unable to remove isolated E2E data: ${error instanceof Error ? error.message : String(error)}\n`);
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
};

void main();
