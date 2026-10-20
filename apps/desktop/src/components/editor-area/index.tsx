import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { pageKind, type Location } from "./page-kinds";
import { TabHistoryPages } from "./tab-history-pages";
import type { MoleculeTab, TabPane } from "../../stores/molecule-store";
import { FloatingPaneHeader } from "../workspace-panes/floating-pane";
import { useNativePopoutSession } from "../workspace-panes/native-scene-window";
import { usePaneVisibility, type PaneShown } from "../workspace-panes/use-pane-tabs";
import { useSourceEditing } from "../../lib/source-editing/context";
import { planSceneResidency, scenePageKey } from "./scene-residency";
import { useSceneEditProtection } from "./use-scene-edit-protection";
import { FileViewerEmptyState } from "../ui/file-viewer-state";
import { Button } from "../ui/button";

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
  const residentPageKeys = useRef<ReadonlySet<string>>(new Set());
  const [overridePageKeys, setOverridePageKeys] = useState<ReadonlySet<string>>(new Set());
  const resumePage = useCallback((key: string) => setOverridePageKeys(previous => new Set([...previous, key])), []);
  const warmPageLimit = mountedWarmPageLimit();
  const paneVisibility = usePaneVisibility(state.page === "settings");
  const sourceEditing = useSourceEditing();
  const editedSceneIds = useSceneEditProtection(state.documents);
  const protectedDocumentIds = useMemo(() => new Set([
    ...(state.dirtyGridDocuments ?? []),
    ...editedSceneIds,
    ...state.documents.filter(document => document.sceneUnsaved || (document.sceneSourcePaths?.length ?? 0) > 1
      || sourceEditing?.sessionForDocument(document)).map(document => document.id),
  ]), [state.dirtyGridDocuments, state.documents, sourceEditing, editedSceneIds]);
  const residency = useMemo(() => planSceneResidency({
    tabs,
    warmTabIds: new Set(tabs.filter(tab => pageKind(tab.location).keepAlive).map(tab => tab.id)),
    recentTabIds: recentlyUsedTabIds,
    visibleTabIds: new Set(tabs.filter((tab, index) => (index === activeTabIndex && !tab.pane)
      || paneVisibility(tab) === "visible").map(tab => tab.id)),
    protectedDocumentIds,
    documents: state.documents,
    limit: warmPageLimit,
    residentPageKeys: residentPageKeys.current,
    overridePageKeys,
    frameCounts: new Map(state.documents.map(document => {
      const slots = sourceEditing?.sessionForDocument(document)?.sourcePreview?.slots;
      return [document.id, slots?.primary && slots.secondary ? 2 : 1];
    })),
  }), [tabs, recentlyUsedTabIds, activeTabIndex, paneVisibility, protectedDocumentIds, state.documents, warmPageLimit, sourceEditing, overridePageKeys]);
  useEffect(() => { residentPageKeys.current = residency.pageKeys; }, [residency]);

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
  // floating window only repositions its surface. Moving an
  // iframe to another parent reloads it, which would rebuild the Mol* scene.
  return (
    <div className="page-stack">
      {tabs.map((tab, index) => {
        const isActive = index === activeTabIndex && !tab.pane;
        const kind = pageKind(tab.location);
        const shown = paneVisibility(tab);
        // Non-file pane controls have local UI state and no molecular viewer
        // to reclaim. Preserve the established hidden-dock state contract.
        const panePageHeld = Boolean(tab.pane) && kind.keepAlive && tab.location.kind !== "file";
        const mountContent = isActive || shown === "visible" || panePageHeld || residency.mountedTabIds.has(tab.id);
        // Keep a minimized floating header usable even when its clean page is
        // cold. The surface/iframe parent never moves during pane transitions.
        if (!mountContent && shown !== "minimized") return null;
        return (
          <MountedPageSurface
            key={tab.id}
            tab={tab}
            isActive={isActive}
            pane={tab.pane ?? null}
            shown={shown}
            mountContent={mountContent}
            retainedHistoryKeys={residency.historyKeys.get(tab.id) ?? EMPTY_HISTORY_KEYS}
            protectedDocumentIds={protectedDocumentIds}
            paused={residency.deferredTabIds.has(tab.id)}
            resumePage={resumePage}
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
  mountContent,
  retainedHistoryKeys,
  protectedDocumentIds,
  paused,
  resumePage,
  state,
  actions,
}: {
  tab: MoleculeTab;
  isActive: boolean;
  pane: TabPane | null;
  shown: PaneShown;
  mountContent: boolean;
  retainedHistoryKeys: ReadonlySet<string>;
  protectedDocumentIds: ReadonlySet<string>;
  paused: boolean;
  resumePage: (key: string) => void;
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
      {mountContent ? <TabHistoryPages tab={tab} state={state} actions={actions} isActive={contentVisible} retainedHistoryKeys={retainedHistoryKeys} protectedDocumentIds={protectedDocumentIds}
        pausedPage={paused ? <FileViewerEmptyState title="Scene paused" icon={null} action={<Button variant="outline" size="sm" onClick={() => resumePage(scenePageKey(tab.id, tab.location))}>Open scene</Button>} /> : undefined} /> : null}
    </div>
  );
}, (previous, next) => {
  if (previous.isActive || next.isActive) return false;
  if (previous.shown !== "hidden" || next.shown !== "hidden") return false;
  if (previous.mountContent !== next.mountContent || previous.retainedHistoryKeys !== next.retainedHistoryKeys) return false;
  if (previous.protectedDocumentIds !== next.protectedDocumentIds) return false;
  if (previous.paused !== next.paused) return false;
  return previous.tab.id === next.tab.id && previous.tab.location === next.tab.location && previous.pane === next.pane
    && previous.state.dirtyGridDocuments === next.state.dirtyGridDocuments
    && previous.state.documents === next.state.documents;
});

const EMPTY_HISTORY_KEYS: ReadonlySet<string> = new Set();

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
  // Missing WKWebView heap telemetry is not evidence of memory pressure.
  // Preserve visited views; cold remounts are substantially slower than warm
  // switches. A measured absolute heap limit still applies without a ratio.
  const heapPressure = (
    typeof usedHeap === "number" &&
    Number.isFinite(usedHeap) &&
    usedHeap >= 0 &&
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

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
