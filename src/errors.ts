export type ErrorCode =
  | "ACTION_FAILED"
  | "ASYNC_REDUCER"
  | "INTERNAL_ERROR"
  | "INVALID_COMMIT"
  | "INVALID_INPUT"
  | "INVALID_PROTOCOL"
  | "INVALID_STATE"
  | "INVALID_STORE"
  | "RECOVERY_FAILED"
  | "REVISION_EXHAUSTED"
  | "SERIALIZATION_FAILED"
  | "STALE_SESSION"
  | "UNKNOWN_ACTION";

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ACTION_FAILED: "Action failed",
  ASYNC_REDUCER: "Reducers must be synchronous",
  INTERNAL_ERROR: "Internal error",
  INVALID_COMMIT: "Invalid commit",
  INVALID_INPUT: "Invalid action input",
  INVALID_PROTOCOL: "Invalid protocol message",
  INVALID_STATE: "Invalid state",
  INVALID_STORE: "Invalid store",
  RECOVERY_FAILED: "Recovery failed",
  REVISION_EXHAUSTED: "Revision limit reached",
  SERIALIZATION_FAILED: "Serialization failed",
  STALE_SESSION: "Stale session",
  UNKNOWN_ACTION: "Unknown action",
};

export class ConvergeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ConvergeError";
    this.code = code;
  }
}

export interface SerializedConvergeError {
  readonly code: ErrorCode;
  readonly message: string;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_MESSAGES, value);
}

export function errorFromCode(code: ErrorCode): ConvergeError {
  return new ConvergeError(code, ERROR_MESSAGES[code]);
}

export function serializeError(error: unknown): SerializedConvergeError {
  if (error instanceof ConvergeError) {
    const code: unknown = error.code;
    if (isErrorCode(code)) {
      return { code, message: ERROR_MESSAGES[code] };
    }
  }
  return { code: "INTERNAL_ERROR", message: "Internal error" };
}
