import { ConvergeError } from "../errors.js";
import type { ErrorCode } from "../errors.js";

declare const structuredClone: <Value>(value: Value) => Value;

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

function inspectWire(value: unknown, seen: WeakSet<object>): void {
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
      inspectDescriptor(Object.getOwnPropertyDescriptor(value, key), seen);
    }
    seen.delete(value);
    return;
  }
  if (!isPlainRecord(value)) throw new TypeError();

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || isUnsafeKey(key)) throw new TypeError();
    inspectDescriptor(Object.getOwnPropertyDescriptor(value, key), seen);
  }
  seen.delete(value);
}

function inspectDescriptor(
  descriptor: PropertyDescriptor | undefined,
  seen: WeakSet<object>,
): void {
  if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError();
  inspectWire(descriptor.value, seen);
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
