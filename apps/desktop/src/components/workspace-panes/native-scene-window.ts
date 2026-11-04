import { useEffect, useRef } from "react";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import type { ShellActions } from "../types";
import type { MoleculeTab } from "../../stores/molecule-store";
import { useMoleculeStore } from "../../stores/molecule-store";
import { requestViewerAction, activeViewerIframeForDocument } from "../../lib/viewer-bridge";
import { focusSceneDocument } from "../../hooks/workspace-scene-import";
import { isTauriRuntime, trackTauriListener } from "../../lib/tauri";
import { toast } from "../ui/toast";
import { useSourceEditing, type SourceEditingContextValue, type SourceEditingTransfer } from "../../lib/source-editing/context";
import { applyTransferredTabPlacement, captureTabPlacement, resolveTabTransferTarget, type TabTransferPlacement, type TabTransferPosition } from "./native-tab-placement";

let sourceEditing: SourceEditingContextValue | null = null;
const CHANNEL = "burette-scene-window-handoff";
type Placement = TabTransferPlacement & { title: string };
type Offer = Placement & { kind: "offer" | "return"; id: string; from: string; path: string; sourcePath?: string; sourceDraft?: SourceEditingTransfer; targetPosition?: TabTransferPosition; targetViewportWidth?: number };
type Reply = { kind: "ready" | "committed" | "commit" | "failed" | "cancel"; id: string; from: string };
type Owner = Placement & { parent: string; tabId: string };
const usePopout = create<{ owners: Record<string, Owner>; busy: boolean }>(() => ({ owners: {}, busy: false }));
function forgetOwner(tabId: string) {
  usePopout.setState(state => ({ owners: Object.fromEntries(Object.entries(state.owners).filter(([id]) => id !== tabId)) }));
}
const pending = new Map<string, { peer: string; finish: (reply: "ready" | "committed" | "failed") => void }>();
const receivingTransfers = new Set<string>();
class HandoffError extends Error {
  constructor(readonly commitRequested: boolean) { super("The other window did not confirm the move. Your scene is still open."); }
}
const emitTo = (target: string, _channel: string, message: Offer | Reply) => invoke("relay_popout_handoff", { target, message });

export function nativePopoutReason(tab: MoleculeTab): string | null {
  if (!isTauriRuntime()) return null;
  const location = tab.location;
  const document = location.kind === "file"
    ? useMoleculeStore.getState().documents.find(doc => doc.id === location.documentId)
    : null;
  if (!document || !["molstar", "xyzrender-external"].includes(document.renderer)) return "Available for molecular scenes and sheets";
  const source = sourceEditing?.sessionForDocument(document);
  if (source?.saving || (source?.dirty && !sourceEditing?.beginTransfer)) return "Wait for source changes to finish saving";
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

async function checkpoint(tabId: string, signal?: AbortSignal) {
  const document = currentDocument(tabId);
  await focusSceneDocument(document, useMoleculeStore.getState().setActiveDocument, signal);
  signal?.throwIfAborted();
  const source = sourceEditing?.sessionForDocument(document);
  if (source?.saving) throw new Error("Wait for source changes to finish saving.");
  if (document.renderer === "molstar") {
    const story = await requestViewerAction(document.id, { type: "observe_story" });
    if (Number(story.count) > 1) throw new Error("Keep this Story in its workspace.");
  }
  signal?.throwIfAborted();
  const archive = await requestViewerAction(document.id, { type: "workspace_scene_snapshot" });
  signal?.throwIfAborted();
  const identity = { sourcePath: document.path, sceneUnsaved: document.sceneUnsaved === true, sceneSourcePaths: document.sceneSourcePaths ?? [] };
  if (archive.sheet) return invoke<string>("save_popout_sheet", { ...identity, recoveryPath: document.recoveryPath, sheet: archive.sheet });
  if (typeof archive.dataBase64 !== "string") throw new Error("The scene could not be captured.");
  return invoke<string>("save_popout_scene", { ...identity, dataBase64: archive.dataBase64 });
}

function tell(peer: string, message: Offer) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let commitRequested = false;
    const finish = (reply: "ready" | "committed" | "failed") => {
      if (settled) return;
      if (reply === "ready") { commitRequested = true; send(); return; }
      settled = true;
      clearTimeout(timeout); clearInterval(retry); pending.delete(message.id);
      if (reply === "committed") resolve(); else {
        if (!commitRequested) void emitTo(peer, CHANNEL, { kind: "cancel", id: message.id, from: message.from }).catch(() => {});
        reject(new HandoffError(commitRequested));
      }
    };
    const send = () => { void emitTo(peer, CHANNEL, commitRequested ? { kind: "commit", id: message.id, from: message.from } : message).catch(() => finish("failed")); };
    const timeout = setTimeout(() => finish("failed"), 60000);
    const retry = setInterval(send, 1000);
    pending.set(message.id, { peer, finish });
    send();
  });
}

