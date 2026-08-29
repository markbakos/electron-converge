import { errorFromCode } from "../errors.js";
import { connectProtocolClient } from "../protocol/client.js";
import type { ProtocolClient } from "../protocol/client.js";
import type { ProtocolTransport } from "../protocol/transport.js";
import type {
  RendererBridge,
  RendererConnection,
  RendererStore,
  RendererStoreDefinition,
} from "./types.js";

type CommitListener = (commit: unknown) => void;

export function createRendererConnection(
  bridge: RendererBridge,
): RendererConnection {
  const sessionId = globalThis.crypto.randomUUID();
  let closed = false;
  let commandNumber = 0;
  const commitListeners = new Map<string, CommitListener>();
  const clients = new Set<ProtocolClient<object>>();
  const connections = new Map<string, Promise<ProtocolClient<object>>>();

  const unsubscribe = bridge.onCommit((commit) => {
    const storeId = readStoreId(commit);
    if (storeId === undefined) {
      for (const listener of commitListeners.values()) listener(commit);
      return;
    }
    commitListeners.get(storeId)?.(commit);
  });

  const nextCommandId = (): string => `${sessionId}:${++commandNumber}`;

  const connectStore = <Definition extends RendererStoreDefinition>(
    storeId: string,
  ): Promise<RendererStore<Definition>> => {
    if (closed) return Promise.reject(errorFromCode("STALE_SESSION"));

    let connecting = connections.get(storeId);
    if (!connecting) {
      connecting = connectProtocolClient<object>(
        createStoreTransport(bridge, storeId, commitListeners),
        storeId,
        sessionId,
        nextCommandId,
      )
        .then((client) => {
          if (closed) {
            client.close();
            throw errorFromCode("STALE_SESSION");
          }
          clients.add(client);
          return client;
        })
        .catch((error: unknown) => {
          connections.delete(storeId);
          throw error;
        });
      connections.set(storeId, connecting);
    }
    return connecting as unknown as Promise<RendererStore<Definition>>;
  };

  return {
    connectStore,
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      commitListeners.clear();
      for (const client of clients) client.close();
      clients.clear();
      connections.clear();
    },
  };
}

function createStoreTransport(
  bridge: RendererBridge,
  storeId: string,
  listeners: Map<string, CommitListener>,
): ProtocolTransport {
  return {
    onCommit(listener) {
      listeners.set(storeId, listener);
      return () => {
        if (listeners.get(storeId) === listener) listeners.delete(storeId);
      };
    },
    attach: (request) => bridge.attach(request),
    command: (request) => bridge.command(request),
    recover: (request) => bridge.recover(request),
    close() {
      listeners.delete(storeId);
    },
  };
}

function readStoreId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "storeId");
    return descriptor &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}
