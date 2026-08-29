import assert from "node:assert/strict";
import test from "node:test";

import { createPreloadBridge } from "../dist/electron-preload/bridge.js";

class FakeIpcRenderer {
  invokes = [];
  listeners = new Map();
  removals = 0;

  invoke(channel, value) {
    this.invokes.push({ channel, value });
    return Promise.resolve({ channel, value });
  }

  on(channel, listener) {
    this.listeners.set(channel, listener);
  }

  removeListener(channel, listener) {
    if (this.listeners.get(channel) === listener) {
      this.listeners.delete(channel);
      this.removals += 1;
    }
  }

  emit(channel, event, value) {
    this.listeners.get(channel)?.(event, value);
  }
}

test("preload bridge exposes only fixed Converge operations", async () => {
  const ipcRenderer = new FakeIpcRenderer();
  const bridge = createPreloadBridge(ipcRenderer);

  assert.deepEqual(Object.keys(bridge).sort(), [
    "attach",
    "command",
    "onCommit",
    "recover",
  ]);
  assert.equal("invoke" in bridge, false);
  assert.equal("on" in bridge, false);
  assert.equal("send" in bridge, false);
  assert.equal("sendSync" in bridge, false);

  await bridge.attach({ request: "attach" });
  await bridge.command({ request: "command" });
  await bridge.recover({ request: "recover" });

  assert.deepEqual(
    ipcRenderer.invokes.map(({ channel }) => channel),
    [
      "electron-converge:v1:attach",
      "electron-converge:v1:command",
      "electron-converge:v1:recover",
    ],
  );
});

test("preload commit subscription strips Electron events and cleans up once", () => {
  const ipcRenderer = new FakeIpcRenderer();
  const bridge = createPreloadBridge(ipcRenderer);
  const received = [];
  const unsubscribe = bridge.onCommit((commit) => received.push(commit));
  const electronEvent = { sender: { secret: true } };
  const commit = { protocol: 1, type: "COMMIT", revision: 1 };

  ipcRenderer.emit("electron-converge:v1:commit", electronEvent, commit);
  assert.deepEqual(received, [commit]);
  assert.notStrictEqual(received[0], electronEvent);

  unsubscribe();
  unsubscribe();
  ipcRenderer.emit("electron-converge:v1:commit", electronEvent, {
    revision: 2,
  });
  assert.deepEqual(received, [commit]);
  assert.equal(ipcRenderer.removals, 1);
});
