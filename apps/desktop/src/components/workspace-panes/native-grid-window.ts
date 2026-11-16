import { invoke } from "@tauri-apps/api/core";
import { useMoleculeStore, type MoleculeTab } from "../../stores/molecule-store";
import { activeViewerIframeForDocument } from "../../lib/viewer-bridge";
import { setGridDocumentCloseTransition, waitForGridDocumentCloseTransition } from "../../lib/window-mutation-barrier";
import type { TabTransferPosition } from "./native-tab-placement";

export type GridWindowSnapshot = { sourceVersion: string; snapshot: string };

export function canTransferNativeGridTab(tabId: string) {
  const state = useMoleculeStore.getState();
  const tab = state.tabs.find(item => item.id === tabId);
  const location = tab?.location;
  return location?.kind === "file" && state.documents.some(item => item.path === location.path && item.renderer === "grid2d");
}

function gridRequest(documentId: string, type: "gridWindowCapture" | "gridWindowRestore" | "gridWindowReady", snapshot?: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  return new Promise<string>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); clearInterval(retry); window.removeEventListener("message", receive); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal?.reason); };
    const receive = (event: MessageEvent) => {
      const body = event.data?.body;
      if (event.data?.source !== "burette-grid" || body?.type !== "gridWindowResult" || body.requestId !== requestId) return;
      if (event.source !== activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow) return;
      cleanup();
      if (body.ok === true && (type !== "gridWindowCapture" || typeof body.snapshot === "string")) resolve(body.snapshot ?? "");
      else reject(new Error(typeof body.error === "string" ? body.error : "The collection could not be transferred."));
    };
    const send = () => activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
      source: "burette-grid-host", body: { type, requestId, snapshot },
    }, "*");
    const timeout = setTimeout(() => { cleanup(); reject(new Error("The collection did not finish loading.")); }, 15000);
    const retry = setInterval(send, 250);
    window.addEventListener("message", receive);
    signal?.addEventListener("abort", abort, { once: true });
    send();
  });
}

export async function captureNativeGridTab(tab: MoleculeTab, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (tab.location.kind !== "file") throw new Error("No collection is selected.");
  const path = tab.location.path;
  const document = useMoleculeStore.getState().documents.find(item => item.path === path);
  if (!document) throw new Error("The collection is no longer open.");
  const previousTabId = useMoleculeStore.getState().activeTabId;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("The collection did not finish loading.")), 15000);
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", abort, { once: true });
  });
  setGridDocumentCloseTransition([document.id], true);
  const release = () => setGridDocumentCloseTransition([document.id], false);
  try {
    // Selecting the tab mounts cold/restored collections. Do not ask the native
    // registry for an index until that viewer confirms its baseline is ready.
    useMoleculeStore.getState().setActiveTab(tab.id);
    return await Promise.race([cancelled, (async () => {
      await gridRequest(document.id, "gridWindowReady", undefined, controller.signal);
      controller.signal.throwIfAborted();
      await waitForGridDocumentCloseTransition([document.id], controller.signal);
      controller.signal.throwIfAborted();
      const sourceVersion = await invoke<string>("grid_transfer_source_version", { documentId: document.id });
      controller.signal.throwIfAborted();
      const snapshot = await gridRequest(document.id, "gridWindowCapture", undefined, controller.signal);
      controller.signal.throwIfAborted();
      return { value: { sourceVersion, snapshot }, release };
    })()]);
  } catch (error) {
    release();
    const store = useMoleculeStore.getState();
    if (store.activeTabId === tab.id && previousTabId && store.tabs.some(item => item.id === previousTabId)) store.setActiveTab(previousTabId);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", abort);
  }
}

export async function restoreNativeGridTab(documentId: string, value: GridWindowSnapshot) {
  if (typeof value.sourceVersion !== "string" || typeof value.snapshot !== "string" || new TextEncoder().encode(value.snapshot).length > 1500 * 1024) throw new Error("Invalid collection transfer.");
  await gridRequest(documentId, "gridWindowReady");
  const sourceVersion = await invoke<string>("grid_transfer_source_version", { documentId });
  if (sourceVersion !== value.sourceVersion) throw new Error("The source file changed while the collection was moving. The original remains open.");
  await gridRequest(documentId, "gridWindowRestore", value.snapshot);
}

export async function transferNativeGridTab(tabId: string, targetWindow?: string, options?: {
  screenPosition?: TabTransferPosition; targetPosition?: TabTransferPosition; targetViewportWidth?: number;
}): Promise<boolean> {
  const tab = useMoleculeStore.getState().tabs.find(item => item.id === tabId);
  if (!tab || !canTransferNativeGridTab(tabId)) return false;
  const { openNativePageWindow } = await import("./native-page-window");
  return openNativePageWindow(tab, { ...options, targetWindow, move: true });
}
