import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import electron from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function runElectron(mode, environment = {}, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(root, "test/electron-app/main.mjs")], {
      cwd: root,
      env: {
        ...process.env,
        CONVERGE_FIXTURE_DIR: path.join("/tmp", "electron-converge-fixture"),
        CONVERGE_FIXTURE_MODE: mode,
        ...environment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Electron ${mode} timed out\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Electron exited ${code ?? signal}\n${stdout}\n${stderr}`));
        return;
      }
      const line = stdout
        .split("\n")
        .find((candidate) => candidate.startsWith("CONVERGE_RESULT "));
      if (!line) {
        reject(new Error(`Electron emitted no result\n${stdout}\n${stderr}`));
        return;
      }
      resolve(JSON.parse(line.slice("CONVERGE_RESULT ".length)));
    });
  });
}
