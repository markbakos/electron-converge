import { ConvergeError, serializeError } from "../errors.js";
import {
  canonicalStoreRuntime,
  type CanonicalStoreRuntime,
} from "../store/types.js";
import type {
  Attached,
  CommandResult,
  ProtocolCommit,
  ProtocolError,
  RecoveryResult,
} from "./messages.js";
import {
  parseAttachRequest,
  parseCommandRequest,
  parseRecoverRequest,
} from "./validation.js";

const MAX_RECENT_COMMITS = 64;

interface Session {
  readonly send: (commit: ProtocolCommit<object>) => void;
}

export interface ProtocolHost {
  attach(
    request: unknown,
    send: (commit: ProtocolCommit<object>) => void,
  ): Attached<object> | ProtocolError;
  command(request: unknown): CommandResult<object> | ProtocolError;
  recover(request: unknown): RecoveryResult<object> | ProtocolError;
  detach(sessionId: string): void;
}

export function createProtocolHost(store: CanonicalStoreRuntime): ProtocolHost {
  const runtime = store[canonicalStoreRuntime]();
  const storeId = runtime.getSnapshot().storeId;
  const sessions = new Map<string, Session>();
  const history: ProtocolCommit<object>[] = [];

  return {
    attach(value, send) {
      let attachedSessionId: string | undefined;
      try {
        const request = parseAttachRequest(value);
        if (request.storeId !== storeId) {
          throw new ConvergeError("INVALID_STORE", "Invalid store");
        }
        if (sessions.has(request.sessionId)) {
          throw new ConvergeError("STALE_SESSION", "Stale session");
        }

        sessions.set(request.sessionId, { send });
        attachedSessionId = request.sessionId;
        return {
          protocol: 1,
          type: "ATTACHED",
          storeId,
          sessionId: request.sessionId,
          snapshot: runtime.getSnapshot(),
        };
      } catch (error) {
        if (attachedSessionId !== undefined) {
          sessions.delete(attachedSessionId);
        }
        return protocolError(error);
      }
    },

    command(value) {
      let request;
      try {
        request = parseCommandRequest(value);
      } catch (error) {
        return protocolError(error);
      }

      if (request.storeId !== storeId) {
        return commandFailure(
          request,
          new ConvergeError("INVALID_STORE", "Invalid store"),
        );
      }
      if (!sessions.has(request.sessionId)) {
        return commandFailure(
          request,
          new ConvergeError("STALE_SESSION", "Stale session"),
        );
      }

      try {
        const dispatched = runtime.dispatch(request.action, request.input);
        const commit = Object.freeze({
          ...dispatched.commit,
          commandId: request.commandId,
          sourceSessionId: request.sessionId,
        });
        history.push(commit);
        if (history.length > MAX_RECENT_COMMITS) history.shift();

        for (const [sessionId, session] of sessions) {
          try {
            session.send(commit);
          } catch {
            sessions.delete(sessionId);
          }
        }

        return {
          protocol: 1,
          type: "COMMAND_RESULT",
          storeId,
          sessionId: request.sessionId,
          commandId: request.commandId,
          ok: true,
          result: dispatched.result,
          commit,
        };
      } catch (error) {
        return commandFailure(request, error);
      }
    },

    recover(value) {
      try {
        const request = parseRecoverRequest(value);
        if (request.storeId !== storeId) {
          throw new ConvergeError("INVALID_STORE", "Invalid store");
        }
        if (!sessions.has(request.sessionId)) {
          throw new ConvergeError("STALE_SESSION", "Stale session");
        }

        const currentRevision = runtime.getSnapshot().revision;
        if (request.fromRevision > currentRevision) {
          throw new ConvergeError("INVALID_PROTOCOL", "Invalid protocol message");
        }
        const commits = history.filter(
          (commit) => commit.revision > request.fromRevision,
        );
        const complete =
          commits.length === currentRevision - request.fromRevision &&
          (commits.length === 0 ||
            commits[0]?.revision === request.fromRevision + 1);

        if (!request.forceSnapshot && complete) {
          return {
            protocol: 1,
            type: "CATCH_UP",
            storeId,
            sessionId: request.sessionId,
            fromRevision: request.fromRevision,
            throughRevision: currentRevision,
            commits,
          };
        }
        return {
          protocol: 1,
          type: "SNAPSHOT",
          storeId,
          sessionId: request.sessionId,
          snapshot: runtime.getSnapshot(),
        };
      } catch (error) {
        return protocolError(error);
      }
    },

    detach(sessionId) {
      sessions.delete(sessionId);
    },
  };
}

function commandFailure(
  request: {
    readonly storeId: string;
    readonly sessionId: string;
    readonly commandId: string;
  },
  error: unknown,
): CommandResult<never> {
  return {
    protocol: 1,
    type: "COMMAND_RESULT",
    storeId: request.storeId,
    sessionId: request.sessionId,
    commandId: request.commandId,
    ok: false,
    error: serializeError(error),
  };
}

function protocolError(error: unknown): ProtocolError {
  return {
    protocol: 1,
    type: "PROTOCOL_ERROR",
    error: serializeError(error),
  };
}
