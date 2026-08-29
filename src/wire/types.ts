export type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value;

export interface CoreCommit<State extends object> {
  readonly protocol: 1;
  readonly type: "COMMIT";
  readonly storeId: string;
  readonly baseRevision: number;
  readonly revision: number;
  readonly changed: Partial<DeepReadonly<State>>;
}

export interface Snapshot<State extends object> {
  readonly storeId: string;
  readonly revision: number;
  readonly state: DeepReadonly<State>;
}
