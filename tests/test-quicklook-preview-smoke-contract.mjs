#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const smoke = await readFile(new URL("../scripts/quicklook-preview-smoke.sh", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const ciFast = await readFile(new URL("../scripts/ci-fast.sh", import.meta.url), "utf8");
const nightlySmoke = await readFile(new URL("../.github/workflows/nightly-smoke.yml", import.meta.url), "utf8");

assert.match(smoke, /last_request_id_for_file\(\)/);
assert.match(smoke, /before_request_id="\$\(last_request_id_for_file "\$preview_file"\)"/);
assert.match(smoke, /result="\$\(wait_for_preview_result "\$preview_file" "\$before_request_id"\)"/);
assert.match(smoke, /JS message type=ready: ready/);
assert.match(smoke, /renderNativeError/);
assert.match(smoke, /BURRETE_QUICKLOOK_SMOKE_TRACE/);
assert.match(smoke, /trace_request_id_for_block\(\)/);
assert.match(smoke, /runtime_directory_for_block\(\)/);
assert.match(smoke, /validate_stability_artifacts\(\)/);
assert.match(smoke, /extension_launch_failure_note\(\)/);
assert.match(smoke, /adhoc_extension_note\(\)/);
assert.match(smoke, /AppleMobileFileIntegrityError/);
assert.match(smoke, /Quick Look extension launch failure/);
assert.match(smoke, /Signature=adhoc/);
assert.match(smoke, /installed preview extension is ad-hoc signed/);
assert.match(smoke, /preview-trace\.jsonl/);
assert.match(smoke, /manifest\.json/);
assert.match(smoke, /trace\+manifest/);
assert.match(smoke, /DEV_FLAVOR_SLUG/);
assert.match(smoke, /APP_BUNDLE_NAME="\$BURRETE_APP_BUNDLE_NAME"/);
assert.match(smoke, /BurretePreview-\$\{DEV_FLAVOR_SLUG\}/);
assert.match(smoke, /preview_file="\$dev_preview_dir\/\$\{DEV_FLAVOR_SLUG\} \$\(basename "\$abs_file"\)"/);
assert.match(smoke, /run_preview\(\)/);
assert.match(smoke, /qlmanage -p -c "\$type" "\$preview_file"/);
assert.doesNotMatch(smoke, /scripts\/force-preview\.sh/);
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
assert.match(nightlySmoke, /schedule:/);
assert.match(nightlySmoke, /BURRETE_DEV_FLAVOR:\s*ci/);
assert.match(nightlySmoke, /quicklook-preview-smoke\.sh/);
for (const fixture of [
  "tests/fixtures/BurettePreviewSamples/mini.pdb",
  "tests/fixtures/BurettePreviewSamples/mini.cif",
  "tests/fixtures/BurettePreviewSamples/sdf/single.sdf",
  "tests/fixtures/BurettePreviewSamples/xyz/single.xyz",
  "tests/fixtures/BurettePreviewSamples/xyzr/single.xyzr",
]) {
  assert.match(nightlySmoke, new RegExp(fixture.replaceAll("/", "\\/")));
}
assert.match(nightlySmoke, /BURRETE_PERF_RUN_GUI:\s*0/);

console.log("quicklook preview smoke contract tests passed");
