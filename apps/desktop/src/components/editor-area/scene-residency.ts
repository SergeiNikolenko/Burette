import type { Location } from "./page-kinds";
import type { MoleculeTab } from "../../stores/molecule-store";
import type { ViewerDocument } from "../../types";

const MIB = 1024 * 1024;

export function pageLocationKey(location: Location) {
  return `${location.kind}:${"path" in location ? location.path : ""}`;
}

export function scenePageKey(tabId: string, location: Location) {
  return `${tabId}\0${pageLocationKey(location)}`;
}

// An admission estimate, not a measurement of JS/native/GPU memory. A viewer
// has a fixed cost even for an empty source; parsing and GPU geometry add more.
export function estimatedSceneBytes(document: ViewerDocument | undefined, frameCount = 1) {
  const sourceBytes = document?.byteCount;
  const bytes = typeof sourceBytes === "number" && Number.isFinite(sourceBytes) && sourceBytes > 0 ? sourceBytes : 0;
  const coordinates = document?.dockingRequest?.ligandPaths;
  const indexedCoordinates = coordinates?.length === 1
    && (/\.(dcd|xtc|trr|dtr)(?:$|\/)/i.test(coordinates[0]) || /^(cms|dtr)$/i.test(document?.extension ?? ""));
  // Indexed coordinate sources are file-backed: byteCount is the whole run,
  // not resident memory. Keep a conservative working-set estimate until atom/
  // geometry accounting is exposed; this is not a hard memory guarantee.
  const estimate = indexedCoordinates ? Math.min(bytes * 8, 384 * MIB) : bytes * 8;
  return Math.max(64 * MIB, estimate) * frameCount;
}

export function planSceneResidency({ tabs, recentTabIds, visibleTabIds, protectedDocumentIds, documents, limit, frameCounts, warmTabIds, residentPageKeys, overridePageKeys }: {
  tabs: readonly MoleculeTab[];
  recentTabIds: readonly string[];
  visibleTabIds: ReadonlySet<string>;
  protectedDocumentIds: ReadonlySet<string>;
  documents: readonly ViewerDocument[];
  limit: number;
  frameCounts: ReadonlyMap<string, number>;
  warmTabIds?: ReadonlySet<string>;
  residentPageKeys?: ReadonlySet<string>;
  overridePageKeys?: ReadonlySet<string>;
}) {
  const byId = new Map(documents.map(document => [document.id, document]));
  const byPath = new Map<string, ViewerDocument>();
  for (const document of documents) if (!byPath.has(document.path)) byPath.set(document.path, document);
  const documentFor = (location: Location) => location.kind === "file"
    ? byId.get(location.documentId ?? "") ?? byPath.get(location.path)
    : undefined;
  const protectedPage = (location: Location) => protectedDocumentIds.has(documentFor(location)?.id ?? "");
  const cost = (location: Location) => {
    const document = documentFor(location);
    return estimatedSceneBytes(document, frameCounts.get(document?.id ?? "") ?? 1);
  };
  const mountedTabIds = new Set<string>();
  const pageKeys = new Set<string>();
  const deferredTabIds = new Set<string>();
  const historyKeys = new Map<string, Set<string>>();
  let retainedBytes = 0;
  let retainedPages = 0;
  const byteBudget = limit * 64 * MIB;
  const add = (tab: MoleculeTab, location: Location, mandatory: boolean) => {
    const current = location === tab.location;
    const pageKey = scenePageKey(tab.id, location);
    const keys = historyKeys.get(tab.id) ?? new Set<string>();
    if (pageKeys.has(pageKey)) return true;
    const bytes = cost(location);
    const frames = frameCounts.get(documentFor(location)?.id ?? "") ?? 1;
    const resident = !residentPageKeys || residentPageKeys.has(pageKey);
    // A single selected large scene is useful even above the estimate. Only
    // retained, unreclaimable state should block a new visible allocation.
    const firstVisible = mandatory && visibleTabIds.has(tab.id) && retainedPages === 0;
    const mustKeep = mandatory && (resident || firstVisible || location.kind !== "file" || overridePageKeys?.has(pageKey));
    if (!mustKeep && (retainedPages + frames > limit || retainedBytes + bytes > byteBudget)) {
      if (current && mandatory) deferredTabIds.add(tab.id);
      return false;
    }
    pageKeys.add(pageKey);
    mountedTabIds.add(tab.id);
    if (current) deferredTabIds.delete(tab.id);
    else { keys.add(pageLocationKey(location)); historyKeys.set(tab.id, keys); }
    retainedBytes += bytes;
    retainedPages += frames;
    return true;
  };

  // Visible panes and non-reconstructable edits take precedence. Protected
  // history is charged conservatively, but the page component still only
  // instantiates previously visited entries. Never cold-mount unseen history.
  const required: Array<{ tab: MoleculeTab; location: Location }> = [];
  for (const tab of tabs) {
    const protectedHistory = [...tab.back, ...tab.forward].filter(protectedPage);
    if (visibleTabIds.has(tab.id) || protectedPage(tab.location) || protectedHistory.length) {
      required.push({ tab, location: tab.location });
      for (const location of protectedHistory) required.push({ tab, location });
    }
  }
  // Preserve existing dirty runtimes before considering any new allocation.
  for (const { tab, location } of required) {
    if (!residentPageKeys || residentPageKeys.has(scenePageKey(tab.id, location))) add(tab, location, true);
  }
  for (const { tab, location } of required.filter(entry => visibleTabIds.has(entry.tab.id))) add(tab, location, true);
  for (const { tab, location } of required) add(tab, location, true);
  const byTabId = new Map(tabs.map(tab => [tab.id, tab]));
  for (let index = recentTabIds.length - 1; index >= 0; index--) {
    const tab = byTabId.get(recentTabIds[index]);
    if (tab && (!warmTabIds || warmTabIds.has(tab.id))) add(tab, tab.location, false);
  }
  // History shares the window's budget instead of receiving two extra viewers
  // per visible pane. Offscreen panes no longer bypass the warm-page budget.
  for (const tab of tabs) {
    if (!visibleTabIds.has(tab.id)) continue;
    for (const location of [...tab.back.slice(-2), ...tab.forward.slice(0, 2)].reverse()) {
      if (location.kind === "file" && (historyKeys.get(tab.id)?.size ?? 0) < 2) add(tab, location, false);
    }
  }
  return { mountedTabIds, historyKeys, pageKeys, deferredTabIds, retainedBytes, retainedPages };
}
