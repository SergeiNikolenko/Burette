import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ViewerDocument, TextFileDocument } from "../apps/desktop/src/types";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle", "localStorage", "CSS"] as const)
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let release: (() => void) | undefined;
let delay = false;
const invoke = mock(async (command: string, args: { paths: string[] }) => {
  if (command === "open_documents") {
    if (delay) await new Promise<void>(resolve => { release = resolve; });
    return { documents: args.paths.map(path => ({ id: path, path, title: path, renderer: "molstar" })), errors: [] };
  }
  if (command === "open_text_files") return { documents: [], errors: [] };
  if (command === "read_text_file") return { content: "name,value\nsample,1", byteCount: 19 };
  throw new Error(command);
});
const { createRoot } = await import("react-dom/client");
const { useAppDockPayloadOpen } = await import("../apps/desktop/src/hooks/use-app-dock-payload-open");
const { useAppSpectrumDockLifecycle } = await import("../apps/desktop/src/hooks/use-app-spectrum-dock-lifecycle");
const { useDockLayout } = await import("../apps/desktop/src/hooks/use-dock-layout");
const { useTabWorkspaceStore, getTabWorkspace, WINDOW_TOOLS_ID } = await import("../apps/desktop/src/stores/tab-workspace-store");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const bottomDock = () => getTabWorkspace(WINDOW_TOOLS_ID).bottom;
const liveTabs = (...ids: string[]) => {
  useMoleculeStore.setState({ tabs: ids.map(id => ({ id, location: { kind: "launcher" }, back: [], forward: [] })), activeTabId: ids[0], documents: [], textDocuments: [] });
  useWorkspacePanesStore.setState({ selectedTabs: {}, closedGroups: {}, fullViewTabId: null });
};
const { useWorkspacePanesStore } = await import("../apps/desktop/src/stores/workspace-panes-store");
const { rightPanelSelection } = await import("../apps/desktop/src/lib/right-workspace-panel");
const rightTabs = () => useMoleculeStore.getState().tabs.filter(tab => tab.pane === "right");
const rightSelection = () => {
  const model = useMoleculeStore.getState();
  return rightPanelSelection(model.tabs, model.activeTabId, useWorkspacePanesStore.getState().selectedTabs.right);
};

test("mixed files stay in the requested panel, and slow right opens keep the newly selected tab focused", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke } });
  useTabWorkspaceStore.setState({ workspaces: {} });
  liveTabs("workspace-a", "workspace-b");
  let open!: ReturnType<typeof useAppDockPayloadOpen>;
  const noop = () => {};
  function Fixture() {
    const model = useMoleculeStore();
    const dock = useDockLayout(model.activeTabId);
    useAppSpectrumDockLifecycle({ ...dock, activeDocument: null, documents: model.documents, textDocuments: model.textDocuments });
    open = useAppDockPayloadOpen({ ...dock, preferences: {} as never, documents: model.documents, textDocuments: model.textDocuments,
      addBackgroundDocuments: model.addBackgroundDocuments, addBackgroundTextDocuments: model.addBackgroundTextDocuments,
      detectContentSpectrumPaths: async () => new Set(), openStructureRecordDocuments: async () => ({ opened: [], errors: [] }),
      pushErrorStatus: error => { throw error; }, pushStatus: noop, rememberRecentStructures: noop });
    return null;
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Fixture />));
    for (const [area, path] of [["right", "/image.png"], ["bottom", "/table.csv"], ["right", "/protein.pdb"], ["bottom", "/ligand.sdf"]] as const) {
      const before = area === "right" ? bottomDock() : rightTabs();
      await act(async () => open({ area, tabKind: "files", payload: { paths: [path], records: [] } }));
      if (area === "right") {
        expect(rightSelection()?.location).toMatchObject({ kind: path.endsWith("png") ? "document" : "file", path });
        expect(bottomDock()).toEqual(before);
      } else {
        expect(bottomDock().documentId).toBe(path.endsWith("csv") ? `media:${path}` : path);
        expect(rightTabs()).toEqual(before);
      }
    }
    expect(useMoleculeStore.getState().documents).toHaveLength(2);
    expect(invoke.mock.calls.filter(([command]) => command === "open_documents").map(([, args]) => args.paths)).toEqual([["/protein.pdb"], ["/ligand.sdf"]]);
    expect(rightTabs().map(tab => "path" in tab.location ? tab.location.path : null)).toEqual(["/image.png", "/protein.pdb"]);
    await act(async () => useMoleculeStore.getState().setActiveTab("workspace-a"));
    delay = true;
    let pending!: Promise<void>;
    await act(async () => { pending = open({ area: "right", tabKind: "files", payload: { paths: ["/slow.pdb"], records: [] } }); });
    await act(async () => useMoleculeStore.getState().setActiveTab("workspace-b"));
    await act(async () => { release!(); await pending; });
    expect(useMoleculeStore.getState().activeTabId).toBe("workspace-b");
    expect(rightTabs().some(tab => tab.location.kind === "file" && tab.location.path === "/slow.pdb")).toBe(true);
  } finally { delay = false; await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); }
});

