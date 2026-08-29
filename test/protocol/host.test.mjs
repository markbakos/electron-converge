import assert from "node:assert/strict";
import test from "node:test";

import { createCanonicalStore } from "../../dist/index.js";
import { createProtocolHost } from "../../dist/protocol/host.js";
import { canonicalStoreRuntime } from "../../dist/store/types.js";
import { counterDefinition } from "../fixtures.mjs";

const attachRequest = (sessionId) => ({
  protocol: 1,
  type: "ATTACH",
  storeId: "counter",
  sessionId,
});

const commandRequest = (sessionId, commandId, action, input) => ({
  protocol: 1,
  type: "COMMAND",
  storeId: "counter",
  sessionId,
  commandId,
  action,
  input,
});

test("host serializes commands into one canonical commit order", () => {
  const store = createCanonicalStore(counterDefinition());
  const host = createProtocolHost(store);
  const received = [];

  assert.deepEqual(host.attach(attachRequest("session-a"), (commit) => {
    received.push(commit);
  }), {
    protocol: 1,
    type: "ATTACHED",
    storeId: "counter",
    sessionId: "session-a",
    snapshot: {
      storeId: "counter",
      revision: 0,
      state: {
        counter: { value: 0 },
        settings: { theme: "dark" },
      },
    },
  });

  const first = host.command(
    commandRequest("session-a", "command-1", "increment", 2),
  );
  const second = host.command(
    commandRequest("session-a", "command-2", "increment", 3),
  );

  assert.equal(first.ok, true);
  assert.equal(first.result, 2);
  assert.equal(first.commit.baseRevision, 0);
  assert.equal(first.commit.revision, 1);
  assert.equal(second.ok, true);
  assert.equal(second.result, 5);
  assert.equal(second.commit.baseRevision, 1);
  assert.equal(second.commit.revision, 2);
  assert.deepEqual(received, [first.commit, second.commit]);
  assert.equal(store.getState().counter.value, 5);
});

test("host returns safe command failures without allocating revisions", () => {
  const store = createCanonicalStore(
    counterDefinition({
      fail() {
        throw new Error("private detail");
      },
    }),
  );
  const host = createProtocolHost(store);
  host.attach(attachRequest("session-a"), () => undefined);

  assert.deepEqual(
    host.command(commandRequest("session-a", "command-1", "fail", undefined)),
    {
      protocol: 1,
      type: "COMMAND_RESULT",
      storeId: "counter",
      sessionId: "session-a",
      commandId: "command-1",
      ok: false,
      error: { code: "ACTION_FAILED", message: "Action failed" },
    },
  );
  assert.equal(store.getRevision(), 0);
});

test("host catches up recent gaps and snapshots evicted gaps", () => {
  const store = createCanonicalStore(counterDefinition());
  const host = createProtocolHost(store);
  host.attach(attachRequest("session-a"), () => undefined);

  for (let index = 1; index <= 65; index += 1) {
    host.command(
      commandRequest("session-a", `command-${index}`, "increment", 1),
    );
  }

  const recent = host.recover({
    protocol: 1,
    type: "RECOVER",
    storeId: "counter",
    sessionId: "session-a",
    fromRevision: 63,
    forceSnapshot: false,
  });
  assert.equal(recent.type, "CATCH_UP");
  assert.equal(recent.fromRevision, 63);
  assert.equal(recent.throughRevision, 65);
  assert.deepEqual(
    recent.commits.map((commit) => commit.revision),
    [64, 65],
  );

  const evicted = host.recover({
    protocol: 1,
    type: "RECOVER",
    storeId: "counter",
    sessionId: "session-a",
    fromRevision: 0,
    forceSnapshot: false,
  });
  assert.equal(evicted.type, "SNAPSHOT");
  assert.equal(evicted.snapshot.revision, 65);
  assert.equal(evicted.snapshot.state.counter.value, 65);
});

test("host removes a destroyed session when publication fails", () => {
  const store = createCanonicalStore(counterDefinition());
  const host = createProtocolHost(store);
  let destroyedDeliveries = 0;
  const healthyRevisions = [];

  host.attach(attachRequest("destroyed"), () => {
    destroyedDeliveries += 1;
    throw new Error("Renderer destroyed");
  });
  host.attach(attachRequest("healthy"), (commit) => {
    healthyRevisions.push(commit.revision);
  });

  assert.equal(
    host.command(
      commandRequest("healthy", "command-1", "increment", 1),
    ).ok,
    true,
  );
  assert.equal(
    host.command(
      commandRequest("healthy", "command-2", "increment", 1),
    ).ok,
    true,
  );

  assert.equal(destroyedDeliveries, 1);
  assert.deepEqual(healthyRevisions, [1, 2]);
});

test("host rolls back a session when snapshot capture fails during attach", () => {
  let failAttachSnapshot = true;
  const store = {
    getSnapshot() {
      if (failAttachSnapshot) {
        failAttachSnapshot = false;
        return { storeId: "counter", revision: 0, state: { value: 0 } };
      }
      if (!this.allowSnapshot) throw new Error("snapshot failed");
      return { storeId: "counter", revision: 0, state: { value: 0 } };
    },
    dispatch() {
      throw new Error("unused");
    },
    allowSnapshot: false,
  };
  store[canonicalStoreRuntime] = () => ({
    getSnapshot: () => store.getSnapshot(),
    dispatch: () => store.dispatch(),
  });
  const host = createProtocolHost(store);

  assert.equal(
    host.attach(attachRequest("session-a"), () => undefined).type,
    "PROTOCOL_ERROR",
  );
  store.allowSnapshot = true;
  assert.equal(
    host.attach(attachRequest("session-a"), () => undefined).type,
    "ATTACHED",
  );
});
