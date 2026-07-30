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
const theme = await read("apps/desktop/src/preview-mesoscale/mesoscale-burette-theme.css");
assert.match(runtime, /MesoscaleExplorer\.create/);
assert.match(runtime, /LoadModel/);
assert.match(runtime, /openState/);
assert.match(runtime, /burette-mesoscale\/v1/);
assert.match(runtime, /burette-mesoscale-host/);
assert.match(runtime, /MESOSCALE_API_VERSION/);
assert.match(runtime, /getHierarchyPage/);
assert.match(runtime, /hierarchyPreview/);
assert.match(runtime, /layoutShowControls: diagnostic/);
assert.match(runtime, /layoutShowLog: diagnostic/);
assert.match(runtime, /viewportShowControls: true/);
assert.match(runtime, /viewportShowAnimation: false/);
assert.doesNotMatch(runtime, /burette-mesoscale-hosted \.msp-viewport-controls/);
assert.match(runtime, /burette-mesoscale-chrome/);
assert.match(runtime, /applyControlPlacement/);
assert.match(runtime, /burette-mesoscale-controls-hidden/);
assert.match(runtime, /burette-mesoscale-owned-chrome/);
assert.match(runtime, /burette-mesoscale-preview/);
assert.match(runtime, /burette-mesoscale-interaction/);
assert.match(runtime, /installMesoscaleCanvasInteractions/);
assert.match(runtime, /applyHostedInteractionBindings/);
assert.match(runtime, /clickCenterFocus: Binding\.Empty/);
assert.match(runtime, /installMesoscaleSelectionSync/);
assert.match(runtime, /structure\.selection\.events\.changed/);
assert.match(runtime, /runtime\.ownsSelectionMutation/);
assert.doesNotMatch(runtime, /if \(runtime\.plugin\.selectionMode\) return/);
assert.match(runtime, /syncSelectedRefs/);
assert.match(runtime, /selection\.select\(\{ loci \}, false\)/);
assert.doesNotMatch(runtime, /selection\.selectJoin/);
assert.match(runtime, /canvas\.identify/);
assert.match(runtime, /Structure\.areEquivalent/);
assert.match(runtime, /renderObject\?\.id === pick\.id\.objectId/);
assert.match(runtime, /activePointerId/);
assert.match(runtime, /lostpointercapture/);
assert.match(runtime, /hasHostMenu/);
assert.match(runtime, /target\.x \+ rect\.left/);
assert.match(runtime, /contextPointer\.moved = Math\.hypot/);
assert.match(runtime, /if \(contextMouse && event\.target === canvas\)/);
assert.match(runtime, /if \(!started\) \{\s*runtime\.clearSelection\(\);\s*emitSelection\(\);/s);
assert.match(runtime, /armContextMenuSuppression/);
assert.match(runtime, /if \(event\.button === 2\) clearContextMenuSuppression\(\)/);
assert.doesNotMatch(runtime, /dispatchSecondaryMouse/);
assert.match(runtime, /suppressPrimaryMouse/);
assert.match(runtime, /addEventListener\("mousedown", onMouseDown, true\)/);
assert.match(runtime, /addEventListener\("mousemove", onMouseMove, true\)/);
assert.match(runtime, /addEventListener\("mouseup", onMouseUp, true\)/);
assert.match(runtime, /mouseGesture/);
assert.match(runtime, /MarkerAction\.Highlight/);
assert.match(runtime, /body\?\.type === "setViewerTheme"/);
assert.match(runtime, /buret-theme-light/);
assert.match(runtime, /buret-theme-dark/);
assert.match(theme, /--buret-meso-panel/);
assert.match(theme, /body\.buret-theme-light/);
assert.match(theme, /body \.msp-plugin \.msp-layout-left/);
assert.match(theme, /body \.msp-plugin \.msp-viewport-controls/);
assert.match(theme, /body \.msp-plugin \.msp-highlight-info/);
assert.match(theme, /body \.msp-plugin #focusinfo/);
assert.match(runtime, /config\.uiMode \?\? "diagnostic"/);
assert.doesNotMatch(runtime, /layoutShowControls: true/);
assert.doesNotMatch(runtime, /layoutShowLog: true/);
for (const command of ["summary", "resetCamera", "setGraphics", "setFilter", "toggleGroup"]) {
  assert.ok(runtime.includes(`"${command}"`), `Mesoscale bridge must expose ${command}`);
}

const browser = await read("apps/desktop/src/lib/browser-dev-documents.ts");
assert.match(browser, /isMesoscaleDocument/);
assert.match(browser, /mesoscaleViewerHtml/);
assert.match(browser, /mesoscale\.js/);
assert.match(browser, /"mesoscale"\)/);
assert.match(browser, /uiMode: "hosted"/);

const contract = await read("apps/desktop/src/lib/mesoscale-contract.ts");
assert.match(contract, /burette-mesoscale\/v2/);
assert.match(contract, /MESOSCALE_HIERARCHY_PAGE_LIMIT = 128/);
assert.match(contract, /MesoscaleChromeMessage/);
assert.match(contract, /MesoscaleCanvasInteractionMessage/);
assert.match(contract, /selectionTruncated/);
assert.match(contract, /selectionVersion/);
assert.match(contract, /mergeMesoscaleHierarchySelection/);
assert.match(contract, /message\.source !== "burette-mesoscale-interaction"/);
for (const action of ["getSummary", "getHierarchyPage", "setSelection", "setSelectionStyle", "setSelectionVisibility", "isolateSelection", "setSelectionMode", "setIllumination", "setLayoutRegion", "setMotion", "setVisibility", "isolateObjects", "setStyle", "resetCamera", "orientAxes", "resetAxes", "exportState"]) {
  assert.ok(contract.includes(`type: "${action}"`), `Mesoscale v2 contract must expose ${action}`);
}
assert.match(runtime, /setLayoutRegion\(region/);
assert.match(runtime, /PluginCommands\.Layout\.Update/);
assert.match(runtime, /showControls/);
assert.match(runtime, /regionState/);
assert.match(runtime, /setMotion\(motion/);
assert.match(runtime, /private mutateSelection/);
assert.match(runtime, /selection\.getLoci\(structure\)/);
assert.match(runtime, /StructureElement\.Loci\.isEmpty/);
assert.match(runtime, /const visited = new Set<string>/);
assert.match(runtime, /current = groups\.find/);

const tauri = await read("apps/desktop/src-tauri/src/preview/runtime_viewer.rs");
assert.match(tauri, /AssetProfile::Mesoscale/);
assert.match(tauri, /fn mesoscale_viewer_html/);
assert.match(tauri, /config\["uiMode"\] = json!\("hosted"\)/);

const quickLook = await read("PreviewExtension/Platform/PreviewViewController.swift");
assert.match(quickLook, /isMesoscalePreview/);
assert.match(quickLook, /mesoscaleInlineHTML/);

const mobile = await read("ios/BuretteMobile/MobilePreviewRuntime.swift");
assert.match(mobile, /isMesoscalePreview/);
assert.match(mobile, /mesoscaleInlineHTML/);

const sourceBundle = await readFile("PreviewExtension/Web/mesoscale.js");
const pluginBundle = await readFile("plugins/burette-agent/preview-web/mesoscale.js");
assert.deepEqual(pluginBundle, sourceBundle, "packaged plugin must mirror the Mesoscale bundle");
const sourceStyle = await readFile("PreviewExtension/Web/mesoscale.css");
const pluginStyle = await readFile("plugins/burette-agent/preview-web/mesoscale.css");
assert.deepEqual(pluginStyle, sourceStyle, "packaged plugin must mirror the themed Mesoscale stylesheet");
assert.match(sourceStyle.toString("utf8"), /--buret-meso-panel/);

const fixtureListing = execFileSync("unzip", ["-Z1", "tests/fixtures/mesoscale/basic.mesozip"], { encoding: "utf8" });
assert.deepEqual(fixtureListing.trim().split("\n").sort(), ["manifest.json", "mini.pdb"]);

console.log("mesoscale runtime contract passed");
