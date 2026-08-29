import { createCanonicalStore, defineStore } from "../dist/index.js";
import { registerElectronMain } from "electron-converge/main";

interface State {
  value: number;
}

const numberStore = createCanonicalStore(
  defineStore<State>()({
    id: "numbers",
    initialState: { value: 0 },
    inputs: {
      set(value: unknown): boolean {
        return typeof value === "number";
      },
    },
    actions: {
      set(_state, value: number) {
        return { state: { value }, result: value };
      },
    },
  }),
);

const textStore = createCanonicalStore(
  defineStore<{ text: string }>()({
    id: "text",
    initialState: { text: "" },
    inputs: {
      set(value: unknown): boolean {
        return typeof value === "string";
      },
    },
    actions: {
      set(_state, text: string) {
        return { state: { text }, result: text.length };
      },
    },
  }),
);

const main = registerElectronMain<{ role: string }>({
  stores: [numberStore, textStore],
  authorizeFrame({ frame }) {
    return frame.origin === "app://converge";
  },
  authorize({ trusted }) {
    return trusted.role === "main";
  },
});

registerElectronMain({
  stores: [numberStore],
  // @ts-expect-error authorization hooks must be synchronous
  authorizeFrame: async () => true,
  authorize: () => true,
});

registerElectronMain({
  stores: [numberStore],
  authorizeFrame: () => true,
  // @ts-expect-error authorization hooks must be synchronous
  authorize: async () => true,
});

// @ts-expect-error main registration accepts canonical stores only
registerElectronMain({ stores: [{}], authorizeFrame: () => true, authorize: () => true });

declare const webContents: import("electron").WebContents;
main.registerRenderer(webContents, { role: "main" });

// @ts-expect-error main-process APIs are not exported from the root
import { registerElectronMain as rootRegistration } from "../dist/index.js";

void rootRegistration;
