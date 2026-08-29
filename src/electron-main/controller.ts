import { performance } from "node:perf_hooks";

import type {
  Event,
  IpcMainInvokeEvent,
  WebContents,
  WebContentsDidStartNavigationEventParams,
  WebFrameMain,
} from "electron";

import { ConvergeError, errorFromCode, serializeError } from "../errors.js";
import type { ErrorCode } from "../errors.js";
import { ELECTRON_CHANNELS } from "../electron/channels.js";
import { createProtocolHost } from "../protocol/host.js";
import type {
  AttachRequest,
  CommandRequest,
  ProtocolError,
  RecoverRequest,
} from "../protocol/messages.js";
import {
  parseAttachRequest,
  parseCommandRequest,
  parseRecoverRequest,
} from "../protocol/validation.js";
import {
  canonicalStoreRuntime,
  type CanonicalStoreRuntime,
} from "../store/types.js";
import type { DeepReadonly } from "../wire/types.js";
import {
  cloneInboundWire,
  cloneWire,
  isPlainRecord,
} from "../wire/validation.js";

export { ELECTRON_CHANNELS } from "../electron/channels.js";

const MAX_STORES = 64;
const MAX_RENDERERS = 128;
const MAX_SESSIONS = 128;
const MAX_ATTACHMENTS = 64;
const MAX_REQUESTS_PER_SECOND = 1_024;

type MainRequest = AttachRequest | CommandRequest | RecoverRequest;
type Operation = "attach" | "command" | "recover";

