import React from "react";
import { createRoot } from "react-dom/client";

import { useStore } from "electron-converge/react";
import { createRendererConnection } from "electron-converge/renderer";

const rawBridge = window.electronConverge;
const counters = {
  attach: 0,
  command: 0,
  recover: 0,
  commitCallbacks: 0,
  commitArguments: 0,
  commitsBeforeConnected: 0,
};
const operations = [];
let attachDelay = 0;
let connection;
let store;
let root;
let sessionId;
let wholeRenders = 0;
let stableRenders = 0;
let renderedRevision = -1;
const renderWaiters = new Set();

const bridge = Object.freeze({
  async attach(request) {
    counters.attach += 1;
    sessionId = request.sessionId;
    const response = await rawBridge.attach(request);
    if (attachDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, attachDelay));
    }
    return response;
  },
  command(request) {
    counters.command += 1;
    return rawBridge.command(request);
  },
  recover(request) {
    counters.recover += 1;
    return rawBridge.recover(request);
  },
  onCommit(listener) {
    return rawBridge.onCommit((...args) => {
      counters.commitCallbacks += 1;
      counters.commitArguments = Math.max(counters.commitArguments, args.length);
      if (!store) counters.commitsBeforeConnected += 1;
      listener(args[0]);
    });
  },
});

function WholeState() {
  const state = useStore(store);
  wholeRenders += 1;
  React.useLayoutEffect(() => {
    renderedRevision = store.getRevision();
    for (const waiter of [...renderWaiters]) {
      if (renderedRevision < waiter.revision) continue;
      renderWaiters.delete(waiter);
      waiter.resolve();
    }
  }, [state]);
  return React.createElement(
    "span",
    { id: "whole", "data-revision": store.getRevision() },
    `${state.counter.value}:${state.payload.value.length}`,
  );
}

function StableSelection() {
  const selected = useStore(
    store,
    (state) => ({ label: state.stable.label }),
    (left, right) => left.label === right.label,
  );
  stableRenders += 1;
  return React.createElement("span", { id: "stable" }, selected.label);
}

function App() {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(WholeState),
    React.createElement(StableSelection),
  );
}

function snapshot() {
  return store
    ? {
        state: store.getState(),
        revision: store.getRevision(),
        status: store.getStatus(),
      }
    : undefined;
}

function waitForRenderedRevision(revision) {
  if (renderedRevision >= revision) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waiter = { revision, resolve };
    renderWaiters.add(waiter);
    setTimeout(() => {
      if (!renderWaiters.delete(waiter)) return;
      reject(new Error(`React revision ${revision} timed out`));
    }, 10_000);
  });
}

window.convergeFixture = Object.freeze({
  async connect(options = {}) {
    attachDelay = options.attachDelay ?? 0;
    connection = createRendererConnection(bridge);
    store = await connection.connectStore("app");
    return snapshot();
  },
  async tryConnect() {
    try {
      await this.connect();
      return { ok: true };
    } catch (error) {
      return { ok: false, code: error?.code ?? "UNKNOWN" };
    }
  },
  async render() {
    const before = { ...counters };
    const rendered = waitForRenderedRevision(store.getRevision());
    root = createRoot(document.getElementById("root"));
    root.render(React.createElement(App));
    await rendered;
    return { before, after: { ...counters }, ...this.report() };
  },
  report() {
    return {
      bridgeKeys: Object.keys(rawBridge).sort(),
      counters: { ...counters },
      hasNode: typeof globalThis.process !== "undefined" || typeof globalThis.require !== "undefined",
      operations: [...operations],
      sessionId,
      snapshot: snapshot(),
      stableRenders,
      wholeRenders,
    };
  },
  localReads(count) {
    const before = { ...counters };
    for (let index = 0; index < count; index += 1) store.getState();
    return { before, after: { ...counters } };
  },
  async dispatchMany(count, by = 1) {
    const completed = [];
    for (let index = 0; index < count; index += 1) {
      const op = {
        opId: `${sessionId}:${operations.length + 1}`,
        processId: sessionId,
        invokeTs: performance.now(),
        completeTs: null,
        opType: "increment",
        key: "counter",
        input: by,
        output: null,
        error: null,
        timeoutMarker: false,
        nodeSeen: "main",
        faultEpoch: null,
      };
      operations.push(op);
      try {
        op.output = await store.dispatch("increment", by);
        op.completeTs = performance.now();
        completed.push({ result: op.output, revision: store.getRevision() });
      } catch (error) {
        op.completeTs = performance.now();
        op.error = error?.code ?? "UNKNOWN";
        throw error;
      }
    }
    return completed;
  },
  async setPayload(size, marker = 0) {
    const payload = `${marker}:`.padEnd(size, "x");
    const rendered = waitForRenderedRevision(store.getRevision() + 1);
    const started = performance.now();
    await store.dispatch("setPayload", payload);
    const acknowledged = performance.now();
    await rendered;
    return {
      acknowledgementMs: acknowledged - started,
      reactNotificationMs: performance.now() - started,
      revision: store.getRevision(),
    };
  },
  async rawRequest(operation, request) {
    return rawBridge[operation](request);
  },
  waitForRevision(revision) {
    if (store.getRevision() >= revision) return Promise.resolve(snapshot());
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`revision ${revision} timed out`));
      }, 10_000);
      const unsubscribe = store.subscribe(() => {
        if (store.getRevision() < revision) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(snapshot());
      });
    });
  },
  close() {
    root?.unmount();
    connection?.close();
  },
});
