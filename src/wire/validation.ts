import { ConvergeError } from "../errors.js";
import type { ErrorCode } from "../errors.js";

declare const structuredClone: <Value>(value: Value) => Value;

const INBOUND_LIMITS = Object.freeze({
  depth: 64,
  entries: 10_000,
  stringUnits: 4_000_000,
});

class WireLimitError extends Error {}

interface WireBudget {
  entries: number;
  stringUnits: number;
}

export function cloneInboundWire<Value>(value: Value): Value {
  try {
    inspectWire(value, new WeakSet<object>(), 0, {
      entries: 0,
      stringUnits: 0,
    });
    return deepFreeze(structuredClone(value));
  } catch (error) {
    if (error instanceof WireLimitError) {
      throw new ConvergeError("RESOURCE_LIMIT", "Resource limit exceeded");
    }
    throw new ConvergeError("INVALID_PROTOCOL", "Invalid protocol message");
  }
}

export function cloneWire<Value>(
  value: Value,
  code: ErrorCode,
  message: string,
): Value {
  validateWire(value, code, message);
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    throw new ConvergeError(code, message);
  }
}

export function validateWire(
  value: unknown,
  code: ErrorCode,
  message: string,
): void {
  try {
    inspectWire(value, new WeakSet<object>());
  } catch {
    throw new ConvergeError(code, message);
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function isWireIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}

function inspectWire(
  value: unknown,
  seen: WeakSet<object>,
  depth = 0,
  budget?: WireBudget,
): void {
  if (budget) {
    budget.entries += 1;
    if (
      depth > INBOUND_LIMITS.depth ||
      budget.entries > INBOUND_LIMITS.entries
    ) {
      throw new WireLimitError();
    }
    if (typeof value === "string") {
      countStringUnits(value, budget);
    }
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return;
  }
  if (typeof value !== "object" || seen.has(value)) throw new TypeError();
  seen.add(value);

  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      const index = typeof key === "string" ? Number(key) : -1;
      if (
        typeof key !== "string" ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= value.length ||
        String(index) !== key
      ) {
        throw new TypeError();
      }
      if (budget) countStringUnits(key, budget);
      inspectDescriptor(
        Object.getOwnPropertyDescriptor(value, key),
        seen,
        depth + 1,
        budget,
      );
    }
    seen.delete(value);
    return;
  }
  if (!isPlainRecord(value)) throw new TypeError();

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || isUnsafeKey(key)) throw new TypeError();
    if (budget) countStringUnits(key, budget);
    inspectDescriptor(
      Object.getOwnPropertyDescriptor(value, key),
      seen,
      depth + 1,
      budget,
    );
  }
  seen.delete(value);
}

function countStringUnits(value: string, budget: WireBudget): void {
  budget.stringUnits += value.length;
  if (budget.stringUnits > INBOUND_LIMITS.stringUnits) {
    throw new WireLimitError();
  }
}

function inspectDescriptor(
  descriptor: PropertyDescriptor | undefined,
  seen: WeakSet<object>,
  depth: number,
  budget?: WireBudget,
): void {
  if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError();
  inspectWire(descriptor.value, seen, depth, budget);
}

function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}
