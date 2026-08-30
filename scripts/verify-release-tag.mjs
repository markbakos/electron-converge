import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function assertReleaseTag(tag, version) {
  assert.match(
    version,
    stableVersion,
    `package version is not stable SemVer: ${version}`,
  );
  assert.equal(
    tag,
    `v${version}`,
    `release tag ${tag} does not match package version ${version}`,
  );
}

if (import.meta.main) {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assertReleaseTag(process.env.RELEASE_TAG, packageJson.version);
}
