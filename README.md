# Electron Converge

Strongly consistent state across Electron processes. Main owns canonical state; renderers issue acknowledged asynchronous commands and keep revisioned local replicas.

## Install

```sh
npm install electron-converge
```

Requires Node.js 24.18.1+, Electron 42–44, and React 18–19 when using the React binding. The package is ESM-only.

## Usage

Define a store in code shared by main and renderer:

```ts
// app-store.ts
import { defineStore } from "electron-converge";

export const appStoreDefinition = defineStore<{ count: number }>()({
  id: "app",
  initialState: { count: 0 },
  inputs: {
    increment: (value: unknown): value is number =>
      typeof value === "number" && Number.isSafeInteger(value),
  },
  actions: {
    increment(state, by: number) {
      const count = state.count + by;
      return { state: { count }, result: count };
    },
  },
});
```

Own the canonical store and register trusted windows in main:

```ts
// main.ts
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { createCanonicalStore } from "electron-converge";
import { registerElectronMain } from "electron-converge/main";
import { appStoreDefinition } from "./app-store.js";

const appStore = createCanonicalStore(appStoreDefinition);
const preload = fileURLToPath(new URL("./preload.cjs", import.meta.url));
const converge = registerElectronMain({
  stores: [appStore],
  authorizeFrame: ({ frame }) => new URL(frame.url).protocol === "app:",
  authorize: () => true,
});

await app.whenReady();
const window = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload,
  },
});

converge.registerRenderer(window.webContents, { role: "app" });
```

Expose the fixed bridge from preload:

```ts
// preload.ts
import { exposeElectronConvergeBridge } from "electron-converge/preload";

exposeElectronConvergeBridge();
```

Bundle the preload entry as CommonJS (for example, `preload.cjs`); sandboxed Electron preloads cannot load ESM imports.

Connect once in the renderer. Reads are synchronous and local; dispatch resolves only after the originating replica installs the committed revision.

```ts
// renderer.ts
import { createRendererConnection } from "electron-converge/renderer";
import type { RendererBridge } from "electron-converge/renderer";
import type { appStoreDefinition } from "./app-store.js";

declare global {
  interface Window {
    readonly electronConverge: RendererBridge;
  }
}

const connection = createRendererConnection(window.electronConverge);
export const appStore =
  await connection.connectStore<typeof appStoreDefinition>("app");

console.log(appStore.getState(), appStore.getRevision());
const count = await appStore.dispatch("increment", 1);
```

React reads the same local replica without IPC during render:

```tsx
import { useStore } from "electron-converge/react";
import { appStore } from "./renderer.js";

export function Counter() {
  const count = useStore(appStore, (state) => state.count);
  return <button onClick={() => void appStore.dispatch("increment", 1)}>{count}</button>;
}
```

Reducers must remain synchronous, deterministic, and free of I/O. Treat renderer inputs as untrusted and keep authorization hooks synchronous. A transport failure reports `OUTCOME_UNKNOWN` and is never retried automatically.

## Exports

- `electron-converge` — store definitions, canonical stores, replicas, and errors
- `electron-converge/main` — Electron main-process controller
- `electron-converge/preload` — fixed context-isolated preload bridge
- `electron-converge/renderer` — Electron-free renderer connection and replica API
- `electron-converge/react` — `useStore`

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:pack
```

`pnpm check` includes the real multi-window Electron test. `pnpm test:pack` installs the generated tarball into a temporary consumer and imports every public entry point.

## Release

Publishing runs from GitHub Actions through npm trusted publishing. Configure the trusted publisher once with npm 11.15.0 or newer, after `publish.yml` is on GitHub:

```sh
npm trust github electron-converge --file publish.yml --repo markbakos/electron-converge --allow-publish
```

For each stable release:

```sh
npm version patch # or minor / major
git push --follow-tags
```

The `vX.Y.Z` tag must exactly match `package.json`. The existing full check and packed-consumer verification run before npm publishes with provenance. The first automated release must be newer than the published `1.0.0`; prerelease tags are not enabled.

## License

[MIT](LICENSE)
