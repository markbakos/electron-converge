import assert from "node:assert/strict";
import test from "node:test";

import { connectProtocolClient } from "../../dist/protocol/client.js";
import { connectClient, createProtocolHarness } from "./harness.mjs";

test("action resolves only after its canonical commit is locally installed", async () => {
  const harness = createProtocolHarness();
  const client = await connectClient(harness, "session-a");
  let notifications = 0;
  client.subscribe(() => {
    notifications += 1;
  });

  let settled = false;
  const action = client.dispatch("increment", 2).then((result) => {
    settled = true;
    return result;
  });

  assert.equal(harness.store.getRevision(), 1);
  assert.equal(client.getRevision(), 0);
  assert.equal(settled, false);

  await harness.deliverNext("command", "session-a");
  assert.equal(await action, 2);
  assert.equal(client.getRevision(), 1);
  assert.equal(client.getState().counter.value, 2);
  assert.equal(notifications, 1);

  await harness.deliverNext("commit", "session-a");
  assert.equal(notifications, 1);
});

test("broadcast may install a commit before its command response", async () => {
  const harness = createProtocolHarness();
  const client = await connectClient(harness, "session-a");
  let settled = false;
  const action = client.dispatch("increment", 1).then((result) => {
    settled = true;
    return result;
  });

  await harness.deliverNext("commit", "session-a");
  assert.equal(client.getRevision(), 1);
  assert.equal(settled, false);

  await harness.deliverNext("command", "session-a");
  assert.equal(await action, 1);
  assert.equal(client.getRevision(), 1);
});

test("concurrent clients share one order while another replica may lag", async () => {
  const harness = createProtocolHarness();
  const firstClient = await connectClient(harness, "first");
  const secondClient = await connectClient(harness, "second");

  const firstAction = firstClient.dispatch("increment", 2);
  const secondAction = secondClient.dispatch("increment", 3);

  assert.equal(harness.store.getRevision(), 2);
  assert.equal(harness.store.getState().counter.value, 5);

  await harness.deliverNext("command", "second");
  await harness.deliverNext("recover", "second");
  assert.equal(await secondAction, 5);
  assert.equal(secondClient.getRevision(), 2);
  assert.equal(firstClient.getRevision(), 0);

  await harness.deliverNext("command", "first");
  assert.equal(await firstAction, 2);
  assert.equal(firstClient.getRevision(), 1);

  await harness.deliverAll();
  assert.equal(firstClient.getRevision(), 2);
  assert.deepEqual(firstClient.getState(), secondClient.getState());
});

test("attachment buffers commits delivered before its snapshot response", async () => {
  const harness = createProtocolHarness();
  const writer = await connectClient(harness, "writer");

  const connecting = connectProtocolClient(
    harness.createTransport(),
    "counter",
    "joining",
  );
  const action = writer.dispatch("increment", 1);

  await harness.deliverNext("commit", "joining");
  await harness.deliverNext("attach", "joining");
  const joining = await connecting;

  assert.equal(joining.getRevision(), 1);
  assert.equal(joining.getState().counter.value, 1);

  await harness.deliverAll();
  assert.equal(await action, 1);
});

test("attachment falls back to a snapshot when its commit queue fills", async () => {
  const harness = createProtocolHarness();
  const writer = await connectClient(harness, "writer");
  const connecting = connectProtocolClient(
    harness.createTransport(),
    "counter",
    "joining",
  );
  const actions = [];

  for (let revision = 1; revision <= 65; revision += 1) {
    actions.push(writer.dispatch("increment", 1));
    await harness.deliverNext("commit", "joining");
  }

  await harness.deliverNext("attach", "joining");
  assert.equal(harness.pending("recover", "joining"), 1);
  await harness.deliverNext("recover", "joining");
  const joining = await connecting;

  assert.equal(joining.getRevision(), 65);
  assert.equal(joining.getState().counter.value, 65);

  await harness.deliverAll();
  await Promise.all(actions);
});
