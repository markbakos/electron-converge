export type ErrorCode =
  | "ACTION_FAILED"
  | "ASYNC_REDUCER"
  | "INTERNAL_ERROR"
  | "INVALID_COMMIT"
  | "INVALID_INPUT"
  | "INVALID_STATE"
  | "INVALID_STORE"
  | "REVISION_EXHAUSTED"
  | "SERIALIZATION_FAILED"
  | "UNKNOWN_ACTION";

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ACTION_FAILED: "Action failed",
  ASYNC_REDUCER: "Reducers must be synchronous",
  INTERNAL_ERROR: "Internal error",
  INVALID_COMMIT: "Invalid commit",
  INVALID_INPUT: "Invalid action input",
  INVALID_STATE: "Invalid state",
  INVALID_STORE: "Invalid store",
  REVISION_EXHAUSTED: "Revision limit reached",
  SERIALIZATION_FAILED: "Serialization failed",
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

export function serializeError(error: unknown): SerializedConvergeError {
  if (error instanceof ConvergeError) {
    const code: unknown = error.code;
    if (typeof code === "string" && Object.hasOwn(ERROR_MESSAGES, code)) {
      const safeCode = code as ErrorCode;
      return { code: safeCode, message: ERROR_MESSAGES[safeCode] };
    }
  }
  return { code: "INTERNAL_ERROR", message: "Internal error" };
}
