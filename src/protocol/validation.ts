import { ConvergeError, isErrorCode } from "../errors.js";
import type { SerializedConvergeError } from "../errors.js";
import { cloneWire, isPlainRecord } from "../wire/validation.js";
import type {
  AttachRequest,
  Attached,
  CommandRequest,
  CommandResult,
  ProtocolCommit,
  ProtocolError,
  RecoverRequest,
  RecoveryResult,
} from "./messages.js";

const attachKeys = ["protocol", "type", "storeId", "sessionId"];
const commandKeys = [
  "protocol",
  "type",
  "storeId",
  "sessionId",
  "commandId",
  "action",
  "input",
];
const recoverKeys = [
  "protocol",
  "type",
  "storeId",
  "sessionId",
  "fromRevision",
  "forceSnapshot",
];
const attachedKeys = ["protocol", "type", "storeId", "sessionId", "snapshot"];
const commitKeys = [
  "protocol",
  "type",
  "storeId",
  "baseRevision",
  "revision",
  "changed",
  "commandId",
  "sourceSessionId",
];
const commandSuccessKeys = [
  "protocol",
  "type",
  "storeId",
  "sessionId",
  "commandId",
  "ok",
  "result",
  "commit",
];
const commandFailureKeys = [
  "protocol",
  "type",
  "storeId",
  "sessionId",
  "commandId",
  "ok",
  "error",
];
const catchUpKeys = [
  "protocol",
  "type",
  "storeId",
  "sessionId",
  "fromRevision",
  "throughRevision",
  "commits",
];
const snapshotKeys = ["protocol", "type", "storeId", "sessionId", "snapshot"];
const protocolErrorKeys = ["protocol", "type", "error"];
const serializedErrorKeys = ["code", "message"];

export function parseAttachRequest(value: unknown): AttachRequest {
  const request = parseRecord(value, attachKeys);
  if (
    request.protocol !== 1 ||
    request.type !== "ATTACH" ||
    !isIdentifier(request.storeId) ||
    !isIdentifier(request.sessionId)
  ) {
    throw invalidProtocol();
  }
  return request as unknown as AttachRequest;
}

export function parseCommandRequest(value: unknown): CommandRequest {
  const request = parseRecord(value, commandKeys);
  if (
    request.protocol !== 1 ||
    request.type !== "COMMAND" ||
    !isIdentifier(request.storeId) ||
    !isIdentifier(request.sessionId) ||
    !isIdentifier(request.commandId) ||
    !isIdentifier(request.action)
  ) {
    throw invalidProtocol();
  }
  return request as unknown as CommandRequest;
}

export function parseRecoverRequest(value: unknown): RecoverRequest {
  const request = parseRecord(value, recoverKeys);
  if (
    request.protocol !== 1 ||
    request.type !== "RECOVER" ||
    !isIdentifier(request.storeId) ||
    !isIdentifier(request.sessionId) ||
    !Number.isSafeInteger(request.fromRevision) ||
    (request.fromRevision as number) < 0 ||
    typeof request.forceSnapshot !== "boolean"
  ) {
    throw invalidProtocol();
  }
  return request as unknown as RecoverRequest;
}

export function parseAttached<State extends object>(
  value: unknown,
  storeId: string,
  sessionId: string,
): Attached<State> {
  const response = parseRecord(value, attachedKeys);
  if (
    response.protocol !== 1 ||
    response.type !== "ATTACHED" ||
    response.storeId !== storeId ||
    response.sessionId !== sessionId
  ) {
    throw invalidProtocol();
  }
  return response as unknown as Attached<State>;
}

export function parseCommandResult<State extends object>(
  value: unknown,
  storeId: string,
  sessionId: string,
  commandId: string,
): CommandResult<State> {
  const cloned = cloneWire(value, "INVALID_PROTOCOL", "Invalid protocol message");
  if (!isPlainRecord(cloned) || typeof cloned.ok !== "boolean") {
    throw invalidProtocol();
  }
  const response = parseRecord(
    cloned,
    cloned.ok ? commandSuccessKeys : commandFailureKeys,
  );
  if (
    response.protocol !== 1 ||
    response.type !== "COMMAND_RESULT" ||
    response.storeId !== storeId ||
    response.sessionId !== sessionId ||
    response.commandId !== commandId
  ) {
    throw invalidProtocol();
  }
  if (response.ok) {
    parseProtocolCommit<State>(response.commit, storeId);
  } else {
    parseSerializedError(response.error);
  }
  return response as unknown as CommandResult<State>;
}

export function parseProtocolCommit<State extends object>(
  value: unknown,
  storeId: string,
): ProtocolCommit<State> {
  const commit = parseRecord(value, commitKeys);
  if (
    commit.protocol !== 1 ||
    commit.type !== "COMMIT" ||
    commit.storeId !== storeId ||
    !isIdentifier(commit.commandId) ||
    !isIdentifier(commit.sourceSessionId)
  ) {
    throw invalidProtocol();
  }
  return commit as unknown as ProtocolCommit<State>;
}

export function parseRecoveryResult<State extends object>(
  value: unknown,
  storeId: string,
  sessionId: string,
): RecoveryResult<State> {
  const cloned = cloneWire(value, "INVALID_PROTOCOL", "Invalid protocol message");
  if (!isPlainRecord(cloned)) throw invalidProtocol();

  if (cloned.type === "CATCH_UP") {
    const response = parseRecord(cloned, catchUpKeys);
    if (
      response.protocol !== 1 ||
      response.storeId !== storeId ||
      response.sessionId !== sessionId ||
      !isRevision(response.fromRevision) ||
      !isRevision(response.throughRevision) ||
      response.throughRevision < response.fromRevision ||
      !Array.isArray(response.commits)
    ) {
      throw invalidProtocol();
    }
    for (const commit of response.commits) {
      parseProtocolCommit<State>(commit, storeId);
    }
    return response as unknown as RecoveryResult<State>;
  }

  const response = parseRecord(cloned, snapshotKeys);
  if (
    response.protocol !== 1 ||
    response.type !== "SNAPSHOT" ||
    response.storeId !== storeId ||
    response.sessionId !== sessionId
  ) {
    throw invalidProtocol();
  }
  return response as unknown as RecoveryResult<State>;
}

export function parseProtocolError(value: unknown): ProtocolError | undefined {
  const cloned = cloneWire(value, "INVALID_PROTOCOL", "Invalid protocol message");
  if (!isPlainRecord(cloned) || cloned.type !== "PROTOCOL_ERROR") {
    return undefined;
  }
  const response = parseRecord(cloned, protocolErrorKeys);
  parseSerializedError(response.error);
  return response as unknown as ProtocolError;
}

function parseRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  const record = cloneWire(value, "INVALID_PROTOCOL", "Invalid protocol message");
  if (
    !isPlainRecord(record) ||
    Reflect.ownKeys(record).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(record, key))
  ) {
    throw invalidProtocol();
  }
  return record;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseSerializedError(value: unknown): SerializedConvergeError {
  const error = parseRecord(value, serializedErrorKeys);
  if (!isErrorCode(error.code) || typeof error.message !== "string") {
    throw invalidProtocol();
  }
  return error as unknown as SerializedConvergeError;
}

function invalidProtocol(): ConvergeError {
  return new ConvergeError("INVALID_PROTOCOL", "Invalid protocol message");
}
