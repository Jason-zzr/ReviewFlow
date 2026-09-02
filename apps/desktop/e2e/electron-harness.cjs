const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { app, BrowserWindow } = require("electron");

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
};

const desktopRoot = resolve(__dirname, "..");
const temporaryRoot = argumentValue("reviewflow-e2e-root");
assert.ok(temporaryRoot, "The outer E2E runner must provide an isolated temporary root");
const resultRoot = join(desktopRoot, "test-results");
const scenarios = [
  {
    id: "video",
    kind: "video",
    label: "视频",
    mediaPath: join(temporaryRoot, "video.mp4"),
    mode: "complete",
    metricsCsv: "\uFEFFpublicationId,views,likes,saves,comments,shares,followersGained,note\r\n"
      + "publication-e2e-video,1200,120,42,18,9,7,\"first line\r\nsecond line, with \"\"evidence\"\"\"",
  },
  { id: "image_text", kind: "image_text", label: "图文", mediaPath: join(temporaryRoot, "image.png"), mode: "complete" },
  { id: "challenge", kind: "video", label: "视频", mediaPath: join(temporaryRoot, "video.mp4"), mode: "challenge" },
];
app.setPath("userData", join(temporaryRoot, "user-data"));
app.on("window-all-closed", () => {
  // The harness owns application lifetime while it runs multiple isolated windows.
});

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const waitFor = async (window, description, expression, timeout = 10_000) => {
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

const clickSelector = async (window, selector, description) => {
  const result = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return "missing";
    if (element.disabled) return "disabled";
    element.click();
    return "clicked";
  })()`, true);
  assert.equal(result, "clicked", `${description} should be enabled`);
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

const preparePublishDialog = async (window, scenario) => {
  await waitFor(window, "the content studio", `Boolean([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "开始评分"))`);
  await clickButton(window, scenario.label);
  await clickSelector(window, ".media-drop", "Media picker");
  await waitFor(window, "managed media selection", `document.body.textContent.includes("1 个素材已选择")`);
  await clickButton(window, "开始评分");
  await waitFor(window, "score result", `document.querySelector(".save-state")?.textContent.includes("评分完成")`);
  await waitFor(window, "score evidence and rubric version", `document.querySelector(".score-meta")?.textContent.includes("公式 v1")
    && document.querySelector(".score-evidence-list")?.textContent.includes("评分依据")
    && document.querySelector(".score-evidence-list")?.textContent.includes("改进建议")`);
  await clickButton(window, "生成区间预测");
  await waitFor(window, "prediction", `document.querySelector(".prediction-tape")?.textContent.includes("播放中枢")`);
  await waitFor(window, "prediction evidence and interval", `document.querySelector(".prediction-meta")?.textContent.includes("冷启动先验")
    && document.querySelector(".prediction-meta")?.textContent.includes("0 条样本")
    && document.querySelector(".prediction-meta")?.textContent.includes("deterministic-baseline")
    && document.querySelector(".prediction-meta")?.textContent.includes("prediction-v2")
    && document.querySelector(".prediction-range-grid")?.textContent.includes("P10")
    && document.querySelector(".prediction-range-grid")?.textContent.includes("P90")
    && document.querySelectorAll(".prediction-rationale li").length === 3`);
  await clickButton(window, "进入发布预览");
  await waitFor(window, "publish dialog", `document.querySelector('[role="dialog"]')?.textContent.includes("确认这一个发布清单")`);
  await window.webContents.executeJavaScript(`(() => {
    for (const checkbox of document.querySelectorAll('.publish-dialog input[type="checkbox"]')) checkbox.click();
  })()`, true);
  await waitFor(window, "enabled exact publish confirmation", `Boolean([...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "确认并发布" && !button.disabled))`);
};

const runContentFlow = async (window, scenario) => {
  await preparePublishDialog(window, scenario);
  await clickButton(window, "确认并发布");
  await waitFor(window, "unknown publish state", `document.querySelector(".save-state")?.textContent.includes("unknown")
    && !document.querySelector(".save-state")?.textContent.includes("发布成功")`);

  await clickButton(window, "恢复上次发布清单");
  await waitFor(window, "restored publish dialog", `document.querySelector('[role="dialog"]')?.textContent.includes("确认这一个发布清单")`);
  await window.webContents.executeJavaScript(`(() => {
    for (const checkbox of document.querySelectorAll('.publish-dialog input[type="checkbox"]')) checkbox.click();
  })()`, true);
  await waitFor(window, "enabled restored confirmation", `Boolean([...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "确认并发布" && !button.disabled))`);
  await clickButton(window, "确认并发布");
  await waitFor(window, "idempotent publish persistence", `window.__reviewflowE2E.snapshot().savedWorkspace?.publishJobs?.length === 1`);

  await clickButton(window, "复盘队列");
  await waitFor(window, "retrospective queue", `document.body.textContent.includes("复盘不是总结，是校准")`);
  const publishedAt = new Date(Date.now() - 80 * 60 * 60 * 1_000).toISOString().slice(0, 16);
  await setLabeledControl(window, "真实发布时间", publishedAt);
  await setLabeledControl(window, "内容链接 / BV 号", `https://example.test/${scenario.kind}`);
  await clickButton(window, "确认已发布并加入 T+3");
  await waitFor(window, "confirmed publication", `document.querySelector(".save-state")?.textContent.includes("已确认小红书发布")`);
  const expectedMetrics = { views: 1200, likes: 120, saves: 42, comments: 18, shares: 9, followersGained: 7 };
  if (scenario.metricsCsv) {
    await clickButton(window, "导入 CSV");
    await waitFor(window, "CSV metrics import", `(() => {
      const expected = ${JSON.stringify(expectedMetrics)};
      const labels = [...document.querySelectorAll(".metrics-grid label")];
      return document.querySelector(".save-state")?.textContent.includes("CSV 指标已载入")
        && Object.entries(expected).every(([metric, value]) => {
          const label = labels.find((candidate) => candidate.childNodes[0]?.textContent?.trim() === metric);
          return label?.querySelector("input")?.value === String(value);
        });
    })()`);
  } else {
    for (const [metric, value] of Object.entries(expectedMetrics)) {
      await setLabeledControl(window, metric, value);
    }
  }
  await clickButton(window, "保存指标并生成复盘");
  await waitFor(window, "T+3 retrospective", `document.querySelector(".retro-result")
    && document.querySelector(".save-state")?.textContent.includes("T+3 复盘已生成")`);
  await waitFor(window, "complete retrospective comparison", `document.querySelectorAll(".retro-metric-results article").length === 6
    && document.querySelector(".retro-metric-results")?.textContent.includes("真实1,200")
    && document.querySelector(".retro-metric-results")?.textContent.includes("P10")
    && document.querySelector(".retro-metric-results")?.textContent.includes("P90")
    && document.querySelector(".retro-metric-results")?.textContent.includes("相对误差 +20.0%")
    && document.querySelector(".retro-timing")?.textContent.includes("T+3 到期")`);
  await waitFor(window, "persisted completed flow", `Boolean(window.__reviewflowE2E.snapshot().savedWorkspace?.retro)`);

  const state = await window.webContents.executeJavaScript("window.__reviewflowE2E.snapshot()", true);
  assert.equal(state.savedWorkspace.content.kind, scenario.kind);
  assert.equal(state.savedWorkspace.publishJobs.length, 1);
  assert.equal(state.savedWorkspace.publicationContexts[0].kind, scenario.kind);
  assert.equal(state.savedWorkspace.retro.publicationId, `publication-e2e-${scenario.id}`);
  assert.equal(state.savedWorkspace.metricSource, scenario.metricsCsv ? "csv" : "manual");
  const executeCalls = state.sidecarCalls.filter((call) => call.path === "/v1/publish/execute");
  assert.equal(state.sidecarCalls.filter((call) => call.path === "/v1/publish/preview").length, 2);
  assert.equal(executeCalls.length, 2);
  assert.equal(executeCalls[0].body.idempotencyKey, executeCalls[1].body.idempotencyKey);
  assert.ok(executeCalls[0].body.manifest.variants.every((variant) => variant.mediaPaths.includes(scenario.mediaPath)));
};

