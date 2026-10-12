import { memo, useEffect, useMemo, useState } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { pageKind, type Location } from "./page-kinds";
import { TabHistoryPages } from "./tab-history-pages";
import type { MoleculeTab, TabPane } from "../../stores/molecule-store";
import { FloatingPaneHeader } from "../workspace-panes/floating-pane";
import { useNativePopoutSession } from "../workspace-panes/native-popout";
import { usePaneVisibility, type PaneShown } from "../workspace-panes/use-pane-tabs";

const DEFAULT_WARM_PAGE_LIMIT = 10;
const LOW_DEVICE_MEMORY_WARM_PAGE_LIMIT = 6;
const MEMORY_PRESSURE_WARM_PAGE_LIMIT = 4;
const MEMORY_PRESSURE_HEAP_BYTES = 768 * 1024 * 1024;
const MEMORY_PRESSURE_HEAP_RATIO = 0.7;

export function ViewerArea({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  useNativePopoutSession(actions);
  const activeTabId = state.activeTabId ?? state.activeTab?.id;
  const tabs = state.tabs.length > 0 ? state.tabs : [{ id: "fallback", location: activeLocation(state), back: [], forward: [] }];
  const activeTabIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const [recentlyUsedTabIds, setRecentlyUsedTabIds] = useState<string[]>([]);
  const warmPageLimit = mountedWarmPageLimit();
  const protectedDocumentIds = useMemo(() => new Set([
    ...(state.dirtyGridDocuments ?? []),
    ...state.documents.filter(document => document.sceneUnsaved || (document.sceneSourcePaths?.length ?? 0) > 1).map(document => document.id),
  ]), [state.dirtyGridDocuments, state.documents]);
  const dirtyTabIds = useMemo(() => new Set(tabs.filter((tab) => (
    [tab.location, ...tab.back, ...tab.forward].some((location) => (
      location.kind === "file" && protectedDocumentIds.has(location.documentId ?? "")
    ))
  )).map((tab) => tab.id)), [tabs, protectedDocumentIds]);
  const warmMountedTabIds = useMemo(
    () => warmMountedTabs(tabs, activeTabIndex, recentlyUsedTabIds, warmPageLimit, dirtyTabIds),
    [activeTabIndex, recentlyUsedTabIds, tabs, warmPageLimit, dirtyTabIds],
  );
  const paneVisibility = usePaneVisibility(tabs, state.page === "settings");

  useEffect(() => {
    setRecentlyUsedTabIds((current) => {
      const tabIds = new Set(tabs.map((tab) => tab.id));
      const retained = current.filter((id) => tabIds.has(id));
      const next = activeTabId && tabIds.has(activeTabId)
        ? [...retained.filter((id) => id !== activeTabId), activeTabId]
        : retained;
      return sameStringArray(current, next) ? current : next;
    });
  }, [activeTabId, tabs]);

  // Every screen stays a child of this one stack wherever it is shown: the
  // side panel and the floating window only reposition its surface. Moving an
  // iframe to another parent reloads it, which would rebuild the Mol* scene.
  return (
    <div className="page-stack">
      {tabs.map((tab, index) => {
        const isActive = index === activeTabIndex && !tab.pane;
        const kind = pageKind(tab.location);
        const shown = paneVisibility(tab);
        // A screen in a pane is held like the active tab while on screen, and a
        // keep-alive one also while its pane shows another screen.
        const held = shown !== "hidden" || dirtyTabIds.has(tab.id) || (Boolean(tab.pane) && kind.keepAlive);
        if (!isActive && !held && (!kind.keepAlive || !warmMountedTabIds.has(tab.id))) return null;
        return (
          <MountedPageSurface
            key={tab.id}
            tab={tab}
            isActive={isActive}
            pane={tab.pane ?? null}
            shown={shown}
            state={state}
            actions={actions}
          />
        );
      })}
    </div>
  );
}

const MountedPageSurface = memo(function MountedPageSurface({
  tab,
  isActive,
  pane,
  shown,
  state,
  actions,
}: {
  tab: MoleculeTab;
  isActive: boolean;
  pane: TabPane | null;
  shown: PaneShown;
  state: ShellViewState;
  actions: ShellActions;
}) {
  const kind = pageKind(tab.location);
  // A minimized floating window still shows its header, but the page behind
  // it is out of sight and may pause like any background tab.
  const contentVisible = isActive || shown === "visible";
  return (
    <div
      className="page-surface"
      data-page-kind={kind.kind}
      data-active={isActive || undefined}
      data-pane={pane ?? undefined}
      data-pane-shown={shown === "hidden" ? undefined : shown}
      aria-hidden={!contentVisible && shown !== "minimized"}
    >
      {/* The header slot is always present so that inserting the header never
          shifts the page's own nodes: React keeps the iframe where it is. */}
      {pane === "floating" ? <FloatingPaneHeader tab={tab} state={state} actions={actions} minimized={shown === "minimized"} /> : null}
      <TabHistoryPages tab={tab} state={state} actions={actions} isActive={contentVisible} />
    </div>
  );
}, (previous, next) => {
  if (previous.isActive || next.isActive) return false;
  if (previous.shown !== "hidden" || next.shown !== "hidden") return false;
  return previous.tab.id === next.tab.id && previous.tab.location === next.tab.location && previous.pane === next.pane
    && previous.state.dirtyGridDocuments === next.state.dirtyGridDocuments
    && previous.state.documents === next.state.documents;
});

function activeLocation(state: ShellViewState): Location {
  if (state.page === "settings") {
    return { kind: "settings", section: "general" };
  }
  if (state.activeDocument) {
    return { kind: "file", documentId: state.activeDocument.id, path: state.activeDocument.path };
  }
  return { kind: "launcher" };
}

function mountedWarmPageLimit() {
  // Native sessions admit at most eight bounded files; preserve visited views.
  if (window.BuretteMcpWorkspace) return Number.POSITIVE_INFINITY;
  let limit = DEFAULT_WARM_PAGE_LIMIT;
  const deviceMemory = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof deviceMemory === "number" && Number.isFinite(deviceMemory) && deviceMemory <= 4) {
    limit = LOW_DEVICE_MEMORY_WARM_PAGE_LIMIT;
  }

  const memory = typeof performance === "undefined"
    ? null
    : (performance as Performance & {
      memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
    }).memory;
  const usedHeap = memory?.usedJSHeapSize;
  const heapLimit = memory?.jsHeapSizeLimit;
  const heapPressure = (
    typeof usedHeap === "number" &&
    Number.isFinite(usedHeap) &&
    (
      usedHeap >= MEMORY_PRESSURE_HEAP_BYTES ||
      (
        typeof heapLimit === "number" &&
        Number.isFinite(heapLimit) &&
        heapLimit > 0 &&
        usedHeap / heapLimit >= MEMORY_PRESSURE_HEAP_RATIO
      )
    )
  );
  if (heapPressure) limit = Math.min(limit, MEMORY_PRESSURE_WARM_PAGE_LIMIT);

  return Math.max(1, Math.min(DEFAULT_WARM_PAGE_LIMIT, limit));
}

function warmMountedTabs(
  tabs: { id: string; location: Location }[],
  activeTabIndex: number,
  recentlyUsedTabIds: string[],
  limit: number,
  dirtyTabIds: ReadonlySet<string>,
) {
  const warmEligibleTabIds = new Set(
    tabs.filter((tab) => pageKind(tab.location).keepAlive).map((tab) => tab.id),
  );
  const selected = new Set<string>();
  const add = (id: string | undefined) => {
    if (id && selected.size < limit && warmEligibleTabIds.has(id)) selected.add(id);
  };

  add(tabs[activeTabIndex]?.id);
  for (let index = recentlyUsedTabIds.length - 1; index >= 0; index -= 1) {
    add(recentlyUsedTabIds[index]);
  }

  // Unsaved iframe state cannot be reconstructed from the source file.
  for (const id of dirtyTabIds) {
    if (warmEligibleTabIds.has(id)) selected.add(id);
  }
  return selected;
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
