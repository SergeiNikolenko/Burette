#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const [filePage, dock, toolbar, rail, scene, objectMenu, overlay, info, store, documentTypes, rustRuntime] = await Promise.all([
  read("apps/desktop/src/components/editor-area/page-kinds/file.tsx"),
  read("apps/desktop/src/components/dock-panel.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-toolbar.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-viewport-rail.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-scene-panel.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-object-menu.ts"),
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
assert.match(filePage, /MesoscaleSceneToggle/);
assert.match(filePage, /MesoscaleCanvasContextMenu/);
assert.doesNotMatch(filePage, /MesoscaleViewportControls/);
assert.match(filePage, /mesoscale-left-panel-open/);
assert.match(filePage, /mesoscale-right-panel-open/);
assert.match(dock, /MesoscaleScenePanel/);
assert.match(dock, /MesoscaleInfoPanel/);
assert.match(toolbar, /setLayoutRegion/);
assert.doesNotMatch(toolbar, /toggleSidebar/);
assert.doesNotMatch(toolbar, /toggleDock\("right"\)/);
assert.match(overlay, /MesoscaleScenePanel/);
assert.match(overlay, /context-menu-content/);
assert.match(toolbar, /type: "setGraphics"/);
for (const action of ["getHierarchyPage", "setSelection", "focusObject", "setVisibility", "isolateObjects", "setStyle", "createSnapshot", "applySnapshot", "deleteSnapshot", "exportState"]) {
  assert.ok(scene.includes(`type: "${action}"`) || objectMenu.includes(`type: "${action}"`) || store.includes(`type: "${action}"`), `Scene dock must expose ${action}`);
}
assert.match(info, /sourceSha256/);
assert.match(store, /expectedRevision/);
assert.match(store, /frames\.get\(response\.documentId\) !== event\.source/);
assert.match(store, /requestAnimationFrame/);
assert.match(store, /burette-mesoscale-preview/);
assert.match(store, /burette-mesoscale-chrome/);
assert.match(store, /isMesoscaleCanvasInteractionMessage/);
assert.match(store, /positionMesoscaleControls/);
assert.match(store, /sceneOpen: session\.sceneOpen/);
assert.match(store, /layoutPreference/);
assert.match(store, /restoreMesoscaleLayout/);
assert.match(store, /!response\.requestId && response\.result\.kind === "summary"/);
assert.match(scene, /onPointerEnter/);
assert.match(scene, /onPointerLeave/);
assert.match(scene, /role="tree"/);
assert.match(scene, /role="treeitem"/);
assert.match(scene, /onContextMenu/);
assert.match(scene, /onMouseDown/);
assert.match(objectMenu, /showNativeContextMenu/);
assert.match(objectMenu, /forceWeb: true/);
assert.doesNotMatch(scene, /GROUP_LONG_PRESS_MS/);
assert.match(objectMenu, /Select all in group/);
assert.match(objectMenu, /Structure actions/);
assert.match(scene, /mesoscale-tree-bar/);
assert.match(scene, /mesoscale-tree-color/);
assert.match(objectMenu, /kind: "swatches"/);
assert.match(objectMenu, /mutationQueues/);
assert.match(objectMenu, /queueMutation/);
assert.match(objectMenu, /mesoscaleFrameGeneration/);
assert.match(store, /selectionRefreshes/);
assert.match(objectMenu, /Selection actions/);
assert.match(objectMenu, /isolateSelection/);
assert.doesNotMatch(scene, /mesoscale-style-editor/);
assert.match(toolbar, /setPreference\("theme"/);
assert.match(toolbar, /Switch to \$\{nextTheme\} theme/);
assert.doesNotMatch(toolbar, /SunMoon/);
assert.doesNotMatch(toolbar, /<select[^>]*aria-label="Viewer theme"/);
assert.match(toolbar, /M8 5h2v2H8V5/);
for (const action of ["resetCamera", "orientAxes", "resetAxes", "exportPng", "setIllumination", "setMotion", "setSelectionMode"]) {
  assert.ok(rail.includes(`type: "${action}"`), `Burette viewport rail must expose ${action}`);
}
assert.match(rail, /Burette viewport controls/);
assert.match(toolbar, /setPointerCapture/);
assert.match(toolbar, /TOOLBAR_POSITION_KEY/);
assert.match(toolbar, /railFootprint/);
assert.match(toolbar, /positionMesoscaleControls/);

console.log("mesoscale UI ownership contract passed");
