#!/usr/bin/env bun
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { compareVersions } from "../apps/desktop/src/lib/semver.ts";

const workflow = readFileSync(".github/workflows/legacy-update-bridge.yml", "utf8");
const packager = readFileSync("scripts/package-legacy-update-bridge.sh", "utf8");
const versionSetter = readFileSync("scripts/set-release-version.mjs", "utf8");
const shellSyntax = spawnSync("bash", ["-n", "scripts/package-legacy-update-bridge.sh"], {
  encoding: "utf8",
});

assert.equal(compareVersions("1.0.32", "1.0.31"), 1);
assert.equal(compareVersions("2.0.1", "1.0.32"), 1);
assert.equal(shellSyntax.status, 0, shellSyntax.stderr);

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /default: "1\.0\.32"/);
assert.match(workflow, /bun scripts\/set-release-version\.mjs/);
assert.match(workflow, /\.\/scripts\/build\.sh/);
assert.match(workflow, /\.\/scripts\/package-legacy-update-bridge\.sh/);
assert.match(workflow, /actions\/upload-artifact@v7/);

assert.match(packager, /com\.local\.BurreteV10/);
assert.match(packager, /com\.local\.BurreteV10\.Preview/);
assert.match(packager, /com\.local\.BurreteV10\.Thumbnail/);
assert.match(packager, /Burrete\.app/);
assert.match(packager, /BurretePreview\.appex/);
assert.match(packager, /BurreteThumbnail\.appex/);
assert.match(packager, /Contents\/MacOS\/burrete/);
assert.match(packager, /codesign --verify --deep --strict/);
assert.doesNotMatch(packager, /codesign[^\n]*\|[^\n]*grep/);
assert.match(packager, /Burrete-\$\{version\}\.zip/);
assert.match(packager, /shasum -a 256/);

assert.match(versionSetter, /MARKETING_VERSION/);
assert.match(versionSetter, /packages\/burette/);
assert.match(versionSetter, /apps\/desktop\/src-tauri\/Cargo\.toml/);
assert.match(versionSetter, /apps\/desktop\/src-tauri\/tauri\.conf\.json/);

console.log("legacy update bridge contract tests passed");
