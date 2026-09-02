const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { mkdirSync, statSync, writeFileSync } = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, dialog } = require("electron");

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
};

const desktopRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(desktopRoot, "..", "..");
const temporaryRoot = argumentValue("reviewflow-e2e-root");
const phase = argumentValue("reviewflow-e2e-phase");
const fixtureSidecar = join(workspaceRoot, "services", "publisher", "tests", "fixtures", "e2e_sidecar.py");
const resultRoot = join(desktopRoot, "test-results");

assert.ok(temporaryRoot, "The outer E2E runner must provide an isolated temporary root");
assert.ok(["video", "image_text", "recover", "schedule"].includes(phase), "The production flow phase is unsupported");

const scenario = phase !== "image_text"
  ? {
      id: phase,
      kind: "video",
      label: "视频",
      mediaPath: join(temporaryRoot, "video.mp4"),
      metricsCsvPath: join(temporaryRoot, "metrics.csv"),
    }
  : {
      id: phase,
      kind: "image_text",
      label: "图文",
      mediaPath: join(temporaryRoot, "image.png"),
    };
const userDataRoot = join(temporaryRoot, phase === "recover" ? "video" : phase, "user-data");

const originalSpawn = childProcess.spawn;
let observedSidecarSession;
childProcess.spawn = (command, args, options) => {
  const sidecarLaunch = Array.isArray(args) && args.includes("reviewflow_publisher.main");
  if (sidecarLaunch) {
    const token = options?.env?.REVIEWFLOW_SESSION_TOKEN;
    const port = Number(options?.env?.REVIEWFLOW_SIDECAR_PORT);
    assert.match(token ?? "", /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(port) && port >= 43_117 && port < 44_117);
    observedSidecarSession = { token, port };
    const fixtureArguments = command === "py" ? ["-3.10", fixtureSidecar] : [fixtureSidecar];
    const child = originalSpawn(command, fixtureArguments, {
      ...options,
      env: { ...options.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => process.stderr.write(`[fixture-sidecar] ${chunk}`));
    child.stderr?.on("data", (chunk) => process.stderr.write(`[fixture-sidecar] ${chunk}`));
    return child;
  }
  return originalSpawn(command, args, options);
};
syncBuiltinESMExports();

dialog.showOpenDialog = async (options) => {
  const extensions = options?.filters?.flatMap((filter) => filter.extensions ?? []) ?? [];
  const filePath = extensions.includes("csv") ? scenario.metricsCsvPath : scenario.mediaPath;
  return { canceled: false, filePaths: [filePath] };
};

app.disableHardwareAcceleration();
app.setPath("userData", userDataRoot);
process.env.REVIEWFLOW_LIVE_PUBLISH = "1";
process.env.REVIEWFLOW_E2E_ROOT = temporaryRoot;

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const toLocalDateTimeInput = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const waitFor = async (window, description, expression, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression, true)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const verifySidecarRequestSecurity = async () => {
  assert.ok(observedSidecarSession, "The production main process must launch the Sidecar");
  const url = `http://127.0.0.1:${observedSidecarSession.port}/v1/adapters`;
  const missing = await fetch(url);
  assert.equal(missing.status, 401);
  const wrong = await fetch(url, { headers: { Authorization: `Bearer ${"0".repeat(64)}` } });
  assert.equal(wrong.status, 401);
  const disallowedOrigin = await fetch(url, {
    headers: {
      Authorization: `Bearer ${observedSidecarSession.token}`,
      Origin: "https://untrusted.example",
    },
  });
  assert.equal(disallowedOrigin.status, 403);
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

const clickButtonIn = async (window, selector, label) => {
  const result = await window.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    const button = [...(root?.querySelectorAll("button") ?? [])]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return "missing";
    if (button.disabled) return "disabled";
    button.click();
    return "clicked";
  })()`, true);
  assert.equal(result, "clicked", `Button ${label} in ${selector} should be enabled`);
};

const clickAccountButton = async (window, cardIndex, label) => {
  const result = await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelectorAll(".accounts-view article")[${cardIndex}];
    const button = [...(card?.querySelectorAll("button") ?? [])]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return "missing";
    if (button.disabled) return "disabled";
    button.click();
    return "clicked";
  })()`, true);
  assert.equal(result, "clicked", `Account button ${label} at index ${cardIndex} should be enabled`);
};

