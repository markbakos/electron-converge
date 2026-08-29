import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.CONVERGE_FIXTURE_DIR ??
  path.join("/tmp", "electron-converge-fixture");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await Promise.all([
  build({
    entryPoints: [path.join(root, "test/electron-app/preload.js")],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node24",
    external: ["electron", "electron/renderer"],
    outfile: path.join(output, "preload.cjs"),
  }),
  build({
    entryPoints: [path.join(root, "test/electron-app/renderer.jsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome148",
    define: { "process.env.NODE_ENV": '"production"' },
    outfile: path.join(output, "renderer.js"),
  }),
]);

await writeFile(
  path.join(output, "index.html"),
  `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'none'; object-src 'none'">
    <title>Electron Converge fixture</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="./renderer.js"></script>
  </body>
</html>
`,
);

console.log(output);
