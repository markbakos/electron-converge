import assert from "node:assert/strict";
import test from "node:test";

import {
  ConvergeError,
  createCanonicalStore,
  createReplica,
} from "../dist/index.js";
import { counterDefinition } from "./fixtures.mjs";

test("replica ingests an adjacent commit and preserves unchanged branches", () => {
  const canonical = createCanonicalStore(counterDefinition());
  const replica = createReplica(canonical.getSnapshot());
  const before = replica.getState();
  let notifications = 0;
  const unsubscribe = replica.subscribe(() => {
    notifications += 1;
  });

  const { commit } = canonical.dispatch("increment", 3);
  assert.deepEqual(replica.ingest(commit), { status: "applied", revision: 1 });

  assert.equal(replica.getState().counter.value, 3);
  assert.strictEqual(replica.getState().settings, before.settings);
  assert.notStrictEqual(replica.getState(), before);
  assert.equal(replica.select((state) => state.counter.value), 3);
  assert.equal(notifications, 1);

  unsubscribe();
  replica.ingest(canonical.dispatch("increment", 1).commit);
  assert.equal(notifications, 1);
});

test("replica ignores duplicates and reports revision gaps", () => {
  const canonical = createCanonicalStore(counterDefinition());
  const replica = createReplica(canonical.getSnapshot());
  const { commit } = canonical.dispatch("increment", 1);
  replica.ingest(commit);
  const stateAtOne = replica.getState();

  assert.deepEqual(replica.ingest(commit), {
    status: "duplicate",
    revision: 1,
  });
  assert.deepEqual(
    replica.ingest({
      ...commit,
      baseRevision: 2,
      revision: 3,
      changed: { counter: { value: 3 } },
    }),
    { status: "gap", expectedRevision: 2, receivedRevision: 3 },
  );
  assert.strictEqual(replica.getState(), stateAtOne);
  assert.equal(replica.getRevision(), 1);
});

test("replica rejects malformed and unknown-slice commits", () => {
  const replica = createReplica({
    storeId: "counter",
    revision: 1,
    state: { counter: { value: 1 }, settings: { theme: "dark" } },
  });
  const before = replica.getState();
  let notifications = 0;
  replica.subscribe(() => {
    notifications += 1;
  });

  assert.throws(
    () =>
      replica.ingest({
        protocol: 1,
        type: "COMMIT",
        storeId: "counter",
        baseRevision: 1,
        revision: 3,
        changed: {},
      }),
    (error) => error instanceof ConvergeError && error.code === "INVALID_COMMIT",
  );
  assert.strictEqual(replica.getState(), before);
  assert.equal(replica.getRevision(), 1);
  assert.equal(notifications, 0);
  assert.throws(
    () =>
      replica.ingest({
        protocol: 1,
        type: "COMMIT",
        storeId: "counter",
        baseRevision: 1,
        revision: 2,
        changed: { unknown: true },
      }),
    (error) => error instanceof ConvergeError && error.code === "INVALID_COMMIT",
  );
  assert.strictEqual(replica.getState(), before);
  assert.equal(replica.getRevision(), 1);
  assert.equal(notifications, 0);

  let getterRan = false;
  const accessorCommit = {
    protocol: 1,
    type: "COMMIT",
    storeId: "counter",
    baseRevision: 1,
    revision: 2,
  };
  Object.defineProperty(accessorCommit, "changed", {
    enumerable: true,
    get() {
      getterRan = true;
      return {};
    },
  });
  assert.throws(
    () => replica.ingest(accessorCommit),
    (error) => error instanceof ConvergeError && error.code === "INVALID_COMMIT",
  );
  assert.equal(getterRan, false);
  assert.strictEqual(replica.getState(), before);
  assert.equal(replica.getRevision(), 1);
  assert.equal(notifications, 0);
});

test("replica installs a newer authoritative snapshot immutably", () => {
  const replica = createReplica({
    storeId: "counter",
    revision: 0,
    state: { counter: { value: 0 }, settings: { theme: "dark" } },
  });

  assert.deepEqual(
    replica.replace({
      storeId: "counter",
      revision: 5,
      state: { counter: { value: 5 }, settings: { theme: "light" } },
    }),
    { status: "applied", revision: 5 },
  );
  assert.equal(replica.getRevision(), 5);
  assert.ok(Object.isFrozen(replica.getState().settings));
  assert.deepEqual(
    replica.replace({
      storeId: "counter",
      revision: 4,
      state: { counter: { value: 4 }, settings: { theme: "dark" } },
    }),
    { status: "duplicate", revision: 5 },
  );
});

test("replica rejects malformed snapshots without changing state", () => {
  const replica = createReplica({
    storeId: "counter",
    revision: 1,
    state: { counter: { value: 1 }, settings: { theme: "dark" } },
  });
  const before = replica.getState();
  let notifications = 0;
  replica.subscribe(() => {
    notifications += 1;
  });

  assert.throws(
    () =>
      replica.replace({
        storeId: "counter",
        revision: 2,
        state: { counter: { value: 2 }, unknown: true },
      }),
    (error) => error instanceof ConvergeError && error.code === "INVALID_COMMIT",
  );

  let getterRan = false;
  const accessorSnapshot = { storeId: "counter", revision: 2 };
  Object.defineProperty(accessorSnapshot, "state", {
    enumerable: true,
    get() {
      getterRan = true;
      return {};
    },
  });
  assert.throws(
    () => replica.replace(accessorSnapshot),
    (error) => error instanceof ConvergeError && error.code === "INVALID_COMMIT",
  );

  assert.equal(getterRan, false);
  assert.strictEqual(replica.getState(), before);
  assert.equal(replica.getRevision(), 1);
  assert.equal(notifications, 0);
});

test("subscriber failures do not poison replica installation", () => {
  const canonical = createCanonicalStore(counterDefinition());
  const replica = createReplica(canonical.getSnapshot());
  let notified = false;
  replica.subscribe(() => {
    throw new Error("subscriber failed");
  });
  replica.subscribe(() => {
    notified = true;
  });

  assert.deepEqual(replica.ingest(canonical.dispatch("increment", 1).commit), {
    status: "applied",
    revision: 1,
  });
  assert.equal(replica.getState().counter.value, 1);
  assert.equal(notified, true);
});
