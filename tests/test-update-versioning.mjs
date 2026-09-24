#!/usr/bin/env bun
import assert from "node:assert/strict";
import { compareVersions } from "../apps/desktop/src/lib/semver.ts";

assert.equal(compareVersions("v0.10.35-beta.2", "0.10.35-beta.1"), 1);
assert.equal(compareVersions("v0.10.35", "0.10.35-beta.2"), 1);
assert.equal(compareVersions("0.10.35+build.7", "0.10.35"), 0);
assert.equal(compareVersions("1.0.0-alpha", "1.0.0"), -1);
assert.equal(compareVersions("1alpha.2.0", "1.2.0"), -1);
assert.equal(compareVersions("V1.0.1", "1.0.0"), 1);

// Calendar releases must remain upgradeable from the historical semver series.
for (const [next, previous] of [
  ["v2026.9.1", "2.3.22"],
  ["2026.9.2", "2026.9.1"],
  ["2026.10.1", "2026.9.99"],
  ["2027.1.1", "2026.12.99"],
  ["2026.2.0-beta.10", "2026.2.0-beta.2"],
  ["2026.2.0", "2026.2.0-beta.10"],
]) {
  assert.equal(compareVersions(next, previous), 1, `${previous} -> ${next}`);
  assert.equal(compareVersions(previous, next), -1, `${next} must not downgrade`);
}

console.log("update versioning tests passed");
