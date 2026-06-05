import type { StructureDragPayload } from "./structure-drag";

export type DockArea = "right" | "bottom";
export type DockToolKind = "ketcher";

export type DockTabKind =
  | "files"
  | "inspector"
  | "structure-basket"
  | "jobs"
  | "logs"
  | "diagnostics"
  | "review"
  | "compare";

export type DockTab = {
  id: string;
  kind: DockTabKind;
};

export type DockDroppedStructure = {
  id: string;
  area: DockArea;
  tabKind: DockTabKind;
  title: string;
  detail: string;
  addedAt: number;
};

export type DockDropInput = {
  area: DockArea;
  tabKind: DockTabKind;
  payload: StructureDragPayload;
};

export const DOCK_TAB_LABELS: Record<DockTabKind, string> = {
  files: "Files",
  inspector: "Inspector",
  "structure-basket": "Structure Basket",
  jobs: "Jobs",
  logs: "Logs",
  diagnostics: "Diagnostics",
  review: "Review",
  compare: "Compare",
};

export const RIGHT_DOCK_DEFAULT_TABS: DockTabKind[] = [
  "files",
];

export const BOTTOM_DOCK_DEFAULT_TABS: DockTabKind[] = [
  "files",
];

const RIGHT_DOCK_TAB_CATALOG: DockTabKind[] = [
  "files",
  "inspector",
];

const BOTTOM_DOCK_TAB_CATALOG: DockTabKind[] = [
  "files",
  "logs",
];

export function createDockTab(kind: DockTabKind): DockTab {
  return { id: `dock-${kind}`, kind };
}

export function defaultDockTabs(area: DockArea) {
  const kinds = area === "right" ? RIGHT_DOCK_DEFAULT_TABS : BOTTOM_DOCK_DEFAULT_TABS;
  return kinds.map(createDockTab);
}

export function dockTabCatalog(area: DockArea) {
  return area === "right" ? RIGHT_DOCK_TAB_CATALOG : BOTTOM_DOCK_TAB_CATALOG;
}

export function firstDockTabKind(area: DockArea) {
  return defaultDockTabs(area)[0]?.kind ?? "files";
}

export function normalizeDockTabs(area: DockArea, tabs: DockTab[] | undefined) {
  const allowedKinds = new Set(dockTabCatalog(area));
  const seen = new Set<DockTabKind>();
  const normalized = (tabs ?? [])
    .filter((tab): tab is DockTab => Boolean(tab && tab.kind && DOCK_TAB_LABELS[tab.kind]))
    .filter((tab) => allowedKinds.has(tab.kind))
    .filter((tab) => {
      if (seen.has(tab.kind)) return false;
      seen.add(tab.kind);
      return true;
    })
    .map((tab) => ({ id: tab.id || `dock-${tab.kind}`, kind: tab.kind }));
  return normalized.length > 0 ? normalized : defaultDockTabs(area);
}

export function normalizeDockActiveTab(area: DockArea, tabs: DockTab[], activeTab: DockTabKind) {
  return tabs.some((tab) => tab.kind === activeTab) ? activeTab : firstDockTabKind(area);
}
