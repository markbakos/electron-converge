import assert from "node:assert/strict";
import test from "node:test";

test("the main subpath resolves separately from the Electron-free root", () => {
  assert.match(import.meta.resolve("electron-converge"), /dist\/index\.js$/u);
  assert.match(
    import.meta.resolve("electron-converge/main"),
    /dist\/electron-main\/index\.js$/u,
  );
});
