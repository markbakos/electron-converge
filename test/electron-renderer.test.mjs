import assert from "node:assert/strict";
import test from "node:test";

import { createRendererConnection } from "electron-converge/renderer";

import { createProtocolHarness } from "./protocol/harness.mjs";

async function connectStore(harness) {
  const connection = createRendererConnection(harness.createTransport());
  const connecting = connection.connectStore("counter");
  await harness.deliverNext("attach");
  return { connection, store: await connecting };
}

test("renderer actions resolve only after their canonical commit is installed", async () => {
  const harness = createProtocolHarness();
  const { store } = await connectStore(harness);
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  let settled = false;
  const action = store.dispatch("increment", 2).then((result) => {
    settled = true;
    return result;
  });

  assert.equal(harness.store.getRevision(), 1);
  assert.equal(store.getRevision(), 0);
  assert.equal(settled, false);

  await harness.deliverNext("command");
  assert.equal(await action, 2);
  assert.equal(store.getRevision(), 1);
  assert.equal(store.select((state) => state.counter.value), 2);
  assert.equal(notifications, 1);
});

test("renderer status exposes recovery while reads keep the last valid snapshot", async () => {
  const harness = createProtocolHarness();
  const writer = await connectStore(harness);
  const follower = await connectStore(harness);
  const statuses = [];
  follower.store.subscribeStatus(() => {
    statuses.push(follower.store.getStatus());
  });

  const first = writer.store.dispatch("increment", 1);
  harness.dropNext("commit");
  harness.dropNext("commit");
  await harness.deliverNext("command");
  await first;

  const second = writer.store.dispatch("increment", 1);
  await harness.deliverNext("commit");
  await harness.deliverNext("commit");

  assert.equal(follower.store.getStatus(), "recovering");
  assert.equal(follower.store.getRevision(), 0);
  assert.equal(follower.store.getState().counter.value, 0);

  await harness.deliverNext("recover");
  assert.equal(follower.store.getStatus(), "ready");
  assert.equal(follower.store.getRevision(), 2);
  assert.equal(follower.store.getState().counter.value, 2);
  assert.deepEqual(statuses, ["recovering", "ready"]);

  await harness.deliverAll();
  assert.equal(await second, 2);
});

test("failed recovery leaves a readable stale replica and blocks actions", async () => {
  const harness = createProtocolHarness();
  const writer = await connectStore(harness);
  const follower = await connectStore(harness);

  const first = writer.store.dispatch("increment", 1);
  harness.dropNext("commit");
  harness.dropNext("commit");
  await harness.deliverNext("command");
  await first;

  const second = writer.store.dispatch("increment", 1);
  await harness.deliverNext("commit");
  await harness.deliverNext("commit");
  harness.failNext("recover");
  await Promise.resolve();

  assert.equal(follower.store.getStatus(), "stale");
  assert.equal(follower.store.getRevision(), 0);
  assert.equal(follower.store.getState().counter.value, 0);
  await assert.rejects(
    follower.store.dispatch("increment", 1),
    (error) => error.code === "RECOVERY_FAILED",
  );

  await harness.deliverAll();
  assert.equal(await second, 2);
});

test("renderer actions wait for active recovery before reaching main", async () => {
  const harness = createProtocolHarness();
  const writer = await connectStore(harness);
  const follower = await connectStore(harness);

  const first = writer.store.dispatch("increment", 1);
  harness.dropNext("commit");
  harness.dropNext("commit");
  await harness.deliverNext("command");
  await first;

  const second = writer.store.dispatch("increment", 1);
  await harness.deliverNext("commit");
  await harness.deliverNext("commit");
  await harness.deliverNext("command");
  await second;
  assert.equal(follower.store.getStatus(), "recovering");

  const waiting = follower.store.dispatch("increment", 1);
  assert.equal(harness.pending("command"), 0);
  await harness.deliverNext("recover");
  assert.equal(harness.pending("command"), 1);
  await harness.deliverNext("command");

  assert.equal(await waiting, 3);
  assert.equal(follower.store.getRevision(), 3);
});

test("a lost command response reports an unknown outcome without retrying", async () => {
  const harness = createProtocolHarness();
  const { store } = await connectStore(harness);

  const action = store.dispatch("increment", 1);
  harness.failNext("command");

  await assert.rejects(
    action,
    (error) => error.code === "OUTCOME_UNKNOWN",
  );
  assert.equal(store.getStatus(), "stale");
  assert.equal(harness.store.getRevision(), 1);
});

test("a malformed command response reports an unknown outcome", async () => {
  const bridge = {
    onCommit: () => () => undefined,
    async attach(request) {
      return {
        protocol: 1,
        type: "ATTACHED",
        storeId: request.storeId,
        sessionId: request.sessionId,
        snapshot: {
          storeId: request.storeId,
          revision: 0,
          state: { counter: { value: 0 } },
        },
      };
    },
    async command() {
      return {};
    },
    async recover() {
      throw new Error("not reached");
    },
  };
  const store = await createRendererConnection(bridge).connectStore("counter");

  await assert.rejects(
    store.dispatch("increment", 1),
    (error) => error.code === "OUTCOME_UNKNOWN",
  );
  assert.equal(store.getStatus(), "stale");
  assert.equal(store.getRevision(), 0);
});