const clickNavigationItem = async (window, label) => {
  const result = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('nav[aria-label="主导航"] button')]
      .find((candidate) => candidate.querySelector("span")?.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return "missing";
    button.click();
    return "clicked";
  })()`, true);
  assert.equal(result, "clicked", `Navigation item ${label} should exist`);
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

const runContentFlow = async (window) => {
  await waitFor(window, "first-run onboarding", `Boolean(document.querySelector(".onboarding-dialog"))`);
  await clickButton(window, "跳过，稍后在设置中查看");
  await waitFor(window, "fixture Sidecar readiness", `(async () => {
    const status = await window.reviewflow?.runtimeStatus();
    return status?.sidecar === "ready" && status?.livePublishingEnabled === true;
  })()`);
  await verifySidecarRequestSecurity();
  const account = await window.webContents.executeJavaScript(`window.reviewflow.sidecarRequest({
    path: "/v1/accounts/check",
    method: "POST",
    body: { platform: "xiaohongshu", accountId: "fixture" }
  })`, true);
  assert.equal(account.runtimeAvailable, true);
  assert.equal(account.authenticated, false);

  await clickButton(window, scenario.label);
  await clickButtonIn(window, ".platform-select", "抖音");
  await clickButtonIn(window, ".platform-select", "B 站");
  await clickSelector(window, ".media-drop", "Media picker");
  await waitFor(window, "managed media selection", `document.body.textContent.includes("1 个素材已选择")`);
  await clickButton(window, "开始评分");
  await waitFor(window, "score evidence", `document.querySelector(".save-state")?.textContent.includes("评分完成")
    && document.querySelector(".score-meta")?.textContent.includes("公式 v1")
    && document.querySelector(".score-evidence-list")?.textContent.includes("评分依据")`);
  await clickButton(window, "生成区间预测");
  await waitFor(window, "prediction interval", `document.querySelector(".prediction-meta")?.textContent.includes("prediction-v2")
    && document.querySelector(".prediction-range-grid")?.textContent.includes("P10")
    && document.querySelector(".prediction-range-grid")?.textContent.includes("P90")`);
  await clickButton(window, "进入发布预览");
  await waitFor(window, "publish dialog", `document.querySelector('[role="dialog"]')?.textContent.includes("确认这一个发布清单")`);
  await window.webContents.executeJavaScript(`(() => {
    for (const checkbox of document.querySelectorAll('.publish-dialog input[type="checkbox"]')) checkbox.click();
  })()`, true);
  await clickButton(window, "确认并发布");
  await waitFor(window, "conservative unknown state", `document.querySelector(".save-state")?.textContent.includes("unknown")
    && !document.querySelector(".save-state")?.textContent.includes("发布成功")`);

  await clickButton(window, "恢复上次发布清单");
  await waitFor(window, "restored publish dialog", `Boolean(document.querySelector('[role="dialog"]'))`);
  await window.webContents.executeJavaScript(`(() => {
    for (const checkbox of document.querySelectorAll('.publish-dialog input[type="checkbox"]')) checkbox.click();
  })()`, true);
  await clickButton(window, "确认并发布");
  await waitFor(window, "one idempotent publication", `(async () => {
    const jobs = await window.reviewflow.sidecarRequest({ path: "/v1/publications" });
    return jobs.length === 1 && jobs[0].dryRun === false && jobs[0].status === "unknown";
  })()`);

  await clickButton(window, "复盘队列");
  await waitFor(window, "retrospective queue", `document.body.textContent.includes("复盘不是总结，是校准")`);
  const publishedAt = new Date(Date.now() - 80 * 60 * 60 * 1_000).toISOString().slice(0, 16);
  await setLabeledControl(window, "真实发布时间", publishedAt);
  await setLabeledControl(window, "内容链接 / BV 号", `https://example.test/${scenario.kind}`);
  await clickButton(window, "确认已发布并加入 T+3");
  await waitFor(window, "confirmed publication", `document.querySelector(".save-state")?.textContent.includes("已确认小红书发布")`);
  const expectedMetrics = { views: 1200, likes: 120, saves: 42, comments: 18, shares: 9, followersGained: 7 };
  if (scenario.metricsCsvPath) {
    await clickButton(window, "导入 CSV");
    await waitFor(window, "CSV metrics", `document.querySelector(".save-state")?.textContent.includes("CSV 指标已载入")`);
  } else {
    for (const [metric, value] of Object.entries(expectedMetrics)) {
      await setLabeledControl(window, metric, value);
    }
  }
  await clickButton(window, "保存指标并生成复盘");
  await waitFor(window, "T+3 retrospective", `document.querySelector(".retro-result")
    && document.querySelector(".save-state")?.textContent.includes("T+3 复盘已生成")
    && document.querySelectorAll(".retro-metric-results article").length === 6`);
  await waitFor(window, "persisted production workspace", `(async () => {
    const workspace = await window.reviewflow.loadWorkspace();
    return Boolean(workspace?.retro && workspace?.publishJobs?.length === 1);
  })()`);

  const evidence = await window.webContents.executeJavaScript(`(async () => {
    const workspace = await window.reviewflow.loadWorkspace();
    const jobs = await window.reviewflow.sidecarRequest({ path: "/v1/publications" });
    const tasks = await window.reviewflow.sidecarRequest({ path: "/v1/metrics/tasks" });
    const publicationId = workspace.retro.publicationId;
    const snapshot = await window.reviewflow.sidecarRequest({ path: "/v1/metrics/latest/" + publicationId });
    return { workspace, jobs, tasks, snapshot, publicationId };
  })()`, true);
  assert.equal(evidence.workspace.content.kind, scenario.kind);
  assert.equal(evidence.workspace.metricSource, scenario.metricsCsvPath ? "csv" : "manual");
  assert.equal(evidence.workspace.publishJobs.length, 1);
  assert.equal(evidence.workspace.publicationContexts[0].kind, scenario.kind);
  assert.equal(evidence.jobs.length, 1);
  assert.equal(evidence.jobs[0].status, "published");
  assert.equal(evidence.jobs[0].details.results[0].condition, "success");
  assert.equal(evidence.tasks.length, 1);
  assert.equal(evidence.tasks[0].publicationId, evidence.publicationId);
  assert.equal(evidence.snapshot.source, scenario.metricsCsvPath ? "csv" : "manual");
  assert.equal(evidence.snapshot.metrics.views, 1200);
  const managedMedia = evidence.workspace.content.mediaPaths[0];
  assert.notEqual(managedMedia, scenario.mediaPath);
  assert.ok(managedMedia.toLocaleLowerCase().includes(join(phase, "user-data", "media").toLocaleLowerCase()));
  assert.equal(statSync(managedMedia).isFile(), true);
  assert.equal(statSync(join(userDataRoot, "data", "reviewflow.sqlite3")).isFile(), true);
  assert.equal(statSync(join(userDataRoot, "publisher-data", "reviewflow.sqlite3")).isFile(), true);
};

