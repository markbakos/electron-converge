import type { DeepReadonly } from "../wire/types.js";

export type IngestResult =
  | { readonly status: "applied"; readonly revision: number }
  | { readonly status: "duplicate"; readonly revision: number }
  | {
      readonly status: "gap";
      readonly expectedRevision: number;
      readonly receivedRevision: number;
    };

export interface Replica<State extends object> {
  getState(): DeepReadonly<State>;
  getRevision(): number;
  select<Selected>(selector: (state: DeepReadonly<State>) => Selected): Selected;
  subscribe(listener: () => void): () => void;
  ingest(commit: unknown): IngestResult;
  replace(snapshot: unknown): IngestResult;
}
