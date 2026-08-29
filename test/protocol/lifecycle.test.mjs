import assert from "node:assert/strict";
import test from "node:test";

import { connectProtocolClient } from "../../dist/protocol/client.js";
import { connectClient, createProtocolHarness } from "./harness.mjs";

test("a failed attachment releases its registered session", async () => {
  const harness = createProtocolHarness();
  const connecting = connectProtocolClient(
    harness.createTransport(),
    "counter",
    "session-a",
  );

  harness.failNext("attach", "session-a");
  await assert.rejects(connecting, /Transport failed/);

  const replacement = await connectClient(harness, "session-a");
  assert.equal(replacement.getRevision(), 0);
});

test("a lost response after commit rejects with an unknown canonical outcome", async () => {
  const harness = createProtocolHarness();
  const client = await connectClient(harness, "old-session");

  const action = client.dispatch("increment", 1);
  harness.failNext("command", "old-session");
  await assert.rejects(action, (error) => error.code === "OUTCOME_UNKNOWN");

  assert.equal(harness.store.getRevision(), 1);
  assert.equal(harness.store.getState().counter.value, 1);

  client.close();
  const stale = harness.host.command({
    protocol: 1,
    type: "COMMAND",
    storeId: "counter",
    sessionId: "old-session",
    commandId: "late-command",
    action: "increment",
    input: 1,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "STALE_SESSION");

  const replacement = await connectClient(harness, "new-session");
  assert.equal(replacement.getRevision(), 1);
  assert.equal(replacement.getState().counter.value, 1);
  await assert.rejects(
    client.dispatch("increment", 1),
    (error) => error.code === "STALE_SESSION",
  );
});

test("duplicate broadcasts install and notify only once", async () => {
  const harness = createProtocolHarness();
  const client = await connectClient(harness, "session-a");
  let notifications = 0;
  client.subscribe(() => {
    notifications += 1;
  });

  const action = client.dispatch("increment", 1);
  harness.duplicateNext("commit", "session-a");
  await harness.deliverNext("commit", "session-a");
  await harness.deliverNext("commit", "session-a");
  await harness.deliverNext("command", "session-a");

  assert.equal(await action, 1);
  assert.equal(notifications, 1);
});

test("recovery status is observable while reads keep the last valid snapshot", async () => {
  const harness = createProtocolHarness();
  const writer = await connectClient(harness, "writer");
  const follower = await connectClient(harness, "follower");
  const statuses = [];
  follower.subscribeStatus(() => {
    statuses.push(follower.getStatus());
  });

  const first = writer.dispatch("increment", 1);
  harness.dropNext("commit", "follower");
  await harness.deliverNext("command", "writer");
  await first;

  const second = writer.dispatch("increment", 1);
  await harness.deliverNext("commit", "follower");

  assert.equal(follower.getStatus(), "recovering");
  assert.equal(follower.getRevision(), 0);
  assert.equal(follower.getState().counter.value, 0);

  await harness.deliverNext("recover", "follower");
  assert.equal(follower.getStatus(), "ready");
  assert.equal(follower.getRevision(), 2);
  assert.equal(follower.getState().counter.value, 2);
  assert.deepEqual(statuses, ["recovering", "ready"]);

  await harness.deliverAll();
  assert.equal(await second, 2);
});

test("failed recovery leaves a stale readable replica and blocks actions", async () => {
  const harness = createProtocolHarness();
  const writer = await connectClient(harness, "writer");
  const follower = await connectClient(harness, "follower");

  const first = writer.dispatch("increment", 1);
  harness.dropNext("commit", "follower");
  await harness.deliverNext("command", "writer");
  await first;

  const second = writer.dispatch("increment", 1);
  await harness.deliverNext("commit", "follower");
  harness.failNext("recover", "follower");
  await Promise.resolve();

  assert.equal(follower.getStatus(), "stale");
  assert.equal(follower.getRevision(), 0);
  assert.equal(follower.getState().counter.value, 0);
  await assert.rejects(
    follower.dispatch("increment", 1),
    (error) => error.code === "RECOVERY_FAILED",
  );

  await harness.deliverAll();
  assert.equal(await second, 2);
});

test("closing during recovery remains closed after the transport settles", async () => {
  const harness = createProtocolHarness();
  const writer = await connectClient(harness, "writer");
  const follower = await connectClient(harness, "follower");

  const first = writer.dispatch("increment", 1);
  harness.dropNext("commit", "follower");
  await harness.deliverNext("command", "writer");
  await first;

  const second = writer.dispatch("increment", 1);
  await harness.deliverNext("commit", "follower");
  assert.equal(follower.getStatus(), "recovering");

  follower.close();
  await Promise.resolve();
  assert.equal(follower.getStatus(), "closed");
  await assert.rejects(
    follower.dispatch("increment", 1),
    (error) => error.code === "STALE_SESSION",
  );

  await harness.deliverAll();
  assert.equal(await second, 2);
});
