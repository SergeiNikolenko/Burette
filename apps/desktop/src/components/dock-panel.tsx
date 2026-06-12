import { Suspense, lazy, useMemo, useState } from "react";
import {
  Atom01Icon,
  File02Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DOCK_TAB_LABELS, dockFileEntries, dockTabCatalog, type DockArea, type DockFileEntry, type DockTabKind } from "../lib/dock";
import { hasStructureDrag, readStructureDragPayload, writeStructureDragPayload } from "../lib/structure-drag";
import type { StructureDragPayload } from "../lib/structure-drag";
import type { ShellActions, ShellViewState } from "./types";
import { showNativeContextMenu } from "./native-context-menu";
import { formatBytes } from "./format";
import { ViewerFrame } from "./editor-area/viewer-frame";
import { TextFileViewer } from "./text-file-viewer";
import { CloseIcon } from "./close-icon";

const KetcherPage = lazy(() => import("./ketcher-page").then((module) => ({
  default: module.KetcherPage,
})));

type DockPanelProps = {
  area: DockArea;
  state: ShellViewState;
  actions: ShellActions;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
};

const dockTabIcons: Record<DockTabKind, typeof File02Icon> = {
  files: Folder01Icon,
  inspector: Search01Icon,
  "structure-basket": Atom01Icon,
  compare: Atom01Icon,
  jobs: File02Icon,
  logs: File02Icon,
  diagnostics: Search01Icon,
  review: Search01Icon,
};

