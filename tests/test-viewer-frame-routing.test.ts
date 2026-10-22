import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { activeViewerIframeForDocument, postMessageToViewerSource } from "../apps/desktop/src/lib/viewer-bridge";
import { dockCameraRestore, prepareDockCameraTransfer, rememberDockCamera, retainDockCameraWorkspaces } from "../apps/desktop/src/lib/dock-camera-transfer";
import type { ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window();
Object.assign(globalThis, { document: browser.document, CSS: browser.CSS });

test("duplicate documents route to the visible scene before warm history, including pane and read-only views", () => {
  document.body.innerHTML = `
    <div class="page-surface" data-active="true">
      <div class="tab-history-page" hidden><iframe id="history" class="viewer-iframe" data-document-id="a" data-renderer="molstar"></iframe></div>
      <div class="tab-history-page"><iframe id="current" class="viewer-iframe" data-document-id="b" data-renderer="molstar"></iframe></div>
    </div>
    <div class="page-surface" data-pane="floating" data-pane-shown="visible">
      <div class="tab-history-page"><iframe id="pane" class="viewer-iframe" data-document-id="a" data-renderer="molstar"></iframe></div>
    </div>`;
  const history = document.querySelector<HTMLIFrameElement>("#history")!;
  const pane = document.querySelector<HTMLIFrameElement>("#pane")!;
  const current = document.querySelector<HTMLIFrameElement>("#current")!;
  const resolve = () => activeViewerIframeForDocument("a", "molstar");
  expect(resolve()).toBe(pane);
  expect(activeViewerIframeForDocument("b")).toBe(current);
  const messages: unknown[] = [];
  pane.contentWindow!.postMessage = message => { messages.push(message); };
  const payload = { body: { documentId: "a", type: "targeted-command" } };
  postMessageToViewerSource(null, payload);
  expect(messages).toEqual([payload]);

  pane.closest(".page-surface")!.setAttribute("data-pane", "floating");
  expect(resolve()).toBe(pane);
  pane.dataset.readOnly = "true";
  expect(resolve()).toBe(pane);
  pane.closest(".page-surface")!.setAttribute("data-pane-shown", "minimized");
  expect(resolve()).toBe(history);
  pane.closest(".page-surface")!.setAttribute("data-pane-shown", "visible");
  history.parentElement!.removeAttribute("hidden");
  expect(resolve()).toBe(history);
  history.parentElement!.setAttribute("hidden", "");
  pane.setAttribute("aria-hidden", "true");
  expect(resolve()).toBe(history);
  expect(activeViewerIframeForDocument("missing")).toBeNull();
  document.body.replaceChildren();
});

test("explicit transfer authenticates the source and keeps the pane camera independent across remounts", async () => {
  Object.assign(globalThis, { window: browser });
  retainDockCameraWorkspaces(["workspace-a"]);
  document.body.innerHTML = `<iframe class="viewer-iframe" data-document-id="transfer" data-renderer="molstar" id="source"></iframe>
    <aside class="dock-panel" data-area="right" data-workspace-id="workspace-a"><iframe class="viewer-iframe" data-document-id="transfer" data-read-only="true" id="dock"></iframe></aside>`;
  const source = document.querySelector<HTMLIFrameElement>("#source")!.contentWindow!;
  const dock = document.querySelector<HTMLIFrameElement>("#dock")!;
  const panel = dock.parentElement!;
  dock.remove();
  const viewState = { camera: { position: [12, 4, 8], target: [1, 2, 3], up: [0, 1, 0], radius: 4 } };
  const viewport = { width: 1200, height: 800 };
  let captures = 0;
  source.postMessage = message => {
    captures++;
    const body = { type: "rendererViewStateCaptured", documentId: "transfer", requestId: message.body.requestId, viewState, viewport };
    browser.dispatchEvent(new browser.MessageEvent("message", { source: dock.contentWindow, data: { source: "burette-viewer", body } }));
    expect(dockCameraRestore(dock.contentWindow, "transfer")).toBeUndefined();
    browser.dispatchEvent(new browser.MessageEvent("message", { source, data: { source: "burette-viewer", body } }));
  };
  const doc = { id: "transfer", renderer: "molstar" } as ViewerDocument;
  await prepareDockCameraTransfer("right", doc, "workspace-a");
  panel.append(dock);
  expect(dockCameraRestore(source, "transfer")).toBeUndefined();
  expect(dockCameraRestore(dock.contentWindow, "transfer")).toEqual({ viewState: JSON.stringify(viewState), sourceViewport: viewport });
  const adjusted = { camera: { ...viewState.camera, position: [23, 6, 13] } };
  expect(rememberDockCamera(source, "transfer", viewState)).toBe(false);
  expect(rememberDockCamera(dock.contentWindow, "transfer", adjusted)).toBe(true);
  expect(dockCameraRestore(dock.contentWindow, "transfer")).toEqual({ viewState: JSON.stringify(adjusted) });
  const replacement = dock.cloneNode() as HTMLIFrameElement;
  dock.replaceWith(replacement);
  await prepareDockCameraTransfer("right", doc, "workspace-a");
  expect(captures).toBe(1);
  expect(dockCameraRestore(replacement.contentWindow, "transfer")).toEqual({ viewState: JSON.stringify(adjusted) });
  expect(dockCameraRestore(replacement.contentWindow, "legacy")).toBeUndefined();
  replacement.dataset.documentId = "mounted";
  document.querySelector<HTMLIFrameElement>("#source")!.dataset.documentId = "mounted";
  await prepareDockCameraTransfer("right", { id: "mounted", renderer: "molstar" } as ViewerDocument, "workspace-a");
  expect(captures).toBe(1);
  expect(dockCameraRestore(replacement.contentWindow, "mounted")).toBeUndefined();
  document.body.replaceChildren();
});

test.each(["reply", "disconnected", "timeout", "closed"])("delayed existing-document camera capture stays in workspace A after switching to B (%s)", async outcome => {
  for (const name of ["window", "navigator", "HTMLElement", "Element", "Node", "Event", "localStorage"] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? browser : browser[name] });
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
  const { useTabWorkspaceStore } = await import("../apps/desktop/src/stores/tab-workspace-store");
  const { useDockLayout } = await import("../apps/desktop/src/hooks/use-dock-layout");
  const { useAppDockPayloadOpen } = await import("../apps/desktop/src/hooks/use-app-dock-payload-open");
  const doc = { id: `shared-${outcome}`, path: `/shared-${outcome}.pdb`, renderer: "molstar" } as ViewerDocument;
  const tabs = ["A", "B"].map(id => ({ id, location: { kind: "file" as const, documentId: doc.id, path: doc.path }, back: [], forward: [] }));
  useMoleculeStore.setState({ tabs, activeTabId: "A", documents: [doc] });
  useTabWorkspaceStore.setState({ workspaces: {} });
  document.body.innerHTML = `<div id="harness"></div><iframe class="viewer-iframe" data-document-id="${doc.id}" data-renderer="molstar" id="source"></iframe>`;
  const root = createRoot(document.querySelector("#harness")!);
  let open!: ReturnType<typeof useAppDockPayloadOpen>;
  function Harness() {
    const active = useMoleculeStore(state => state.activeTabId);
    const { captureDockTarget } = useDockLayout(active);
    open = useAppDockPayloadOpen({
      captureDockTarget, documents: [doc], textDocuments: [], preferences: {} as never,
      addBackgroundDocuments() {}, addBackgroundTextDocuments() {}, openDocumentTab() {},
      detectContentSpectrumPaths: async () => new Set(), openStructureRecordDocuments: async () => ({ opened: [], errors: [] }),
      pushStatus() {}, pushErrorStatus: error => { throw error; }, rememberRecentStructures() {},
    });
    return null;
  }
  const frame = document.querySelector<HTMLIFrameElement>("#source")!;
  const source = frame.contentWindow!;
  let requestId = "";
  source.postMessage = message => { requestId = message.body.requestId; };
  const viewState = { camera: { position: [3, 4, 12], target: [1, 2, 3], up: [0, 1, 0], radius: 4 } };
  let pending!: Promise<void>;
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => { pending = open({ area: "right", tabKind: "files", payload: { paths: [doc.path], records: [] } }); });
    expect(requestId).not.toBe("");
    await act(async () => useMoleculeStore.setState({ activeTabId: "B", ...(outcome === "closed" ? { tabs: tabs.slice(1) } : {}) }));
    if (outcome === "disconnected") frame.remove();
    await act(async () => {
      if (outcome !== "timeout") browser.dispatchEvent(new browser.MessageEvent("message", { source, data: { source: "burette-viewer", body: {
        type: "rendererViewStateCaptured", requestId, documentId: doc.id, viewState, viewport: { width: 1200, height: 800 },
      } } }));
      await pending;
    });
    const workspaces = useTabWorkspaceStore.getState().workspaces;
    expect(workspaces.B).toBeUndefined();
    if (outcome === "closed") expect(workspaces.A).toBeUndefined();
    else {
      expect(workspaces.A.right.documentId).toBe(doc.id);
      expect(workspaces.A.droppedStructures.map(drop => drop.payload.paths)).toEqual([[doc.path]]);
    }
    const panel = document.createElement("aside");
    panel.className = "dock-panel";
    panel.dataset.area = "right";
    panel.dataset.workspaceId = "A";
    panel.innerHTML = `<iframe class="viewer-iframe" data-document-id="${doc.id}" data-read-only="true"></iframe>`;
    document.body.append(panel);
    const dock = panel.querySelector("iframe")!.contentWindow!;
    expect(dockCameraRestore(dock, doc.id)).toEqual(outcome === "reply"
      ? { viewState: JSON.stringify(viewState), sourceViewport: { width: 1200, height: 800 } } : undefined);
    panel.dataset.workspaceId = "B";
    expect(dockCameraRestore(dock, doc.id)).toBeUndefined();
    const bView = { camera: { ...viewState.camera, position: [5, 6, 40] } };
    expect(rememberDockCamera(dock, doc.id, bView)).toBe(true);
    panel.dataset.workspaceId = "A";
    expect(dockCameraRestore(dock, doc.id)?.viewState).toBe(outcome === "reply" ? JSON.stringify(viewState) : undefined);
    panel.dataset.workspaceId = "B";
    expect(dockCameraRestore(dock, doc.id)).toEqual({ viewState: JSON.stringify(bView) });
    await act(async () => useMoleculeStore.setState({ tabs: [] }));
    expect(rememberDockCamera(dock, doc.id, bView)).toBe(true);
    expect(dockCameraRestore(dock, doc.id)).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    retainDockCameraWorkspaces([]);
  }
});

test("workspace camera checkpoints remain bounded and an evicted pane cannot write the source camera", () => {
  retainDockCameraWorkspaces(["bounded"]);
  document.body.innerHTML = '<aside class="dock-panel" data-workspace-id="bounded" data-area="right"><iframe class="viewer-iframe" data-read-only="true"></iframe></aside>';
  const frame = document.querySelector("iframe")!;
  for (let index = 0; index < 65; index++) {
    frame.dataset.documentId = `doc-${index}`;
    expect(rememberDockCamera(frame.contentWindow, `doc-${index}`, { camera: { position: [index, 0, 0] } })).toBe(true);
  }
  frame.dataset.documentId = "doc-0";
  expect(dockCameraRestore(frame.contentWindow, "doc-0")).toBeUndefined();
  expect(rememberDockCamera(frame.contentWindow, "doc-0", { camera: { position: [9, 0, 0] } })).toBe(true);
  expect(dockCameraRestore(frame.contentWindow, "doc-0")).toEqual({ viewState: JSON.stringify({ camera: { position: [9, 0, 0] } }) });
  retainDockCameraWorkspaces([]);
  document.body.replaceChildren();
});