export async function popOutNativeScene(tabId: string, targetWindow?: string, options: { screenPosition?: TabTransferPosition; targetPosition?: TabTransferPosition; targetViewportWidth?: number } = {}) {
  const store = useMoleculeStore.getState();
  const tab = store.tabs.find(tab => tab.id === tabId);
  if (!tab || nativePopoutReason(tab)) return;
  usePopout.setState({ busy: true });
  let surface: HTMLElement | null | undefined;
  let peer: string | undefined;
  let createdWindow = false;
  const document = currentDocument(tabId);
  let transferred = false;
  let handoff: Offer | undefined;
  try {
    const sourceDraft = sourceEditing?.beginTransfer?.(document) ?? undefined;
    surface = activeViewerIframeForDocument(currentDocument(tabId).id)?.closest<HTMLElement>(".page-surface");
    if (surface) surface.inert = true;
    const path = await checkpoint(tabId);
    if (targetWindow === getCurrentWindow().label) return;
    peer = targetWindow ?? await invoke<string>("open_new_workspace_window", { paths: [], screenPosition: options.screenPosition });
    createdWindow = !targetWindow;
    handoff = { ...captureTabPlacement(tab, store.tabs.indexOf(tab)), kind: "offer", id: crypto.randomUUID(), from: getCurrentWindow().label,
      path, sourcePath: document.path, sourceDraft, title: tab.title ?? document.title, targetPosition: options.targetPosition, targetViewportWidth: options.targetViewportWidth };
    await tell(peer, handoff);
    transferred = true;
    if (await sourceEditing?.finishTransfer?.(document, true) === false) throw new Error("The source editor could not finish moving. Try again.");
    // Only an acknowledged, nonempty loaded destination can retire the original scene.
    useMoleculeStore.getState().closeTab(tabId);
  } catch (error) {
    if (error instanceof HandoffError && error.commitRequested) transferred = true;
    if (!transferred && peer && handoff) await emitTo(peer, CHANNEL, { kind: "cancel", id: handoff.id, from: handoff.from }).catch(() => {});
    // Request a normal close so the destination's unsaved-change guard remains
    // authoritative if the user interacted with it while the handoff failed.
    if (!transferred && peer && createdWindow) await Window.getByLabel(peer).then(window => window?.close()).catch(() => {});
    toast.add({ title: "Could not move scene", description: error instanceof Error ? error.message : "Try again with the scene open.", type: "error" });
  } finally {
    await sourceEditing?.finishTransfer?.(document, false);
    if (surface) surface.inert = false;
    usePopout.setState({ busy: false });
  }
}

