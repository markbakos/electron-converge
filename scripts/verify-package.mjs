import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "electron-converge-pack-"));
const packResult = JSON.parse(
  execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], {
    cwd: root,
    encoding: "utf8",
  }),
);
const packed = Array.isArray(packResult)
  ? packResult[0]
  : Object.values(packResult)[0];
assert.ok(packed);
const files = new Set(packed.files.map(({ path: file }) => file));

for (const file of [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/electron-main/index.js",
  "dist/electron-preload/index.js",
  "dist/electron-renderer/index.js",
  "dist/react/index.js",
]) {
  assert.ok(files.has(file), `packed tarball is missing ${file}`);
}
assert.ok([...files].every((file) => !file.startsWith("src/") && !file.startsWith("test/")));
for (const stale of [
  "dist/canonical-store.js",
  "dist/contracts.js",
  "dist/replica.js",
  "dist/wire.js",
]) {
  assert.equal(files.has(stale), false, `packed tarball contains stale ${stale}`);
}

const consumer = path.join(temporary, "consumer");
await mkdir(consumer);
await writeFile(
  path.join(consumer, "package.json"),
  JSON.stringify({ name: "consumer", private: true, type: "module" }),
);
execFileSync(
  "npm",
  [
    "install",
    "--ignore-scripts",
    "--legacy-peer-deps",
    "--no-audit",
    "--no-fund",
    path.join(temporary, packed.filename),
  ],
  { cwd: consumer, stdio: "inherit" },
);
await writeFile(
  path.join(consumer, "verify.mjs"),
  `await import("electron-converge");
await import("electron-converge/renderer");
await import("electron-converge/react");
for (const entry of ["main", "preload"]) {
  if (!import.meta.resolve(\`electron-converge/\${entry}\`)) process.exit(1);
}
`,
);
execFileSync(process.execPath, [path.join(consumer, "verify.mjs")], {
  cwd: consumer,
  stdio: "inherit",
});

console.log(JSON.stringify({ filename: packed.filename, files: packed.files.length }));
