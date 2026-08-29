import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

import { app, BrowserWindow, protocol } from "electron";

import { createCanonicalStore } from "electron-converge";
import { registerElectronMain } from "electron-converge/main";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "converge",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

const fixtureDirectory = process.env.CONVERGE_FIXTURE_DIR ??
  path.join("/tmp", "electron-converge-fixture");
const mode = process.env.CONVERGE_FIXTURE_MODE ?? "test";
const installedProtocols = new WeakSet();

const store = createCanonicalStore({
  id: "app",
  initialState: {
    counter: { value: 0 },
    payload: { value: "" },
    stable: { label: "stable" },
  },
  inputs: {
    increment: (value) => typeof value === "number" && Number.isSafeInteger(value),
    setPayload: (value) => typeof value === "string" && value.length <= 1_100_000,
    forbidden: (value) => value === null,
  },
  actions: {
    increment(state, by) {
      const value = state.counter.value + by;
      return { state: { ...state, counter: { value } }, result: value };
    },
    setPayload(state, value) {
      return { state: { ...state, payload: { value } }, result: value.length };
    },
    forbidden(state) {
      return { state, result: null };
    },
  },
});

let controller;
let nextWindowId = 1;
const windows = new Map();

function mimeType(file) {
  return file.endsWith(".js") ? "text/javascript" : "text/html";
}

async function installProtocol(target = protocol) {
  if (installedProtocols.has(target)) return;
  target.handle("converge", async (request) => {
    const url = new URL(request.url);
    const name = url.pathname === "/" ? "index.html" : path.basename(url.pathname);
    if (!new Set(["index.html", "renderer.js"]).has(name)) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(await readFile(path.join(fixtureDirectory, name)), {
      headers: { "content-type": mimeType(name) },
    });
  });
  installedProtocols.add(target);
}

function createWindow({ registered = true } = {}) {
  const id = nextWindowId++;
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      partition: `converge-fixture-${id}`,
      preload: path.join(fixtureDirectory, "preload.cjs"),
      sandbox: true,
    },
  });
  const fault = { drop: 0, hold: 0, dropped: 0, held: [], released: 0 };
  const originalSend = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel, ...values) => {
    if (channel === "electron-converge:v1:commit") {
      if (fault.drop > 0) {
        fault.drop -= 1;
        fault.dropped += 1;
        return;
      }
      if (fault.hold > 0) {
        fault.hold -= 1;
        fault.held.push([channel, values]);
        return;
      }
    }
    originalSend(channel, ...values);
  };
  const registration = registered
    ? controller.registerRenderer(window.webContents, { role: "main", id })
    : undefined;
  windows.set(id, { id, fault, registration, window, originalSend });
  window.on("closed", () => windows.delete(id));
  return windows.get(id);
}

async function load(entry) {
  await installProtocol(entry.window.webContents.session.protocol);
  await entry.window.loadURL(`converge://fixture-${entry.id}/index.html`);
  return entry;
}

function call(entry, method, ...args) {
  const expression = `globalThis.convergeFixture[${JSON.stringify(method)}](...${JSON.stringify(args)})`;
  return entry.window.webContents.executeJavaScript(expression, true);
}

