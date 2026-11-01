import { afterAll, expect, test } from "bun:test";
import { plugin as installPlugin } from "bun";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { molstarCubeUnitsPlugin } from "../scripts/molstar-cube-units.mjs";
import { molstarCubeDatasetsPlugin } from "../scripts/molstar-cube-datasets.mjs";
import { molstarCubeUiHistoryPlugin } from "../scripts/molstar-cube-ui-history.mjs";
export { test, expect, React, act };
export const original = readFileSync(new URL("fixtures/cube-ui-history/three-fields.cube", import.meta.url), "utf8");
export const oracle = JSON.parse(readFileSync(new URL("fixtures/cube-ui-history/oracle.json", import.meta.url), "utf8"));
const browser = new Window({ url: "http://localhost/" });
Object.assign(browser, { setImmediate, clearImmediate });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "document", "navigator", "DocumentFragment", "HTMLFormElement", "HTMLSelectElement", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
installPlugin(molstarCubeUnitsPlugin); installPlugin(molstarCubeDatasetsPlugin); installPlugin(molstarCubeUiHistoryPlugin);
const { PluginUIContext } = await import("@molstar/plugin-ui/context");
const { DefaultPluginUISpec } = await import("@molstar/plugin-ui/default-spec");
const { PluginReactContext } = await import("@molstar/plugin-ui/base");
const { LeftPanelControls } = await import("@molstar/plugin-ui/left-panel");
const { OpenFiles } = await import("@molstar/plugin/state/actions/file");
const { PluginStateObject } = await import("@molstar/plugin/state/objects");
const { TransformUpdaterControl, UpdateTransformControl } = await import("@molstar/plugin-ui/state/update-transform");
const { StateTransforms } = await import("@molstar/viewer/state-transforms");
const { CubeProvider } = await import("@molstar/plugin/state/formats/volume/cube");
const { Asset } = await import("@molstar/core/util/assets");
const { File_ } = await import("@molstar/core/util/nodejs-shims");
const { createRoot } = await import("react-dom/client");
const { mountViewerSelectionActions } = await import("../apps/desktop/src/preview-controls/viewer-selection-controls");
const { mountViewerSelectionToolbar } = await import("../apps/desktop/src/preview-controls/viewer-selection-toolbar");
const source = readFileSync("PreviewExtension/Web/viewer.js", "utf8");
const attachStart = source.indexOf("    activeViewer = viewer;\n");
const attachEnd = source.indexOf("    await viewer.plugin.managers.structure.component.setOptions", attachStart);
expect(attachStart).toBeGreaterThan(0); expect(attachEnd).toBeGreaterThan(attachStart);
const attachSource = source.slice(attachStart, attachEnd);
const method = (name: string) => {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  if (start < 0) throw new Error(`Missing viewer owner: ${name}`);
  return source.slice(start, source.indexOf("\n  }", start) + 4);
};
export const wait = async (check: () => boolean, label: string) => { for (let i = 0; i < 100 && !check(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5))); expect(check(), label).toBe(true); };
export const click = async (container: Element, label: string) => { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label); expect(button, label).toBeDefined(); await act(async () => button!.click()); };

