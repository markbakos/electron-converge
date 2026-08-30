import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertReleaseTag } from "../scripts/verify-release-tag.mjs";

const publishWorkflow = await readFile(
  new URL("../.github/workflows/publish.yml", import.meta.url),
  "utf8",
);
const ciWorkflow = await readFile(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

test("accepts the exact stable package version tag", () => {
  assert.doesNotThrow(() => assertReleaseTag("v1.2.3", "1.2.3"));
});

test("rejects a tag that does not match the package version", () => {
  assert.throws(() => assertReleaseTag("v1.2.4", "1.2.3"));
});

test("rejects prerelease and malformed versions", () => {
  for (const version of ["1.2.3-beta.1", "01.2.3", "1.2", "latest"]) {
    assert.throws(() => assertReleaseTag(`v${version}`, version));
  }
});

test("publishes matching version tags through OIDC", () => {
  for (const required of [
    'tags:\n      - "v*"',
    "contents: read",
    "id-token: write",
    "package-manager-cache: false",
    "node scripts/verify-release-tag.mjs",
    "pnpm install --frozen-lockfile",
    "xvfb-run --auto-servernum npm publish",
  ]) {
    assert.ok(
      publishWorkflow.includes(required),
      `publish workflow is missing ${required}`,
    );
  }
  assert.ok(ciWorkflow.includes('branches:\n      - "**"'));
});