// Closing the detached window returns its latest scene if the parent still
// exists. If it has closed, a durable checkpoint remains in this workspace.
export async function returnNativePopout(tabId?: string): Promise<boolean> {
  if (!tabId) {
    for (const id of Object.keys(usePopout.getState().owners)) {
      if (await returnNativePopout(id)) return true;
    }
    return false;
  }
  const { owners, busy } = usePopout.getState();
  const owner = owners[tabId];
  if (!owner) return false;
  if (!useMoleculeStore.getState().tabs.some(tab => tab.id === owner.tabId)) { forgetOwner(tabId); return false; }
  if (busy) throw new Error("Wait for the scene to finish moving.");
  usePopout.setState({ busy: true });
  let surface: HTMLElement | null | undefined;
  const document = currentDocument(owner.tabId);
  let transferred = false;
  let handoff: Offer | undefined;
  try {
    const sourceDraft = sourceEditing?.beginTransfer?.(document) ?? undefined;
    surface = activeViewerIframeForDocument(currentDocument(owner.tabId).id)?.closest<HTMLElement>(".page-surface");
    if (surface) surface.inert = true;
    const path = await checkpoint(owner.tabId);
    if (!await Window.getByLabel(owner.parent)) {
      retainCheckpoint(owner.tabId, path);
      forgetOwner(tabId);
      return false;
    }
    const currentTab = useMoleculeStore.getState().tabs.find(tab => tab.id === owner.tabId)!;
    handoff = { ...owner, ...captureTabPlacement(currentTab, owner.index), title: currentTab.title ?? currentDocument(owner.tabId).title,
      kind: "return", id: crypto.randomUUID(), from: getCurrentWindow().label, path, sourcePath: document.path, sourceDraft };
    await tell(owner.parent, handoff);
    transferred = true;
    if (await sourceEditing?.finishTransfer?.(document, true) === false) throw new Error("The source editor could not finish moving. Try again.");
    useMoleculeStore.getState().closeTab(owner.tabId);
    forgetOwner(tabId);
    const remaining = useMoleculeStore.getState().tabs.some(tab => !["launcher", "settings"].includes(tab.location.kind));
    if (remaining) return false;
    await invoke("close_workspace_window");
    return true;
  } catch (error) {
    if (error instanceof HandoffError && error.commitRequested) transferred = true;
    throw error;
  } finally {
    if (!transferred && handoff) await emitTo(owner.parent, CHANNEL, { kind: "cancel", id: handoff.id, from: handoff.from }).catch(() => {});
    await sourceEditing?.finishTransfer?.(document, false);
    if (surface) surface.inert = false;
    usePopout.setState({ busy: false });
  }
}

function retainCheckpoint(tabId: string, path: string) {
  const document = currentDocument(tabId);
  useMoleculeStore.setState(state => ({
    documents: state.documents.map(doc => doc.id === document.id ? { ...doc, recoveryPath: path } : doc),
    tabs: state.tabs.map(tab => tab.id === tabId && tab.location.kind === "file" ? { ...tab, location: { ...tab.location, recoveryPath: path } } : tab),
  }));
}

// Reopening a closed sheet must use the view at close time, not the previous
// exit/transfer checkpoint. A failed capture leaves the tab and source alive.
export async function checkpointNativeScenesForClose(tabIds: string[], signal?: AbortSignal) {
  if (!isTauriRuntime()) return;
  signal?.throwIfAborted();
  const store = useMoleculeStore.getState();
  const wanted = new Set(tabIds);
  const targets = store.tabs.filter(tab => wanted.has(tab.id) && tab.location.kind === "file")
    .filter(tab => {
      const location = tab.location;
      const document = location.kind === "file"
        ? store.documents.find(document => document.id === location.documentId)
        : undefined;
      // An unopened restored tab has no live scene to capture. Keep its saved
      // location intact instead of loading it merely to close it.
      return document && !document.runtimeDeferred
        && (document.renderer === "xyzrender-external" || !!document.recoveryPath);
    });
  if (!targets.length) return;
  if (nativePopoutBusy()) throw new Error("Wait for the scene to finish moving.");
  const activeTabId = store.activeTabId;
  const controller = new AbortController();
  let cancel!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new Error("The window close was cancelled."));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const surfaces = targets.map(tab => activeViewerIframeForDocument(currentDocument(tab.id).id)?.closest<HTMLElement>(".page-surface"))
    .filter((surface): surface is HTMLElement => !!surface)
    .map(surface => ({ surface, inert: surface.inert }));
  usePopout.setState({ busy: true });
  for (const { surface } of surfaces) surface.inert = true;
  try {
    await Promise.race([
      cancelled,
      (async () => {
        for (const tab of targets) {
          controller.signal.throwIfAborted();
          const documentId = currentDocument(tab.id).id;
          const documentPath = currentDocument(tab.id).path;
          const path = await checkpoint(tab.id, controller.signal);
          controller.signal.throwIfAborted();
          const current = currentDocument(tab.id);
          if (current.id !== documentId || current.path !== documentPath) throw new Error("The tab changed while its scene was being saved. Try closing it again.");
          retainCheckpoint(tab.id, path);
        }
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("The scene did not finish saving. The tab is still open; try again when its viewer is ready."));
        }, 15000);
      }),
    ]);
  } finally {
    controller.abort();
    signal?.removeEventListener("abort", cancel);
    clearTimeout(timeout);
    for (const { surface, inert } of surfaces) surface.inert = inert;
    const current = useMoleculeStore.getState();
    if (activeTabId && current.tabs.some(tab => tab.id === activeTabId)) current.setActiveTab(activeTabId);
    usePopout.setState({ busy: false });
  }
}

