import { defineStore } from "electron-converge";
import { useStore } from "electron-converge/react";
import type { RendererStore } from "electron-converge/renderer";

const definition = defineStore<{ counter: { value: number } }>()({
  id: "counter",
  initialState: { counter: { value: 0 } },
  inputs: {
    increment(value: unknown): value is number {
      return typeof value === "number";
    },
  },
  actions: {
    increment(state, by: number) {
      return {
        state: { counter: { value: state.counter.value + by } },
        result: undefined,
      };
    },
  },
});

declare const store: RendererStore<typeof definition>;
const state = useStore(store);
const value = useStore(store, (snapshot) => snapshot.counter.value);
const selected = useStore(
  store,
  (snapshot) => ({ value: snapshot.counter.value }),
  (left, right) => left.value === right.value,
);

const stateValue: number = state.counter.value;
const selectedValue: number = value;
const equalityValue: number = selected.value;

// @ts-expect-error selected state remains deeply read-only
state.counter.value = 1;

void stateValue;
void selectedValue;
void equalityValue;
