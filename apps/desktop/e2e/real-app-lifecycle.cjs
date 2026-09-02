const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
};

const desktopRoot = resolve(__dirname, "..");
const temporaryRoot = argumentValue("reviewflow-e2e-root");
const phase = argumentValue("reviewflow-e2e-phase");
const markerTitle = "ReviewFlow restart recovery marker";
const resultRoot = join(desktopRoot, "test-results");

assert.ok(temporaryRoot, "The outer E2E runner must provide an isolated temporary root");
assert.ok(["seed", "recover"].includes(phase), "The lifecycle phase must be seed or recover");

app.disableHardwareAcceleration();
app.setPath("userData", join(temporaryRoot, "user-data"));
process.env.REVIEWFLOW_LIVE_PUBLISH = "0";

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const waitFor = async (window, description, expression, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression, true)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const clickButton = async (window, label) => {
  const result = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return "missing";
    if (button.disabled) return "disabled";
    button.click();
    return "clicked";
  })()`, true);
  assert.equal(result, "clicked", `Button ${label} should be enabled`);
};

const setLabeledControl = async (window, labelText, value) => {
  const result = await window.webContents.executeJavaScript(`(() => {
    const ownText = (element) => [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .trim();
    const label = [...document.querySelectorAll("label")]
      .find((candidate) => ownText(candidate) === ${JSON.stringify(labelText)});
    const control = label?.querySelector("input, textarea, select");
    if (!control) return false;
    control.value = ${JSON.stringify(String(value))};
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`, true);
  assert.equal(result, true, `Labeled control ${labelText} should exist`);
};

const captureFailure = async (window) => {
  if (!window || window.isDestroyed()) return;
  mkdirSync(resultRoot, { recursive: true });
  try {
    const image = await window.webContents.capturePage();
    writeFileSync(join(resultRoot, `workspace-${phase}-failure.png`), image.toPNG());
  } catch {
    // The original assertion remains authoritative.
  }
  try {
    const html = await window.webContents.executeJavaScript("document.documentElement.outerHTML", true);
    writeFileSync(join(resultRoot, `workspace-${phase}-failure.html`), html, "utf8");
  } catch {
    // The renderer may already be unavailable.
  }
};

const runSeedPhase = async (window) => {
  await waitFor(window, "first-run onboarding", `Boolean(document.querySelector(".onboarding-dialog"))`);
  assert.match(
    await window.webContents.executeJavaScript("document.querySelector('.onboarding-dialog')?.textContent ?? ''", true),
    /先留下发布前判断/,
  );
  await clickButton(window, "跳过，稍后在设置中查看");
  await waitFor(window, "dismissed onboarding", `!document.querySelector(".onboarding-dialog")`);
  await setLabeledControl(window, "标题", markerTitle);
  await waitFor(window, "workspace persisted through the real preload", `(async () => {
    const saved = await window.reviewflow?.loadWorkspace();
    return saved?.onboardingComplete === true && saved?.content?.title === ${JSON.stringify(markerTitle)};
  })()`);
};

const runRecoverPhase = async (window) => {
  await waitFor(window, "restored content in the renderer", `(() => {
    const control = document.querySelector(".title-field textarea");
    return control?.value === ${JSON.stringify(markerTitle)};
  })()`);
  assert.equal(
    await window.webContents.executeJavaScript("Boolean(document.querySelector('.onboarding-dialog'))", true),
    false,
    "Completed onboarding must stay dismissed after a full application restart",
  );
  const saved = await window.webContents.executeJavaScript("window.reviewflow.loadWorkspace()", true);
  assert.equal(saved.onboardingComplete, true);
  assert.equal(saved.content.title, markerTitle);
};

let finished = false;
let startupTimer;

const finish = (window, exitCode) => {
  if (finished) return;
  finished = true;
  clearTimeout(startupTimer);
  process.exitCode = exitCode;
  if (window && !window.isDestroyed()) window.close();
  setTimeout(() => app.exit(exitCode), 8_000).unref();
};

app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", () => {
    void (async () => {
      try {
        if (phase === "seed") await runSeedPhase(window);
        else await runRecoverPhase(window);
        process.stdout.write(`${JSON.stringify({ scenario: `workspace_${phase}`, status: "passed" })}\n`);
        finish(window, 0);
      } catch (error) {
        await captureFailure(window);
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
        finish(window, 1);
      }
    })();
  });
});

startupTimer = setTimeout(() => {
  process.stderr.write("Timed out waiting for the real ReviewFlow window\n");
  finish(undefined, 1);
}, 20_000);

void import(pathToFileURL(join(desktopRoot, "dist-electron", "main.js")).href).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  finish(undefined, 1);
});
