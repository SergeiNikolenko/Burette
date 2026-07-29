#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const registry = JSON.parse(await read("config/preview-formats.json"));
const formats = new Map(registry.formats.map((format) => [format.id, format]));

for (const [id, extension, binary] of [
  ["mesoscale-state-json", "molj", false],
  ["mesoscale-state-archive", "molx", true],
  ["mesoscale-model-archive", "mesozip", true],
]) {
  const format = formats.get(id);
  assert.ok(format, `${id} must be registered`);
  assert.ok(format.extensions.includes(extension), `${id} must cover .${extension}`);
  assert.equal(format.viewer.binary, binary, `${id} binary routing`);
  assert.equal(format.preview.profile, "mesoscale", `${id} must opt into the Mesoscale profile`);
  assert.equal(format.quickLook.sizeLimitMiB, 100, `${id} must have an explicit Quick Look budget`);
  assert.ok(registry.documentTypes.extensions.includes(extension), `desktop/iOS registration must include .${extension}`);
  assert.ok(registry.quickLook.contentTypes.includes(format.contentType), `Quick Look must include ${format.contentType}`);
}

const runtime = await read("apps/desktop/src/preview-mesoscale/mesoscale-runtime.ts");
assert.match(runtime, /MesoscaleExplorer\.create/);
assert.match(runtime, /LoadModel/);
assert.match(runtime, /openState/);
assert.match(runtime, /burette-mesoscale\/v1/);
for (const command of ["summary", "resetCamera", "setGraphics", "setFilter", "toggleGroup"]) {
  assert.ok(runtime.includes(`"${command}"`), `Mesoscale bridge must expose ${command}`);
}

const browser = await read("apps/desktop/src/lib/browser-dev-documents.ts");
assert.match(browser, /isMesoscaleDocument/);
assert.match(browser, /mesoscaleViewerHtml/);
assert.match(browser, /mesoscale\.js/);

const tauri = await read("apps/desktop/src-tauri/src/preview/runtime_viewer.rs");
assert.match(tauri, /AssetProfile::Mesoscale/);
assert.match(tauri, /fn mesoscale_viewer_html/);

const quickLook = await read("PreviewExtension/Platform/PreviewViewController.swift");
assert.match(quickLook, /isMesoscalePreview/);
assert.match(quickLook, /mesoscaleInlineHTML/);

const mobile = await read("ios/BuretteMobile/MobilePreviewRuntime.swift");
assert.match(mobile, /isMesoscalePreview/);
assert.match(mobile, /mesoscaleInlineHTML/);

const sourceBundle = await readFile("PreviewExtension/Web/mesoscale.js");
const pluginBundle = await readFile("plugins/burette-agent/preview-web/mesoscale.js");
assert.deepEqual(pluginBundle, sourceBundle, "packaged plugin must mirror the Mesoscale bundle");

const fixtureListing = execFileSync("unzip", ["-Z1", "tests/fixtures/mesoscale/basic.mesozip"], { encoding: "utf8" });
assert.deepEqual(fixtureListing.trim().split("\n").sort(), ["manifest.json", "mini.pdb"]);

console.log("mesoscale runtime contract passed");
