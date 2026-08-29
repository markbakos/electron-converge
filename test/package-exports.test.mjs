import assert from "node:assert/strict";
import test from "node:test";

test("process subpaths resolve separately from the Electron-free root", () => {
  assert.match(import.meta.resolve("electron-converge"), /dist\/index\.js$/u);
  assert.match(
    import.meta.resolve("electron-converge/main"),
    /dist\/electron-main\/index\.js$/u,
  );
  assert.match(
    import.meta.resolve("electron-converge/renderer"),
    /dist\/electron-renderer\/index\.js$/u,
  );
});
