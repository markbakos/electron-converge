import type { RendererBridge } from "../electron-renderer/types.js";
import { ELECTRON_CHANNELS } from "../electron/channels.js";

interface IpcRendererPort {
  invoke(channel: string, value: unknown): Promise<unknown>;
  on(
    channel: string,
    listener: (event: unknown, value: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    listener: (event: unknown, value: unknown) => void,
  ): void;
}

export function createPreloadBridge(
  ipcRenderer: IpcRendererPort,
): RendererBridge {
  const bridge: RendererBridge = {
    attach: (request) => ipcRenderer.invoke(ELECTRON_CHANNELS.attach, request),
    command: (request) =>
      ipcRenderer.invoke(ELECTRON_CHANNELS.command, request),
    recover: (request) =>
      ipcRenderer.invoke(ELECTRON_CHANNELS.recover, request),
    onCommit(listener) {
      const wrapped = (_event: unknown, commit: unknown): void => {
        listener(commit);
      };
      ipcRenderer.on(ELECTRON_CHANNELS.commit, wrapped);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        ipcRenderer.removeListener(ELECTRON_CHANNELS.commit, wrapped);
      };
    },
  };
  return Object.freeze(bridge);
}
