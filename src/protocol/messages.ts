import type { SerializedConvergeError } from "../errors.js";
import type { CoreCommit, DeepReadonly, Snapshot } from "../wire/types.js";

export interface AttachRequest {
  readonly protocol: 1;
  readonly type: "ATTACH";
  readonly storeId: string;
  readonly sessionId: string;
}

export interface Attached<State extends object> {
  readonly protocol: 1;
  readonly type: "ATTACHED";
  readonly storeId: string;
  readonly sessionId: string;
  readonly snapshot: Snapshot<State>;
}

export interface CommandRequest {
  readonly protocol: 1;
  readonly type: "COMMAND";
  readonly storeId: string;
  readonly sessionId: string;
  readonly commandId: string;
  readonly action: string;
  readonly input: unknown;
}

export interface ProtocolCommit<State extends object>
  extends CoreCommit<State> {
  readonly commandId: string;
  readonly sourceSessionId: string;
}

export type CommandResult<State extends object> =
  | {
      readonly protocol: 1;
      readonly type: "COMMAND_RESULT";
      readonly storeId: string;
      readonly sessionId: string;
      readonly commandId: string;
      readonly ok: true;
      readonly result: DeepReadonly<unknown>;
      readonly commit: ProtocolCommit<State>;
    }
  | {
      readonly protocol: 1;
      readonly type: "COMMAND_RESULT";
      readonly storeId: string;
      readonly sessionId: string;
      readonly commandId: string;
      readonly ok: false;
      readonly error: SerializedConvergeError;
    };

export interface RecoverRequest {
  readonly protocol: 1;
  readonly type: "RECOVER";
  readonly storeId: string;
  readonly sessionId: string;
  readonly fromRevision: number;
  readonly forceSnapshot: boolean;
}

export type RecoveryResult<State extends object> =
  | {
      readonly protocol: 1;
      readonly type: "CATCH_UP";
      readonly storeId: string;
      readonly sessionId: string;
      readonly fromRevision: number;
      readonly throughRevision: number;
      readonly commits: readonly ProtocolCommit<State>[];
    }
  | {
      readonly protocol: 1;
      readonly type: "SNAPSHOT";
      readonly storeId: string;
      readonly sessionId: string;
      readonly snapshot: Snapshot<State>;
    };

export interface ProtocolError {
  readonly protocol: 1;
  readonly type: "PROTOCOL_ERROR";
  readonly error: SerializedConvergeError;
}
