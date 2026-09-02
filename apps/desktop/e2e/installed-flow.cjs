const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, statSync, writeFileSync } = require("node:fs");
const net = require("node:net");
const { basename, isAbsolute, join, relative, resolve, sep } = require("node:path");

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
};

const executable = resolve(argumentValue("reviewflow-executable"));
const userDataRoot = resolve(argumentValue("reviewflow-user-data"));
const temporaryRoot = resolve(argumentValue("reviewflow-e2e-root"));
const mediaPath = resolve(argumentValue("reviewflow-media"));
const resultRoot = resolve(argumentValue("reviewflow-result-root"));

const isWithin = (candidate, parent) => {
  const path = relative(parent, candidate);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

assert.equal(existsSync(executable), true, "The installed ReviewFlow executable must exist");
assert.equal(existsSync(mediaPath), true, "The managed-media fixture must exist");
assert.equal(statSync(mediaPath).isFile(), true, "The managed-media fixture must be a file");
assert.equal(isWithin(executable, temporaryRoot), true, "The installed executable must stay inside the E2E root");
assert.equal(isWithin(userDataRoot, temporaryRoot), true, "User data must stay inside the E2E root");
assert.equal(isWithin(mediaPath, join(userDataRoot, "media")), true, "Fixture media must be pre-positioned in the managed library");

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const freePort = () => new Promise((resolvePort, rejectPort) => {
  const server = net.createServer();
  server.once("error", rejectPort);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    assert.equal(typeof address, "object");
    const port = address.port;
    server.close((error) => (error ? rejectPort(error) : resolvePort(port)));
  });
});

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data));
      if (!payload.id) return;
      const pending = this.pending.get(payload.id);
      if (!pending) return;
      this.pending.delete(payload.id);
      clearTimeout(pending.timer);
      if (payload.error) pending.reject(new Error(`${pending.method}: ${payload.error.message}`));
      else pending.resolve(payload.result);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP connection closed while waiting for ${pending.method}`));
      }
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise((resolveConnection, rejectConnection) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        rejectConnection(new Error("Timed out connecting to the installed Electron renderer"));
      }, 10_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolveConnection(new CdpClient(socket));
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        rejectConnection(new Error("Unable to connect to the installed Electron renderer"));
      }, { once: true });
    });
  }

  call(method, params = {}, timeout = 15_000) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`Timed out waiting for CDP method ${method}`));
      }, timeout);
      this.pending.set(id, { method, resolve: resolveCall, reject: rejectCall, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

const evaluate = async (client, expression) => {
  const response = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    const message = response.exceptionDetails.exception?.description
      ?? response.exceptionDetails.text
      ?? "Renderer evaluation failed";
    throw new Error(message);
  }
  return response.result.value;
};

const waitFor = async (client, description, expression, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, expression)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(75);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
};

const clickButton = async (client, label) => {
  const result = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return "missing";
    if (button.disabled) return "disabled";
    button.click();
    return "clicked";
  })()`);
  assert.equal(result, "clicked", `Button ${label} should be enabled`);
};

const setLabeledControl = async (client, labelText, value) => {
  const result = await evaluate(client, `(() => {
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
  })()`);
  assert.equal(result, true, `Labeled control ${labelText} should exist`);
};

const terminateProcessTree = (child) => {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGKILL");
  }
};

const waitForProcessExit = (child, timeout = 12_000) => new Promise((resolveExit, rejectExit) => {
  if (child.exitCode !== null) {
    resolveExit();
    return;
  }
  const timer = setTimeout(() => rejectExit(new Error("Installed Electron process did not exit")), timeout);
  child.once("exit", () => {
    clearTimeout(timer);
    resolveExit();
  });
});

