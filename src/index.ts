export {
  ConvergeError,
  serializeError,
} from "./errors.js";
export type {
  ErrorCode,
  SerializedConvergeError,
} from "./errors.js";

export {
  createCanonicalStore,
  defineStore,
} from "./store/create-canonical-store.js";
export type {
  ActionOutcome,
  ActionReducer,
  CanonicalStore,
  DispatchResult,
  StoreDefinition,
} from "./store/types.js";

export { createReplica } from "./replica/create-replica.js";
export type { IngestResult, Replica } from "./replica/types.js";

export type {
  CoreCommit,
  DeepReadonly,
  Snapshot,
} from "./wire/types.js";
