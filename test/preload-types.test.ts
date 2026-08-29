import { exposeElectronConvergeBridge } from "electron-converge/preload";
import type { RendererBridge } from "electron-converge/renderer";

declare global {
  interface Window {
    readonly electronConverge: RendererBridge;
  }
}

exposeElectronConvergeBridge();

// @ts-expect-error preload exports no generic invoke surface
import { invoke } from "electron-converge/preload";

void invoke;