const startInstalledSession = async () => {
  const port = await freePort();
  const output = [];
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataRoot}`,
  ], {
    env: {
      ...process.env,
      REVIEWFLOW_E2E_ROOT: temporaryRoot,
      REVIEWFLOW_LIVE_PUBLISH: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => output.push(String(chunk)));
  child.stderr?.on("data", (chunk) => output.push(String(chunk)));
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Installed ReviewFlow exited before CDP was ready: ${output.join("").slice(-2_000)}`);
    }
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) {
        const client = await CdpClient.connect(page.webSocketDebuggerUrl);
        await client.call("Runtime.enable");
        return { child, client, output };
      }
    } catch {
      // Electron has not opened the local DevTools endpoint yet.
    }
    await delay(100);
  }
  terminateProcessTree(child);
  throw new Error(`Timed out waiting for installed Electron CDP: ${output.join("").slice(-2_000)}`);
};

const closeInstalledSession = async (session) => {
  try {
    await session.client.call("Browser.close", {}, 5_000);
  } catch {
    terminateProcessTree(session.child);
  }
  try {
    await waitForProcessExit(session.child);
  } catch (error) {
    terminateProcessTree(session.child);
    throw error;
  } finally {
    session.client.close();
  }
};

const captureFailure = async (client) => {
  if (!client) return;
  try {
    mkdirSync(resultRoot, { recursive: true });
    const result = await client.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(resultRoot, "installed-flow-failure.png"), Buffer.from(result.data, "base64"));
  } catch {
    // The original assertion remains authoritative.
  }
};