const runRecoveryFlow = async (window) => {
  await waitFor(window, "fixture Sidecar readiness after restart", `(async () => {
    const status = await window.reviewflow?.runtimeStatus();
    return status?.sidecar === "ready" && status?.livePublishingEnabled === true;
  })()`);
  await verifySidecarRequestSecurity();
  await waitFor(window, "completed workspace recovery", `(async () => {
    const workspace = await window.reviewflow.loadWorkspace();
    return workspace?.content?.kind === "video"
      && workspace?.publishJobs?.length === 1
      && Boolean(workspace?.retro?.publicationId);
  })()`);
  assert.equal(
    await window.webContents.executeJavaScript("Boolean(document.querySelector('.onboarding-dialog'))", true),
    false,
    "Completed onboarding must remain dismissed after restarting the production bridge",
  );
  const evidence = await window.webContents.executeJavaScript(`(async () => {
    const workspace = await window.reviewflow.loadWorkspace();
    const jobs = await window.reviewflow.sidecarRequest({ path: "/v1/publications" });
    const tasks = await window.reviewflow.sidecarRequest({ path: "/v1/metrics/tasks" });
    const snapshot = await window.reviewflow.sidecarRequest({
      path: "/v1/metrics/latest/" + workspace.retro.publicationId
    });
    return { workspace, jobs, tasks, snapshot };
  })()`, true);
  assert.equal(evidence.jobs.length, 1);
  assert.equal(evidence.jobs[0].status, "published");
  assert.equal(evidence.tasks.length, 1);
  assert.equal(evidence.tasks[0].publicationId, evidence.workspace.retro.publicationId);
  assert.equal(evidence.snapshot.metrics.views, 1200);
  assert.equal(evidence.snapshot.source, "csv");
  assert.equal(statSync(evidence.workspace.content.mediaPaths[0]).isFile(), true);
  assert.equal(statSync(join(userDataRoot, "data", "reviewflow.sqlite3")).isFile(), true);
  assert.equal(statSync(join(userDataRoot, "publisher-data", "reviewflow.sqlite3")).isFile(), true);

  await clickNavigationItem(window, "平台账号");
  await waitFor(window, "account management view", `document.querySelectorAll(".accounts-view article").length === 3`);
  const commands = await window.webContents.executeJavaScript(`(async () => {
    const platforms = ["xiaohongshu", "douyin", "bilibili"];
    const cards = [...document.querySelectorAll(".accounts-view article")];
    const result = {};
    for (let index = 0; index < platforms.length; index += 1) {
      result[platforms[index]] = await window.reviewflow.copyLoginCommand({
        platform: platforms[index],
        accountId: cards[index].querySelector("input").value,
      });
    }
    return result;
  })()`, true);
  assert.match(commands.xiaohongshu, /reviewflow-sau\.exe' xiaohongshu login --account '[^']+' --headed$/);
  assert.match(commands.douyin, /reviewflow-sau\.exe' douyin login --account '[^']+' --headed$/);
  assert.match(commands.bilibili, /reviewflow-sau\.exe' bilibili login --account '[^']+'$/);
  assert.doesNotMatch(commands.bilibili, /--headed/);

  for (let index = 0; index < 3; index += 1) {
    await clickAccountButton(window, index, "检查登录");
    await waitFor(window, `unauthenticated account ${index + 1}`, `document.querySelectorAll(".accounts-view article")[${index}]
      ?.querySelector("small")?.textContent === "未登录或 Cookie 已失效"`);
  }
};

const runScheduleFlow = async (window) => {
  await waitFor(window, "first-run onboarding", `Boolean(document.querySelector(".onboarding-dialog"))`);
  await clickButton(window, "跳过，稍后在设置中查看");
  await waitFor(window, "fixture Sidecar readiness", `(async () => {
    const status = await window.reviewflow?.runtimeStatus();
    return status?.sidecar === "ready" && status?.livePublishingEnabled === true;
  })()`);
  await verifySidecarRequestSecurity();

  await clickButton(window, scenario.label);
  await clickSelector(window, ".media-drop", "Media picker");
  await waitFor(window, "managed media selection", `document.body.textContent.includes("1 个素材已选择")`);
  await clickButton(window, "开始评分");
  await waitFor(window, "score evidence", `document.querySelector(".save-state")?.textContent.includes("评分完成")
    && document.querySelector(".score-meta")?.textContent.includes("公式 v1")`);
  await clickButton(window, "生成区间预测");
  await waitFor(window, "prediction interval", `document.querySelector(".prediction-meta")?.textContent.includes("prediction-v2")
    && document.querySelector(".prediction-range-grid")?.textContent.includes("P90")`);

  const xiaohongshuSchedule = toLocalDateTimeInput(new Date(Date.now() + 4 * 60 * 60 * 1_000));
  const bilibiliSchedule = toLocalDateTimeInput(new Date(Date.now() + 5 * 60 * 60 * 1_000));
  await clickButtonIn(window, ".variant-tabs", "小红书");
  await setLabeledControl(window, "平台原生定时（可选）", xiaohongshuSchedule);
  await clickButtonIn(window, ".variant-tabs", "B 站");
  await waitFor(window, "Bilibili variant editor", `document.body.textContent.includes("B 站分区 tid")`);
  await setLabeledControl(window, "平台原生定时（可选）", bilibiliSchedule);
  await setLabeledControl(window, "B 站分区 tid", 171);

  await clickButton(window, "进入发布预览");
  await waitFor(window, "three-platform publish dialog", `document.querySelector('[role="dialog"]')
    ?.textContent.includes("确认这一个发布清单")
    && document.querySelectorAll(".publish-dialog .manifest-list article").length === 3`);
  await window.webContents.executeJavaScript(`(() => {
    for (const checkbox of document.querySelectorAll('.publish-dialog input[type="checkbox"]')) checkbox.click();
  })()`, true);
  await clickButton(window, "确认并发布");
  await waitFor(window, "conservative scheduled publication state", `(async () => {
    const jobs = await window.reviewflow.sidecarRequest({ path: "/v1/publications" });
    return jobs.length === 1 && jobs[0].dryRun === false && jobs[0].status === "unknown";
  })()`);
  await waitFor(window, "persisted scheduled manifest", `(async () => {
    const workspace = await window.reviewflow.loadWorkspace();
    return workspace?.manifest?.variants?.length === 3;
  })()`);

  const evidence = await window.webContents.executeJavaScript(`(async () => ({
    workspace: await window.reviewflow.loadWorkspace(),
    jobs: await window.reviewflow.sidecarRequest({ path: "/v1/publications" })
  }))()`, true);
  assert.equal(evidence.jobs.length, 1);
  const commands = Object.fromEntries(
    evidence.jobs[0].details.commands.map((command) => [command[1], command]),
  );
  assert.deepEqual(Object.keys(commands).sort(), ["bilibili", "douyin", "xiaohongshu"]);
  assert.equal(
    commands.xiaohongshu[commands.xiaohongshu.indexOf("--schedule") + 1],
    xiaohongshuSchedule.replace("T", " "),
  );
  assert.equal(commands.xiaohongshu.includes("--headed"), true);
  assert.equal(commands.douyin.includes("--schedule"), false);
  assert.equal(commands.douyin.includes("--headed"), true);
  assert.equal(
    commands.bilibili[commands.bilibili.indexOf("--schedule") + 1],
    bilibiliSchedule.replace("T", " "),
  );
  assert.equal(commands.bilibili[commands.bilibili.indexOf("--tid") + 1], "171");
  assert.equal(commands.bilibili.includes("--headed"), false);

  const manifestVariants = Object.fromEntries(
    evidence.workspace.manifest.variants.map((variant) => [variant.platform, variant]),
  );
  assert.equal(manifestVariants.xiaohongshu.scheduledAt, new Date(xiaohongshuSchedule).toISOString());
  assert.equal("scheduledAt" in manifestVariants.douyin, false);
  assert.equal(manifestVariants.bilibili.scheduledAt, new Date(bilibiliSchedule).toISOString());
  assert.equal(manifestVariants.bilibili.bilibiliTid, 171);

  await clickButton(window, "恢复上次发布清单");
  await waitFor(window, "restored scheduled publish dialog", `Boolean(document.querySelector('[role="dialog"]'))`);
  await window.webContents.executeJavaScript(`(() => {
    for (const checkbox of document.querySelectorAll('.publish-dialog input[type="checkbox"]')) checkbox.click();
  })()`, true);
  await clickButton(window, "确认并发布");
  await waitFor(window, "one idempotent scheduled publication", `(async () => {
    const jobs = await window.reviewflow.sidecarRequest({ path: "/v1/publications" });
    return jobs.length === 1 && jobs[0].dryRun === false && jobs[0].status === "unknown";
  })()`);
};

const captureFailure = async (window) => {
  if (!window || window.isDestroyed()) return;
  mkdirSync(resultRoot, { recursive: true });
  try {
    const image = await window.webContents.capturePage();
    writeFileSync(join(resultRoot, `production-${phase}-failure.png`), image.toPNG());
  } catch {
    // The original assertion remains authoritative.
  }
};

let finished = false;
let startupTimer;

const finish = (window, exitCode) => {
  if (finished) return;
  finished = true;
  clearTimeout(startupTimer);
  void window;
  app.exit(exitCode);
};

app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", () => {
    void (async () => {
      try {
        if (phase === "recover") await runRecoveryFlow(window);
        else if (phase === "schedule") await runScheduleFlow(window);
        else await runContentFlow(window);
        process.stdout.write(`${JSON.stringify({ scenario: `production_${phase}`, status: "passed" })}\n`);
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
  process.stderr.write("Timed out waiting for the production ReviewFlow window\n");
  finish(undefined, 1);
}, 20_000);

void import(pathToFileURL(join(desktopRoot, "dist-electron", "main.js")).href).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  finish(undefined, 1);
});
