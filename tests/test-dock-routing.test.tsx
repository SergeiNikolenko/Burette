import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle", "localStorage"] as const)
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
const { useTabWorkspaceStore, getTabWorkspace } = await import("../apps/desktop/src/stores/tab-workspace-store");
const { dockFileEntries } = await import("../apps/desktop/src/lib/dock");

test("mixed files stay in the requested panel, and slow opens retain their originating workspace", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke } });
  useTabWorkspaceStore.setState({ workspaces: {} });
  let open!: ReturnType<typeof useAppDockPayloadOpen>;
  const added: unknown[] = [];
  const noop = () => {};
  function Fixture({ tabId }: { tabId: string }) {
    const dock = useDockLayout(tabId);
    useAppSpectrumDockLifecycle({ ...dock, activeDocument: null, documents: added as never, textDocuments: [] });
    open = useAppDockPayloadOpen({ ...dock, preferences: {} as never, documents: [], textDocuments: [],
      addBackgroundDocuments: docs => added.push(...docs), addBackgroundTextDocuments: noop,
      detectContentSpectrumPaths: async () => new Set(), openStructureRecordDocuments: async () => ({ opened: [], errors: [] }),
      pushErrorStatus: error => { throw error; }, pushStatus: noop, rememberRecentStructures: noop });
    return null;
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Fixture tabId="workspace-a" />));
    for (const [area, path] of [["right", "/image.png"], ["bottom", "/table.csv"], ["right", "/protein.pdb"], ["bottom", "/ligand.sdf"]] as const) {
      const opposite = area === "right" ? "bottom" : "right";
      const before = getTabWorkspace("workspace-a")[opposite];
      await act(async () => open({ area, tabKind: "files", payload: { paths: [path], records: [] } }));
      expect(getTabWorkspace("workspace-a")[area].documentId).toBe(path.endsWith("png") || path.endsWith("csv") ? `media:${path}` : path);
      expect(getTabWorkspace("workspace-a")[opposite]).toEqual(before);
    }
    expect(added).toHaveLength(2);
    expect(invoke.mock.calls.filter(([command]) => command === "open_documents").map(([, args]) => args.paths)).toEqual([["/protein.pdb"], ["/ligand.sdf"]]);
    const workspace = getTabWorkspace("workspace-a");
    expect(dockFileEntries({ dockDrops: workspace.droppedStructures.filter(drop => drop.area === "right"), documents: added as never, textDocuments: [], activeDocumentId: workspace.right.documentId, activeTool: null }).map(entry => entry.title)).toEqual(["/protein.pdb", "image.png"]);
    delay = true;
    let pending!: Promise<void>;
    await act(async () => { pending = open({ area: "right", tabKind: "files", payload: { paths: ["/slow.pdb"], records: [] } }); });
    await act(async () => root.render(<Fixture tabId="workspace-b" />));
    await act(async () => { release!(); await pending; });
    expect(getTabWorkspace("workspace-a").right.documentId).toBe("/slow.pdb");
    expect(getTabWorkspace("workspace-b").right.documentId).toBeNull();
  } finally { delay = false; await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); }
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
