import { defaultTabWorkspace, getTabWorkspace, useTabWorkspaceStore, type TabWorkspace } from "../../stores/tab-workspace-store";
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime, trackTauriListener } from "../../lib/tauri";
import { useMoleculeStore, type MoleculeTab } from "../../stores/molecule-store";
import { deserializeLocation, serializeLocation, type Location, type SerializedLocation } from "../editor-area/page-kinds";
import type { ShellActions } from "../types";
import { toast } from "../ui/toast";

const CHANNEL = "burette-workspace-page";
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
type Offer = { kind: "open"; id: string; from: string; location: SerializedLocation; title?: string; toolDrops?: TabWorkspace["droppedStructures"] };
type Reply = { kind: "ready" | "failed"; id: string; from: string };
const pending = new Map<string, { peer: string; finish: (ok: boolean) => void }>();
const opening = new Set<string>();
const send = (target: string, message: Offer | Reply) => invoke("relay_workspace_page", { target, message });

function waitForPageSurface(id: string): Promise<boolean> {
  const selector = `.page-surface[data-view-id="${CSS.escape(id)}"][data-workspace-visible]`;
  if (document.querySelector(selector)) return Promise.resolve(true);
  // A newly created or background WKWebView can defer animation frames. Wait
  // for React's committed surface instead of acknowledging an arbitrary frame.
  return new Promise(resolve => {
    const finish = (visible: boolean) => { observer.disconnect(); clearTimeout(timeout); resolve(visible); };
    const observer = new MutationObserver(() => { if (document.querySelector(selector)) finish(true); });
    const timeout = setTimeout(() => finish(false), 15000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-workspace-visible"] });
  });
}

export function workspacePageSources(location: Location): string[] {
  if (location.kind === "file" || location.kind === "text-file" || location.kind === "document") return [location.path];
  if (location.kind === "chemical-space") return location.collectionPath ? [location.collectionPath] : [];
  if (location.kind === "tool") return location.sourcePath ? [location.sourcePath] : [];
  if (location.kind === "pose-review" || location.kind === "fep-setup") return [location.gridPath, location.dockingPath];
  return [];
}

async function captureLocation(tab: MoleculeTab): Promise<Location> {
  if (tab.location.kind !== "ketcher") return tab.location;
  const { getKetcherAgentController } = await import("../../lib/ketcher-agent");
  const controller = getKetcherAgentController(tab.id);
  if (!controller) return tab.location;
  const snapshot = controller.snapshot();
  const exported = await controller.execute({ type: "control_ketcher", apiVersion: snapshot.apiVersion, surfaceId: snapshot.surfaceId,
    expectedRevision: snapshot.structureRevision, command: "get_structure", formats: ["ket"] });
  const formats = exported.result?.formats as Record<string, unknown> | undefined;
  if (!exported.ok || typeof formats?.ket !== "string") throw new Error("The sketch could not be copied. Try again with the editor open.");
  return { kind: "ketcher", draftKet: formats.ket };
}

export async function openNativePageWindow(tab: MoleculeTab) {
  if (!isTauriRuntime() || opening.has(tab.id)) return;
  opening.add(tab.id);
  try {
    const location = await captureLocation(tab);
    const offer: Offer = { kind: "open", id: crypto.randomUUID(), from: getCurrentWindow().label, location: serializeLocation(location) ?? location, ...(tab.title ? { title: tab.title } : {}), ...(location.kind === "tool" ? { toolDrops: getTabWorkspace(tab.id).droppedStructures } : {}) };
    if (new TextEncoder().encode(JSON.stringify(offer)).length > MAX_PAGE_BYTES) throw new Error("Save this screen before opening it in another window.");
    if (workspacePageSources(location).some(path => !path.startsWith("/"))) throw new Error("Save this source before opening it in another window.");
    const peer = await invoke<string>("open_new_workspace_window", { paths: [] });
    await new Promise<void>((resolve, reject) => {
      const finish = (ok: boolean) => {
        clearTimeout(timeout); clearInterval(retry); pending.delete(offer.id);
        if (ok) resolve(); else reject(new Error("The new window could not open the screen. The original is still available."));
      };
      const transmit = () => { void send(peer, offer).catch(() => finish(false)); };
      const timeout = setTimeout(() => finish(false), 60000);
      const retry = setInterval(transmit, 1000);
      pending.set(offer.id, { peer, finish });
      transmit();
    });
  } catch (error) {
    toast.add({ title: "Could not open window", description: error instanceof Error ? error.message : "Try again with the screen open.", type: "error" });
  } finally { opening.delete(tab.id); }
}

export function useNativePageWindowSession(actions: ShellActions) {
  const actionsRef = useRef(actions); actionsRef.current = actions;
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const current = getCurrentWindow();
    const received = new Map<string, Promise<boolean>>();
    return trackTauriListener(current.listen<Offer | Reply>(CHANNEL, async ({ payload }) => {
      if (!payload || typeof payload.id !== "string" || typeof payload.from !== "string") return;
      if (payload.kind === "ready" || payload.kind === "failed") {
        const waiting = pending.get(payload.id);
        if (waiting?.peer === payload.from) waiting.finish(payload.kind === "ready");
        return;
      }
      if (payload.kind !== "open") return;
      let receipt = received.get(payload.id);
      if (!receipt) {
        receipt = (async () => {
          const location = deserializeLocation(payload.location);
          if (!location) return false;
          const paths = workspacePageSources(location);
          if (location.kind === "text-file") await actionsRef.current.openTextPaths(paths);
          else if (paths.length) await actionsRef.current.openPaths(paths, { requireSuccess: true });
          const store = useMoleculeStore.getState();
          if (location.kind === "text-file" && !store.textDocuments.some(document => document.path === location.path)) return false;
          // Clear runtime IDs from the originating window. Each window owns its documents.
          if (location.kind === "file" || location.kind === "text-file") delete location.documentId;
          store.openScreenTab(location, null);
          const id = useMoleculeStore.getState().activeTabId;
          if (!id) return false;
          if (payload.title) store.renameTab(id, payload.title);
          if (location.kind === "tool" && payload.toolDrops?.length) {
            const tools = useTabWorkspaceStore.getState();
            tools.restoreSnapshot({ workspaces: { ...tools.workspaces, [id]: { ...defaultTabWorkspace(), droppedStructures: payload.toolDrops.slice(0, 60) } } });
          }
          return waitForPageSurface(id);
        })().catch(() => false);
        received.set(payload.id, receipt);
        if (received.size > 16) received.delete(received.keys().next().value!);
      }
      const ok = await receipt;
      await send(payload.from, { kind: ok ? "ready" : "failed", id: payload.id, from: current.label });
    }), "workspace page window");
  }, []);
}
