import { useEffect, useRef } from "react";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import type { ShellActions } from "../types";
import type { MoleculeTab } from "../../stores/molecule-store";
import { useMoleculeStore } from "../../stores/molecule-store";
import { requestViewerAction, activeViewerIframeForDocument } from "../../lib/viewer-bridge";
import { focusSceneDocument } from "../../hooks/workspace-scene-import";
import { captureWorkspaceSceneSnapshot } from "../../hooks/workspace-scene-snapshot";
import { sameSceneSource, waitForSceneScienceRestore } from "../../lib/science-session/restore";
import { isTauriRuntime, trackTauriListener } from "../../lib/tauri";
import { toast } from "../ui/toast";
import { useSourceEditing, type SourceEditingContextValue } from "../../lib/source-editing/context";

let sourceEditing: SourceEditingContextValue | null = null;
const CHANNEL = "burette-scene-window-handoff";
type Placement = { title: string; index: number; pinned: boolean };
type Offer = Placement & { kind: "offer" | "return"; id: string; from: string; path: string };
type Reply = { kind: "ready" | "failed"; id: string; from: string };
type Owner = Placement & { parent: string; tabId: string };
const usePopout = create<{ owner: Owner | null; busy: boolean }>(() => ({ owner: null, busy: false }));
const pending = new Map<string, { peer: string; finish: (ok: boolean) => void }>();
const emitTo = (target: string, _channel: string, message: Offer | Reply) => invoke("relay_popout_handoff", { target, message });

export function nativePopoutReason(tab: MoleculeTab): string | null {
  if (!isTauriRuntime()) return null;
  const location = tab.location;
  const document = location.kind === "file"
    ? useMoleculeStore.getState().documents.find(doc => doc.id === location.documentId)
    : null;
  if (!document || !["molstar", "xyzrender-external"].includes(document.renderer)) return "Available for molecular scenes and sheets";
  const source = sourceEditing?.sessionForDocument(document);
  if (source?.dirty || source?.saving) return "Save source changes before moving this scene";
  if (document.dockingRequest && !document.dockingRequest.sceneMode || /\.(mvsj|mvsx|xtc|dcd|trr|nc)$/i.test(document.path)) return "Keep this trajectory or Story in its workspace";
  if (usePopout.getState().busy) return "Wait for the scene to finish moving";
  return null;
}

function currentDocument(tabId: string) {
  const store = useMoleculeStore.getState();
  const tab = store.tabs.find(tab => tab.id === tabId);
  const location = tab?.location;
  const document = location?.kind === "file" ? store.documents.find(doc => doc.id === location.documentId) : null;
  if (!document) throw new Error("The scene is no longer open.");
  return document;
}

async function checkpoint(tabId: string) {
  const document = currentDocument(tabId);
  const source = sourceEditing?.sessionForDocument(document);
  if (source?.dirty || source?.saving) throw new Error("Save source changes before moving this scene.");
  const snapshot = await captureWorkspaceSceneSnapshot(document, { sourceEditing, sceneFileCount: new Set(document.sceneSourcePaths ?? [document.path]).size, scientificData: "require" });
  if (snapshot.document.renderer === "molstar") {
    const story = await requestViewerAction(snapshot.document.id, { type: "observe_story" });
    if (Number(story.count) > 1) throw new Error("Keep this Story in its workspace.");
  }
  const confirm = async () => {
    await snapshot.confirm();
    const current = sourceEditing?.sessionForDocument(snapshot.document);
    if (current?.dirty || current?.saving) throw new Error("Save source changes before moving this scene.");
  };
  await confirm();
  const path = snapshot.result.kind === "sheet"
    ? await invoke<string>("save_popout_sheet", { sourcePath: snapshot.document.path, sheet: snapshot.result.sheet })
    : await invoke<string>("save_popout_scene", { dataBase64: snapshot.result.dataBase64 });
  return { path, confirm };
}

function tell(peer: string, message: Offer) {
  return new Promise<void>((resolve, reject) => {
    const finish = (ok: boolean) => {
      clearTimeout(timeout); clearInterval(retry); pending.delete(message.id);
      if (ok) resolve(); else reject(new Error("The other window could not load the scene. Your scene is still open."));
    };
    const send = () => { void emitTo(peer, CHANNEL, message).catch(() => finish(false)); };
    const timeout = setTimeout(() => finish(false), 60000);
    const retry = setInterval(send, 1000);
    pending.set(message.id, { peer, finish });
    send();
  });
}

export async function popOutNativeScene(tabId: string) {
  const store = useMoleculeStore.getState();
  const tab = store.tabs.find(tab => tab.id === tabId);
  if (!tab || nativePopoutReason(tab)) return;
  usePopout.setState({ busy: true });
  let surface: HTMLElement | null | undefined;
  try {
    surface = activeViewerIframeForDocument(currentDocument(tabId).id)?.closest<HTMLElement>(".page-surface");
    if (surface) surface.inert = true;
    const captured = await checkpoint(tabId);
    const path = captured.path;
    const peer = await invoke<string>("open_new_workspace_window", { paths: [path] });
    await tell(peer, { kind: "offer", id: crypto.randomUUID(), from: getCurrentWindow().label,
      path, title: tab.title ?? currentDocument(tabId).title, index: store.tabs.indexOf(tab), pinned: tab.pinned === true });
    // Only an acknowledged, nonempty loaded destination can retire the original scene.
    await captured.confirm();
    useMoleculeStore.getState().closeTab(tabId);
  } catch (error) {
    toast.add({ title: "Could not move scene", description: error instanceof Error ? error.message : "Try again with the scene open.", type: "error" });
  } finally {
    if (surface) surface.inert = false;
    usePopout.setState({ busy: false });
  }
}

