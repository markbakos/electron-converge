import { ConvergeError } from "../errors.js";
import type { ErrorCode } from "../errors.js";
import type {
  CoreCommit,
  DeepReadonly,
  Snapshot,
} from "../wire/types.js";
import { cloneWire, isPlainRecord } from "../wire/validation.js";
import type { Replica } from "./types.js";

export function createReplica<State extends object>(
  initialSnapshot: Snapshot<State>,
): Replica<State> {
  const initial = parseSnapshot<State>(
    initialSnapshot,
    "INVALID_STATE",
    "Invalid snapshot",
  );
  const sliceNames = Object.keys(initial.state);
  const storeId = initial.storeId;
  let state = initial.state;
  let revision = initial.revision;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Subscriber failures cannot roll back an installed revision.
      }
    }
  };

  return {
    getState: () => state,
    getRevision: () => revision,
    select: (selector) => selector(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ingest(commit) {
      const incoming = parseCommit<State>(commit, storeId, sliceNames);

      if (incoming.revision <= revision) {
        return { status: "duplicate", revision };
      }
      if (incoming.baseRevision !== revision) {
        return {
          status: "gap",
          expectedRevision: revision + 1,
          receivedRevision: incoming.revision,
        };
      }

      state = Object.freeze({
        ...state,
        ...incoming.changed,
      }) as DeepReadonly<State>;
      revision = incoming.revision;
      notify();
      return { status: "applied", revision };
    },
    replace(snapshot) {
      const incoming = parseSnapshot<State>(
        snapshot,
        "INVALID_COMMIT",
        "Invalid snapshot",
      );
      if (incoming.storeId !== storeId) {
        throw new ConvergeError("INVALID_COMMIT", "Invalid snapshot");
      }
      const incomingSliceNames = Object.keys(incoming.state);
      if (
        incomingSliceNames.length !== sliceNames.length ||
        incomingSliceNames.some((name) => !sliceNames.includes(name))
      ) {
        throw new ConvergeError("INVALID_COMMIT", "Invalid snapshot");
      }
      if (incoming.revision <= revision) {
        return { status: "duplicate", revision };
      }

      state = incoming.state;
      revision = incoming.revision;
      notify();
      return { status: "applied", revision };
    },
  };
}

function parseCommit<State extends object>(
  commit: unknown,
  storeId: string,
  sliceNames: readonly string[],
): CoreCommit<State> {
  const incoming = cloneWire(commit, "INVALID_COMMIT", "Invalid commit");
  if (
    !isPlainRecord(incoming) ||
    incoming.protocol !== 1 ||
    incoming.type !== "COMMIT" ||
    incoming.storeId !== storeId ||
    !isPlainRecord(incoming.changed)
  ) {
    throw new ConvergeError("INVALID_COMMIT", "Invalid commit");
  }
  validateRevision(incoming.baseRevision, "INVALID_COMMIT", "Invalid commit");
  validateRevision(incoming.revision, "INVALID_COMMIT", "Invalid commit");
  if (incoming.revision !== incoming.baseRevision + 1) {
    throw new ConvergeError("INVALID_COMMIT", "Invalid commit");
  }

  const allowed = new Set(sliceNames);
  const names = Object.keys(incoming.changed);
  if (names.some((name) => !allowed.has(name))) {
    throw new ConvergeError("INVALID_COMMIT", "Invalid commit");
  }
  return incoming as unknown as CoreCommit<State>;
}

function parseSnapshot<State extends object>(
  snapshot: unknown,
  code: ErrorCode,
  message: string,
): Snapshot<State> {
  const incoming = cloneWire(snapshot, code, message);
  if (
    !isPlainRecord(incoming) ||
    typeof incoming.storeId !== "string" ||
    incoming.storeId.length === 0 ||
    !isPlainRecord(incoming.state)
  ) {
    throw new ConvergeError(code, message);
  }
  validateRevision(incoming.revision, code, message);
  return incoming as unknown as Snapshot<State>;
}

function validateRevision(
  value: unknown,
  code: ErrorCode,
  message: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ConvergeError(code, message);
  }
}
