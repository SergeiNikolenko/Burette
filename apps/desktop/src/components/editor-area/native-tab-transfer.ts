import type { TabTransferPosition } from "../workspace-panes/native-tab-placement";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMoleculeStore } from "../../stores/molecule-store";
import { canStartNativeFileDrag } from "../../lib/native-file-drag";
import { isTauriRuntime } from "../../lib/tauri";
import { canTransferNativeGridTab, transferNativeGridTab } from "../workspace-panes/native-grid-window";
import { openNativePageWindow } from "../workspace-panes/native-page-window";
import { nativePopoutReason, popOutNativeScene } from "../workspace-panes/native-scene-window";

type NativeTabDrop =
  | { outcome: "cancelled" }
  | { outcome: "window"; windowLabel: string; viewportWidth: number; position: { x: number; y: number } }
  | { outcome: "outside"; position: { x: number; y: number } };

export function canTransferNativeTab(tabId: string) {
  const tab = useMoleculeStore.getState().tabs.find(tab => tab.id === tabId);
  // Moving works in every desktop window; only the drag gesture needs AppKit.
  return isTauriRuntime() && Boolean(tab && (
    !nativePopoutReason(tab) || canTransferNativeGridTab(tabId)
    || (tab.location.kind !== "file" && tab.location.kind !== "settings" && tab.location.kind !== "document")
  ));
}

export async function transferNativeTab(tabId: string, cancelled: () => boolean = () => false): Promise<boolean> {
  const store = useMoleculeStore.getState();
  const tab = store.tabs.find(tab => tab.id === tabId);
  if (!tab || !canStartNativeFileDrag() || !canTransferNativeTab(tabId)) return false;
  const location = tab.location;
  const document = location.kind === "file" ? store.documents.find(document => document.id === location.documentId) : undefined;
  const drop = await invoke<NativeTabDrop>("start_tab_drag", { tabId, title: tab.title ?? document?.title ?? "Tab" });
  if (cancelled() || drop.outcome === "cancelled") return false;
  if (drop.outcome === "window" && drop.windowLabel === getCurrentWindow().label) {
    // AppKit reports logical view points. Compensate for the webview's zoom.
    const scale = drop.viewportWidth > 0 ? window.innerWidth / drop.viewportWidth : 1;
    if (!globalThis.document.elementFromPoint(drop.position.x * scale, drop.position.y * scale)?.closest(".tab-strip")) return false;
    window.dispatchEvent(new CustomEvent("burette-native-tab-drop", { detail: {
      tabId, x: drop.position.x * scale, y: drop.position.y * scale,
    } }));
    return true;
  }
  const targetWindow = drop.outcome === "window" ? drop.windowLabel : undefined;
  const options = drop.outcome === "outside"
    ? { screenPosition: drop.position }
    : { targetPosition: drop.position, targetViewportWidth: drop.viewportWidth };
  return moveNativeTab(tabId, targetWindow, options);
}

export async function moveNativeTab(tabId: string, targetWindow?: string, options: {
  screenPosition?: TabTransferPosition; targetPosition?: TabTransferPosition; targetViewportWidth?: number;
} = {}): Promise<boolean> {
  const tab = useMoleculeStore.getState().tabs.find(tab => tab.id === tabId);
  if (!tab || !canTransferNativeTab(tabId)) return false;
  if (canTransferNativeGridTab(tabId)) return transferNativeGridTab(tabId, targetWindow, options);
  if (tab.location.kind !== "file") return openNativePageWindow(tab, { ...options, targetWindow, move: true });
  await popOutNativeScene(tabId, targetWindow, options);
  return !useMoleculeStore.getState().tabs.some(tab => tab.id === tabId);
}
