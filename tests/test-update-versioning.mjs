#!/usr/bin/env bun
import assert from "node:assert/strict";
import { compareVersions } from "../apps/desktop/src/lib/semver.ts";

assert.equal(compareVersions("v0.10.35-beta.2", "0.10.35-beta.1"), 1);
assert.equal(compareVersions("v0.10.35", "0.10.35-beta.2"), 1);
assert.equal(compareVersions("0.10.35+build.7", "0.10.35"), 0);
assert.equal(compareVersions("1.0.0-alpha", "1.0.0"), -1);
assert.equal(compareVersions("1alpha.2.0", "1.2.0"), -1);
assert.equal(compareVersions("V1.0.1", "1.0.0"), 1);

console.log("update versioning tests passed");
