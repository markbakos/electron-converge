import { ConvergeError } from "../errors.js";
import type { DeepReadonly } from "../wire/types.js";
import {
  cloneWire,
  isPlainRecord,
  validateWire,
} from "../wire/validation.js";
import type {
  ActionMap,
  CanonicalStore,
  DispatchResult,
  StoreDefinition,
} from "./types.js";

export function defineStore<State extends object = Record<string, unknown>>() {
  return <Actions extends ActionMap<State>>(
    definition: StoreDefinition<State, Actions>,
  ): StoreDefinition<State, Actions> => definition;
}

export function createCanonicalStore<
  State extends object,
  Actions extends ActionMap<State>,
>(definition: StoreDefinition<State, Actions>): CanonicalStore<State, Actions> {
  if (typeof definition.id !== "string" || definition.id.length === 0) {
    throw new ConvergeError("INVALID_STORE", "Invalid store");
  }
  const storeId = definition.id;
  if (!isPlainRecord(definition.actions)) {
    throw new ConvergeError("INVALID_STORE", "Invalid store");
  }
  const actionEntries = Object.entries(definition.actions);
  if (
    actionEntries.some(
      ([name, reducer]) =>
        name === "__proto__" ||
        name === "constructor" ||
        name === "prototype" ||
        typeof reducer !== "function",
    )
  ) {
    throw new ConvergeError("INVALID_STORE", "Invalid store");
  }
  const actions = Object.freeze(Object.fromEntries(actionEntries)) as Actions;

  const initialState = cloneWire(
    definition.initialState,
    "INVALID_STATE",
    "Invalid state",
  );
  if (!isPlainRecord(initialState)) {
    throw new ConvergeError("INVALID_STATE", "Invalid state");
  }
  const sliceNames = Object.keys(initialState);
  let state = initialState as DeepReadonly<State>;
  let revision = 0;

  return {
    getState: () => state,
    getRevision: () => revision,
    getSnapshot: () => Object.freeze({ storeId, revision, state }),
    dispatch(action, input) {
      const reducer = Object.hasOwn(actions, action)
        ? actions[action]
        : undefined;
      if (typeof reducer !== "function") {
        throw new ConvergeError("UNKNOWN_ACTION", "Unknown action");
      }
      if (revision === Number.MAX_SAFE_INTEGER) {
        throw new ConvergeError(
          "REVISION_EXHAUSTED",
          "Revision limit reached",
        );
      }

      const safeInput = cloneWire(
        input,
        "INVALID_INPUT",
        "Invalid action input",
      );
      let outcome: unknown;
      try {
        outcome = (
          reducer as (
            state: DeepReadonly<State>,
            input: typeof safeInput,
          ) => unknown
        )(state, safeInput);
      } catch {
        throw new ConvergeError("ACTION_FAILED", "Action failed");
      }

      let promiseLike = false;
      if (
        outcome !== null &&
        (typeof outcome === "object" || typeof outcome === "function")
      ) {
        try {
          promiseLike = typeof Reflect.get(outcome, "then") === "function";
        } catch {
          promiseLike = true;
        }
      }
      if (promiseLike) {
        throw new ConvergeError(
          "ASYNC_REDUCER",
          "Reducers must be synchronous",
        );
      }
      validateWire(
        outcome,
        "SERIALIZATION_FAILED",
        "Invalid reducer output",
      );
      if (!isPlainRecord(outcome) || !Object.hasOwn(outcome, "state")) {
        throw new ConvergeError(
          "SERIALIZATION_FAILED",
          "Invalid reducer output",
        );
      }

      const nextState = outcome.state;
      if (!isPlainRecord(nextState)) {
        throw new ConvergeError(
          "SERIALIZATION_FAILED",
          "Invalid reducer state",
        );
      }
      const nextSliceNames = Object.keys(nextState);
      if (
        nextSliceNames.length !== sliceNames.length ||
        nextSliceNames.some((name) => !sliceNames.includes(name))
      ) {
        throw new ConvergeError(
          "SERIALIZATION_FAILED",
          "Invalid reducer state",
        );
      }
      const result = cloneWire(
        outcome.result,
        "SERIALIZATION_FAILED",
        "Invalid reducer result",
      );
      const changed: Record<string, unknown> = {};
      for (const name of sliceNames) {
        if (
          !Object.is(
            nextState[name],
            (state as unknown as Record<string, unknown>)[name],
          )
        ) {
          changed[name] = cloneWire(
            nextState[name],
            "SERIALIZATION_FAILED",
            "Invalid reducer state",
          );
        }
      }

      const baseRevision = revision;
      const nextRevision = baseRevision + 1;
      const nextCanonical = Object.freeze({
        ...state,
        ...changed,
      }) as DeepReadonly<State>;
      const commit = Object.freeze({
        protocol: 1 as const,
        type: "COMMIT" as const,
        storeId,
        baseRevision,
        revision: nextRevision,
        changed: Object.freeze(changed) as Partial<DeepReadonly<State>>,
      });

      state = nextCanonical;
      revision = nextRevision;
      return Object.freeze({ result, commit }) as DispatchResult<
        State,
        ReturnType<typeof reducer>["result"]
      >;
    },
  };
}
