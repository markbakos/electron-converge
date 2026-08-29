import { createCanonicalStore } from "../../dist/index.js";
import { connectProtocolClient } from "../../dist/protocol/client.js";
import { createProtocolHost } from "../../dist/protocol/host.js";
import { counterDefinition } from "../fixtures.mjs";

export function createProtocolHarness() {
  const store = createCanonicalStore(counterDefinition());
  const host = createProtocolHost(store);
  const queue = [];

  function createTransport() {
    let closed = false;
    let listener;
    let sessionId;

    function request(kind, value, invoke) {
      if (closed) return Promise.reject(new Error("Transport closed"));
      sessionId = value.sessionId;
      const response = invoke();
      return new Promise((resolve, reject) => {
        queue.push({
          kind,
          sessionId,
          deliver: () => resolve(structuredClone(response)),
          reject,
        });
      });
    }

    return {
      onCommit(nextListener) {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      },
      attach(value) {
        return request("attach", value, () =>
          host.attach(value, (commit) => {
            queue.push({
              kind: "commit",
              sessionId: value.sessionId,
              deliver: () => {
                if (!closed) listener?.(structuredClone(commit));
              },
            });
          }),
        );
      },
      command(value) {
        return request("command", value, () => host.command(value));
      },
      recover(value) {
        return request("recover", value, () => host.recover(value));
      },
      close() {
        if (closed) return;
        closed = true;
        listener = undefined;
        if (sessionId) host.detach(sessionId);
        for (let index = queue.length - 1; index >= 0; index -= 1) {
          const event = queue[index];
          if (event?.sessionId === sessionId && event.reject) {
            queue.splice(index, 1);
            event.reject(new Error("Transport closed"));
          }
        }
      },
    };
  }

  async function deliverNext(kind, sessionId) {
    const index = findEvent(kind, sessionId);
    if (index === -1) throw new Error(`No queued ${kind} event`);
    const [event] = queue.splice(index, 1);
    event.deliver();
    await Promise.resolve();
  }

  function findEvent(kind, sessionId) {
    return queue.findIndex(
      (event) =>
        event.kind === kind &&
        (sessionId === undefined || event.sessionId === sessionId),
    );
  }

  async function deliverAll() {
    while (queue.length > 0) {
      const [event] = queue.splice(0, 1);
      event.deliver();
      await Promise.resolve();
    }
  }

  return {
    store,
    host,
    createTransport,
    deliverNext,
    deliverAll,
    dropNext(kind, sessionId) {
      const index = findEvent(kind, sessionId);
      if (index === -1) throw new Error(`No queued ${kind} event`);
      queue.splice(index, 1);
    },
    failNext(kind, sessionId) {
      const index = findEvent(kind, sessionId);
      if (index === -1) throw new Error(`No queued ${kind} event`);
      const [event] = queue.splice(index, 1);
      if (!event.reject) throw new Error(`${kind} cannot fail`);
      event.reject(new Error("Transport failed"));
    },
    duplicateNext(kind, sessionId) {
      const index = findEvent(kind, sessionId);
      if (index === -1) throw new Error(`No queued ${kind} event`);
      queue.splice(index + 1, 0, { ...queue[index] });
    },
    deferNext(kind, sessionId) {
      const index = findEvent(kind, sessionId);
      if (index === -1) throw new Error(`No queued ${kind} event`);
      const [event] = queue.splice(index, 1);
      queue.push(event);
    },
    pending: (kind, sessionId) =>
      queue.filter(
        (event) =>
          event.kind === kind &&
          (sessionId === undefined || event.sessionId === sessionId),
      ).length,
  };
}

export async function connectClient(harness, sessionId) {
  const connecting = connectProtocolClient(
    harness.createTransport(),
    "counter",
    sessionId,
  );
  await harness.deliverNext("attach", sessionId);
  return connecting;
}
