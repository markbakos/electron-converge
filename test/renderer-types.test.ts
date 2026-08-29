import { defineStore } from "../dist/index.js";
import {
  createRendererConnection,
  type RendererBridge,
} from "electron-converge/renderer";

interface AppState {
  counter: { value: number };
}

const definition = defineStore<AppState>()({
  id: "app",
  initialState: { counter: { value: 0 } },
  inputs: {
    increment(value: unknown): value is { by: number } {
      return (
        typeof value === "object" &&
        value !== null &&
        "by" in value &&
        typeof value.by === "number"
      );
    },
  },
  actions: {
    increment(state, input: { by: number }) {
      const value = state.counter.value + input.by;
      return { state: { counter: { value } }, result: value };
    },
  },
});

declare const bridge: RendererBridge;
const connection = createRendererConnection(bridge);
const store = await connection.connectStore<typeof definition>("app");
const stateValue: number = store.getState().counter.value;
const selected: number = store.select((state) => state.counter.value);
const result: number = await store.dispatch("increment", { by: 2 });

// @ts-expect-error renderer snapshots are deeply read-only
store.getState().counter.value = 3;
// @ts-expect-error action input is inferred from the store definition
store.dispatch("increment", { by: "2" });
// @ts-expect-error action names are inferred from the store definition
store.dispatch("missing", undefined);
// @ts-expect-error main-process APIs are not exported to renderer bundles
import { registerElectronMain } from "electron-converge/renderer";

void stateValue;
void selected;
void result;
void registerElectronMain;