const seedWorkspace = async (client) => {
  const timestamp = new Date().toISOString();
  const workspace = {
    onboardingComplete: true,
    selectedPlatforms: ["xiaohongshu"],
    accountIds: {
      xiaohongshu: "installed-xhs",
      douyin: "installed-dy",
      bilibili: "installed-bili",
    },
    content: {
      id: "installed-content-video",
      title: "安装包完整工作流零网络验收",
      body: "这条内容仅验证安装包中的评分、预测、确认、发布状态机、指标回收与复盘，不会请求任何内容平台。",
      kind: "video",
      topic: "ReviewFlow 安装验收",
      audiencePain: "源码测试通过后仍需要确认安装产物中的真实桥接链路",
      emotionalHook: "只有可追溯的安装包证据才能发现打包边界问题",
      mediaPaths: [mediaPath],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
  await evaluate(client, `window.reviewflow.saveWorkspace(${JSON.stringify(workspace)})`);
  await client.call("Page.reload", { ignoreCache: true });
  await waitFor(client, "seeded installed workspace", `document.body.textContent.includes("1 个素材已选择")
    && [...document.querySelectorAll("input, textarea")]
      .some((control) => control.value === "安装包完整工作流零网络验收")`);
};

const runInstalledWorkflow = async (client) => {
  await waitFor(client, "installed fixture Sidecar readiness", `(async () => {
    const status = await window.reviewflow?.runtimeStatus();
    return status?.sidecar === "ready" && status?.livePublishingEnabled === true;
  })()`);
  assert.equal(await evaluate(client, "Boolean(document.querySelector('.onboarding-dialog'))"), false);
  await clickButton(client, "开始评分");
  await waitFor(client, "installed score evidence", `document.querySelector(".save-state")?.textContent.includes("评分完成")
    && document.querySelector(".score-meta")?.textContent.includes("公式 v1")
    && document.querySelector(".score-evidence-list")?.textContent.includes("评分依据")`);
  await clickButton(client, "生成区间预测");
  await waitFor(client, "installed prediction interval", `document.querySelector(".prediction-meta")?.textContent.includes("prediction-v2")
    && document.querySelector(".prediction-range-grid")?.textContent.includes("P10")
    && document.querySelector(".prediction-range-grid")?.textContent.includes("P90")`);
  await clickButton(client, "进入发布预览");
  await waitFor(client, "installed immutable publish dialog", `document.querySelector('[role="dialog"]')
    ?.textContent.includes("确认这一个发布清单")`);
  await evaluate(client, `(() => {
    for (const checkbox of document.querySelectorAll('.publish-dialog input[type="checkbox"]')) checkbox.click();
  })()`);
  await clickButton(client, "确认并发布");
  await waitFor(client, "installed conservative publication state", `(async () => {
    const jobs = await window.reviewflow.sidecarRequest({ path: "/v1/publications" });
    return jobs.length === 1 && jobs[0].dryRun === false && jobs[0].status === "unknown";
  })()`);

  await clickButton(client, "恢复上次发布清单");
  await waitFor(client, "installed restored publish dialog", `Boolean(document.querySelector('[role="dialog"]'))`);
  await evaluate(client, `(() => {
    for (const checkbox of document.querySelectorAll('.publish-dialog input[type="checkbox"]')) checkbox.click();
  })()`);
  await clickButton(client, "确认并发布");
  await waitFor(client, "installed idempotent publication", `(async () => {
    const jobs = await window.reviewflow.sidecarRequest({ path: "/v1/publications" });
    return jobs.length === 1 && jobs[0].status === "unknown";
  })()`);

  const publicationEvidence = await evaluate(client, `(async () => ({
    workspace: await window.reviewflow.loadWorkspace(),
    jobs: await window.reviewflow.sidecarRequest({ path: "/v1/publications" })
  }))()`);
  assert.equal(publicationEvidence.jobs.length, 1);
  assert.equal(publicationEvidence.jobs[0].details.commands.length, 1);
  assert.equal(publicationEvidence.jobs[0].details.commands[0][1], "xiaohongshu");
  assert.match(publicationEvidence.jobs[0].details.results[0].stdout, /fixture-only; non-loopback network is blocked/);
  assert.equal(publicationEvidence.workspace.content.mediaPaths[0], mediaPath);

  await clickButton(client, "复盘队列");
  await waitFor(client, "installed retrospective queue", `document.body.textContent.includes("复盘不是总结，是校准")`);
  const publishedAt = new Date(Date.now() - 80 * 60 * 60 * 1_000).toISOString().slice(0, 16);
  await setLabeledControl(client, "真实发布时间", publishedAt);
  await setLabeledControl(client, "内容链接 / BV 号", "https://example.test/installed-package");
  await clickButton(client, "确认已发布并加入 T+3");
  await waitFor(client, "installed publication confirmation", `document.querySelector(".save-state")
    ?.textContent.includes("已确认小红书发布")`);
  const expectedMetrics = { views: 1200, likes: 120, saves: 42, comments: 18, shares: 9, followersGained: 7 };
  for (const [metric, value] of Object.entries(expectedMetrics)) {
    await setLabeledControl(client, metric, value);
  }
  await clickButton(client, "保存指标并生成复盘");
  await waitFor(client, "installed T+3 retrospective", `document.querySelector(".retro-result")
    && document.querySelector(".save-state")?.textContent.includes("T+3 复盘已生成")
    && document.querySelectorAll(".retro-metric-results article").length === 6`);
  await waitFor(client, "installed persisted completed flow", `(async () => {
    const workspace = await window.reviewflow.loadWorkspace();
    return Boolean(workspace?.retro && workspace?.publishJobs?.length === 1);
  })()`);

  const completed = await evaluate(client, `(async () => {
    const workspace = await window.reviewflow.loadWorkspace();
    const jobs = await window.reviewflow.sidecarRequest({ path: "/v1/publications" });
    const tasks = await window.reviewflow.sidecarRequest({ path: "/v1/metrics/tasks" });
    const snapshot = await window.reviewflow.sidecarRequest({
      path: "/v1/metrics/latest/" + workspace.retro.publicationId
    });
    return { workspace, jobs, tasks, snapshot };
  })()`);
  assert.equal(completed.workspace.metricSource, "manual");
  assert.equal(completed.jobs.length, 1);
  assert.equal(completed.jobs[0].status, "published");
  assert.equal(completed.tasks.length, 1);
  assert.equal(completed.tasks[0].publicationId, completed.workspace.retro.publicationId);
  assert.equal(completed.snapshot.metrics.views, 1200);
  assert.equal(completed.snapshot.source, "manual");
  assert.equal(statSync(join(userDataRoot, "data", "reviewflow.sqlite3")).isFile(), true);
  assert.equal(statSync(join(userDataRoot, "publisher-data", "reviewflow.sqlite3")).isFile(), true);
  return completed.workspace.retro.publicationId;
};

const verifyInstalledRecovery = async (client, publicationId) => {
  await waitFor(client, "installed fixture Sidecar readiness after restart", `(async () => {
    const status = await window.reviewflow?.runtimeStatus();
    return status?.sidecar === "ready" && status?.livePublishingEnabled === true;
  })()`);
  await waitFor(client, "installed complete-flow recovery", `(async () => {
    const workspace = await window.reviewflow.loadWorkspace();
    return workspace?.content?.id === "installed-content-video"
      && workspace?.publishJobs?.length === 1
      && workspace?.retro?.publicationId === ${JSON.stringify(publicationId)};
  })()`);
  assert.equal(await evaluate(client, "Boolean(document.querySelector('.onboarding-dialog'))"), false);
  const recovered = await evaluate(client, `(async () => {
    const workspace = await window.reviewflow.loadWorkspace();
    const jobs = await window.reviewflow.sidecarRequest({ path: "/v1/publications" });
    const tasks = await window.reviewflow.sidecarRequest({ path: "/v1/metrics/tasks" });
    const snapshot = await window.reviewflow.sidecarRequest({
      path: "/v1/metrics/latest/" + workspace.retro.publicationId
    });
    return { workspace, jobs, tasks, snapshot };
  })()`);
  assert.equal(recovered.jobs.length, 1);
  assert.equal(recovered.jobs[0].status, "published");
  assert.match(recovered.jobs[0].details.results[0].stdout, /fixture-only; non-loopback network is blocked/);
  assert.equal(recovered.tasks.length, 1);
  assert.equal(recovered.snapshot.metrics.views, 1200);
  assert.equal(recovered.workspace.content.mediaPaths[0], mediaPath);
};

const main = async () => {
  let first;
  let second;
  try {
    first = await startInstalledSession();
    await seedWorkspace(first.client);
    const publicationId = await runInstalledWorkflow(first.client);
    await closeInstalledSession(first);
    first = undefined;

    second = await startInstalledSession();
    await verifyInstalledRecovery(second.client, publicationId);
    await closeInstalledSession(second);
    second = undefined;
    process.stdout.write(`${JSON.stringify({
      scenario: "installed_fixture_workflow",
      status: "passed",
      executable: basename(executable),
      userData: basename(userDataRoot),
    })}\n`);
  } catch (error) {
    await captureFailure(first?.client ?? second?.client);
    const message = error instanceof Error ? error.stack : String(error);
    let renderer = null;
    try {
      const client = first?.client ?? second?.client;
      if (client) {
        renderer = await evaluate(client, `(async () => ({
          saveState: document.querySelector(".save-state")?.textContent ?? "",
          currentStatus: document.querySelector(".status-block")?.textContent ?? "",
          runtime: await window.reviewflow?.runtimeStatus(),
          body: document.body.textContent?.slice(0, 4_000) ?? ""
        }))()`);
      }
    } catch {
      // Preserve the original failure when the renderer is no longer available.
    }
    mkdirSync(resultRoot, { recursive: true });
    writeFileSync(
      join(resultRoot, "installed-flow-failure.json"),
      `${JSON.stringify({ message, renderer }, null, 2)}\n`,
      "utf8",
    );
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    if (first) terminateProcessTree(first.child);
    if (second) terminateProcessTree(second.child);
  }
};

void main();
