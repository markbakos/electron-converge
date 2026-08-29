import assert from "node:assert/strict";
import test from "node:test";

import { ConvergeError, serializeError } from "../dist/index.js";

test("serialized errors expose stable public fields only", () => {
  assert.deepEqual(serializeError(new Error("private detail")), {
    code: "INTERNAL_ERROR",
    message: "Internal error",
  });
  assert.deepEqual(
    serializeError(new ConvergeError("INVALID_COMMIT", "private detail")),
    { code: "INVALID_COMMIT", message: "Invalid commit" },
  );

  const invalidCode = new ConvergeError("INVALID_COMMIT", "private detail");
  invalidCode.code = "CUSTOM";
  assert.deepEqual(serializeError(invalidCode), {
    code: "INTERNAL_ERROR",
    message: "Internal error",
  });
});
