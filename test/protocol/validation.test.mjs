import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAttachRequest,
  parseProtocolError,
} from "../../dist/protocol/validation.js";

test("protocol validation rejects malformed records without invoking accessors", () => {
  let accessorInvoked = false;
  const accessor = {};
  Object.defineProperty(accessor, "type", {
    enumerable: true,
    get() {
      accessorInvoked = true;
      return "PROTOCOL_ERROR";
    },
  });

  assert.throws(
    () => parseProtocolError(accessor),
    (error) => error.code === "INVALID_PROTOCOL",
  );
  assert.equal(accessorInvoked, false);
  assert.throws(
    () =>
      parseAttachRequest({
        protocol: 1,
        type: "ATTACH",
        storeId: "counter",
        sessionId: "session-a",
        extra: true,
      }),
    (error) => error.code === "INVALID_PROTOCOL",
  );
});

test("protocol validation rejects oversized and control-character identifiers", () => {
  for (const sessionId of ["x".repeat(129), "session\nother"]) {
    assert.throws(
      () =>
        parseAttachRequest({
          protocol: 1,
          type: "ATTACH",
          storeId: "counter",
          sessionId,
        }),
      (error) => error.code === "INVALID_PROTOCOL",
    );
  }
});
