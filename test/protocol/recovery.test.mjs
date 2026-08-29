import assert from "node:assert/strict";
import test from "node:test";

import { connectClient, createProtocolHarness } from "./harness.mjs";

test("an out-of-order revision catches up without fabricating a chain", async () => {
  const harness = createProtocolHarness();
  const writer = await connectClient(harness, "writer");
  const follower = await connectClient(harness, "follower");

  const first = writer.dispatch("increment", 1);
  await harness.deliverNext("command", "writer");
  assert.equal(await first, 1);

  const second = writer.dispatch("increment", 1);
  harness.deferNext("commit", "follower");
  await harness.deliverNext("commit", "follower");
  assert.equal(follower.getRevision(), 0);
  assert.equal(harness.pending("recover", "follower"), 1);

  await harness.deliverNext("recover", "follower");
  assert.equal(follower.getRevision(), 2);
  assert.equal(follower.getState().counter.value, 2);

  await harness.deliverNext("commit", "follower");
  assert.equal(follower.getRevision(), 2);

  await harness.deliverAll();
  assert.equal(await second, 2);
});

test("commits racing recovery are buffered and installed afterward", async () => {
  const harness = createProtocolHarness();
  const writer = await connectClient(harness, "writer");
  const follower = await connectClient(harness, "follower");

  const first = writer.dispatch("increment", 1);
  harness.dropNext("commit", "follower");
  await harness.deliverNext("command", "writer");
  await first;

  const second = writer.dispatch("increment", 1);
  await harness.deliverNext("commit", "follower");
  assert.equal(harness.pending("recover", "follower"), 1);

  const third = writer.dispatch("increment", 1);
  await harness.deliverNext("commit", "follower");
  assert.equal(follower.getRevision(), 0);

  await harness.deliverNext("recover", "follower");
  assert.equal(follower.getRevision(), 3);
  assert.equal(follower.getState().counter.value, 3);

  await harness.deliverAll();
  assert.equal(await second, 2);
  assert.equal(await third, 3);
});

test("a full recovery queue discards deltas and requests a snapshot", async () => {
  const harness = createProtocolHarness();
  const writer = await connectClient(harness, "writer");
  const follower = await connectClient(harness, "follower");

  const first = writer.dispatch("increment", 1);
  harness.dropNext("commit", "follower");
  await harness.deliverNext("commit", "writer");
  await harness.deliverNext("command", "writer");
  await first;

  const second = writer.dispatch("increment", 1);
  await harness.deliverNext("commit", "writer");
  await harness.deliverNext("commit", "follower");
  await harness.deliverNext("command", "writer");
  await second;

  for (let revision = 3; revision <= 67; revision += 1) {
    const action = writer.dispatch("increment", 1);
    await harness.deliverNext("commit", "writer");
    await harness.deliverNext("commit", "follower");
    await harness.deliverNext("command", "writer");
    await action;
  }

  await harness.deliverNext("recover", "follower");
  assert.equal(harness.pending("recover", "follower"), 1);
  await harness.deliverNext("recover", "follower");

  assert.equal(follower.getRevision(), 67);
  assert.equal(follower.getState().counter.value, 67);
});

test("an evicted gap replaces the replica from an authoritative snapshot", async () => {
  const harness = createProtocolHarness();
  const writer = await connectClient(harness, "writer");
  const follower = await connectClient(harness, "follower");

  for (let revision = 1; revision <= 65; revision += 1) {
    const action = writer.dispatch("increment", 1);
    harness.dropNext("commit", "follower");
    harness.dropNext("commit", "writer");
    await harness.deliverNext("command", "writer");
    await action;
  }

  const action = writer.dispatch("increment", 1);
  harness.dropNext("commit", "writer");
  await harness.deliverNext("commit", "follower");
  await harness.deliverNext("recover", "follower");

  assert.equal(follower.getRevision(), 66);
  assert.equal(follower.getState().counter.value, 66);

  await harness.deliverNext("command", "writer");
  assert.equal(await action, 66);
});
