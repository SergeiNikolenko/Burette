#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const smoke = await readFile(new URL("../scripts/quicklook-preview-smoke.sh", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const ciFast = await readFile(new URL("../scripts/ci-fast.sh", import.meta.url), "utf8");

assert.match(smoke, /last_request_id_for_file\(\)/);
assert.match(smoke, /before_request_id="\$\(last_request_id_for_file "\$abs_file"\)"/);
assert.match(smoke, /JS message type=ready: ready/);
assert.match(smoke, /renderNativeError/);
assert.match(smoke, /scripts\/force-preview\.sh/);
assert.match(smoke, /BURRETE_QUICKLOOK_SMOKE_RESULTS/);
assert.match(smoke, /BURRETE_QUICKLOOK_SMOKE_TIMEOUT_SECONDS/);
assert.match(smoke, /qlmanage -r cache/);
assert.doesNotMatch(smoke, /screencapture/);
assert.doesNotMatch(smoke, /pkill -f/);
assert.doesNotMatch(smoke, /killall quicklookd/);

assert.match(
  packageJson.scripts["test:update"],
  /test-quicklook-preview-smoke-contract\.mjs/,
  "Quick Look smoke contract must run in update tests",
);
assert.doesNotMatch(ciFast, /quicklook-preview-smoke\.sh/);

console.log("quicklook preview smoke contract tests passed");
