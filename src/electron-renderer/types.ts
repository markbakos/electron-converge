import type {
  AttachRequest,
  CommandRequest,
  RecoverRequest,
} from "../protocol/messages.js";
import type { DeepReadonly } from "../wire/types.js";

export interface RendererBridge {
  onCommit(listener: (commit: unknown) => void): () => void;
  attach(request: AttachRequest): Promise<unknown>;
  command(request: CommandRequest): Promise<unknown>;
  recover(request: RecoverRequest): Promise<unknown>;
}

export type RendererStoreStatus =
  | "ready"
  | "recovering"
  | "stale"
  | "closed";

export interface RendererStoreDefinition {
  readonly initialState: object;
  readonly actions: Readonly<
    Record<string, (...args: never[]) => { readonly result: unknown }>
  >;
}

type DefinitionState<Definition extends RendererStoreDefinition> =
  Definition["initialState"];

type DefinitionActions<Definition extends RendererStoreDefinition> =
  Definition["actions"];

type ActionInput<Action extends (...args: never[]) => unknown> =
  Parameters<Action>[1];

type ActionResult<Action extends (...args: never[]) => unknown> =
  ReturnType<Action> extends { readonly result: infer Result }
    ? DeepReadonly<Result>
    : never;

export interface RendererStore<Definition extends RendererStoreDefinition> {
  getState(): DeepReadonly<DefinitionState<Definition>>;
  getRevision(): number;
  select<Selected>(
    selector: (
      state: DeepReadonly<DefinitionState<Definition>>,
    ) => Selected,
  ): Selected;
  subscribe(listener: () => void): () => void;
  getStatus(): RendererStoreStatus;
  subscribeStatus(listener: () => void): () => void;
  dispatch<Name extends keyof DefinitionActions<Definition> & string>(
    action: Name,
    input: ActionInput<DefinitionActions<Definition>[Name]>,
  ): Promise<ActionResult<DefinitionActions<Definition>[Name]>>;
}

export interface RendererConnection {
  connectStore<Definition extends RendererStoreDefinition>(
    storeId: string,
  ): Promise<RendererStore<Definition>>;
  close(): void;
}