test.each(["right", "bottom"] as const)("%s panel preserves text fallback and reuses registered files", async area => {
  const structures: ViewerDocument[] = [], texts: TextFileDocument[] = [], statuses: unknown[][] = [];
  const backend = mock(async (command: string, args: { paths: string[] }) => {
    if (command === "read_text_file") return { content: "smiles,name\nCCO,ethanol", byteCount: 23 };
    if (command === "open_documents") {
      const path = args.paths[0];
      if (path.endsWith("throw.nw")) throw new Error("Unsupported structure");
      return path.endsWith("broken.csv")
        ? { documents: [{ id: path, path, renderer: "not-renderable" }], errors: ["Invalid molecule"] }
        : { documents: [{ id: path, path, renderer: "molstar" }], errors: [] };
    }
    if (command === "open_text_files") return { documents: args.paths.map(path => ({ id: `text:${path}`, path, title: path, content: "source" })), errors: [] };
    throw new Error(command);
  });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke: backend } });
  useTabWorkspaceStore.setState({ workspaces: {} });
  liveTabs("text-workspace");
  let open!: ReturnType<typeof useAppDockPayloadOpen>;
  function Fixture() {
    const model = useMoleculeStore();
    const dock = useDockLayout(model.activeTabId);
    open = useAppDockPayloadOpen({ ...dock, preferences: {} as never, documents: model.documents, textDocuments: model.textDocuments,
      addBackgroundDocuments: docs => { structures.push(...docs); model.addBackgroundDocuments(docs); },
      addBackgroundTextDocuments: docs => { texts.push(...docs); model.addBackgroundTextDocuments(docs); },
      detectContentSpectrumPaths: async () => new Set(), openStructureRecordDocuments: async () => ({ opened: [], errors: [] }),
      pushErrorStatus: error => { throw error; }, pushStatus: (...args) => statuses.push(args), rememberRecentStructures: () => {} });
    return null;
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const send = async (paths: string[]) => act(async () => open({ area, tabKind: "files", payload: { paths, records: [] } }));
  const selectedId = () => {
    if (area === "bottom") return bottomDock().documentId;
    const location = rightSelection()?.location;
    return location?.kind === "file" || location?.kind === "text-file" ? location.documentId : null;
  };
  try {
    await act(async () => root.render(<Fixture />));
    await send(["/run.log", "/artifact.unknown", "/README"]);
    expect(backend.mock.calls.map(([command, args]) => [command, args.paths])).toEqual([
      ["open_text_files", ["/run.log", "/artifact.unknown", "/README"]],
    ]);
    expect(selectedId()).toBe("text:/run.log");
    await send(["/both.nw", "/throw.nw", "/broken.csv"]);
    expect(structures.map(doc => doc.path)).toEqual(["/both.nw"]);
    expect(texts.map(doc => doc.path)).toEqual(["/run.log", "/artifact.unknown", "/README", "/both.nw", "/throw.nw", "/broken.csv"]);
    expect(selectedId()).toBe("/both.nw");
    expect(statuses.some(status => status[1] === "error")).toBe(false);
    const count = backend.mock.calls.length;
    for (const [path, id] of [["/both.nw", "/both.nw"], ["/throw.nw", "text:/throw.nw"], ["/broken.csv", "text:/broken.csv"]]) {
      await send([path]);
      expect(selectedId()).toBe(id);
    }
    expect(backend.mock.calls.length).toBe(count);
    if (area === "right") {
      expect(bottomDock().documentId).toBeNull();
      expect(rightTabs()).toHaveLength(7);
    } else expect(rightTabs()).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); }
});

test("hidden Mol* panels stop the render loop and visible panels resume it", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
  const start = source.indexOf("    if (body.type === 'viewerVisibilityChanged') {");
  const end = source.indexOf("    if (event.source === window.parent && body.type === 'hostLayoutGesture')", start);
  const route = new Function("body", "activeViewer", "activeTrajectoryPlaybackControl", "scheduleViewerResize", `let hostViewerVisible = true; ${source.slice(start, end)}`);
  const calls: unknown[] = [];
  const viewer = { plugin: { animationLoop: { isAnimating: true, start() { this.isAnimating = true; calls.push("start"); }, stop(options: unknown) { this.isAnimating = false; calls.push(options); } } } };
  const playback = { visibilityChanged: () => calls.push("playback") };
  const resize = () => calls.push("resize");
  route({ type: "viewerVisibilityChanged", visible: false }, viewer, playback, resize);
  expect(calls).toEqual(["playback", { noDraw: true }]);
  calls.length = 0;
  route({ type: "viewerVisibilityChanged", visible: true }, viewer, playback, resize);
  expect(calls).toEqual(["playback", "start", "resize"]);
  calls.length = 0;
  route({ type: "viewerVisibilityChanged", visible: true }, viewer, playback, resize);
  expect(calls).toEqual(["playback", "resize"]);
});
