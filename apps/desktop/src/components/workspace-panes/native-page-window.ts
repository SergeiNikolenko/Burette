import { defaultTabWorkspace, getTabWorkspace, useTabWorkspaceStore, type TabWorkspace } from "../../stores/tab-workspace-store";
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { isTauriRuntime, trackTauriListener } from "../../lib/tauri";
import { useMoleculeStore, type MoleculeTab } from "../../stores/molecule-store";
import { deserializeLocation, serializeLocation, type Location, type SerializedLocation } from "../editor-area/page-kinds";
import type { ShellActions } from "../types";
import { toast } from "../ui/toast";
import { captureNativeGridTab, canTransferNativeGridTab, restoreNativeGridTab, type GridWindowSnapshot } from "./native-grid-window";
import { applyTransferredTabPlacement, captureTabPlacement, resolveTabTransferTarget, type TabTransferPlacement, type TabTransferPosition } from "./native-tab-placement";
import type { TextFileDocument } from "../../types";
import { setGridDocumentCloseTransition } from "../../lib/window-mutation-barrier";

const CHANNEL = "burette-workspace-page";
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
type Offer = { kind: "open"; id: string; from: string; location: SerializedLocation; title?: string; toolDrops?: TabWorkspace["droppedStructures"]; grid?: GridWindowSnapshot; text?: TextFileDocument; placement?: TabTransferPlacement; targetPosition?: TabTransferPosition; targetViewportWidth?: number };
type Reply = { kind: "ready" | "committed" | "failed" | "commit" | "abort"; id: string; from: string };
const pending = new Map<string, { peer: string; finish: (ok: boolean) => void; prepare: () => void }>();
const opening = new Set<string>();
const receiving = new Set<string>();
export function nativePageTransferBusy() { return opening.size > 0 || receiving.size > 0; }
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

export async function openNativePageWindow(tab: MoleculeTab, options: {
  targetWindow?: string; move?: boolean; screenPosition?: TabTransferPosition;
  targetPosition?: TabTransferPosition; targetViewportWidth?: number;
} = {}): Promise<boolean> {
  if (!isTauriRuntime() || opening.has(tab.id) || options.targetWindow === getCurrentWindow().label) return false;
  opening.add(tab.id);
  let peer: string | undefined;
  let offerId: string | undefined;
  let commitSent = false;
  let releaseGrid: (() => void) | undefined;
  const surface = document.querySelector<HTMLElement>(`.page-surface[data-view-id="${CSS.escape(tab.id)}"]`);
  const wasInert = surface?.inert ?? false;
  if (surface) surface.inert = true;
  try {
    const location = await captureLocation(tab);
    const state = useMoleculeStore.getState();
    const grid = canTransferNativeGridTab(tab.id) ? await captureNativeGridTab(tab) : undefined;
    releaseGrid = grid?.release;
    const text = location.kind === "text-file" ? state.textDocuments.find(item => item.path === location.path) : undefined;
    const offer: Offer = { kind: "open", id: crypto.randomUUID(), from: getCurrentWindow().label, location: serializeLocation(location) ?? location, ...(tab.title ? { title: tab.title } : {}), ...(location.kind === "tool" ? { toolDrops: getTabWorkspace(tab.id).droppedStructures } : {}),
      grid: grid?.value, text, placement: captureTabPlacement(tab, state.tabs.findIndex(item => item.id === tab.id)),
      targetPosition: options.targetPosition, targetViewportWidth: options.targetViewportWidth };
    offerId = offer.id;
    if (new TextEncoder().encode(JSON.stringify(offer)).length > MAX_PAGE_BYTES) throw new Error("Save this screen before opening it in another window.");
    if (workspacePageSources(location).some(path => !path.startsWith("/"))) throw new Error("Save this source before opening it in another window.");
    const destination = options.targetWindow ?? await invoke<string>("open_new_workspace_window", { paths: [], screenPosition: options.screenPosition });
    peer = destination;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let prepared = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout); clearInterval(retry); pending.delete(offer.id);
        if (ok) resolve(); else reject(new Error("The new window could not open the screen. The original is still available."));
      };
      const transmit = () => { void send(destination, prepared ? { kind: "commit", id: offer.id, from: offer.from } : offer).catch(() => finish(false)); };
      const timeout = setTimeout(() => finish(false), 60000);
      const retry = setInterval(transmit, 1000);
      pending.set(offer.id, { peer: destination, finish, prepare: () => { prepared = true; commitSent = true; transmit(); } });
      transmit();
    });
    if (options.move) useMoleculeStore.getState().closeTab(tab.id);
    return true;
  } catch (error) {
    if (peer && offerId) await send(peer, { kind: "abort", id: offerId, from: getCurrentWindow().label }).catch(() => {});
    if (peer && !options.targetWindow && !commitSent) await Window.getByLabel(peer).then(window => window?.close()).catch(() => {});
    toast.add({ title: "Could not open window", description: error instanceof Error ? error.message : "Try again with the screen open.", type: "error" });
    return false;
  } finally { releaseGrid?.(); if (surface) surface.inert = wasInert; opening.delete(tab.id); }
}

