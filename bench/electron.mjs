import assert from "node:assert/strict";

import { runElectron } from "../test/run-electron.mjs";

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const samples = readOption("--samples", "30");
const warmup = readOption("--warmup", "5");
const { mode, result } = await runElectron(
  "benchmark",
  {
    CONVERGE_BENCH_SAMPLES: samples,
    CONVERGE_BENCH_WARMUP: warmup,
  },
  15 * 60_000,
);

assert.equal(mode, "benchmark");
assert.equal(result.matrix.length, 16);
for (const entry of result.matrix) {
  assert.equal(entry.completedSamples, Number.parseInt(samples, 10));
  for (const distribution of [
    entry.acknowledgementMs,
    entry.propagationMs,
    entry.reactNotificationMs,
    entry.structuredCloneMs,
  ]) {
    assert.ok(Number.isFinite(distribution.p50));
    assert.ok(Number.isFinite(distribution.p95));
    assert.ok(Number.isFinite(distribution.p99));
    assert.ok(distribution.p50 <= distribution.p95);
    assert.ok(distribution.p95 <= distribution.p99);
  }
}
assert.ok(result.recoverySamples >= 1);
assert.ok(Number.isFinite(result.recoveryMs.catchUp.p99));
assert.ok(Number.isFinite(result.recoveryMs.snapshot.p99));

console.log(JSON.stringify(result, null, 2));