async function waitUntil(check, message, timeout = 10_000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function connect(entry, options) {
  await call(entry, "connect", options ?? {});
  return call(entry, "render");
}

function setFault(entry, fault) {
  Object.assign(entry.fault, fault);
}

function releaseHeld(entry) {
  const held = entry.fault.held.splice(0);
  for (const [channel, values] of held.reverse()) {
    entry.fault.released += 1;
    entry.originalSend(channel, ...values);
  }
}

async function close(entry) {
  if (entry.window.isDestroyed()) return;
  try {
    await call(entry, "close");
  } catch {
    // A crashed renderer cannot run its local cleanup.
  }
  entry.window.close();
}

async function runCorrectness() {
  console.error("fixture: create initial windows");
  const first = await load(createWindow());
  const second = await load(createWindow());
  const firstRender = await connect(first);
  const secondRender = await connect(second);

  assert.deepEqual(firstRender.bridgeKeys, ["attach", "command", "onCommit", "recover"]);
  assert.equal(firstRender.hasNode, false);
  assert.deepEqual(firstRender.before, firstRender.after);
  assert.deepEqual(secondRender.before, secondRender.after);
  const localReads = await call(first, "localReads", 1_000);
  assert.deepEqual(localReads.before, localReads.after);

  const [firstOps, secondOps] = await Promise.all([
    call(first, "dispatchMany", 10, 1),
    call(second, "dispatchMany", 10, 1),
  ]);
  const results = [...firstOps, ...secondOps].map(({ result }) => result).sort((a, b) => a - b);
  assert.deepEqual(results, Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(store.getRevision(), 20);
  assert.equal(store.getState().counter.value, 20);
  assert.ok(firstOps.every(({ result, revision }) => revision >= result));
  assert.ok(secondOps.every(({ result, revision }) => revision >= result));

  console.error("fixture: attach race");
  const racing = await load(createWindow());
  const connecting = call(racing, "connect", { attachDelay: 75 });
  await waitUntil(
    () => controller.getDiagnostics().liveSessions === 3,
    "racing renderer did not attach",
  );
  await call(first, "dispatchMany", 1, 1);
  await connecting;
  await call(racing, "render");
  const raceReport = await call(racing, "report");
  assert.ok(raceReport.counters.commitsBeforeConnected >= 1);
  assert.equal(raceReport.snapshot.revision, store.getRevision());

  console.error("fixture: catch up");
  const beforeCatchUp = controller.getDiagnostics().catchUpRecoveries;
  setFault(second, { hold: 1 });
  await call(first, "dispatchMany", 2, 1);
  await waitUntil(
    async () => (await call(second, "report")).snapshot.revision === store.getRevision(),
    "out-of-order follower did not catch up",
  );
  releaseHeld(second);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(controller.getDiagnostics().catchUpRecoveries > beforeCatchUp);
  assert.equal(second.fault.released, 1);

  console.error("fixture: snapshot recovery");
  const beforeSnapshot = controller.getDiagnostics().snapshotRecoveries;
  setFault(second, { drop: 65 });
  await call(first, "dispatchMany", 65, 1);
  assert.equal(second.fault.dropped, 65);
  await call(first, "dispatchMany", 1, 1);
  await waitUntil(
    async () => (await call(second, "report")).snapshot.revision === store.getRevision(),
    "history-evicted follower did not replace from snapshot",
  );
  assert.ok(controller.getDiagnostics().snapshotRecoveries > beforeSnapshot);

  console.error("fixture: React and boundary");
  const renderBefore = await call(first, "report");
  const requestBefore = { ...renderBefore.counters };
  await call(first, "dispatchMany", 1, 1);
  await waitUntil(
    async () => (await call(first, "report")).wholeRenders > renderBefore.wholeRenders,
    "React did not observe the installed replica",
  );
  const renderAfter = await call(first, "report");
  assert.equal(renderAfter.stableRenders, renderBefore.stableRenders);
  assert.equal(renderAfter.counters.command, requestBefore.command + 1);
  assert.equal(renderAfter.counters.attach, requestBefore.attach);
  assert.equal(renderAfter.counters.recover, requestBefore.recover);
  assert.equal(renderAfter.counters.commitArguments, 1);

  const firstSession = renderAfter.sessionId;
  const secondSession = (await call(second, "report")).sessionId;
  const revisionBeforeBoundary = store.getRevision();
  const malformed = await call(first, "rawRequest", "command", {});
  assert.equal(malformed.error.code, "INVALID_PROTOCOL");
  const spoofed = await call(first, "rawRequest", "command", {
    protocol: 1,
    type: "COMMAND",
    storeId: "app",
    sessionId: secondSession,
    commandId: "spoofed:1",
    action: "increment",
    input: 1,
  });
  assert.equal(spoofed.error.code, "STALE_SESSION");
  const unauthorized = await call(first, "rawRequest", "command", {
    protocol: 1,
    type: "COMMAND",
    storeId: "app",
    sessionId: firstSession,
    commandId: "forbidden:1",
    action: "forbidden",
    input: null,
  });
  assert.equal(unauthorized.error.code, "UNAUTHORIZED");
  assert.equal(store.getRevision(), revisionBeforeBoundary);

  const unregistered = await load(createWindow({ registered: false }));
  assert.deepEqual(await call(unregistered, "tryConnect"), {
    ok: false,
    code: "UNAUTHORIZED",
  });
  await close(unregistered);

  console.error("fixture: reload and crash");
  const oldSecondSession = secondSession;
  const reloadedPage = new Promise((resolve) =>
    second.window.webContents.once("did-finish-load", resolve),
  );
  second.window.reload();
  await reloadedPage;
  await connect(second);
  const reloaded = await call(second, "report");
  assert.notEqual(reloaded.sessionId, oldSecondSession);
  assert.equal(reloaded.snapshot.revision, store.getRevision());
  const stale = await call(second, "rawRequest", "command", {
    protocol: 1,
    type: "COMMAND",
    storeId: "app",
    sessionId: oldSecondSession,
    commandId: "stale:1",
    action: "increment",
    input: 1,
  });
  assert.equal(stale.error.code, "STALE_SESSION");

  const sessionsBeforeCrash = controller.getDiagnostics().liveSessions;
  assert.notEqual(
    first.window.webContents.getOSProcessId(),
    racing.window.webContents.getOSProcessId(),
  );
  const crashed = new Promise((resolve) => racing.window.webContents.once("render-process-gone", resolve));
  process.kill(racing.window.webContents.getOSProcessId(), "SIGKILL");
  await crashed;
  console.error("fixture: crash landed");
  await waitUntil(
    () => controller.getDiagnostics().liveSessions === sessionsBeforeCrash - 1,
    "crashed renderer session remained live",
  );
  console.error("fixture: crash session removed");
  await call(first, "dispatchMany", 1, 1);
  console.error("fixture: publication survived crash");
  racing.window.destroy();

  await waitUntil(
    async () => (await call(second, "report")).snapshot.revision === store.getRevision(),
    "reloaded renderer did not converge",
  );
  const diagnostics = controller.getDiagnostics();
  const firstReport = await call(first, "report");
  const secondReport = await call(second, "report");
  assert.equal(firstReport.snapshot.state.counter.value, store.getState().counter.value);
  assert.equal(secondReport.snapshot.state.counter.value, store.getState().counter.value);
  assert.ok(firstReport.operations.length >= 1);
  assert.ok(firstReport.operations.every((operation) => operation.completeTs !== null));

  await close(second);
  await call(first, "dispatchMany", 1, 1);
  await close(first);

  return {
    canonicalRevision: store.getRevision(),
    canonicalValue: store.getState().counter.value,
    catchUpRecoveries: diagnostics.catchUpRecoveries,
    snapshotRecoveries: diagnostics.snapshotRecoveries,
    droppedCommits: second.fault.dropped,
    reorderedCommits: second.fault.released,
    historyOperations: firstReport.operations.length + secondReport.operations.length,
    reactRenders: firstReport.wholeRenders + secondReport.wholeRenders,
  };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function distribution(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

async function runBenchmark() {
  const samples = Number.parseInt(process.env.CONVERGE_BENCH_SAMPLES ?? "30", 10);
  const warmup = Number.parseInt(process.env.CONVERGE_BENCH_WARMUP ?? "5", 10);
  const rendererCounts = [1, 2, 5, 10];
  const payloadSizes = [1_024, 10_240, 102_400, 1_048_576];
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  const cpuBefore = process.cpuUsage();
  eventLoop.enable();
  const matrix = [];
  let peakProcesses = [];

  for (const rendererCount of rendererCounts) {
    const entries = [];
    for (let index = 0; index < rendererCount; index += 1) {
      const entry = await load(createWindow());
      await connect(entry);
      entries.push(entry);
    }
    for (const payloadSize of payloadSizes) {
      const acknowledgement = [];
      const propagation = [];
      const reactNotification = [];
      const clone = [];
      for (let index = -warmup; index < samples; index += 1) {
        const origin = entries[index < 0 ? 0 : index % entries.length];
        const expectedRevision = store.getRevision() + 1;
        const followers = entries
          .filter((entry) => entry !== origin)
          .map((entry) => call(entry, "waitForRevision", expectedRevision));
        const payload = `${index}:`.padEnd(payloadSize, "x");
        const cloneStarted = performance.now();
        structuredClone(payload);
        const cloneMs = performance.now() - cloneStarted;
        const propagationStarted = performance.now();
        const result = await call(origin, "setPayload", payloadSize, index);
        await Promise.all(followers);
        if (index >= 0) {
          acknowledgement.push(result.acknowledgementMs);
          propagation.push(performance.now() - propagationStarted);
          reactNotification.push(result.reactNotificationMs);
          clone.push(cloneMs);
        }
      }
      matrix.push({
        rendererCount,
        payloadSize,
        completedSamples: acknowledgement.length,
        acknowledgementMs: distribution(acknowledgement),
        propagationMs: distribution(propagation),
        reactNotificationMs: distribution(reactNotification),
        structuredCloneMs: distribution(clone),
      });
    }
    if (rendererCount === 10) peakProcesses = app.getAppMetrics();
    for (const entry of entries) await close(entry);
  }

  const recoverySamples = Math.min(samples, 10);
  const catchUp = [];
  const snapshot = [];
  const origin = await load(createWindow());
  const follower = await load(createWindow());
  await connect(origin);
  await connect(follower);
  for (let index = 0; index < recoverySamples; index += 1) {
    setFault(follower, { drop: 1 });
    await call(origin, "dispatchMany", 1, 1);
    const catchUpRevision = store.getRevision() + 1;
    const catchUpWait = call(follower, "waitForRevision", catchUpRevision);
    const catchUpStarted = performance.now();
    await call(origin, "dispatchMany", 1, 1);
    await catchUpWait;
    catchUp.push(performance.now() - catchUpStarted);

    setFault(follower, { drop: 65 });
    await call(origin, "dispatchMany", 65, 1);
    const snapshotRevision = store.getRevision() + 1;
    const snapshotWait = call(follower, "waitForRevision", snapshotRevision);
    const snapshotStarted = performance.now();
    await call(origin, "dispatchMany", 1, 1);
    await snapshotWait;
    snapshot.push(performance.now() - snapshotStarted);
  }
  await close(follower);
  await close(origin);

  eventLoop.disable();
  return {
    environment: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model ?? "unknown",
      buildMode: "production renderer bundle",
    },
    warmup,
    samples,
    matrix,
    recoverySamples,
    recoveryMs: {
      catchUp: distribution(catchUp),
      snapshot: distribution(snapshot),
    },
    mainEventLoopDelayMs: {
      p50: eventLoop.percentile(50) / 1e6,
      p95: eventLoop.percentile(95) / 1e6,
      p99: eventLoop.percentile(99) / 1e6,
    },
    cpuMicros: process.cpuUsage(cpuBefore),
    processes: peakProcesses.map((metric) => ({
      type: metric.type,
      cpuPercent: metric.cpu.percentCPUUsage,
      memoryBytes: metric.memory.workingSetSize * 1_024,
    })),
  };
}

async function main() {
  console.error("fixture: waiting for app ready");
  await app.whenReady();
  console.error("fixture: app ready");
  await installProtocol();
  controller = registerElectronMain({
    stores: [store],
    authorizeFrame({ frame, trusted }) {
      const url = new URL(frame.url);
      return url.protocol === "converge:" && url.host.startsWith("fixture-") && trusted.role === "main";
    },
    authorize(_context, request) {
      return request.type !== "COMMAND" || request.action !== "forbidden";
    },
  });
  const result = mode === "benchmark" ? await runBenchmark() : await runCorrectness();
  console.log(`CONVERGE_RESULT ${JSON.stringify({ mode, result })}`);
  controller.dispose();
  app.exit(0);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  controller?.dispose();
  app.exit(1);
});
