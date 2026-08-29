import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createCanonicalStore } from "../dist/index.js";
import {
  ELECTRON_CHANNELS,
  createElectronMainController,
} from "../dist/electron-main/controller.js";

class FakeIpcMain {
  handlers = new Map();

  handle(channel, listener) {
    if (this.handlers.has(channel)) throw new Error("handler collision");
    this.handlers.set(channel, listener);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }

  invoke(
    channel,
    webContents,
    value,
    frame = webContents.mainFrame,
    ...extraValues
  ) {
    const handler = this.handlers.get(channel);
    assert.ok(handler, `missing handler for ${channel}`);
    return handler(
      { sender: webContents, senderFrame: frame },
      value,
      ...extraValues,
    );
  }
}

let nextWebContentsId = 1;

class FakeWebContents extends EventEmitter {
  id = nextWebContentsId++;
  mainFrame = {
    url: "app://converge/index.html",
    origin: "app://converge",
    processId: 1,
    routingId: 1,
  };
  sent = [];
  destroyed = false;
  failSend = false;

  isDestroyed() {
    return this.destroyed;
  }

  send(channel, value) {
    if (this.failSend) throw new Error("send failed");
    this.sent.push({ channel, value });
  }

  destroy() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

function counterStore(id = "counter", onValidate = () => undefined) {
  return createCanonicalStore({
    id,
    initialState: { value: 0 },
    inputs: {
      increment(value) {
        onValidate();
        return typeof value === "number";
      },
    },
    actions: {
      increment(state, amount) {
        const value = state.value + amount;
        return { state: { value }, result: value };
      },
    },
  });
}

const attach = (storeId, sessionId) => ({
  protocol: 1,
  type: "ATTACH",
  storeId,
  sessionId,
});

const command = (storeId, sessionId, commandId, input = 1) => ({
  protocol: 1,
  type: "COMMAND",
  storeId,
  sessionId,
  commandId,
  action: "increment",
  input,
});

const recover = (storeId, sessionId, fromRevision, forceSnapshot = false) => ({
  protocol: 1,
  type: "RECOVER",
  storeId,
  sessionId,
  fromRevision,
  forceSnapshot,
});

function createController(stores, overrides = {}) {
  const ipcMain = new FakeIpcMain();
  const controller = createElectronMainController(ipcMain, {
    stores,
    authorizeFrame({ frame }) {
      return new URL(frame.url).protocol === "app:";
    },
    authorize({ trusted }) {
      return trusted.role === "main";
    },
    ...overrides,
  });
  return { ipcMain, controller };
}

test("main admits only authorized registered main frames and publishes the canonical commit", () => {
  let validations = 0;
  const store = counterStore("counter", () => {
    validations += 1;
  });
  const { ipcMain, controller } = createController([store]);
  const webContents = new FakeWebContents();
  const trusted = { role: "main" };

  assert.deepEqual(
    ipcMain.invoke(ELECTRON_CHANNELS.attach, webContents, attach("counter", "session-a")),
    {
      protocol: 1,
      type: "PROTOCOL_ERROR",
      error: { code: "UNAUTHORIZED", message: "Unauthorized" },
    },
  );

  const renderer = controller.registerRenderer(webContents, trusted);
  trusted.role = "changed-after-registration";
  assert.equal(
    ipcMain.invoke(
      ELECTRON_CHANNELS.attach,
      webContents,
      attach("counter", "session-a"),
      { url: "app://converge/subframe.html" },
    ).error.code,
    "UNAUTHORIZED",
  );
  assert.equal(
    ipcMain.invoke(ELECTRON_CHANNELS.attach, webContents, attach("counter", "session-a")).type,
    "ATTACHED",
  );

  const invalid = ipcMain.invoke(
    ELECTRON_CHANNELS.command,
    webContents,
    command("counter", "session-a", "command-invalid", "bad"),
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "INVALID_INPUT");
  assert.equal(store.getRevision(), 0);

  const response = ipcMain.invoke(
    ELECTRON_CHANNELS.command,
    webContents,
    command("counter", "session-a", "command-1", 2),
  );
  assert.equal(response.ok, true);
  assert.equal(response.result, 2);
  assert.strictEqual(webContents.sent[0].value, response.commit);
  assert.equal(webContents.sent[0].channel, ELECTRON_CHANNELS.commit);
  assert.equal(validations, 2);
  assert.ok(Object.isFrozen(controller.getDiagnostics()));

  renderer.unregister();
  controller.dispose();
});

test("operation authorization runs before store lookup and application input validation", () => {
  let validations = 0;
  const store = counterStore("counter", () => {
    validations += 1;
  });
  const { ipcMain, controller } = createController([store], {
    authorize() {
      return false;
    },
  });
  const webContents = new FakeWebContents();
  controller.registerRenderer(webContents, { role: "main" });

  const denied = ipcMain.invoke(
    ELECTRON_CHANNELS.command,
    webContents,
    command("missing", "session-a", "command-1", { expensive: true }),
  );

  assert.equal(denied.type, "PROTOCOL_ERROR");
  assert.equal(denied.error.code, "UNAUTHORIZED");
  assert.equal(validations, 0);
  assert.equal(store.getRevision(), 0);
});

test("authorization throws and Promise-like results fail closed", () => {
  for (const authorizeFrame of [
    () => {
      throw new Error("private authorization detail");
    },
    () => Promise.resolve(true),
  ]) {
    const { ipcMain, controller } = createController([counterStore()], {
      authorizeFrame,
    });
    const webContents = new FakeWebContents();
    controller.registerRenderer(webContents, { role: "main" });

    assert.equal(
      ipcMain.invoke(
        ELECTRON_CHANNELS.attach,
        webContents,
        attach("counter", "session-a"),
      ).error.code,
      "UNAUTHORIZED",
    );
  }
});

test("handlers reject extra invoke arguments instead of ignoring them", () => {
  const { ipcMain, controller } = createController([counterStore()]);
  const webContents = new FakeWebContents();
  controller.registerRenderer(webContents, { role: "main" });

  const response = ipcMain.invoke(
    ELECTRON_CHANNELS.attach,
    webContents,
    attach("counter", "session-a"),
    webContents.mainFrame,
    "extra",
  );

  assert.equal(response.type, "PROTOCOL_ERROR");
  assert.equal(response.error.code, "INVALID_PROTOCOL");
});

test("navigation, crash, and explicit rotation invalidate old renderer sessions", () => {
  const store = counterStore();
  const { ipcMain, controller } = createController([store]);
  const webContents = new FakeWebContents();
  const renderer = controller.registerRenderer(webContents, { role: "main" });
  assert.equal(
    ipcMain.invoke(ELECTRON_CHANNELS.attach, webContents, attach("counter", "session-a")).type,
    "ATTACHED",
  );

  webContents.emit("did-start-navigation", {
    isMainFrame: true,
    isSameDocument: false,
  });
  assert.equal(
    ipcMain.invoke(ELECTRON_CHANNELS.attach, webContents, attach("counter", "session-b")).error.code,
    "STALE_SESSION",
  );

  webContents.emit("did-frame-finish-load", {}, true, 1, 1);
  assert.equal(
    ipcMain.invoke(ELECTRON_CHANNELS.attach, webContents, attach("counter", "session-b")).type,
    "ATTACHED",
  );

  webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(
    ipcMain.invoke(ELECTRON_CHANNELS.attach, webContents, attach("counter", "session-c")).error.code,
    "STALE_SESSION",
  );
  renderer.rotate();
  assert.equal(
    ipcMain.invoke(ELECTRON_CHANNELS.attach, webContents, attach("counter", "session-c")).type,
    "ATTACHED",
  );

  webContents.destroy();
  assert.equal(controller.getDiagnostics().registeredRenderers, 0);
  assert.equal(controller.getDiagnostics().liveSessions, 0);
});

test("publication failure detaches the failed session from every store without affecting healthy recipients", () => {
  const first = counterStore("first");
  const second = counterStore("second");
  const { ipcMain, controller } = createController([first, second]);
  const failed = new FakeWebContents();
  const healthy = new FakeWebContents();
  controller.registerRenderer(failed, { role: "main" });
  controller.registerRenderer(healthy, { role: "main" });

  for (const storeId of ["first", "second"]) {
    assert.equal(
      ipcMain.invoke(ELECTRON_CHANNELS.attach, failed, attach(storeId, "failed-session")).type,
      "ATTACHED",
    );
    assert.equal(
      ipcMain.invoke(ELECTRON_CHANNELS.attach, healthy, attach(storeId, "healthy-session")).type,
      "ATTACHED",
    );
  }
  failed.failSend = true;

  const committed = ipcMain.invoke(
    ELECTRON_CHANNELS.command,
    healthy,
    command("first", "healthy-session", "command-1"),
  );
  assert.equal(committed.ok, true);
  assert.equal(healthy.sent.length, 1);
  assert.equal(controller.getDiagnostics().publicationFailures, 1);
  assert.equal(controller.getDiagnostics().liveSessions, 1);
  assert.equal(
    ipcMain.invoke(
      ELECTRON_CHANNELS.command,
      failed,
      command("second", "failed-session", "command-2"),
    ).error.code,
    "STALE_SESSION",
  );
});

test("main routes recovery through the shared host and counts catch-up and snapshot responses", () => {
  const store = counterStore();
  const { ipcMain, controller } = createController([store]);
  const webContents = new FakeWebContents();
  controller.registerRenderer(webContents, { role: "main" });
  ipcMain.invoke(ELECTRON_CHANNELS.attach, webContents, attach("counter", "session-a"));
  ipcMain.invoke(
    ELECTRON_CHANNELS.command,
    webContents,
    command("counter", "session-a", "command-1"),
  );

  assert.equal(
    ipcMain.invoke(
      ELECTRON_CHANNELS.recover,
      webContents,
      recover("counter", "session-a", 0),
    ).type,
    "CATCH_UP",
  );
  assert.equal(
    ipcMain.invoke(
      ELECTRON_CHANNELS.recover,
      webContents,
      recover("counter", "session-a", 0, true),
    ).type,
    "SNAPSHOT",
  );
  assert.equal(controller.getDiagnostics().catchUpRecoveries, 1);
  assert.equal(controller.getDiagnostics().snapshotRecoveries, 1);
});

test("handler setup rolls back collisions and disposal removes only owned handlers", () => {
  const ipcMain = new FakeIpcMain();
  const existing = () => "existing";
  ipcMain.handle(ELECTRON_CHANNELS.command, existing);

  assert.throws(() =>
    createElectronMainController(ipcMain, {
      stores: [counterStore()],
      authorizeFrame: () => true,
      authorize: () => true,
    }),
  );
  assert.equal(ipcMain.handlers.has(ELECTRON_CHANNELS.attach), false);
  assert.strictEqual(ipcMain.handlers.get(ELECTRON_CHANNELS.command), existing);

  ipcMain.removeHandler(ELECTRON_CHANNELS.command);
  const controller = createElectronMainController(ipcMain, {
    stores: [counterStore()],
    authorizeFrame: () => true,
    authorize: () => true,
  });
  assert.deepEqual(
    [...ipcMain.handlers.keys()].sort(),
    [ELECTRON_CHANNELS.attach, ELECTRON_CHANNELS.command, ELECTRON_CHANNELS.recover].sort(),
  );
  controller.dispose();
  controller.dispose();
  assert.equal(ipcMain.handlers.size, 0);
  assert.throws(
    () => controller.registerRenderer(new FakeWebContents(), { role: "main" }),
    (error) => error.code === "STALE_SESSION",
  );
});

test("per-renderer request limits reject boundedly and are visible in diagnostics", () => {
  const { ipcMain, controller } = createController([counterStore()]);
  const webContents = new FakeWebContents();
  controller.registerRenderer(webContents, { role: "main" });

  let last;
  for (let index = 0; index < 1_025; index += 1) {
    last = ipcMain.invoke(
      ELECTRON_CHANNELS.attach,
      webContents,
      attach("counter", `session-${index}`),
    );
  }

  assert.equal(last.type, "PROTOCOL_ERROR");
  assert.equal(last.error.code, "RESOURCE_LIMIT");
  assert.equal(controller.getDiagnostics().resourceLimitRejections, 1);
});