test("recovery that stops below an action commit leaves the replica stale", async () => {
  const bridge = {
    onCommit: () => () => undefined,
    async attach(request) {
      return {
        protocol: 1,
        type: "ATTACHED",
        storeId: request.storeId,
        sessionId: request.sessionId,
        snapshot: {
          storeId: request.storeId,
          revision: 0,
          state: { counter: { value: 0 } },
        },
      };
    },
    async command(request) {
      return {
        protocol: 1,
        type: "COMMAND_RESULT",
        storeId: request.storeId,
        sessionId: request.sessionId,
        commandId: request.commandId,
        ok: true,
        result: 2,
        commit: {
          protocol: 1,
          type: "COMMIT",
          storeId: request.storeId,
          commandId: request.commandId,
          sourceSessionId: request.sessionId,
          baseRevision: 1,
          revision: 2,
          changed: { counter: { value: 2 } },
        },
      };
    },
    async recover(request) {
      return {
        protocol: 1,
        type: "SNAPSHOT",
        storeId: request.storeId,
        sessionId: request.sessionId,
        snapshot: {
          storeId: request.storeId,
          revision: 1,
          state: { counter: { value: 1 } },
        },
      };
    },
  };
  const store = await createRendererConnection(bridge).connectStore("counter");

  await assert.rejects(
    store.dispatch("increment", 2),
    (error) => error.code === "RECOVERY_FAILED",
  );
  assert.equal(store.getStatus(), "stale");
  assert.equal(store.getRevision(), 1);
  assert.equal(store.getState().counter.value, 1);
});

test("one connection shares a fresh session and unique command IDs across stores", async () => {
  const attachRequests = [];
  const commandRequests = [];
  const bridge = {
    onCommit: () => () => undefined,
    async attach(request) {
      attachRequests.push(request);
      return {
        protocol: 1,
        type: "ATTACHED",
        storeId: request.storeId,
        sessionId: request.sessionId,
        snapshot: { storeId: request.storeId, revision: 0, state: {} },
      };
    },
    async command(request) {
      commandRequests.push(request);
      return {
        protocol: 1,
        type: "COMMAND_RESULT",
        storeId: request.storeId,
        sessionId: request.sessionId,
        commandId: request.commandId,
        ok: false,
        error: { code: "UNKNOWN_ACTION", message: "Unknown action" },
      };
    },
    async recover() {
      throw new Error("not reached");
    },
  };

  const firstConnection = createRendererConnection(bridge);
  const firstStore = await firstConnection.connectStore("first");
  const secondStore = await firstConnection.connectStore("second");
  await assert.rejects(firstStore.dispatch("missing", undefined));
  await assert.rejects(secondStore.dispatch("missing", undefined));

  const secondConnection = createRendererConnection(bridge);
  await secondConnection.connectStore("third");

  assert.equal(attachRequests[0].sessionId, attachRequests[1].sessionId);
  assert.notEqual(attachRequests[0].sessionId, attachRequests[2].sessionId);
  assert.equal(
    commandRequests[0].commandId,
    `${attachRequests[0].sessionId}:1`,
  );
  assert.equal(
    commandRequests[1].commandId,
    `${attachRequests[0].sessionId}:2`,
  );
});

test("connecting the same store is idempotent and close is observable", async () => {
  const harness = createProtocolHarness();
  const connection = createRendererConnection(harness.createTransport());
  const first = connection.connectStore("counter");
  const second = connection.connectStore("counter");
  assert.equal(harness.pending("attach"), 1);
  await harness.deliverNext("attach");

  const firstStore = await first;
  assert.equal(firstStore, await second);
  connection.close();
  assert.equal(firstStore.getStatus(), "closed");
  await assert.rejects(
    connection.connectStore("other"),
    (error) => error.code === "STALE_SESSION",
  );
});

test("renderer buffers commits delivered before attachment completes", async () => {
  const harness = createProtocolHarness();
  const writer = await connectStore(harness);
  const connection = createRendererConnection(harness.createTransport());
  const connecting = connection.connectStore("counter");
  const action = writer.store.dispatch("increment", 1);

  harness.deferNext("commit");
  await harness.deliverNext("commit");
  await harness.deliverNext("attach");
  const joining = await connecting;

  assert.equal(joining.getRevision(), 1);
  assert.equal(joining.getState().counter.value, 1);

  await harness.deliverAll();
  assert.equal(await action, 1);
});

