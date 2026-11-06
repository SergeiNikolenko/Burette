import type { Location } from "../components/editor-area/page-kinds";
import { useMoleculeStore, type MoleculeTab } from "../stores/molecule-store";
import { defaultTabWorkspace, useTabWorkspaceStore } from "../stores/tab-workspace-store";
import { useWorkspacePanesStore } from "../stores/workspace-panes-store";
import { dockMediaPath, dockTabCatalog, firstDockTabKind, type DockDropInput, type DockTabKind } from "./dock";
import { documentFallbackExtensions, isDocumentMediaPath, isPreferredTextPath, pathExtension, structureExtensions } from "./file-routing";
import { selectedGroupTab } from "./group-selection";

export function rightPanelSelection(tabs: MoleculeTab[], activeTabId: string | null, remembered?: string) {
  return selectedGroupTab(tabs, activeTabId, { right: remembered }, "right");
}

export function openRightLocation(location: Location, focus = true): string {
  const model = useMoleculeStore.getState();
  const panes = useWorkspacePanesStore.getState();
  const active = model.tabs.find(tab => tab.id === model.activeTabId);
  if (focus && active && !active.pane && active.location.kind !== "settings") panes.selectTab("main", active.id);
  const existing = model.tabs.find(tab => tab.pane === "right" && matchingLocation(tab.location, location));
  const id = existing?.id ?? model.openScreenTab(location, "right", { newTab: true, focus });
  if (focus) {
    panes.selectTab("right", id);
    panes.setGroupOpen("right", true);
    if (panes.fullViewTabId && panes.fullViewTabId !== id) panes.setFullView(id);
    const current = useMoleculeStore.getState();
    if (current.activeTabId !== id) current.setActiveTab(id);
  }
  return id;
}

function matchingLocation(left: Location, right: Location): boolean {
  if (left.kind === "tool" && right.kind === "tool") {
    return left.tool === right.tool && left.area === right.area && left.sourcePath === right.sourcePath;
  }
  if (left.kind === "ketcher" && right.kind === "ketcher") {
    return left.importRequestId === right.importRequestId && left.importRequest?.id === right.importRequest?.id;
  }
  return "path" in left && "path" in right && left.kind === right.kind && left.path === right.path;
}

export function openRightTool(kind: DockTabKind, sourcePath?: string): string {
  return openRightLocation({ kind: "tool", area: "right", tool: kind, sourcePath });
}

export function rightDocumentLocation(id: string): Location | undefined {
  const { documents, textDocuments } = useMoleculeStore.getState();
  const document = documents.find(document => document.id === id);
  if (document) return { kind: "file", path: document.path, documentId: id };
  const text = textDocuments.find(document => document.id === id);
  if (text) return { kind: "text-file", path: text.path, documentId: id };
  const media = dockMediaPath(id);
  if (media) return { kind: "document", path: media };
}

export function openRightDocument(id: string, focus = true) {
  const location = rightDocumentLocation(id);
  if (location) return openRightLocation(location, focus);
}

export function setRightPanelOpen(open: boolean) {
  const model = useMoleculeStore.getState();
  const panes = useWorkspacePanesStore.getState();
  const right = rightPanelSelection(model.tabs, model.activeTabId, panes.selectedTabs.right);
  if (open && !right) {
    openRightTool(firstDockTabKind("right"));
    return;
  }
  if (!right) return;
  panes.selectTab("right", right.id);
  panes.setGroupOpen("right", open);
  if (panes.fullViewTabId && (open || panes.fullViewTabId === right.id)) panes.setFullView(null);
  if (open) return;
  if (model.activeTabId === right.id) {
    const main = model.tabs.find(tab => !tab.pane && tab.id === panes.selectedTabs.main)
      ?? model.tabs.find(tab => !tab.pane && tab.location.kind !== "settings");
    if (main) model.setActiveTab(main.id);
  }
}

export function openRightDockDrop(input: DockDropInput, focus = true) {
  if (!dockTabCatalog("right").includes(input.tabKind)) return;
  // File drops are opened by the document loader. It supplies the registered
  // document or editor after decoding the input.
  if (input.tabKind === "files") return;
  const id = openRightLocation({ kind: "tool", area: "right", tool: input.tabKind }, focus);
  useTabWorkspaceStore.getState().addDockDrop(id, input);
}

export function migrateLegacyRightPanels() {
  const { tabs, activeTabId } = useMoleculeStore.getState();
  const panes = useWorkspacePanesStore.getState();
  const workspaceStore = useTabWorkspaceStore.getState();
  const defaults = defaultTabWorkspace().right;
  const hadRightTabs = tabs.some(tab => tab.pane === "right");
  let activeLegacySelection: string | undefined;
  let activeLegacySize = 0;
  for (const owner of tabs) {
    const workspace = workspaceStore.workspaces[owner.id];
    const right = workspace?.right;
    if (!right) continue;
    const drops = workspace.droppedStructures.filter(drop => drop.area === "right");
    const custom = right.tabs.some(tab => !defaults.tabs.some(item => item.kind === tab.kind));
    if (!right.open && !right.documentId && !right.documentPath && !right.tool && !custom
      && (owner.location.kind === "tool" || !drops.length)) continue;
    const sourcePath = right.documentPath ?? (right.documentId ? locationPath(rightDocumentLocation(right.documentId)) : undefined);
    for (const kind of new Set([...right.tabs.map(tab => tab.kind), ...drops.map(drop => drop.tabKind)])) {
      if (!dockTabCatalog("right").includes(kind)) continue;
      const location = kind !== "files" ? { kind: "tool", area: "right", tool: kind, sourcePath } as const
        : right.tool ? { kind: "ketcher" } as const
          : right.documentId && rightDocumentLocation(right.documentId)
            || (sourcePath ? legacyFileLocation(sourcePath) : { kind: "tool", area: "right", tool: "files" } as const);
      const id = openRightLocation(location, false);
      const toolDrops = drops.filter(drop => drop.tabKind === kind);
      if (kind === "files") {
        for (const path of new Set(toolDrops.flatMap(drop => drop.payload.paths))) {
          openRightLocation(legacyFileLocation(path), false);
        }
      } else if (toolDrops.length) workspaceStore.mergeToolDrops(id, toolDrops);
      if (owner.id === activeTabId && right.open && right.activeTab === kind) {
        activeLegacySelection = id;
        activeLegacySize = right.size;
      }
    }
    workspaceStore.clearLegacyRight(owner.id);
  }
  if (!hadRightTabs && useMoleculeStore.getState().tabs.some(tab => tab.pane === "right")) {
    if (activeLegacySelection) panes.selectTab("right", activeLegacySelection);
    if (activeLegacySize && window.innerWidth > 0) panes.setSplit("right", 1 - activeLegacySize / window.innerWidth);
    panes.setGroupOpen("right", Boolean(activeLegacySelection));
  }
}

function legacyFileLocation(path: string): Location {
  const { documents, textDocuments } = useMoleculeStore.getState();
  const document = documents.find(item => item.path === path) ?? textDocuments.find(item => item.path === path);
  const registered = document && rightDocumentLocation(document.id);
  if (registered) return registered;
  const extension = pathExtension(path);
  if (isDocumentMediaPath(path) || documentFallbackExtensions.has(extension)) return { kind: "document", path };
  if (isPreferredTextPath(path, extension) || !structureExtensions.has(extension)) return { kind: "text-file", path };
  return { kind: "file", path };
}

function locationPath(location: Location | undefined): string | undefined {
  return location && "path" in location ? location.path : undefined;
}