export function DockPanel({ area, state, actions, onResizeStart }: DockPanelProps) {
  const [dropActive, setDropActive] = useState(false);
  const tabs = area === "right" ? state.rightDockTabs : state.bottomDockTabs;
  const activeTabKind = area === "right" ? state.rightDockActiveTab : state.bottomDockActiveTab;
  const open = area === "right" ? state.rightDockOpen : state.bottomDockOpen;
  const size = area === "right" ? state.rightDockWidth : state.bottomDockHeight;
  const dragging = area === "right" ? state.rightDockDragging : state.bottomDockDragging;
  const activeTab = tabs.find((tab) => tab.kind === activeTabKind) ?? tabs[0];
  const dockDocumentId = area === "right" ? state.rightDockDocumentId : state.bottomDockDocumentId;
  const dockTool = area === "right" ? state.rightDockTool : state.bottomDockTool;
  const dockDocument = dockDocumentId ? state.documents.find((document) => document.id === dockDocumentId) ?? null : null;
  const dockTextDocument = dockDocumentId ? state.textDocuments.find((document) => document.id === dockDocumentId) ?? null : null;
  const filesTabDragPayload = dockFilesDragPayload(dockDocument, dockTextDocument, dockTool);
  const dockDrops = useMemo(
    () => state.dockDroppedStructures.filter((item) => item.area === area && item.tabKind === activeTab.kind),
    [activeTab.kind, area, state.dockDroppedStructures],
  );

  const showAddMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu(
      dockTabCatalog(area).map((kind) => ({
        kind: "item" as const,
        id: `dock-${area}-${kind}`,
        text: DOCK_TAB_LABELS[kind],
        disabled: tabs.some((tab) => tab.kind === kind),
        action: () => actions.openDockTab(area, kind),
      })),
      { x: rect.left, y: rect.bottom + 6 },
      { forceWeb: true },
    );
  };

  const handleDrag = (event: React.DragEvent<HTMLElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
    actions.setStructureDragActive(true);
  };

  const clearDrop = () => {
    setDropActive(false);
    actions.setStructureDragActive(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = readStructureDragPayload(event.dataTransfer);
    clearDrop();
    if (payload.paths.length === 0 && payload.records.length === 0 && (payload.items?.length ?? 0) === 0) return;
    void actions.openDockPayload({ area, tabKind: activeTab.kind, payload });
  };

  return (
    <aside
      className="dock-panel"
      data-area={area}
      data-active-tab={activeTab.kind}
      data-open={open ? "true" : "false"}
      data-dragging={dragging || undefined}
      data-drop-active={dropActive || undefined}
      style={area === "right" ? { width: open ? size : 0 } : { height: open ? size : 0 }}
      aria-hidden={!open || undefined}
      inert={!open}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        clearDrop();
      }}
      onDrop={handleDrop}
      aria-label={`${area} dock`}
    >
      <div
        className="dock-resizer"
        role="separator"
        aria-orientation={area === "right" ? "vertical" : "horizontal"}
        aria-label={`Resize ${area} dock`}
        onPointerDown={onResizeStart}
      />
      <div
        className="dock-panel-inner"
        style={area === "right" ? { width: size } : { height: size }}
      >
        <div className="dock-header">
          <div className="dock-tab-strip" role="tablist" aria-label={`${area} dock tabs`}>
            {tabs.map((tab) => {
              const Icon = dockTabIcons[tab.kind];
              const active = tab.kind === activeTab.kind;
              const closeTab = () => {
                if (tabs.length > 1) {
                  actions.closeDockTab(area, tab.id);
                  return;
                }
                actions.setDockOpen(area, false);
              };
              return (
                <div className="dock-tab-shell" key={tab.id}>
                  <button
                    type="button"
                    className="dock-tab"
                    data-active={active || undefined}
                    draggable={tab.kind === "files" && Boolean(filesTabDragPayload)}
                    onDragStart={(event) => {
                      if (tab.kind !== "files" || !filesTabDragPayload) return;
                      writeStructureDragPayload(event.dataTransfer, filesTabDragPayload);
                      actions.setStructureDragActive(true);
                    }}
                    onDragEnd={() => actions.setStructureDragActive(false)}
                    onClick={() => actions.setDockActiveTab(area, tab.kind)}
                    role="tab"
                    aria-selected={active}
                    title={DOCK_TAB_LABELS[tab.kind]}
                  >
                    <HugeiconsIcon icon={Icon} size={16} color="currentColor" strokeWidth={2} />
                    <span>{DOCK_TAB_LABELS[tab.kind]}</span>
                  </button>
                  <button
                    type="button"
                    className="dock-tab-close"
                    aria-label={tabs.length > 1 ? `Close ${DOCK_TAB_LABELS[tab.kind]}` : `Close ${area} dock`}
                    onClick={closeTab}
                  >
                    <CloseIcon size={11} />
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" className="dock-icon-button" onClick={showAddMenu} aria-label={`Add ${area} dock tab`}>
            +
          </button>
          <button type="button" className="dock-icon-button" onClick={() => actions.setDockOpen(area, false)} aria-label={`Close ${area} dock`}>
            <CloseIcon size={15} />
          </button>
        </div>
        <DockPanelContent
          area={area}
          activeTabKind={activeTab.kind}
          state={state}
          actions={actions}
          dockDrops={dockDrops}
        />
      </div>
    </aside>
  );
}

function DockPanelContent({
  area,
  activeTabKind,
  state,
  actions,
  dockDrops,
}: {
  area: DockArea;
  activeTabKind: DockTabKind;
  state: ShellViewState;
  actions: ShellActions;
  dockDrops: ShellViewState["dockDroppedStructures"];
}) {
  const activeDocument = state.activeDocument;
  const dockDocumentId = area === "right" ? state.rightDockDocumentId : state.bottomDockDocumentId;
  const dockTool = area === "right" ? state.rightDockTool : state.bottomDockTool;
  const dockDocument = dockDocumentId ? state.documents.find((document) => document.id === dockDocumentId) ?? null : null;
  const dockTextDocument = dockDocumentId ? state.textDocuments.find((document) => document.id === dockDocumentId) ?? null : null;
  const fileEntries = activeTabKind === "files"
    ? dockFileEntries({
        dockDrops,
        documents: state.documents,
        textDocuments: state.textDocuments,
        activeDocumentId: dockDocumentId,
        activeTool: dockTool,
      })
    : [];
  const activeFileEntryKey = activeDockFileEntryKey(dockDocument, dockTextDocument, dockTool);
  if (activeTabKind === "files") {
    const fileTabs = (
      <DockFileTabs
        area={area}
        entries={fileEntries}
        activeKey={activeFileEntryKey}
        actions={actions}
      />
    );
    if (dockTool === "ketcher") {
      return (
        <div className="dock-files-view">
          {fileTabs}
          <div className="dock-viewer">
            <Suspense fallback={<div className="ketcher-loading">Loading editor</div>}>
              <KetcherPage location={{ kind: "ketcher" }} state={state} actions={actions} isActive acceptImportRequests={false} />
            </Suspense>
          </div>
        </div>
      );
    }
    if (dockDocument) {
      return (
        <div className="dock-files-view">
          {fileTabs}
          <div className="dock-viewer">
            <ViewerFrame document={dockDocument} />
          </div>
        </div>
      );
    }
    if (dockTextDocument) {
      return (
        <div className="dock-files-view">
          {fileTabs}
          <div className="dock-viewer">
            <TextFileViewer document={dockTextDocument} openPaths={actions.openPaths} />
          </div>
        </div>
      );
    }
    return (
      <div className="dock-content dock-content-empty">
        <div className="dock-empty dock-empty-large">Drop a structure to open it here</div>
      </div>
    );
  }
  if (activeTabKind === "inspector") {
    return (
      <div className="dock-content">
        <Metric label="Active structure" value={activeDocument?.title ?? "None"} />
        <Metric label="Renderer" value={activeDocument?.renderer ?? "None"} />
        <Metric label="Size" value={activeDocument ? formatBytes(activeDocument.byteCount) : "None"} />
        {activeDocument ? (
          <button type="button" className="dock-action" onClick={() => void actions.showActiveDocumentMetadata()}>
            Show metadata
          </button>
        ) : null}
        <DockDropList items={dockDrops} actions={actions} emptyLabel="No inspected drops" />
      </div>
    );
  }
  if (activeTabKind === "structure-basket") {
    return (
      <div className="dock-content">
        <Metric label="Basket" value={`${dockDrops.length} structure${dockDrops.length === 1 ? "" : "s"}`} />
        <DockDropList items={dockDrops} actions={actions} emptyLabel="No structures" />
      </div>
    );
  }
  if (activeTabKind === "compare") {
    return (
      <div className="dock-content">
        <Metric label="Compare set" value={`${dockDrops.length} structure${dockDrops.length === 1 ? "" : "s"}`} />
        <Metric label="Active source" value={activeDocument?.title ?? "None"} />
        <DockDropList items={dockDrops} actions={actions} emptyLabel="No compare inputs" />
      </div>
    );
  }
  if (activeTabKind === "jobs") {
    return (
      <div className="dock-content">
        <Metric label="Renderer jobs" value="Idle" />
        <Metric label="Open runtimes" value={String(state.documents.length)} />
        <DockDropList items={dockDrops} actions={actions} emptyLabel="No job inputs" />
      </div>
    );
  }
  if (activeTabKind === "logs") {
    return (
      <div className="dock-content">
        <Metric label="Status" value={state.status?.message ?? "No active notice"} />
        <button type="button" className="dock-action" onClick={() => void actions.openLogs()}>
          Open logs folder
        </button>
        <DockDropList items={dockDrops} actions={actions} emptyLabel="No log inputs" />
      </div>
    );
  }
  if (activeTabKind === "diagnostics") {
    return (
      <div className="dock-content dock-content-grid">
        <Metric label="Runtime" value={state.buildInfo.isAgentShell ? "Agent shell" : state.buildInfo.isBrowserDev ? "Browser dev" : "Desktop"} />
        <Metric label="Build" value={state.buildInfo.version} />
        <Metric label="Flavor" value={state.buildInfo.flavor ?? "Release"} />
        <button type="button" className="dock-action" onClick={() => void actions.exportDiagnostics()}>
          Export diagnostics
        </button>
        <DockDropList items={dockDrops} actions={actions} emptyLabel="No diagnostic inputs" />
      </div>
    );
  }
  return (
    <div className="dock-content">
      <Metric label={area === "right" ? "Review context" : "Review queue"} value={activeDocument?.title ?? "None"} />
      <Metric label="Dropped inputs" value={String(dockDrops.length)} />
      <DockDropList items={dockDrops} actions={actions} emptyLabel="No review inputs" />
    </div>
  );
}

function activeDockFileEntryKey(
  dockDocument: ShellViewState["documents"][number] | null,
  dockTextDocument: ShellViewState["textDocuments"][number] | null,
  dockTool: ShellViewState["rightDockTool"],
) {
  if (dockDocument) return `document:${dockDocument.id}`;
  if (dockTextDocument) return `text-document:${dockTextDocument.id}`;
  if (dockTool) return `tool:${dockTool}`;
  return null;
}

function DockFileTabs({
  area,
  entries,
  activeKey,
  actions,
}: {
  area: DockArea;
  entries: DockFileEntry[];
  activeKey: string | null;
  actions: ShellActions;
}) {
  if (entries.length <= 1) return null;
  return (
    <div className="dock-file-tabs" role="tablist" aria-label={`${area} dock files`}>
      {entries.map((entry) => (
        <button
          type="button"
          key={entry.key}
          className="dock-file-tab"
          data-active={entry.key === activeKey || undefined}
          title={entry.kind === "tool" ? entry.title : entry.path}
          onClick={() => {
            if (entry.kind === "tool") {
              actions.setDockTool(area, "ketcher");
              return;
            }
            actions.setDockDocument(area, entry.documentId);
          }}
          role="tab"
          aria-selected={entry.key === activeKey}
        >
          <span>{entry.title}</span>
        </button>
      ))}
    </div>
  );
}

function dockFilesDragPayload(
  dockDocument: ShellViewState["documents"][number] | null,
  dockTextDocument: ShellViewState["textDocuments"][number] | null,
  dockTool: ShellViewState["rightDockTool"],
): StructureDragPayload | null {
  if (dockDocument) {
    return {
      paths: [dockDocument.path],
      records: [],
      items: [{
        kind: "file",
        title: dockDocument.title,
        detail: dockDocument.renderer,
        path: dockDocument.path,
      }],
    };
  }
  if (dockTextDocument) {
    return {
      paths: [dockTextDocument.path],
      records: [],
      items: [{
        kind: "writer",
        title: dockTextDocument.title,
        detail: dockTextDocument.extension,
        path: dockTextDocument.path,
      }],
    };
  }
  if (dockTool === "ketcher") {
    return {
      paths: [],
      records: [],
      items: [{ kind: "ketcher", title: "Ketcher", detail: "Sketcher" }],
    };
  }
  return null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="dock-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DockDropList({
  items,
  actions,
  emptyLabel,
}: {
  items: ShellViewState["dockDroppedStructures"];
  actions: ShellActions;
  emptyLabel: string;
}) {
  return (
    <div className="dock-drop-list">
      {items.length === 0 ? (
        <div className="dock-empty">{emptyLabel}</div>
      ) : items.map((item) => (
        <div
          className="dock-drop-item"
          key={item.id}
          draggable
          onDragStart={(event) => {
            writeStructureDragPayload(event.dataTransfer, item.payload);
            actions.setStructureDragActive(true);
          }}
          onDragEnd={() => actions.setStructureDragActive(false)}
        >
          <strong>{item.title}</strong>
          <span>{item.detail}</span>
        </div>
      ))}
    </div>
  );
}
