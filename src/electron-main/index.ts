import { ipcMain } from "electron";

import {
  createElectronMainController,
  type ElectronMainController,
  type ElectronMainOptions,
} from "./controller.js";

export type {
  ElectronAuthorizationContext,
  ElectronMainController,
  ElectronMainDiagnostics,
  ElectronMainOptions,
  RendererRegistration,
} from "./controller.js";

export function registerElectronMain<
  Trusted extends object = Record<string, unknown>,
>(options: ElectronMainOptions<Trusted>): ElectronMainController<Trusted> {
  return createElectronMainController(ipcMain, options);
}
