import { defineStore } from "../dist/index.js";

export function counterDefinition(extraActions = {}) {
  return defineStore()({
    id: "counter",
    initialState: {
      counter: { value: 0 },
      settings: { theme: "dark" },
    },
    inputs: {
      increment(value) {
        return typeof value === "number";
      },
      ...Object.fromEntries(
        Object.keys(extraActions).map((name) => [name, () => true]),
      ),
    },
    actions: {
      increment(state, amount) {
        const value = state.counter.value + amount;
        return {
          state: { ...state, counter: { value } },
          result: value,
        };
      },
      ...extraActions,
    },
  });
}
