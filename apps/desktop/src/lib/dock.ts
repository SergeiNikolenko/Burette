import type { StructureDragPayload } from "./structure-drag";
import type { TextFileDocument, ViewerDocument } from "../types";

export type DockArea = "right" | "bottom";
export type DockToolKind = "ketcher";

export type DockTabKind =
  | "xyzrender"
  | "files"
  | "spectrum"
  | "text"
  | "inspector"
  | "descriptors"
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
  payload: StructureDragPayload;
};

export type DockDropInput = {
  area: DockArea;
  tabKind: DockTabKind;
  payload: StructureDragPayload;
};

export type DockFileEntry =
  | {
      key: string;
      kind: "document";
      documentId: string;
      title: string;
      detail: string;
      path: string;
    }
  | {
      key: string;
      kind: "text-document";
      documentId: string;
      title: string;
      detail: string;
      path: string;
    }
  | {
      key: string;
      kind: "tool";
      tool: DockToolKind;
      title: string;
      detail: string;
    };

export type DockFileEntriesInput = {
  dockDrops: DockDroppedStructure[];
  documents: ViewerDocument[];
  textDocuments: TextFileDocument[];
  activeDocumentId: string | null;
  activeTool: DockToolKind | null;
};

export const DOCK_TAB_LABELS: Record<DockTabKind, string> = {
  xyzrender: "xyzr",
  files: "Files",
  spectrum: "Spectrum",
  text: "Text",
  inspector: "Info",
  descriptors: "Descriptors",
  "structure-basket": "Structure Basket",
  jobs: "Jobs",
  logs: "Logs",
  diagnostics: "Diagnostics",
  review: "Review",
  compare: "Compare",
};

export const RIGHT_DOCK_DEFAULT_TABS: DockTabKind[] = [
  "xyzrender",
  "inspector",
  "descriptors",
  "text",
  "files",
];

export const BOTTOM_DOCK_DEFAULT_TABS: DockTabKind[] = [
  "files",
];

const RIGHT_DOCK_TAB_CATALOG: DockTabKind[] = [
  "xyzrender",
  "inspector",
  "descriptors",
  "text",
  "files",
];

const BOTTOM_DOCK_TAB_CATALOG: DockTabKind[] = [
  "files",
  "spectrum",
  "logs",
];

export function createDockTab(kind: DockTabKind): DockTab {
  return { id: `dock-${kind}`, kind };
}

export function defaultDockTabs(area: DockArea) {
  const kinds = area === "right" ? RIGHT_DOCK_DEFAULT_TABS : BOTTOM_DOCK_DEFAULT_TABS;
  return kinds.map(createDockTab);
}

export function ensureDefaultDockTabs(area: DockArea, tabs: DockTab[]) {
  const normalized = normalizeDockTabs(area, tabs);
  const existingByKind = new Map(normalized.map((tab) => [tab.kind, tab]));
  const defaults = defaultDockTabs(area).map((defaultTab) => existingByKind.get(defaultTab.kind) ?? defaultTab);
  const extras = normalized.filter((tab) => !defaults.some((defaultTab) => defaultTab.kind === tab.kind));
  return [...defaults, ...extras];
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

export function dockFileEntries({
  dockDrops,
  documents,
  textDocuments,
  activeDocumentId,
  activeTool,
}: DockFileEntriesInput) {
  const documentsByPath = new Map(documents.map((document) => [document.path, document]));
  const textDocumentsByPath = new Map(textDocuments.map((document) => [document.path, document]));
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const textDocumentsById = new Map(textDocuments.map((document) => [document.id, document]));
  const entries: DockFileEntry[] = [];
  const seen = new Set<string>();

  const pushEntry = (entry: DockFileEntry, position: "start" | "end" = "end") => {
    if (seen.has(entry.key)) return;
    seen.add(entry.key);
    if (position === "start") entries.unshift(entry);
    else entries.push(entry);
  };
  const pushPath = (path: string | undefined | null) => {
    if (!path) return;
    const document = documentsByPath.get(path);
    if (document) {
      pushEntry({
        key: `document:${document.id}`,
        kind: "document",
        documentId: document.id,
        title: document.title,
        detail: document.renderer,
        path: document.path,
      });
      return;
    }
    const textDocument = textDocumentsByPath.get(path);
    if (textDocument) {
      pushEntry({
        key: `text-document:${textDocument.id}`,
        kind: "text-document",
        documentId: textDocument.id,
        title: textDocument.title,
        detail: textDocument.extension,
        path: textDocument.path,
      });
    }
  };
  const pushTool = (tool: DockToolKind) => {
    pushEntry({
      key: `tool:${tool}`,
      kind: "tool",
      tool,
      title: tool === "ketcher" ? "Ketcher" : tool,
      detail: "Tool",
    });
  };

  for (const drop of dockDrops) {
    for (const path of drop.payload.paths) pushPath(path);
    for (const item of drop.payload.items ?? []) {
      if (item.kind === "ketcher") pushTool("ketcher");
      pushPath(item.path);
    }
  }

  const activeDocument = activeDocumentId ? documentsById.get(activeDocumentId) : null;
  if (activeDocument) {
    pushEntry({
      key: `document:${activeDocument.id}`,
      kind: "document",
      documentId: activeDocument.id,
      title: activeDocument.title,
      detail: activeDocument.renderer,
      path: activeDocument.path,
    }, "start");
  }
  const activeTextDocument = activeDocumentId ? textDocumentsById.get(activeDocumentId) : null;
  if (activeTextDocument) {
    pushEntry({
      key: `text-document:${activeTextDocument.id}`,
      kind: "text-document",
      documentId: activeTextDocument.id,
      title: activeTextDocument.title,
      detail: activeTextDocument.extension,
      path: activeTextDocument.path,
    }, "start");
  }
  if (activeTool) pushTool(activeTool);

  return entries;
}
