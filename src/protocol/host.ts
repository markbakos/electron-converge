import { ConvergeError, serializeError } from "../errors.js";
import type { ActionMap, CanonicalStore, DispatchResult } from "../store/types.js";
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

interface Session<State extends object> {
  readonly send: (commit: ProtocolCommit<State>) => void;
}

export interface ProtocolHost<State extends object> {
  attach(
    request: unknown,
    send: (commit: ProtocolCommit<State>) => void,
  ): Attached<State> | ProtocolError;
  command(request: unknown): CommandResult<State> | ProtocolError;
  recover(request: unknown): RecoveryResult<State> | ProtocolError;
  detach(sessionId: string): void;
}

export function createProtocolHost<
  State extends object,
  Actions extends ActionMap<State>,
>(store: CanonicalStore<State, Actions>): ProtocolHost<State> {
  const storeId = store.getSnapshot().storeId;
  const sessions = new Map<string, Session<State>>();
  const history: ProtocolCommit<State>[] = [];
  const dispatch = store.dispatch as (
    action: string,
    input: unknown,
  ) => DispatchResult<State, unknown>;

  return {
    attach(value, send) {
      try {
        const request = parseAttachRequest(value);
        if (request.storeId !== storeId) {
          throw new ConvergeError("INVALID_STORE", "Invalid store");
        }
        if (sessions.has(request.sessionId)) {
          throw new ConvergeError("STALE_SESSION", "Stale session");
        }

        sessions.set(request.sessionId, { send });
        return {
          protocol: 1,
          type: "ATTACHED",
          storeId,
          sessionId: request.sessionId,
          snapshot: store.getSnapshot(),
        };
      } catch (error) {
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
        const dispatched = dispatch(request.action, request.input);
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

        const currentRevision = store.getRevision();
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
          snapshot: store.getSnapshot(),
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
