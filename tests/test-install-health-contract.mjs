#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const [
  installScript,
  installLocalScript,
  toolchainAction,
  ciWorkflow,
  nightlySmokeWorkflow,
  releaseWorkflow,
  blobSizeWorkflow,
  packageInstaller,
  packageJsonSource,
] = await Promise.all([
  source("scripts/install.sh"),
  source("scripts/install-local.sh"),
  source(".github/actions/setup-burrete-toolchain/action.yml"),
  source(".github/workflows/ci.yml"),
  source(".github/workflows/nightly-smoke.yml"),
  source(".github/workflows/release.yml"),
  source(".github/workflows/blob-size-policy.yml"),
  source("packages/burrete/bin/burrete.mjs"),
  source("package.json"),
]);

const packageJson = JSON.parse(packageJsonSource);

assert.match(installScript, /exec "\$ROOT\/scripts\/install-local\.sh" "\$@"/);
assert.match(installLocalScript, /verify_installed_bundle\(\)/);
assert.match(installLocalScript, /installed app document types do not match build output/);
assert.match(installLocalScript, /installed Quick Look supported content types do not match build output/);
assert.match(installLocalScript, /assert_bundled_xyzrender_runner/);
assert.match(installLocalScript, /run_bundled_xyzrender_help/);
assert.match(installLocalScript, /-m xyzrender\.cli --help/);
assert.doesNotMatch(installLocalScript, /"\$runtime\/bin\/xyzrender" --help/);
assert.match(installLocalScript, /unregister_stale_dev_flavor_extensions\(\)/);
assert.match(installLocalScript, /\/Burrete-/);
assert.doesNotMatch(installLocalScript, /assert_quicklook_xyzrender_python/);
assert.doesNotMatch(installLocalScript, /sign_quicklook_xyzrender_python/);
assert.doesNotMatch(installLocalScript, /APPEX_XYZRENDER/);
assert.doesNotMatch(installLocalScript, /STAGING_APPEX\/Contents\/Resources\/xyzrender-runtime/);
assert.doesNotMatch(installLocalScript, /STAGING_APPEX\/Contents\/Resources\/xyzrender-python(?:\/|")/);
assert.doesNotMatch(installLocalScript, /bundle_quicklook_xyzrender_launcher\(\)/);
assert.match(installLocalScript, /Contents\/Resources\/xyzrender-python3/);
assert.doesNotMatch(installLocalScript, /Contents\/MacOS\/xyzrender-python3/);
assert.match(installLocalScript, /-name 'libpython3\*\.dylib'/);
assert.match(installLocalScript, /-name 'Python'/);
assert.match(installLocalScript, /Contents\/lib\/\{libpython3\*\.dylib,Python\}/);
assert.doesNotMatch(installLocalScript, /Contents\/lib\/libpython3\.13\.dylib/);
assert.doesNotMatch(installLocalScript, /install_name_tool -change "@executable_path\/\.\.\/lib\/libpython3\.13\.dylib" "@executable_path\/libpython3\.13\.dylib"/);
assert.doesNotMatch(installLocalScript, /Contents\/MacOS\/xyzrender-python\/bin\/python3/);
assert.doesNotMatch(installLocalScript, /BurretePreviewChild\.entitlements/);
assert.match(installLocalScript, /"\$STAGING_APPEX\/Contents\/Resources\/burrete-core-bridge"/);
assert.match(installLocalScript, /pluginkit -a "\$DEST_APPEX"/);
assert.match(installLocalScript, /LSSetDefaultRoleHandlerForContentType|lsregister/);
assert.doesNotMatch(installLocalScript, /-name python3 -o/);
assert.doesNotMatch(installLocalScript, /-name 'python3\.\*' -o/);
assert.doesNotMatch(installLocalScript, /sign_bundled_xyzrender_runtime[\s\S]*sign_xyzrender_binaries/u);
assert.doesNotMatch(installLocalScript, /sign_quicklook_xyzrender_launcher\(\)/u);
assert.doesNotMatch(installLocalScript, /rsync -aL --delete "\$LOCAL_XYZRENDER_ENV\/" "\$STAGING_XYZRENDER_ENV\/"/u);
assert.match(installLocalScript, /from build output/u);
assert.doesNotMatch(installLocalScript, /XYZRENDER_CODESIGN_ENTITLEMENTS/u);

for (const [input, defaultValue] of [
  ["bun-version", '"1.3.8"'],
  ["install-dependencies", '"true"'],
  ["install-xyzrender", '"false"'],
]) {
  assert.match(toolchainAction, new RegExp(`${input}:[\\s\\S]*default: ${defaultValue}`));
}
assert.match(toolchainAction, /uses: oven-sh\/setup-bun@v2/);
assert.match(toolchainAction, /if: inputs\.install-dependencies == 'true'/);
assert.match(toolchainAction, /if: inputs\.install-xyzrender == 'true'/);
assert.match(toolchainAction, /python3 -m pip install --user --break-system-packages uv/);
assert.match(toolchainAction, /uv" tool install xyzrender/);

for (const [label, workflow] of [
  ["ci", ciWorkflow],
  ["nightly smoke", nightlySmokeWorkflow],
  ["release", releaseWorkflow],
]) {
  assert.match(workflow, /uses: \.\/\.github\/actions\/setup-burrete-toolchain/, `${label} must use shared toolchain action`);
}
assert.match(ciWorkflow, /install-dependencies: "false"/);
assert.match(ciWorkflow, /install-xyzrender: "true"/);
assert.match(nightlySmokeWorkflow, /install-xyzrender: "true"/);
assert.match(releaseWorkflow, /install-xyzrender: "true"/);
assert.doesNotMatch(ciWorkflow, /python3 -m pip install --user --break-system-packages uv/);
assert.doesNotMatch(releaseWorkflow, /python3 -m pip install --user --break-system-packages uv/);

assert.match(blobSizeWorkflow, /python3 scripts\/check-blob-size\.py/);
assert.match(blobSizeWorkflow, /--max-bytes 512000/);
assert.match(blobSizeWorkflow, /--allowlist \.github\/blob-size-allowlist\.txt/);

assert.match(packageInstaller, /export async function fetchLatestRelease/);
assert.match(packageInstaller, /export function findZipAsset/);
assert.match(packageInstaller, /export async function replaceInstalledApp/);
assert.match(packageInstaller, /registerInstalledApp\(targetApp\)/);
assert.match(packageInstaller, /quicklookd/);
assert.match(packageInstaller, /verifyDigest\(zipPath, asset\.digest\)/);

const updateTests = packageJson.scripts["test:update"].split(/\s*&&\s*/u);
for (const command of [
  "bun tests/test-update-versioning.mjs",
  "bun tests/test-update-auto-prompt-contract.mjs",
  "bun tests/test-bun-installer-behavior.mjs",
  "bun tests/test-dev-namespace.mjs",
  "bun tests/test-quicklook-preview-smoke-contract.mjs",
  "bun tests/test-install-health-contract.mjs",
]) {
  assert.ok(updateTests.includes(command), `test:update must include ${command}`);
}

console.log("install health contract tests passed");