interface IpcMainPort {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...values: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface ElectronAuthorizationContext<Trusted extends object> {
  readonly webContents: WebContents;
  readonly frame: WebFrameMain;
  readonly trusted: DeepReadonly<Trusted>;
}

export interface ElectronMainOptions<Trusted extends object> {
  readonly stores: readonly CanonicalStoreRuntime[];
  readonly authorizeFrame: (
    context: ElectronAuthorizationContext<Trusted>,
  ) => boolean;
  readonly authorize: (
    context: ElectronAuthorizationContext<Trusted>,
    request: MainRequest,
  ) => boolean;
}

export interface ElectronMainDiagnostics {
  readonly registeredRenderers: number;
  readonly liveSessions: number;
  readonly attachedStores: number;
  readonly acceptedRequests: number;
  readonly rejectedRequests: number;
  readonly committedCommands: number;
  readonly catchUpRecoveries: number;
  readonly snapshotRecoveries: number;
  readonly publicationFailures: number;
  readonly resourceLimitRejections: number;
}

export interface RendererRegistration {
  rotate(): void;
  unregister(): void;
}

export interface ElectronMainController<Trusted extends object> {
  registerRenderer(
    webContents: WebContents,
    trustedContext: Trusted,
  ): RendererRegistration;
  getDiagnostics(): ElectronMainDiagnostics;
  dispose(): void;
}

interface Session {
  readonly id: string;
  readonly registration: Registration;
  readonly frame: WebFrameMain;
  readonly generation: number;
  readonly attachedStores: Set<string>;
}

interface Registration {
  readonly webContents: WebContents;
  readonly trusted: DeepReadonly<object>;
  readonly listeners: {
    readonly startNavigation: (
      details: Event<WebContentsDidStartNavigationEventParams>,
    ) => void;
    readonly finishLoad: (
      event: Event,
      isMainFrame: boolean,
      frameProcessId: number,
      frameRoutingId: number,
    ) => void;
    readonly processGone: () => void;
    readonly destroyed: () => void;
  };
  generation: number;
  accepting: boolean;
  session: Session | undefined;
  windowStartedAt: number;
  windowRequests: number;
}

export function createElectronMainController<Trusted extends object>(
  ipcMain: IpcMainPort,
  options: ElectronMainOptions<Trusted>,
): ElectronMainController<Trusted> {
  if (
    !Array.isArray(options.stores) ||
    options.stores.length === 0 ||
    options.stores.length > MAX_STORES ||
    typeof options.authorizeFrame !== "function" ||
    typeof options.authorize !== "function"
  ) {
    throw new ConvergeError("INVALID_STORE", "Invalid store");
  }

  const stores = new Map<string, ReturnType<typeof createProtocolHost>>();
  for (const store of options.stores) {
    const runtime = store[canonicalStoreRuntime]();
    const storeId = runtime.getSnapshot().storeId;
    if (stores.has(storeId)) {
      throw new ConvergeError("INVALID_STORE", "Invalid store");
    }
    stores.set(storeId, createProtocolHost(store));
  }

  const registrations = new Map<WebContents, Registration>();
  const sessions = new Map<string, Session>();
  const counters = {
    acceptedRequests: 0,
    rejectedRequests: 0,
    committedCommands: 0,
    catchUpRecoveries: 0,
    snapshotRecoveries: 0,
    publicationFailures: 0,
    resourceLimitRejections: 0,
  };
  let attachedStores = 0;
  let disposed = false;

  const handlers = [
    [ELECTRON_CHANNELS.attach, "attach"],
    [ELECTRON_CHANNELS.command, "command"],
    [ELECTRON_CHANNELS.recover, "recover"],
  ] as const;
  const installed: string[] = [];
  try {
    for (const [channel, operation] of handlers) {
      ipcMain.handle(channel, (event, ...values) =>
        handle(operation, event, values),
      );
      installed.push(channel);
    }
  } catch (error) {
    for (const channel of installed) ipcMain.removeHandler(channel);
    throw error;
  }

  function handle(
    operation: Operation,
    event: IpcMainInvokeEvent,
    values: readonly unknown[],
  ): unknown {
    try {
      const registration = registrations.get(event.sender);
      if (!registration || registration.webContents.isDestroyed()) {
        throw boundaryError("UNAUTHORIZED");
      }
      if (!registration.accepting) throw boundaryError("STALE_SESSION");

      const frame = event.senderFrame;
      if (frame === null || frame !== registration.webContents.mainFrame) {
        throw boundaryError("UNAUTHORIZED");
      }
      consumeRequest(registration);

      const context = Object.freeze({
        webContents: registration.webContents,
        frame,
        trusted: registration.trusted as DeepReadonly<Trusted>,
      });
      requireAuthorized(() => options.authorizeFrame(context));

      if (values.length !== 1) throw boundaryError("INVALID_PROTOCOL");
      const request = parseRequest(operation, cloneInboundWire(values[0]));
      requireAuthorized(() => options.authorize(context, request));
      checkSessionProvisional(registration, request);

      counters.acceptedRequests += 1;
      const response = route(registration, frame, request);
      if (isRejectedResponse(response)) counters.rejectedRequests += 1;
      return response;
    } catch (error) {
      counters.rejectedRequests += 1;
      if (error instanceof ConvergeError && error.code === "RESOURCE_LIMIT") {
        counters.resourceLimitRejections += 1;
      }
      return protocolError(error);
    }
  }

  function route(
    registration: Registration,
    frame: WebFrameMain,
    request: MainRequest,
  ): unknown {
    const host = stores.get(request.storeId);
    if (!host) throw boundaryError("INVALID_STORE");

    if (request.type === "ATTACH") {
      return attachSession(registration, frame, request, host);
    }
    const session = requireSession(registration, frame, request.sessionId);
    if (!session.attachedStores.has(request.storeId)) {
      throw boundaryError("STALE_SESSION");
    }
    if (request.type === "COMMAND") {
      const response = host.command(request);
      if (response.type === "COMMAND_RESULT" && response.ok) {
        counters.committedCommands += 1;
      }
      return response;
    }

    const response = host.recover(request);
    if (response.type === "CATCH_UP") counters.catchUpRecoveries += 1;
    if (response.type === "SNAPSHOT") counters.snapshotRecoveries += 1;
    return response;
  }

  function attachSession(
    registration: Registration,
    frame: WebFrameMain,
    request: AttachRequest,
    host: ReturnType<typeof createProtocolHost>,
  ): unknown {
    let session = registration.session;
    let created = false;
    if (!session) {
      if (sessions.size >= MAX_SESSIONS) throw boundaryError("RESOURCE_LIMIT");
      session = {
        id: request.sessionId,
        registration,
        frame,
        generation: registration.generation,
        attachedStores: new Set(),
      };
      sessions.set(session.id, session);
      registration.session = session;
      created = true;
    }
    if (
      session.attachedStores.size >= MAX_ATTACHMENTS &&
      !session.attachedStores.has(request.storeId)
    ) {
      if (created) detachSession(session);
      throw boundaryError("RESOURCE_LIMIT");
    }

    const response = host.attach(request, (commit) => {
      const current = sessions.get(request.sessionId);
      if (!current || current.registration.webContents.isDestroyed()) {
        throw boundaryError("STALE_SESSION");
      }
      try {
        current.registration.webContents.send(ELECTRON_CHANNELS.commit, commit);
      } catch (error) {
        counters.publicationFailures += 1;
        detachSession(current);
        throw error;
      }
    });
    if (response.type !== "ATTACHED") {
      if (created) detachSession(session);
      return response;
    }
    session.attachedStores.add(request.storeId);
    attachedStores += 1;
    return response;
  }

  function checkSessionProvisional(
    registration: Registration,
    request: MainRequest,
  ): void {
    const current = registration.session;
    if (request.type === "ATTACH") {
      if (
        (current && current.id !== request.sessionId) ||
        (!current && sessions.has(request.sessionId))
      ) {
        throw boundaryError("STALE_SESSION");
      }
      return;
    }
    if (!current || current.id !== request.sessionId) {
      throw boundaryError("STALE_SESSION");
    }
  }

  function requireSession(
    registration: Registration,
    frame: WebFrameMain,
    sessionId: string,
  ): Session {
    const session = registration.session;
    if (
      !session ||
      session.id !== sessionId ||
      session.frame !== frame ||
      session.generation !== registration.generation
    ) {
      throw boundaryError("STALE_SESSION");
    }
    return session;
  }

  function detachSession(session: Session): void {
    if (sessions.get(session.id) !== session) return;
    for (const storeId of session.attachedStores) {
      stores.get(storeId)?.detach(session.id);
    }
    attachedStores -= session.attachedStores.size;
    session.attachedStores.clear();
    sessions.delete(session.id);
    if (session.registration.session === session) {
      session.registration.session = undefined;
    }
  }

  function rotate(registration: Registration, accepting: boolean): void {
    if (registration.session) detachSession(registration.session);
    registration.generation += 1;
    registration.accepting = accepting;
  }

  function unregister(registration: Registration): void {
    if (registrations.get(registration.webContents) !== registration) return;
    if (registration.session) detachSession(registration.session);
    registrations.delete(registration.webContents);
    const { webContents, listeners } = registration;
    webContents.off("did-start-navigation", listeners.startNavigation);
    webContents.off("did-frame-finish-load", listeners.finishLoad);
    webContents.off("render-process-gone", listeners.processGone);
    webContents.off("destroyed", listeners.destroyed);
  }

  return {
    registerRenderer(webContents, trustedContext) {
      if (disposed) throw boundaryError("STALE_SESSION");
      if (
        webContents.isDestroyed() ||
        registrations.has(webContents) ||
        registrations.size >= MAX_RENDERERS
      ) {
        throw boundaryError(
          registrations.size >= MAX_RENDERERS
            ? "RESOURCE_LIMIT"
            : "STALE_SESSION",
        );
      }
      const trusted = cloneWire(
        trustedContext,
        "INVALID_INPUT",
        "Invalid action input",
      );
      if (!isPlainRecord(trusted)) {
        throw new ConvergeError("INVALID_INPUT", "Invalid action input");
      }

      let registration: Registration;
      const listeners: Registration["listeners"] = {
        startNavigation(details) {
          if (details.isMainFrame && !details.isSameDocument) {
            rotate(registration, false);
          }
        },
        finishLoad(_event, isMainFrame, frameProcessId, frameRoutingId) {
          let frame: WebFrameMain;
          try {
            frame = webContents.mainFrame;
          } catch {
            return;
          }
          if (
            isMainFrame &&
            frame.processId === frameProcessId &&
            frame.routingId === frameRoutingId
          ) {
            registration.accepting = true;
          }
        },
        processGone() {
          rotate(registration, false);
        },
        destroyed() {
          unregister(registration);
        },
      };
      registration = {
        webContents,
        trusted,
        listeners,
        generation: 0,
        accepting: true,
        session: undefined,
        windowStartedAt: performance.now(),
        windowRequests: 0,
      };

      webContents.on(
        "did-start-navigation",
        registration.listeners.startNavigation,
      );
      webContents.on(
        "did-frame-finish-load",
        registration.listeners.finishLoad,
      );
      webContents.on(
        "render-process-gone",
        registration.listeners.processGone,
      );
      webContents.on("destroyed", registration.listeners.destroyed);
      if (webContents.isDestroyed()) {
        webContents.off(
          "did-start-navigation",
          registration.listeners.startNavigation,
        );
        webContents.off(
          "did-frame-finish-load",
          registration.listeners.finishLoad,
        );
        webContents.off(
          "render-process-gone",
          registration.listeners.processGone,
        );
        webContents.off("destroyed", registration.listeners.destroyed);
        throw boundaryError("STALE_SESSION");
      }
      registrations.set(webContents, registration);

      let active = true;
      return Object.freeze({
        rotate() {
          if (!active || webContents.isDestroyed()) return;
          rotate(registration, true);
        },
        unregister() {
          if (!active) return;
          active = false;
          unregister(registration);
        },
      });
    },

    getDiagnostics() {
      return Object.freeze({
        registeredRenderers: registrations.size,
        liveSessions: sessions.size,
        attachedStores,
        ...counters,
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const registration of [...registrations.values()]) {
        unregister(registration);
      }
      for (const [channel] of handlers) ipcMain.removeHandler(channel);
    },
  };

  function consumeRequest(registration: Registration): void {
    const now = performance.now();
    if (now - registration.windowStartedAt >= 1_000) {
      registration.windowStartedAt = now;
      registration.windowRequests = 0;
    }
    if (registration.windowRequests >= MAX_REQUESTS_PER_SECOND) {
      throw boundaryError("RESOURCE_LIMIT");
    }
    registration.windowRequests += 1;
  }
}

function parseRequest(operation: Operation, value: unknown): MainRequest {
  if (operation === "attach") return parseAttachRequest(value);
  if (operation === "command") return parseCommandRequest(value);
  return parseRecoverRequest(value);
}

function isRejectedResponse(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    (value.type === "PROTOCOL_ERROR" ||
      (value.type === "COMMAND_RESULT" && value.ok === false))
  );
}

function boundaryError(code: ErrorCode): ConvergeError {
  return errorFromCode(code);
}

function requireAuthorized(check: () => boolean): void {
  try {
    if (check() === true) return;
  } catch {
    // Application authorization details never cross IPC.
  }
  throw boundaryError("UNAUTHORIZED");
}

function protocolError(error: unknown): ProtocolError {
  return Object.freeze({
    protocol: 1,
    type: "PROTOCOL_ERROR",
    error: Object.freeze(serializeError(error)),
  });
}
