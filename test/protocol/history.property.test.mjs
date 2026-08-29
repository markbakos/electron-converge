import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { connectClient, createProtocolHarness } from "./harness.mjs";

test("randomized delivery histories preserve valid prefixes and converge", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          source: fc.integer({ min: 0, max: 2 }),
          amount: fc.integer({ min: -3, max: 3 }),
          responseFirst: fc.boolean(),
          dropped: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
        }),
        { minLength: 1, maxLength: 30 },
      ),
      async (history) => {
        const harness = createProtocolHarness();
        const clients = await Promise.all([
          connectClient(harness, "session-0"),
          connectClient(harness, "session-1"),
          connectClient(harness, "session-2"),
        ]);
        const values = [0];

        for (const operation of history) {
          const source = clients[operation.source];
          const action = source.dispatch("increment", operation.amount);
          const revision = harness.store.getRevision();
          values.push(values.at(-1) + operation.amount);

          if (operation.responseFirst) {
            await harness.deliverNext("command", `session-${operation.source}`);
          }
          for (let index = 0; index < clients.length; index += 1) {
            if (operation.dropped[index]) {
              harness.dropNext("commit", `session-${index}`);
            } else {
              await harness.deliverNext("commit", `session-${index}`);
            }
          }
          if (!operation.responseFirst) {
            await harness.deliverNext("command", `session-${operation.source}`);
          }
          await harness.deliverAll();
          await action;

          assert.equal(source.getRevision(), revision);
          for (const client of clients) {
            assert.equal(
              client.getState().counter.value,
              values[client.getRevision()],
            );
          }
        }

        const finalAction = clients[0].dispatch("increment", 0);
        for (let index = 0; index < clients.length; index += 1) {
          await harness.deliverNext("commit", `session-${index}`);
        }
        await harness.deliverNext("command", "session-0");
        await harness.deliverAll();
        await finalAction;

        for (const client of clients) {
          assert.equal(client.getRevision(), harness.store.getRevision());
          assert.deepEqual(client.getState(), harness.store.getState());
          client.close();
        }
      },
    ),
    { numRuns: 40 },
  );
});
