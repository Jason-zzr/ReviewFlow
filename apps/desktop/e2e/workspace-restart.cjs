const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, sep } = require("node:path");

const electronPath = require("electron");
const temporaryRoot = mkdtempSync(join(tmpdir(), "reviewflow-workspace-e2e-"));
const resultRoot = join(__dirname, "..", "test-results");

for (const phase of ["seed", "recover"]) {
  rmSync(join(resultRoot, `workspace-${phase}-failure.png`), { force: true });
  rmSync(join(resultRoot, `workspace-${phase}-failure.html`), { force: true });
}

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
      join(__dirname, "real-app-lifecycle.cjs"),
      `--reviewflow-e2e-root=${encodeURIComponent(temporaryRoot)}`,
      `--reviewflow-e2e-phase=${phase}`,
    ],
    {
      cwd: join(__dirname, "..", "..", ".."),
      env: { ...process.env, REVIEWFLOW_LIVE_PUBLISH: "0" },
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
    settle(new Error(`Electron ${phase} phase timed out after 45 seconds`));
  }, 45_000);
  child.once("error", settle);
  child.once("exit", (code, signal) => {
    if (code === 0) settle();
    else settle(new Error(`Electron ${phase} phase exited with ${code ?? signal ?? "unknown"}`));
  });
});

const removeTemporaryRoot = () => {
  const temporaryParent = `${tmpdir()}${sep}`.toLocaleLowerCase();
  const resolvedRoot = `${temporaryRoot}${sep}`.toLocaleLowerCase();
  const safeTemporaryRoot = resolvedRoot.startsWith(temporaryParent)
    && basename(temporaryRoot).startsWith("reviewflow-workspace-e2e-");
  if (!safeTemporaryRoot) {
    throw new Error(`Refusing to remove unexpected E2E path: ${temporaryRoot}`);
  }
  rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
};

const main = async () => {
  let exitCode = 1;
  try {
    for (const phase of ["seed", "recover"]) await runPhase(phase);
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