const runChallengeFlow = async (window, scenario) => {
  await preparePublishDialog(window, scenario);
  await clickButton(window, "确认并发布");
  await waitFor(window, "user action required state", `document.querySelector(".save-state")?.textContent.includes("userActionRequired")
    && !document.querySelector(".save-state")?.textContent.includes("发布成功")
    && Boolean(document.querySelector('[role="dialog"]'))`);
  const state = await window.webContents.executeJavaScript("window.__reviewflowE2E.snapshot()", true);
  assert.equal(state.sidecarCalls.filter((call) => call.path === "/v1/publish/preview").length, 1);
  assert.equal(state.sidecarCalls.filter((call) => call.path === "/v1/publish/execute").length, 1);
  assert.match(state.lastSidecarError, /^userActionRequired:/);
};

const captureFailure = async (window, scenario) => {
  if (!window || window.isDestroyed()) return;
  mkdirSync(resultRoot, { recursive: true });
  try {
    const image = await window.webContents.capturePage();
    writeFileSync(join(resultRoot, `renderer-${scenario.id}-failure.png`), image.toPNG());
  } catch (error) {
    process.stderr.write(`Unable to capture E2E failure screenshot: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  try {
    const html = await window.webContents.executeJavaScript("document.documentElement.outerHTML", true);
    writeFileSync(join(resultRoot, `renderer-${scenario.id}-failure.html`), html, "utf8");
  } catch {
    // The renderer may already be unavailable; the original assertion remains authoritative.
  }
};

app.whenReady().then(async () => {
  let exitCode = 0;
  for (const scenario of scenarios) {
    let window;
    try {
      window = new BrowserWindow({
        show: false,
        width: 1440,
        height: 920,
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          additionalArguments: [
            `--reviewflow-e2e-media=${encodeURIComponent(scenario.mediaPath)}`,
            `--reviewflow-e2e-scenario=${scenario.id}`,
            `--reviewflow-e2e-mode=${scenario.mode}`,
            ...(scenario.metricsCsv
              ? [`--reviewflow-e2e-metrics-csv=${encodeURIComponent(scenario.metricsCsv)}`]
              : []),
          ],
        },
      });
      await window.loadFile(join(desktopRoot, "dist", "index.html"));
      if (scenario.mode === "challenge") await runChallengeFlow(window, scenario);
      else await runContentFlow(window, scenario);
      process.stdout.write(`${JSON.stringify({ scenario: scenario.id, status: "passed" })}\n`);
    } catch (error) {
      exitCode = 1;
      await captureFailure(window, scenario);
      if (window && !window.isDestroyed()) {
        try {
          const diagnostics = await window.webContents.executeJavaScript(`(() => {
            const state = window.__reviewflowE2E?.snapshot();
            return { lastSidecarError: state?.lastSidecarError, paths: state?.sidecarCalls?.map((call) => call.path) };
          })()`, true);
          process.stderr.write(`${JSON.stringify(diagnostics)}\n`);
        } catch {
          // The original assertion remains authoritative.
        }
      }
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    } finally {
      if (window && !window.isDestroyed()) window.destroy();
    }
    if (exitCode !== 0) break;
  }
  app.exit(exitCode);
});
