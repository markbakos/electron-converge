import assert from "node:assert/strict";
import test from "node:test";

import { cloneInboundWire } from "../dist/wire/validation.js";

test("inbound wire validation rejects depth, entry, and string resource limits", () => {
  let deep = null;
  for (let index = 0; index < 65; index += 1) deep = { child: deep };

  for (const value of [
    deep,
    Array.from({ length: 10_000 }, () => 0),
    "x".repeat(4_000_001),
    { ["x".repeat(4_000_001)]: 0 },
  ]) {
    assert.throws(
      () => cloneInboundWire(value),
      (error) => error.code === "RESOURCE_LIMIT",
    );
  }
});
