import assert from "node:assert/strict";
import test from "node:test";

import {
  ConvergeError,
  createCanonicalStore,
} from "../dist/index.js";
import { counterDefinition } from "./fixtures.mjs";

test("canonical dispatch commits one immutable adjacent revision", () => {
  const store = createCanonicalStore(counterDefinition());
  const before = store.getState();

  const dispatched = store.dispatch("increment", 2);

  assert.equal(dispatched.result, 2);
  assert.deepEqual(dispatched.commit, {
    protocol: 1,
    type: "COMMIT",
    storeId: "counter",
    baseRevision: 0,
    revision: 1,
    changed: { counter: { value: 2 } },
  });
  assert.equal(store.getRevision(), 1);
  assert.notStrictEqual(store.getState(), before);
  assert.strictEqual(store.getState().settings, before.settings);
  assert.ok(Object.isFrozen(store.getState()));
  assert.ok(Object.isFrozen(store.getState().counter));
  assert.throws(() => {
    store.getState().counter.value = 99;
  }, TypeError);
});

test("a throwing reducer rolls back state and revision", () => {
  const store = createCanonicalStore(
    counterDefinition({
      fail() {
        throw new Error("private detail");
      },
    }),
  );
  const before = store.getState();

  assert.throws(
    () => store.dispatch("fail", undefined),
    (error) => error instanceof ConvergeError && error.code === "ACTION_FAILED",
  );
  assert.strictEqual(store.getState(), before);
  assert.equal(store.getRevision(), 0);
});

test("a Promise-like reducer result is rejected without committing", () => {
  const store = createCanonicalStore(
    counterDefinition({
      invalid() {
        return { then() {} };
      },
    }),
  );
  const before = store.getState();

  assert.throws(
    () => store.dispatch("invalid", undefined),
    (error) => error instanceof ConvergeError && error.code === "ASYNC_REDUCER",
  );
  assert.strictEqual(store.getState(), before);
  assert.equal(store.getRevision(), 0);
});

test("a successful no-change action still receives one revision", () => {
  const store = createCanonicalStore(
    counterDefinition({
      inspect(state) {
        return { state, result: state.counter.value };
      },
    }),
  );

  const dispatched = store.dispatch("inspect", undefined);

  assert.equal(dispatched.result, 0);
  assert.deepEqual(dispatched.commit.changed, {});
  assert.equal(dispatched.commit.baseRevision, 0);
  assert.equal(dispatched.commit.revision, 1);
  assert.equal(store.getRevision(), 1);
});

test("non-serializable reducer output is rejected without committing", () => {
  const store = createCanonicalStore(
    counterDefinition({
      invalid(state) {
        return { state, result: () => undefined };
      },
    }),
  );
  const before = store.getState();

  assert.throws(
    () => store.dispatch("invalid", undefined),
    (error) =>
      error instanceof ConvergeError && error.code === "SERIALIZATION_FAILED",
  );
  assert.strictEqual(store.getState(), before);
  assert.equal(store.getRevision(), 0);
});

test("dispatch rejects inherited action names", () => {
  const store = createCanonicalStore(counterDefinition());

  assert.throws(
    () => store.dispatch("constructor", undefined),
    (error) => error instanceof ConvergeError && error.code === "UNKNOWN_ACTION",
  );
  assert.equal(store.getRevision(), 0);
});

test("dispatch rejects an input that fails its action validator", () => {
  const store = createCanonicalStore({
    id: "validated",
    initialState: { value: 0 },
    inputs: {
      set(value) {
        return typeof value === "number";
      },
    },
    actions: {
      set(state, value) {
        return { state: { value }, result: value };
      },
    },
  });

  assert.throws(
    () => store.dispatch("set", "not-a-number"),
    (error) => error instanceof ConvergeError && error.code === "INVALID_INPUT",
  );
  assert.equal(store.getRevision(), 0);
  assert.deepEqual(store.getState(), { value: 0 });
});

test("dispatch converts throwing and Promise-like validators to INVALID_INPUT", () => {
  for (const validate of [
    () => {
      throw new Error("private validator detail");
    },
    () => Promise.resolve(true),
  ]) {
    const store = createCanonicalStore({
      id: "validated",
      initialState: { value: 0 },
      inputs: { set: validate },
      actions: {
        set(state, value) {
          return { state: { value }, result: value };
        },
      },
    });

    assert.throws(
      () => store.dispatch("set", 1),
      (error) => error instanceof ConvergeError && error.code === "INVALID_INPUT",
    );
    assert.equal(store.getRevision(), 0);
  }
});

test("store creation snapshots and validates action definitions", () => {
  assert.throws(
    () =>
      createCanonicalStore({
        ...counterDefinition(),
        id: "x".repeat(129),
      }),
    (error) => error instanceof ConvergeError && error.code === "INVALID_STORE",
  );
  assert.throws(
    () =>
      createCanonicalStore(
        counterDefinition({
          ["x".repeat(129)](state) {
            return { state, result: undefined };
          },
        }),
      ),
    (error) => error instanceof ConvergeError && error.code === "INVALID_STORE",
  );
  assert.throws(
    () =>
      createCanonicalStore(
        counterDefinition({
          constructor() {
            return { state: {}, result: undefined };
          },
        }),
      ),
    (error) => error instanceof ConvergeError && error.code === "INVALID_STORE",
  );

  const definition = counterDefinition();
  const store = createCanonicalStore(definition);
  definition.actions.increment = (state) => ({ state, result: 999 });
  definition.inputs.increment = () => false;

  assert.equal(store.dispatch("increment", 1).result, 1);
});