// Closing the detached window returns its latest scene if the parent still
// exists. If it has closed, a durable checkpoint remains in this workspace.
export async function returnNativePopout(): Promise<boolean> {
  const { owner, busy } = usePopout.getState();
  if (!owner) return false;
  if (!useMoleculeStore.getState().tabs.some(tab => tab.id === owner.tabId)) { usePopout.setState({ owner: null }); return false; }
  if (busy) throw new Error("Wait for the scene to finish moving.");
  usePopout.setState({ busy: true });
  let surface: HTMLElement | null | undefined;
  try {
    surface = activeViewerIframeForDocument(currentDocument(owner.tabId).id)?.closest<HTMLElement>(".page-surface");
    if (surface) surface.inert = true;
    const captured = await checkpoint(owner.tabId);
    const path = captured.path;
    if (!await Window.getByLabel(owner.parent)) {
      await captured.confirm();
      retainCheckpoint(owner.tabId, path);
      usePopout.setState({ owner: null });
      return false;
    }
    await tell(owner.parent, { ...owner, kind: "return", id: crypto.randomUUID(), from: getCurrentWindow().label, path });
    await captured.confirm();
    useMoleculeStore.getState().closeTab(owner.tabId);
    usePopout.setState({ owner: null });
    const remaining = useMoleculeStore.getState().tabs.some(tab => !["launcher", "settings"].includes(tab.location.kind));
    if (remaining) return false;
    await invoke("close_workspace_window");
    return true;
  } finally {
    if (surface) surface.inert = false;
    usePopout.setState({ busy: false });
  }
}

function retainCheckpoint(tabId: string, path: string) {
  const document = currentDocument(tabId);
  useMoleculeStore.setState(state => ({
    documents: state.documents.map(doc => doc.id === document.id ? { ...doc, path, virtual: false } : doc),
    tabs: state.tabs.map(tab => tab.id === tabId && tab.location.kind === "file" ? { ...tab, location: { ...tab.location, path } } : tab),
  }));
}

export async function checkpointNativePopoutForExit() {
  if (usePopout.getState().busy) throw new Error("Wait for the scene to finish moving.");
  const owner = usePopout.getState().owner;
  if (!owner) return;
  if (!useMoleculeStore.getState().tabs.some(tab => tab.id === owner.tabId)) { usePopout.setState({ owner: null }); return; }
  usePopout.setState({ busy: true });
  try { const captured = await checkpoint(owner.tabId); await captured.confirm(); retainCheckpoint(owner.tabId, captured.path); }
  finally { usePopout.setState({ busy: false }); }
}

export function useNativePopoutSession(actions: ShellActions) {
  sourceEditing = useSourceEditing();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const current = getCurrentWindow();
    const received = new Map<string, Promise<boolean>>();
    return trackTauriListener(current.listen<Offer | Reply>(CHANNEL, async ({ payload }) => {
      if (!payload || typeof payload !== "object" || typeof payload.id !== "string" || typeof payload.from !== "string") return;
      if (payload.kind === "ready" || payload.kind === "failed") {
        const waiting = pending.get(payload.id);
        if (waiting?.peer === payload.from) waiting.finish(payload.kind === "ready");
        return;
      }
      if (!("path" in payload)) return;
      if (!["offer", "return"].includes(payload.kind) || !/^[a-zA-Z0-9-]+$/.test(payload.from)
        || typeof payload.path !== "string" || !/\/popout-scenes\/[a-f0-9-]+\.[a-zA-Z0-9]{1,10}$/.test(payload.path) || payload.path.length > 4096
        || typeof payload.title !== "string" || payload.title.length > 1024 || typeof payload.pinned !== "boolean" || !Number.isInteger(payload.index)) return;
      let receipt = received.get(payload.id);
      if (!receipt) {
        receipt = (async () => {
          if (payload.kind === "return") await actionsRef.current.openStructurePaths([payload.path], { mode: "individual" });
          const store = useMoleculeStore.getState();
          const document = store.documents.find(doc => doc.path === payload.path);
          if (!document) return false;
          const tab = store.tabs.find(tab => tab.location.kind === "file" && tab.location.documentId === document.id);
          if (!tab) return false;
          await focusSceneDocument(document, store.setActiveDocument);
          const ready = await requestViewerAction(document.id, { type: "workspace_scene_state" });
          if (!ready.ready) return false;
          const confirmRestore = await waitForSceneScienceRestore(document);
          confirmRestore?.();
          if (!useMoleculeStore.getState().documents.some(current => current.id === document.id && sameSceneSource(current, document))) return false;
          store.renameTab(tab.id, payload.title);
          if (Boolean(tab.pinned) !== payload.pinned) store.togglePinnedTab(tab.id);
          if (payload.kind === "offer") usePopout.setState({ owner: { parent: payload.from, tabId: tab.id, title: payload.title, index: payload.index, pinned: payload.pinned } });
          else store.moveTab(tab.id, Math.max(0, Math.min(payload.index, store.tabs.length - 1)));
          return true;
        })().catch(() => false);
        received.set(payload.id, receipt);
        if (received.size > 16) received.delete(received.keys().next().value!);
      }
      const ok = await receipt;
      // A fresh window may receive the offer before startup has opened its file.
      if (!ok) received.delete(payload.id);
      if (ok) await emitTo(payload.from, CHANNEL, { kind: "ready", id: payload.id, from: current.label } satisfies Reply);
    }), "native scene handoff");
  }, []);
}

export function useNativePopoutOwner() { return usePopout(state => state.owner); }
export function nativePopoutBusy() { return usePopout.getState().busy; }
export function isNativePopoutTab(tabId: string) { return usePopout.getState().owner?.tabId === tabId; }
