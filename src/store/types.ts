import type {
  CoreCommit,
  DeepReadonly,
  Snapshot,
} from "../wire/types.js";

export interface ActionOutcome<State extends object, Result> {
  readonly state: DeepReadonly<State>;
  readonly result: Result;
}

export type ActionReducer<State extends object, Input, Result> = (
  state: DeepReadonly<State>,
  input: DeepReadonly<Input>,
) => ActionOutcome<State, Result>;

export type ActionMap<State extends object> = Record<
  string,
  ActionReducer<State, never, unknown>
>;

type ActionInput<Action extends (...args: never[]) => unknown> =
  Parameters<Action>[1];

type ActionResult<Action extends (...args: never[]) => unknown> =
  ReturnType<Action> extends ActionOutcome<object, infer Result>
    ? Result
    : never;

export interface StoreDefinition<
  State extends object,
  Actions extends ActionMap<State>,
> {
  readonly id: string;
  readonly initialState: State;
  readonly actions: Actions;
}

export interface DispatchResult<State extends object, Result> {
  readonly result: DeepReadonly<Result>;
  readonly commit: CoreCommit<State>;
}

export interface CanonicalStore<
  State extends object,
  Actions extends ActionMap<State>,
> {
  getState(): DeepReadonly<State>;
  getRevision(): number;
  getSnapshot(): Snapshot<State>;
  dispatch<Name extends keyof Actions & string>(
    action: Name,
    input: ActionInput<Actions[Name]>,
  ): DispatchResult<State, ActionResult<Actions[Name]>>;
}
