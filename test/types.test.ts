import {
  createCanonicalStore,
  createReplica,
  defineStore,
} from "../dist/index.js";
import type { DeepReadonly } from "../dist/index.js";

interface AppState {
  counter: { value: number };
  settings: { theme: string };
}

const definition = defineStore<AppState>()({
  id: "app",
  initialState: {
    counter: { value: 0 },
    settings: { theme: "dark" },
  },
  actions: {
    increment(state, input: { by: number }) {
      const value = state.counter.value + input.by;
      return {
        state: { ...state, counter: { value } },
        result: value,
      };
    },
    reset(state, _input: undefined) {
      return {
        state: { ...state, counter: { value: 0 } },
        result: undefined,
      };
    },
  },
});

const store = createCanonicalStore(definition);
const dispatched = store.dispatch("increment", { by: 2 });
const result: number = dispatched.result;
const value: number = store.getState().counter.value;

store.dispatch("reset", undefined);

// @ts-expect-error input types are inferred per action
store.dispatch("increment", { by: "2" });
// @ts-expect-error action names are limited to the definition
store.dispatch("missing", undefined);
// @ts-expect-error snapshots are read-only
store.getState().counter.value = 3;

type ReadonlyTuple = DeepReadonly<[number, { label: string }]>;
declare const tuple: ReadonlyTuple;
const tupleNumber: number = tuple[0];
const tupleLabel: string = tuple[1].label;
// @ts-expect-error tuple positions remain precise
const wrongTupleValue: string = tuple[0];
// @ts-expect-error tuple contents are deeply read-only
tuple[1].label = "changed";

const replica = createReplica(store.getSnapshot());
declare const transportPayload: unknown;
replica.ingest(transportPayload);
replica.replace(transportPayload);

void result;
void value;
void tupleNumber;
void tupleLabel;
void wrongTupleValue;
