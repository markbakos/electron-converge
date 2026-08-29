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
  await assert.rejects(action, /Transport failed/);

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
