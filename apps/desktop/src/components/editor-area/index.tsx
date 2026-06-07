import { memo, useEffect, useMemo, useState, type ComponentType } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { pageKind, type Location } from "./page-kinds";
import type { PageComponentProps } from "./page-kinds/types";
import type { MoleculeTab } from "../../stores/molecule-store";

const DEFAULT_WARM_PAGE_LIMIT = 10;
const LOW_DEVICE_MEMORY_WARM_PAGE_LIMIT = 6;
const MEMORY_PRESSURE_WARM_PAGE_LIMIT = 4;
const MEMORY_PRESSURE_HEAP_BYTES = 768 * 1024 * 1024;
const MEMORY_PRESSURE_HEAP_RATIO = 0.7;

export function ViewerArea({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const activeTabId = state.activeTabId ?? state.activeTab?.id;
  const tabs = state.tabs.length > 0 ? state.tabs : [{ id: "fallback", location: activeLocation(state), back: [], forward: [] }];
  const activeTabIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const [recentlyUsedTabIds, setRecentlyUsedTabIds] = useState<string[]>([]);
  const warmPageLimit = mountedWarmPageLimit();
  const warmMountedTabIds = useMemo(
    () => warmMountedTabs(tabs, activeTabIndex, recentlyUsedTabIds, warmPageLimit),
    [activeTabIndex, recentlyUsedTabIds, tabs, warmPageLimit],
  );

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

  return (
    <div className="page-stack">
      {tabs.map((tab, index) => {
        const isActive = index === activeTabIndex;
        const kind = pageKind(tab.location);
        if (!isActive && (!kind.keepAlive || !warmMountedTabIds.has(tab.id))) return null;
        return (
          <MountedPageSurface
            key={tab.id}
            tab={tab}
            isActive={isActive}
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
  state,
  actions,
}: {
  tab: MoleculeTab;
  isActive: boolean;
  state: ShellViewState;
  actions: ShellActions;
}) {
  const kind = pageKind(tab.location);
  const Page = kind.Component as ComponentType<PageComponentProps<typeof tab.location>>;
  return (
    <div className="page-surface" data-page-kind={kind.kind} data-active={isActive || undefined} aria-hidden={!isActive}>
      <Page location={tab.location} state={state} actions={actions} isActive={isActive} />
    </div>
  );
}, (previous, next) => {
  if (previous.isActive || next.isActive) return false;
  return previous.tab.id === next.tab.id && previous.tab.location === next.tab.location;
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

  const fallbackCenter = activeTabIndex >= 0 ? activeTabIndex : tabs.length - 1;
  for (let offset = 1; selected.size < limit && offset < tabs.length; offset += 1) {
    add(tabs[fallbackCenter - offset]?.id);
    add(tabs[fallbackCenter + offset]?.id);
  }
  for (let index = tabs.length - 1; selected.size < limit && index >= 0; index -= 1) {
    add(tabs[index]?.id);
  }

  return selected;
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