export async function fixture() {
  const plugin = new PluginUIContext({ ...DefaultPluginUISpec(), components: { remoteState: "none" } }); await plugin.init();
  const asset = Asset.File(new File_([original], "three-fields.cube"));
  const { data } = await plugin.builders.data.readFile({ file: asset, isBinary: false });
  const parsed = await CubeProvider.parse(plugin, data);
  const cubeCell = [...plugin.state.data.cells.values()].find(cell => cell.transform.transformer.id === "ms-plugin.volume-from-cube")!;
  const volumeRef = cubeCell.transform.ref, formatRef = cubeCell.transform.parent;
  const sourceObject = data.cell!.obj, formatObject = plugin.state.data.cells.get(formatRef)!.obj;
  const structure = parsed.structure.cell!.obj!.data;
  const atomPositions = () => Array.from({ length: structure.models[0].atomicHierarchy.atoms._rowCount }, (_, i) => [structure.models[0].atomicConformation.x[i], structure.models[0].atomicConformation.y[i], structure.models[0].atomicConformation.z[i]]);
  const host = document.createElement("div"), bar = document.createElement("div"); document.body.append(host, bar);
  const root = createRoot(host), viewer = { plugin }, notifications: unknown[] = [];
  let active = true;
  const bindings = { window: { BuretteNativeViewerMenus: { stylePopover() {}, mountSelectionActions: mountViewerSelectionActions } }, document,
    activeMolstarViewer: () => active ? viewer : null, viewportPlugin: () => plugin, activeConfig: {}, resolveViewerTheme: () => "light",
    postHostMessage: (message: unknown) => notifications.push(message), debug() {}, setStatus() {}, hideStatus() {}, setTimeout, isQuickLookHost: () => false,
    setMolstarStructureDirty() {}, syncMolstarIllustrativeOutline() {}, scheduleSceneTreeRender() {},
    SCENE_TREE_UNIFORM_COLORS: [], sceneTreeColorHex: (value: number) => String(value), positionOpenViewportMenu() {}, addViewportSelectionComponent() {}, paintViewportSelection() {} };
  const methods = ["installMolstarCubeDatasetHistory", "captureMolstarSceneUndoSnapshot", "pushMolstarHistorySnapshot", "notifyMolstarEditHistoryChanged", "pushMolstarEditUndoSnapshot", "runMolstarSceneEdit", "clearMolstarEditUndoHistory", "restoreMolstarSceneUndoSnapshot", "restoreMolstarEditUndoSnapshot", "undoMolstarLastEdit", "captureMolstarHistoryCounterpart", "redoMolstarLastEdit", "runViewportMenuAction", "viewportApplyMenu"].map(method).join("\n");
  const api = new Function(...Object.keys(bindings), `let activeViewer=null, molstarStructureDirty=false, activeStructureAlignmentControl=null, viewportMenuControls=null, menu=null;
    const molstarEditUndoStack=[], molstarEditRedoStack=[]; ${source.match(/const MOLSTAR_EDIT_HISTORY_LIMIT = \d+;/)![0]}
    function closeViewportMenu(){viewportMenuControls?.dispose();viewportMenuControls=null;menu?.remove();menu=null;}
    ${methods}
    return { attach: viewer=>{${attachSource}}, clear:clearMolstarEditUndoHistory, sizes:()=>[molstarEditUndoStack.length,molstarEditRedoStack.length],
      openApply:()=>{closeViewportMenu();menu=document.createElement('div');document.body.append(menu);viewportApplyMenu(menu);}, close:closeViewportMenu };
  `)(...Object.values(bindings));
  api.attach(viewer);
  let toolbar: ReturnType<typeof mountViewerSelectionToolbar>;
  await act(async () => { root.render(<PluginReactContext.Provider value={plugin}><TransformUpdaterControl nodeRef={volumeRef} /></PluginReactContext.Provider>);
    toolbar = mountViewerSelectionToolbar(bar, { read: () => ({ level: "element", label: "" }), levels: [["element", "Atom"]], onAction: action => { if (action === "apply") api.openApply(); }, onLevel() {} }); });
  const cell = () => plugin.state.data.cells.get(volumeRef)!;
  return { plugin, host, bar, asset, data, volumeRef, notifications, api, cell, atomPositions, deactivate: () => { active = false; },
    replaceSource: async () => {
      await act(async () => { plugin.behaviors.layout.leftPanelTabName.next("data"); root.render(<PluginReactContext.Provider value={plugin}><LeftPanelControls /></PluginReactContext.Provider>); });
      const remove = host.querySelector<HTMLButtonElement>('button[title="Remove All"]'); expect(remove).not.toBeNull();
      await act(async () => remove!.click()); await wait(() => !plugin.state.data.cells.has(volumeRef), "native Remove All completed");
      const nextText = original.replace("Oblique", "Revised"), nextAsset = Asset.File(new File_([nextText], "replacement.cube"));
      await act(async () => { await plugin.runTask(plugin.state.data.applyAction(OpenFiles, { files: [nextAsset], format: { name: "auto", params: {} }, visuals: false })); });
      const nextVolume = [...plugin.state.data.cells.values()].find(cell => cell.transform.transformer.id === "ms-plugin.volume-from-cube")!;
      expect(nextVolume.transform.ref).not.toBe(volumeRef); expect(await plugin.managers.asset.get(nextAsset)!.file.text()).toBe(nextText);
      return () => ({ index: nextVolume.params!.values.dataIndex, values: Array.from((nextVolume.obj!.data as any).grid.cells.data) });
    },
    choose: async (id: number) => { await act(async () => host.querySelector<HTMLButtonElement>(".msp-select-toggle")!.click()); await click(host, String(id)); },
    render: async (ref: string, customUpdate?: (params: any) => Promise<void>) => { await act(async () => root.render(<PluginReactContext.Provider value={plugin}>{customUpdate
      ? <UpdateTransformControl state={plugin.state.data} transform={plugin.state.data.cells.get(ref)!.transform} customUpdate={customUpdate} />
      : <TransformUpdaterControl nodeRef={ref} />}</PluginReactContext.Provider>)); },
    verify: async (id: number) => {
      const grid = (cell().obj!.data as any).grid;
      expect({ index: cell().params!.values.dataIndex, values: Array.from(grid.cells.data), dimensions: grid.cells.space.dimensions, matrix: Array.from(grid.transform.matrix), atoms: atomPositions() })
        .toEqual({ index: oracle.datasetIds.indexOf(id), values: oracle.fieldValues[String(id)], dimensions: oracle.dimensions, matrix: oracle.matrixColumnMajor, atoms: oracle.atomsAngstrom });
      expect(data.cell!.obj).toBe(sourceObject); expect(plugin.state.data.cells.get(formatRef)!.obj).toBe(formatObject);
      // The pinned reader keeps the file as a response body; its bytes are the original text.
      expect(new TextDecoder().decode(PluginStateObject.Data.readBytes(data.cell!.obj!))).toBe(original); expect(plugin.managers.asset.get(asset)!.asset).toBe(asset);
      expect(await plugin.managers.asset.get(asset)!.file.text()).toBe(original);
    },
    history: async (direction: "Undo" | "Redo") => { await click(bar, "Apply"); const menu = document.querySelector(".buret-selection-apply")!; await click(menu, direction); },
    close: async () => { await act(async () => { api.close(); toolbar.dispose(); root.unmount(); }); host.remove(); bar.remove(); plugin.dispose(); },
  };
}
export { StateTransforms };
afterAll(async () => { await act(async () => new Promise(resolve => setTimeout(resolve, 20))); await browser.happyDOM.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
