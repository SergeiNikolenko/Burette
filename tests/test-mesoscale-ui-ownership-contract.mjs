#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const [filePage, dock, toolbar, scene, overlay, info, store, documentTypes, rustRuntime] = await Promise.all([
  read("apps/desktop/src/components/editor-area/page-kinds/file.tsx"),
  read("apps/desktop/src/components/dock-panel.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-toolbar.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-scene-panel.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-scene-overlay.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-info-panel.tsx"),
  read("apps/desktop/src/stores/mesoscale-store.ts"),
  read("apps/desktop/src/types.ts"),
  read("apps/desktop/src-tauri/src/preview/runtime.rs"),
]);

assert.match(documentTypes, /viewerProfile\?: "structure" \| "mesoscale" \| "grid" \| "spectrum"/);
assert.match(rustRuntime, /viewer_profile: String/);
assert.match(filePage, /bindMesoscaleFrame/);
assert.match(filePage, /MesoscaleToolbar/);
assert.match(filePage, /MesoscaleSceneOverlay/);
assert.match(dock, /MesoscaleScenePanel/);
assert.match(dock, /MesoscaleInfoPanel/);
assert.match(toolbar, /onToggleScene/);
assert.match(toolbar, /toggleSidebar/);
assert.match(toolbar, /toggleDock\("right"\)/);
assert.match(overlay, /MesoscaleScenePanel/);
for (const action of ["setGraphics", "resetCamera", "exportPng", "setSelectionMode", "setIllumination"]) {
  assert.ok(toolbar.includes(`type: "${action}"`), `toolbar must expose ${action}`);
}
for (const action of ["getHierarchyPage", "setSelection", "focusObject", "setVisibility", "setStyle", "createSnapshot", "applySnapshot", "deleteSnapshot", "exportState"]) {
  assert.ok(scene.includes(`type: "${action}"`) || store.includes(`type: "${action}"`), `Scene dock must expose ${action}`);
}
assert.match(info, /sourceSha256/);
assert.match(store, /expectedRevision/);
assert.match(store, /frames\.get\(response\.documentId\) !== event\.source/);
assert.match(store, /requestAnimationFrame/);
assert.match(store, /burette-mesoscale-preview/);
assert.match(scene, /onPointerEnter/);
assert.match(scene, /onPointerLeave/);
assert.match(toolbar, /setPreference\("theme"/);

console.log("mesoscale UI ownership contract passed");
