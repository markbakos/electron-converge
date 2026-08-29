import assert from "node:assert/strict";
import test from "node:test";

import { runElectron } from "./run-electron.mjs";

test("real Electron preserves V1 consistency, lifecycle, React, and boundary claims", async () => {
  const { mode, result } = await runElectron("test");
  assert.equal(mode, "test");
  assert.ok(result.canonicalRevision >= 90);
  assert.equal(result.canonicalValue, result.canonicalRevision);
  assert.ok(result.catchUpRecoveries >= 1);
  assert.ok(result.snapshotRecoveries >= 1);
  assert.equal(result.droppedCommits, 65);
  assert.equal(result.reorderedCommits, 1);
  assert.ok(result.historyOperations >= 20);
  assert.ok(result.reactRenders >= 2);
});
