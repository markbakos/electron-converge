import { ConvergeError, errorFromCode } from "../errors.js";
import { createReplica } from "../replica/create-replica.js";
import type { Replica } from "../replica/types.js";
import type { DeepReadonly } from "../wire/types.js";
import type { ProtocolTransport } from "./transport.js";
import {
  parseAttached,
  parseCommandResult,
  parseProtocolCommit,
  parseProtocolError,
  parseRecoveryResult,
} from "./validation.js";

const MAX_BUFFERED_COMMITS = 64;

export interface ProtocolClient<State extends object> {
  getState(): DeepReadonly<State>;
  getRevision(): number;
  select<Selected>(selector: (state: DeepReadonly<State>) => Selected): Selected;
  subscribe(listener: () => void): () => void;
  getStatus(): ProtocolClientStatus;
  subscribeStatus(listener: () => void): () => void;
  dispatch(action: string, input: unknown): Promise<unknown>;
  close(): void;
}

export type ProtocolClientStatus =
  | "ready"
  | "recovering"
  | "stale"
  | "closed";

export async function connectProtocolClient<State extends object>(
  transport: ProtocolTransport,
  storeId: string,
  sessionId: string,
  nextCommandId?: () => string,
): Promise<ProtocolClient<State>> {
  let replica: Replica<State> | undefined;
  let closed = false;
  let commandNumber = 0;
  let forceSnapshot = false;
  let recovery: Promise<void> | undefined;
  let terminalError: ConvergeError | undefined;
  let status: ProtocolClientStatus = "ready";
  const bufferedCommits: unknown[] = [];
  const statusListeners = new Set<() => void>();

  const setStatus = (nextStatus: ProtocolClientStatus): void => {
    if (status === "closed") return;
    if (status === nextStatus) return;
    status = nextStatus;
    for (const listener of statusListeners) {
      try {
        listener();
      } catch {
        // Observer failures cannot alter protocol lifecycle.
      }
    }
  };

  const becomeStale = (error: ConvergeError): ConvergeError => {
    terminalError = error;
    setStatus("stale");
    return error;
  };

  const applyCommit = (value: unknown): boolean => {
    if (!replica) return false;
    try {
      return (
        replica.ingest(parseProtocolCommit<State>(value, storeId)).status !==
        "gap"
      );
    } catch {
      forceSnapshot = true;
      return false;
    }
  };

  const beginRecovery = (snapshotOnly = false): void => {
    forceSnapshot ||= snapshotOnly;
    if (!replica || recovery || terminalError || closed) return;
    setStatus("recovering");

    recovery = (async () => {
      try {
        while (!closed) {
          const snapshotOnly = forceSnapshot;
          forceSnapshot = false;
          const responseValue = await transport.recover({
            protocol: 1,
            type: "RECOVER",
            storeId,
            sessionId,
            fromRevision: replica.getRevision(),
            forceSnapshot: snapshotOnly,
          });
          if (closed) return;

          const responseError = parseProtocolError(responseValue);
          if (responseError) throw errorFromCode(responseError.error.code);
          const response = parseRecoveryResult<State>(
            responseValue,
            storeId,
            sessionId,
          );

          if (response.type === "SNAPSHOT") {
            replica.replace(response.snapshot);
            if (replica.getRevision() !== response.snapshot.revision) {
              throw errorFromCode("RECOVERY_FAILED");
            }
          } else {
            if (response.fromRevision !== replica.getRevision()) {
              throw errorFromCode("RECOVERY_FAILED");
            }
            for (const commit of response.commits) {
              if (replica.ingest(commit).status !== "applied") {
                throw errorFromCode("RECOVERY_FAILED");
              }
            }
            if (replica.getRevision() !== response.throughRevision) {
              throw errorFromCode("RECOVERY_FAILED");
            }
          }

          const pending = bufferedCommits.splice(0);
          if (!forceSnapshot) {
            let gap = false;
            for (const commit of pending) {
              if (!applyCommit(commit)) {
                gap = true;
                break;
              }
            }
            if (!gap) {
              setStatus("ready");
              return;
            }
          }
        }
      } catch {
        throw becomeStale(errorFromCode("RECOVERY_FAILED"));
      } finally {
        recovery = undefined;
      }
    })();
    void recovery.catch(() => undefined);
  };

  const acceptCommit = (value: unknown): void => {
    if (closed || terminalError) return;
    if (!replica || recovery) {
      if (bufferedCommits.length === MAX_BUFFERED_COMMITS) {
        bufferedCommits.length = 0;
        forceSnapshot = true;
      }
      if (!forceSnapshot) bufferedCommits.push(value);
    } else if (!applyCommit(value)) {
      beginRecovery(forceSnapshot);
    }
  };

  const unsubscribe = transport.onCommit(acceptCommit);
  const closeTransport = (): void => {
    if (closed) return;
    closed = true;
    setStatus("closed");
    statusListeners.clear();
    unsubscribe();
    transport.close();
  };
  try {
    const attachedValue = await transport.attach({
      protocol: 1,
      type: "ATTACH",
      storeId,
      sessionId,
    });
    const attachedError = parseProtocolError(attachedValue);
    if (attachedError) throw errorFromCode(attachedError.error.code);

    const attached = parseAttached<State>(attachedValue, storeId, sessionId);
    replica = createReplica(attached.snapshot);
    if (forceSnapshot) beginRecovery(true);
    else for (const commit of bufferedCommits.splice(0)) acceptCommit(commit);
    if (recovery) await recovery;
  } catch (error) {
    closeTransport();
    throw error;
  }

  const currentReplica = (): Replica<State> => {
    if (!replica) throw new ConvergeError("INVALID_STATE", "Invalid state");
    return replica;
  };

  return {
    getState: () => currentReplica().getState(),
    getRevision: () => currentReplica().getRevision(),
    select: (selector) => currentReplica().select(selector),
    subscribe: (listener) => currentReplica().subscribe(listener),
    getStatus: () => status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    async dispatch(action, input) {
      if (closed) throw new ConvergeError("STALE_SESSION", "Stale session");
      if (recovery) await recovery;
      if (closed) throw new ConvergeError("STALE_SESSION", "Stale session");
      if (terminalError) throw terminalError;
      const commandId = nextCommandId?.() ?? `${sessionId}:${++commandNumber}`;
      let responseValue: unknown;
      try {
        responseValue = await transport.command({
          protocol: 1,
          type: "COMMAND",
          storeId,
          sessionId,
          commandId,
          action,
          input,
        });
      } catch {
        throw becomeStale(errorFromCode("OUTCOME_UNKNOWN"));
      }
      let responseError: ReturnType<typeof parseProtocolError>;
      try {
        responseError = parseProtocolError(responseValue);
      } catch {
        throw becomeStale(errorFromCode("OUTCOME_UNKNOWN"));
      }
      if (responseError) throw errorFromCode(responseError.error.code);

      let response: ReturnType<typeof parseCommandResult<State>>;
      try {
        response = parseCommandResult<State>(
          responseValue,
          storeId,
          sessionId,
          commandId,
        );
      } catch {
        throw becomeStale(errorFromCode("OUTCOME_UNKNOWN"));
      }
      if (!response.ok) throw errorFromCode(response.error.code);

      acceptCommit(response.commit);
      if (recovery) await recovery;
      if (terminalError) throw terminalError;
      if (currentReplica().getRevision() < response.commit.revision) {
        throw becomeStale(errorFromCode("RECOVERY_FAILED"));
      }
      return response.result;
    },
    close: closeTransport,
  };
}
