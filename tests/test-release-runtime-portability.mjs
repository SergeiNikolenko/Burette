#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const buildScript = source("scripts/build.sh");
const conformerCommand = source("apps/desktop/src-tauri/src/commands/documents.rs");
const xtbRuntime = source("apps/desktop/src-tauri/src/commands/xtb_runtime.rs");
const viewer = source("PreviewExtension/Web/viewer.js");
const runtimeViewer = source("apps/desktop/src-tauri/src/preview/runtime_viewer.rs");
const updater = source("apps/desktop/src-tauri/src/commands/updater.rs");
const registry = JSON.parse(source("config/preview-formats.json"));

assert.match(buildScript, /relocate_bundled_python_runtime/);
assert.match(buildScript, /install_name_tool/);
assert.match(buildScript, /assert_no_external_python_dependencies/);
assert.match(buildScript, /prepare_bundled_python_for_signing/);
assert.match(buildScript, /_CodeSignature/);
assert.match(buildScript, /codesign --verify --deep --strict \"\$python_framework\"/);
assert.match(buildScript, /otool -L/);
assert.match(buildScript, /External Homebrew dependency/);
assert.match(buildScript, /build_compute_metal_runtime/);
assert.match(buildScript, /compute\/metal\/build-metallib\.sh/);
assert.match(buildScript, /assert_bundled_compute_metal_runtime/);
assert.match(buildScript, /cargo build --release --bin burette-compute-service/);
assert.match(buildScript, /Contents\/Helpers\/burette-compute-service/);
assert.match(buildScript, /smoke_bundled_compute_service/);
assert.match(buildScript, /check-compute-service\.mjs/);
assert.ok(
  buildScript.indexOf("build_compute_metal_runtime\n") < buildScript.indexOf("bun run build:tauri"),
  "the reviewed Metal runtime must be compiled before Tauri packages resources",
);
assert.match(buildScript, /export CARGO_PROFILE_RELEASE_STRIP=false/);
assert.match(buildScript, /--exclude \.codegraph/);
assert.match(buildScript, /bun scripts\/check-release-version\.mjs/);

assert.match(conformerCommand, /candidate_errors/);
assert.match(conformerCommand, /format_conformer_candidate_errors/);

assert.match(xtbRuntime, /conda_environment_candidates/);
assert.match(xtbRuntime, /registered_conda_environment_candidates/);
assert.match(xtbRuntime, /environments\.txt/);
assert.match(xtbRuntime, /\.conda["']?\)\.join\(["']envs/);
assert.match(xtbRuntime, /rejected_candidates/);
assert.match(xtbRuntime, /Found xTB candidates but could not validate them/);

assert.match(runtimeViewer, /BuretteRDKitWasmDataURL/);
assert.match(runtimeViewer, /Sha256::digest/);
assert.match(runtimeViewer, /write_bytes_atomic/);
assert.match(viewer, /BuretteRDKitWasmDataURL/);
assert.match(viewer, /molstarPreviewLoadRDKitWasmData/);

assert.match(updater, /killall Finder/);

const mol = registry.formats.find((format) => format.id === "mol");
const cif = registry.formats.find((format) => format.id === "cif");
assert.deepEqual(mol.quickLookContentTypeAliases, [
  "com.revvity.external.mdl3000",
  "com.mdli.molfile",
]);
assert.deepEqual(cif.quickLookContentTypeAliases, ["com.revvity.external.cif"]);

console.log("Release runtime portability tests passed");