export function useNativePageWindowSession(actions: ShellActions) {
  const actionsRef = useRef(actions); actionsRef.current = actions;
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const current = getCurrentWindow();
    const received = new Map<string, Promise<boolean>>();
    const stages = new Map<string, { from: string; tabs: Set<string>; gridId?: string; previousInert: boolean; timer: ReturnType<typeof setTimeout> }>();
    const committed = new Set<string>();
    const complete = (id: string, keep: boolean) => {
      const stage = stages.get(id);
      if (!stage) return;
      clearTimeout(stage.timer);
      if (!keep) for (const tab of stage.tabs) useMoleculeStore.getState().closeTab(tab);
      if (stage.gridId) setGridDocumentCloseTransition([stage.gridId], false);
      document.body.inert = stage.previousInert;
      stages.delete(id); receiving.delete(id);
      if (keep) { committed.add(id); if (committed.size > 16) committed.delete(committed.values().next().value!); }
    };
    return trackTauriListener(current.listen<Offer | Reply>(CHANNEL, async ({ payload }) => {
      if (!payload || typeof payload.id !== "string" || typeof payload.from !== "string") return;
      if (payload.kind === "ready" || payload.kind === "committed" || payload.kind === "failed") {
        const waiting = pending.get(payload.id);
        if (waiting?.peer === payload.from) {
          if (payload.kind === "ready") waiting.prepare();
          else waiting.finish(payload.kind === "committed");
        }
        return;
      }
      if (payload.kind === "commit" || payload.kind === "abort") {
        const stage = stages.get(payload.id);
        if (stage && stage.from !== payload.from) return;
        if (payload.kind === "abort") { complete(payload.id, false); return; }
        if (stage && await received.get(payload.id)) complete(payload.id, true);
        await send(payload.from, { kind: committed.has(payload.id) ? "committed" : "failed", id: payload.id, from: current.label });
        return;
      }
      if (payload.kind !== "open") return;
      let receipt = received.get(payload.id);
      if (!receipt) {
        receipt = (async () => {
          const location = deserializeLocation(payload.location);
          if (!location) return false;
          const target = payload.targetPosition ? resolveTabTransferTarget(payload.targetPosition, payload.targetViewportWidth) : undefined;
          if (payload.targetPosition && !target) return false;
          const paths = workspacePageSources(location);
          const before = useMoleculeStore.getState();
          if ((payload.grid || payload.text) && paths.some(path => before.documents.some(item => item.path === path) || before.textDocuments.some(item => item.path === path))) return false;
          if (stages.size > 0) return false;
          const previousTabs = new Set(before.tabs.map(tab => tab.id));
          const stage = { from: payload.from, tabs: new Set<string>(), gridId: undefined as string | undefined,
            previousInert: document.body.inert, timer: setTimeout(() => complete(payload.id, false), 60000) };
          stages.set(payload.id, stage); receiving.add(payload.id); document.body.inert = true;
          try {
            if (location.kind === "text-file") await actionsRef.current.openTextPaths(paths);
            else if (paths.length) await actionsRef.current.openPaths(paths, { requireSuccess: true });
          } finally {
            // Finder can open unrelated tabs while this load is pending. Only
            // this transfer's source paths belong to its rollback, including
            // partial opens that throw before returning to the receiver.
            for (const tab of useMoleculeStore.getState().tabs) {
              const opened = tab.location;
              if (!previousTabs.has(tab.id) && (opened.kind === "file" || opened.kind === "text-file" || opened.kind === "document") && paths.includes(opened.path)) stage.tabs.add(tab.id);
            }
            if (stages.get(payload.id) !== stage) {
              for (const id of stage.tabs) useMoleculeStore.getState().closeTab(id);
            }
          }
          if (stages.get(payload.id) !== stage) {
            return false;
          }
          const store = useMoleculeStore.getState();
          if (location.kind === "text-file" && !store.textDocuments.some(document => document.path === location.path)) return false;
          if (location.kind === "text-file" && payload.text) {
            const opened = store.textDocuments.find(document => document.path === location.path)!;
            store.addTextDocuments([{ ...opened, content: payload.text.content, truncated: payload.text.truncated }]);
          }
          // Clear runtime IDs from the originating window. Each window owns its documents.
          if (location.kind === "file" || location.kind === "text-file") delete location.documentId;
          store.openScreenTab(location, null, { newTab: location.kind !== "file" && location.kind !== "text-file" });
          const id = useMoleculeStore.getState().activeTabId;
          if (!id) return false;
          if (!previousTabs.has(id)) stage.tabs.add(id);
          if (payload.grid && location.kind === "file") {
            stage.gridId = store.documents.find(document => document.path === location.path)?.id;
            if (stage.gridId) setGridDocumentCloseTransition([stage.gridId], true);
          }
          if (payload.title) store.renameTab(id, payload.title);
          if (payload.placement) applyTransferredTabPlacement(id, payload.placement, payload.targetPosition, payload.targetViewportWidth, target ?? undefined);
          if (location.kind === "tool" && payload.toolDrops?.length) {
            const tools = useTabWorkspaceStore.getState();
            tools.restoreSnapshot({ workspaces: { ...tools.workspaces, [id]: { ...defaultTabWorkspace(), droppedStructures: payload.toolDrops.slice(0, 60) } } });
          }
          if (!(await waitForPageSurface(id))) return false;
          if (stages.get(payload.id) !== stage) return false;
          if (payload.grid && location.kind === "file") {
            const opened = useMoleculeStore.getState().documents.find(document => document.path === location.path);
            if (!opened || opened.renderer !== "grid2d") return false;
            try { await restoreNativeGridTab(opened.id, payload.grid); }
            catch { return false; }
          }
          return stages.get(payload.id) === stage;
        })().catch(() => false);
        received.set(payload.id, receipt);
        if (received.size > 16) received.delete(received.keys().next().value!);
      }
      const ok = await receipt;
      if (!ok) complete(payload.id, false);
      await send(payload.from, { kind: ok ? "ready" : "failed", id: payload.id, from: current.label });
    }), "workspace page window");
  }, []);
}
