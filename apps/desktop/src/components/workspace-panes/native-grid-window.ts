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

function gridRequest(documentId: string, type: "gridWindowCapture" | "gridWindowRestore" | "gridWindowReady", snapshot?: string) {
  const requestId = crypto.randomUUID();
  return new Promise<string>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); clearInterval(retry); window.removeEventListener("message", receive); };
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
    window.addEventListener("message", receive); send();
  });
}

export async function captureNativeGridTab(tab: MoleculeTab) {
  if (tab.location.kind !== "file") throw new Error("No collection is selected.");
  const path = tab.location.path;
  const document = useMoleculeStore.getState().documents.find(item => item.path === path);
  if (!document) throw new Error("The collection is no longer open.");
  setGridDocumentCloseTransition([document.id], true);
  const release = () => setGridDocumentCloseTransition([document.id], false);
  try {
    await waitForGridDocumentCloseTransition([document.id]);
    const sourceVersion = await invoke<string>("grid_transfer_source_version", { documentId: document.id });
    const snapshot = await gridRequest(document.id, "gridWindowCapture");
    return { value: { sourceVersion, snapshot }, release };
  } catch (error) { release(); throw error; }
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
