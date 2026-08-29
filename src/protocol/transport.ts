import type {
  AttachRequest,
  CommandRequest,
  RecoverRequest,
} from "./messages.js";

export interface ProtocolTransport {
  onCommit(listener: (commit: unknown) => void): () => void;
  attach(request: AttachRequest): Promise<unknown>;
  command(request: CommandRequest): Promise<unknown>;
  recover(request: RecoverRequest): Promise<unknown>;
  close(): void;
}