export async function checkpointNativePopoutForExit(signal?: AbortSignal) {
  if (nativePopoutBusy()) throw new Error("Wait for the scene to finish moving.");
  // Use the same bounded, cancellable capture as tab close. Unopened restored
  // tabs keep their existing checkpoint instead of loading during app exit.
  await checkpointNativeScenesForClose(useMoleculeStore.getState().tabs.map(tab => tab.id), signal);
}

export function useNativePopoutSession(actions: ShellActions) {
  sourceEditing = useSourceEditing();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const current = getCurrentWindow();
    const received = new Map<string, Promise<boolean>>();
    const cancelled = new Set<string>();
    const introduced = new Map<string, string>();
    const committed = new Set<string>();
    const receiving = new Set<string>();
    const leases = new Map<string, ReturnType<typeof setTimeout>>();
    const staged = new Map<string, { document: ReturnType<typeof currentDocument>; surface: HTMLElement | null | undefined; sourceLocked: boolean }>();
    const rollback = async (key: string) => {
      if (committed.has(key)) return;
      clearTimeout(leases.get(key));
      leases.delete(key);
      receivingTransfers.delete(key);
      const tabId = introduced.get(key);
      if (!tabId) return;
      const stage = staged.get(key);
      if (stage?.sourceLocked && await sourceEditing?.finishTransfer?.(stage.document, true) === false) {
        if (stage.surface) stage.surface.inert = false;
        staged.delete(key);
        return;
      }
      useMoleculeStore.getState().closeTab(tabId);
      forgetOwner(tabId);
      introduced.delete(key);
      staged.delete(key);
    };
    const cleanup = trackTauriListener(current.listen<Offer | Reply>(CHANNEL, async ({ payload }) => {
      if (!payload || typeof payload !== "object" || typeof payload.id !== "string" || typeof payload.from !== "string") return;
      const key = `${payload.from}:${payload.id}`;
      if (payload.kind === "cancel") {
        if (committed.has(key)) return;
        cancelled.add(key);
        if (!receiving.has(key)) await rollback(key);
        if (cancelled.size > 64) cancelled.delete(cancelled.values().next().value!);
        return;
      }
      if (payload.kind === "commit") {
        const receipt = received.get(key);
        if (!receipt || !await receipt || cancelled.has(key)) return;
        const stage = staged.get(key);
        if (!committed.has(key) && (!stage || !useMoleculeStore.getState().tabs.some(tab => tab.location.kind === "file" && tab.location.documentId === stage.document.id))) {
          await rollback(key);
          await emitTo(payload.from, CHANNEL, { kind: "failed", id: payload.id, from: current.label });
          return;
        }
        if (stage && !committed.has(key)) {
          clearTimeout(leases.get(key));
          leases.delete(key);
          committed.add(key);
          if (stage.sourceLocked) await sourceEditing?.finishTransfer?.(stage.document, false);
          if (stage.surface) stage.surface.inert = false;
          receivingTransfers.delete(key);
          staged.delete(key);
        }
        await emitTo(payload.from, CHANNEL, { kind: "committed", id: payload.id, from: current.label });
        return;
      }
      if (payload.kind === "ready" || payload.kind === "committed" || payload.kind === "failed") {
        const waiting = pending.get(payload.id);
        if (waiting?.peer === payload.from) waiting.finish(payload.kind);
        return;
      }
      if (!("path" in payload)) return;
      if (!["offer", "return"].includes(payload.kind) || !/^[a-zA-Z0-9-]+$/.test(payload.from)
        || typeof payload.path !== "string" || !/\/popout-scenes\/[a-f0-9-]+\.[a-zA-Z0-9]{1,10}$/.test(payload.path) || payload.path.length > 4096
        || typeof payload.title !== "string" || payload.title.length > 1024 || typeof payload.pinned !== "boolean" || !Number.isInteger(payload.index)) return;
      if (cancelled.has(key)) return;
      let receipt = received.get(key);
      if (!receipt) {
        if (payload.targetPosition && !resolveTabTransferTarget(payload.targetPosition, payload.targetViewportWidth)) {
          await emitTo(payload.from, CHANNEL, { kind: "failed", id: payload.id, from: current.label });
          return;
        }
        receiving.add(key);
        receivingTransfers.add(key);
        leases.set(key, setTimeout(() => {
          cancelled.add(key);
          if (!receiving.has(key)) void rollback(key);
        }, 60000));
        receipt = (async () => {
          const before = useMoleculeStore.getState();
          if (payload.sourcePath && before.documents.some(document => document.path === payload.sourcePath)) return false;
          const existingTabs = new Set(before.tabs.map(tab => tab.id));
          if (!useMoleculeStore.getState().documents.some(document => (document.recoveryPath ?? document.path) === payload.path)) {
            await actionsRef.current.openStructurePaths([payload.path], { mode: "individual" });
          }
          const store = useMoleculeStore.getState();
          const document = store.documents.find(doc => (doc.recoveryPath ?? doc.path) === payload.path);
          if (!document) return false;
          const tab = store.tabs.find(tab => tab.location.kind === "file" && tab.location.documentId === document.id);
          if (!tab) return false;
          if (!existingTabs.has(tab.id)) introduced.set(key, tab.id);
          if (cancelled.has(key)) { await rollback(key); return false; }
          const surface = activeViewerIframeForDocument(document.id)?.closest<HTMLElement>(".page-surface");
          if (surface) surface.inert = true;
          const stage = { document, surface, sourceLocked: false };
          staged.set(key, stage);
          await focusSceneDocument(document, store.setActiveDocument);
          stage.surface = activeViewerIframeForDocument(document.id)?.closest<HTMLElement>(".page-surface");
          if (stage.surface) stage.surface.inert = true;
          const ready = await requestViewerAction(document.id, { type: "workspace_scene_state" });
          if (!ready.ready) return false;
          if (payload.sourceDraft) {
            if (!sourceEditing?.receiveTransfer) return false;
            await sourceEditing.receiveTransfer(document, payload.sourceDraft);
            sourceEditing.beginTransfer?.(document);
            stage.sourceLocked = Boolean(sourceEditing.beginTransfer);
          }
          if (cancelled.has(key)) { await rollback(key); return false; }
          store.renameTab(tab.id, payload.title);
          if (Boolean(tab.pinned) !== payload.pinned) store.togglePinnedTab(tab.id);
          applyTransferredTabPlacement(tab.id, payload, payload.targetPosition, payload.targetViewportWidth);
          if (payload.kind === "offer") usePopout.setState(state => ({ owners: { ...state.owners, [tab.id]: { parent: payload.from, tabId: tab.id, title: payload.title, index: payload.index, pinned: payload.pinned } } }));
          else store.moveTab(tab.id, Math.max(0, Math.min(payload.index, store.tabs.length - 1)));
          return true;
        })().catch(() => false).finally(() => receiving.delete(key));
        received.set(key, receipt);
        if (received.size > 64) {
          const oldest = [...received.keys()].find(id => committed.has(id) || cancelled.has(id));
          if (oldest) {
            received.delete(oldest); introduced.delete(oldest); staged.delete(oldest); committed.delete(oldest);
          }
        }
      }
      const ok = await receipt;
      if (!ok || cancelled.has(key)) await rollback(key);
      if (!cancelled.has(key)) await emitTo(payload.from, CHANNEL, { kind: ok ? "ready" : "failed", id: payload.id, from: current.label } satisfies Reply);
    }), "native scene handoff");
    return () => {
      cleanup();
      for (const timer of leases.values()) clearTimeout(timer);
      for (const key of received.keys()) receivingTransfers.delete(key);
    };
  }, []);
}

export function useNativePopoutOwner() {
  const activeTabId = useMoleculeStore(state => state.activeTabId);
  return usePopout(state => activeTabId ? state.owners[activeTabId] ?? null : null);
}
export function nativePopoutBusy() { return usePopout.getState().busy || receivingTransfers.size > 0; }
export function isNativePopoutTab(tabId: string) { return Boolean(usePopout.getState().owners[tabId]); }