test("renderer suppresses a duplicate response and broadcast commit", async () => {
  const harness = createProtocolHarness();
  const { store } = await connectStore(harness);
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const action = store.dispatch("increment", 1);
  harness.duplicateNext("commit");
  await harness.deliverNext("commit");
  await harness.deliverNext("commit");
  await harness.deliverNext("command");

  assert.equal(await action, 1);
  assert.equal(store.getRevision(), 1);
  assert.equal(notifications, 1);
});

test("renderer replaces an evicted gap with an authoritative snapshot", async () => {
  const harness = createProtocolHarness();
  const writer = await connectStore(harness);
  const follower = await connectStore(harness);

  for (let revision = 1; revision <= 65; revision += 1) {
    const action = writer.store.dispatch("increment", 1);
    harness.dropNext("commit");
    harness.dropNext("commit");
    await harness.deliverNext("command");
    await action;
  }

  const action = writer.store.dispatch("increment", 1);
  harness.dropNext("commit");
  await harness.deliverNext("commit");
  await harness.deliverNext("recover");

  assert.equal(follower.store.getStatus(), "ready");
  assert.equal(follower.store.getRevision(), 66);
  assert.equal(follower.store.getState().counter.value, 66);

  await harness.deliverNext("command");
  assert.equal(await action, 66);
});

test("renderer attachment overflow forces snapshot recovery", async () => {
  const harness = createProtocolHarness();
  const writer = await connectStore(harness);
  const connection = createRendererConnection(harness.createTransport());
  const connecting = connection.connectStore("counter");
  const actions = [];

  for (let revision = 1; revision <= 65; revision += 1) {
    actions.push(writer.store.dispatch("increment", 1));
    harness.dropNext("commit");
    await harness.deliverNext("commit");
  }

  await harness.deliverNext("attach");
  assert.equal(harness.pending("recover"), 1);
  await harness.deliverNext("recover");
  const joining = await connecting;

  assert.equal(joining.getRevision(), 65);
  assert.equal(joining.getState().counter.value, 65);

  await harness.deliverAll();
  await Promise.all(actions);
});

test("invalid renderer commit and recovery data never replace the last valid snapshot", async () => {
  let emitCommit;
  let resolveRecovery;
  const recoveryResult = new Promise((resolve) => {
    resolveRecovery = resolve;
  });
  const bridge = {
    onCommit(listener) {
      emitCommit = listener;
      return () => undefined;
    },
    async attach(request) {
      return {
        protocol: 1,
        type: "ATTACHED",
        storeId: request.storeId,
        sessionId: request.sessionId,
        snapshot: {
          storeId: request.storeId,
          revision: 0,
          state: { counter: { value: 0 } },
        },
      };
    },
    async command() {
      throw new Error("not reached");
    },
    recover: () => recoveryResult,
  };
  const store = await createRendererConnection(bridge).connectStore("counter");

  emitCommit({ storeId: "counter" });
  assert.equal(store.getStatus(), "recovering");
  assert.equal(store.getRevision(), 0);
  assert.equal(store.getState().counter.value, 0);

  const blockedAction = store.dispatch("increment", 1);
  resolveRecovery({});
  await assert.rejects(
    blockedAction,
    (error) => error.code === "RECOVERY_FAILED",
  );
  assert.equal(store.getStatus(), "stale");
  assert.equal(store.getRevision(), 0);
  assert.equal(store.getState().counter.value, 0);
});

test("renderer routes stores independently and removes its bridge listener on close", async () => {
  let commitListener;
  let unsubscribeCalls = 0;
  const bridge = {
    onCommit(listener) {
      commitListener = listener;
      return () => {
        commitListener = undefined;
        unsubscribeCalls += 1;
      };
    },
    async attach(request) {
      return {
        protocol: 1,
        type: "ATTACHED",
        storeId: request.storeId,
        sessionId: request.sessionId,
        snapshot: {
          storeId: request.storeId,
          revision: 0,
          state: { value: 0 },
        },
      };
    },
    async command() {
      throw new Error("not reached");
    },
    async recover() {
      throw new Error("not reached");
    },
  };
  const connection = createRendererConnection(bridge);
  const first = await connection.connectStore("first");
  const second = await connection.connectStore("second");
  let firstNotifications = 0;
  let secondNotifications = 0;
  first.subscribe(() => {
    firstNotifications += 1;
  });
  second.subscribe(() => {
    secondNotifications += 1;
  });

  assert.equal(first.select((state) => state.value), 0);

  commitListener({
    protocol: 1,
    type: "COMMIT",
    storeId: "first",
    commandId: "external:1",
    sourceSessionId: "external",
    baseRevision: 0,
    revision: 1,
    changed: { value: 1 },
  });

  assert.equal(first.getRevision(), 1);
  assert.equal(first.getState().value, 1);
  assert.equal(firstNotifications, 1);
  assert.equal(second.getRevision(), 0);
  assert.equal(second.getState().value, 0);
  assert.equal(secondNotifications, 0);

  connection.close();
  assert.equal(unsubscribeCalls, 1);
  assert.equal(first.getStatus(), "closed");
  assert.equal(second.getStatus(), "closed");
});
