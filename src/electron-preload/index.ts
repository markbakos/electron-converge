import { contextBridge, ipcRenderer } from "electron/renderer";

import type { RendererBridge } from "../electron-renderer/types.js";
import { createPreloadBridge } from "./bridge.js";

declare global {
  interface Window {
    readonly electronConverge: RendererBridge;
  }
}

export function exposeElectronConvergeBridge(): void {
  contextBridge.exposeInMainWorld(
    "electronConverge",
    createPreloadBridge(ipcRenderer),
  );
}
