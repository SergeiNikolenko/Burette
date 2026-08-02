#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const [filePage, dock, toolbar, selectionBar, rail, scene, objectMenu, overlay, info, store, documentTypes, mesoscaleContract, rustRuntime, styles, runtime] = await Promise.all([
  read("apps/desktop/src/components/editor-area/page-kinds/file.tsx"),
  read("apps/desktop/src/components/dock-panel.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-toolbar.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-selection-bar.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-viewport-rail.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-scene-panel.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-object-menu.ts"),
  read("apps/desktop/src/components/mesoscale/mesoscale-scene-overlay.tsx"),
  read("apps/desktop/src/components/mesoscale/mesoscale-info-panel.tsx"),
  read("apps/desktop/src/stores/mesoscale-store.ts"),
  read("apps/desktop/src/types.ts"),
  read("apps/desktop/src/lib/mesoscale-contract.ts"),
  read("apps/desktop/src-tauri/src/preview/runtime.rs"),
  read("apps/desktop/src/styles.css"),
  read("apps/desktop/src/preview-mesoscale/mesoscale-runtime.ts"),
]);

assert.match(documentTypes, /viewerProfile\?: "structure" \| "mesoscale" \| "grid" \| "spectrum"/);
assert.match(mesoscaleContract, /MESOSCALE_HIERARCHY_DETAIL_LIMIT = 512/);
assert.match(mesoscaleContract, /MESOSCALE_HIERARCHY_DETAIL_DEPTH_LIMIT = 4/);
assert.match(rustRuntime, /viewer_profile: String/);
assert.match(filePage, /bindMesoscaleFrame/);
assert.match(filePage, /MesoscaleToolbar/);
assert.match(filePage, /MesoscaleSceneOverlay/);
assert.match(filePage, /MesoscaleSceneToggle/);
assert.match(filePage, /MesoscaleCanvasContextMenu/);
assert.match(filePage, /MesoscaleSelectionBar/);
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
for (const action of ["getHierarchyPage", "setSelection", "setSelectionBatch", "focusObject", "setVisibility", "isolateObjects", "setStyle", "createSnapshot", "applySnapshot", "deleteSnapshot", "exportState"]) {
  assert.ok(scene.includes(`type: "${action}"`) || objectMenu.includes(`type: "${action}"`) || overlay.includes(`type: "${action}"`) || store.includes(`type: "${action}"`), `Scene dock must expose ${action}`);
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
assert.match(scene, /aria-multiselectable="true"/);
assert.match(scene, /role="treeitem"/);
assert.match(scene, /onContextMenu/);
assert.match(scene, /event\.button === 0 && event\.ctrlKey/);
assert.match(scene, /onMouseDown/);
assert.match(objectMenu, /showNativeContextMenu/);
assert.match(objectMenu, /forceWeb: true/);
assert.doesNotMatch(scene, /GROUP_LONG_PRESS_MS/);
assert.doesNotMatch(scene, /mesoscale-segmented/);
assert.doesNotMatch(scene, /mesoscale-search/);
assert.match(objectMenu, /Select all in group/);
assert.match(objectMenu, /kind: "submenu"/, "the object menu groups its commands into submenus");
assert.match(objectMenu, /text: "Clip"/, "cutting an object with a clip shape is reachable from the menu");
assert.match(objectMenu, /type: "setClip"/);
assert.match(scene, /mesoscale-tree-bar/);
assert.match(scene, /mesoscale-tree-color/);
assert.match(scene, /showMesoscaleAppearanceMenu/);
assert.match(styles, /grid-template-columns: 2px minmax\(0, 1fr\) minmax\(64px, 92px\)/, "scene names and element counts use stable columns");
assert.match(scene, /data-mesoscale-ref/);
assert.match(scene, /setSelectionBatch/);
assert.match(scene, /selectionError/);
assert.match(scene, /setPointerCapture/);
assert.match(scene, /onLostPointerCapture/);
assert.match(scene, /MesoscaleHierarchyDetail/);
assert.match(scene, /className="mesoscale-detail-main"/, "detail hierarchy rows are interactive, not inert labels");
assert.match(scene, /data-mesoscale-detail-id/, "detail rows expose stable hierarchy identity");
assert.match(scene, /data-mesoscale-detail-key/, "operator leaves are addressable for range and drag selection");
assert.match(scene, /previewMesoscaleObject\(documentId, ownerRef, selector\)/, "hovering an operator highlights that instance, not the whole structure");
assert.match(scene, /type: "setDetailSelection"/, "clicking an operator selects that instance");
assert.match(scene, /type: "setDetailSelectionBatch"/, "range and drag selection over operators go through one batched request");
assert.match(scene, /type: "focusDetail"/, "double-clicking an operator focuses that instance");
assert.match(scene, /More details/);
assert.match(scene, /childrenTruncated/);
assert.match(objectMenu, /kind: "swatches"/);
assert.match(objectMenu, /mutationQueues/);
assert.match(objectMenu, /queueMutation/);
assert.match(objectMenu, /mesoscaleFrameGeneration/);
assert.match(store, /selectionRefreshes/);
assert.match(runtime, /installMesoscalePanelResizeHandles/, "hosted Mol\* panels install Burette resize handles");
assert.match(runtime, /applyBuretteSelectionAppearance/, "Mesoscale selection keeps Burette-owned visual treatment");
assert.match(runtime, /await loadSource\(runtime, config\);\s*\/\/[\s\S]*?applyBuretteSelectionAppearance\(runtime\);/, "Burette selection appearance must win after LoadModel resets Mol* props");
assert.match(runtime, /await this\.plugin\.state\.setSnapshot\(snapshot\);\s*applyBuretteSelectionAppearance\(this\);/, "snapshot restore cannot reinstate native white/yellow selection props");
assert.match(runtime, /installBuretteSelectionAppearanceGuard/, "modifier key release cannot restore the upstream white selection mask");
assert.match(runtime, /keyReleased\.subscribe[\s\S]*?queueMicrotask[\s\S]*?hoverAppearanceActive \? 1 : 0/, "Ctrl+Shift key release restores whatever hover state the pointer is in");
assert.match(runtime, /selectStrength: 0/, "selection must preserve the original colors of selected structures");
assert.match(runtime, /selectEdgeColor: Color\(0xaf52de\)/, "selection outline uses the Burette accent instead of Mesoscale yellow");
assert.match(runtime, /setHoverAppearance/, "hover has its own appearance separate from selection");
assert.match(runtime, /dimStrength: dimmed \? 1 : 0/, "a resting scene keeps every structure colored, even while objects are selected");
assert.match(runtime, /const dimmed = active && this\.hoverDimming/, "only hover fades the rest, and only while dimming is enabled");
assert.match(runtime, /highlightStrength: active && !this\.hoverDimming \? 0\.45 : 0/, "with dimming off hover tints the hovered structure instead");
assert.match(runtime, /case "setHoverDimming"/, "the scene panel can switch the hover style at runtime");
assert.match(overlay, /setHoverDimming/, "the scene header exposes the hover-style toggle");
assert.match(runtime, /operatorDetail\.children\?\.push/, "operator groups preserve drill-down into individual instances");
assert.match(runtime, /suppressPrimaryMouse = false;\s*window\.clearTimeout\(suppressClickTimer\)/, "a compatibility click releases the next primary gesture");
assert.match(objectMenu, /text: "Selection"/);
assert.match(objectMenu, /isolateSelection/);
assert.doesNotMatch(scene, /mesoscale-style-editor/);
assert.match(toolbar, /setPreference\("theme"/);
assert.match(toolbar, /Switch to \$\{nextTheme\} theme/);
assert.doesNotMatch(toolbar, /SunMoon/);
assert.doesNotMatch(toolbar, /<select[^>]*aria-label="Viewer theme"/);
assert.match(toolbar, /M8 5h2v2H8V5/);
assert.doesNotMatch(toolbar, /MesoscaleSelectionBar/);
assert.match(selectionBar, /Selection level: Structure/);
assert.match(selectionBar, /Nothing selected/);
assert.match(selectionBar, /type: "setSelection", mode: "clear"/);
assert.match(selectionBar, /type: "setSelectionMode", enabled: false/);
for (const action of ["resetCamera", "orientAxes", "resetAxes", "exportPng", "setIllumination", "setMotion", "setSelectionMode"]) {
  assert.ok(rail.includes(`type: "${action}"`), `Burette viewport rail must expose ${action}`);
}
assert.match(rail, /Burette viewport controls/);
assert.match(toolbar, /setPointerCapture/);
assert.match(toolbar, /TOOLBAR_POSITION_KEY/);
assert.match(toolbar, /railFootprint/);
assert.match(toolbar, /positionMesoscaleControls/);

console.log("mesoscale UI ownership contract passed");
