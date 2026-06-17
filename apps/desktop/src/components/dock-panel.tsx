import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { ViewerFrame } from "./editor-area/viewer-frame";
import { TextFileViewer } from "./text-file-viewer";
import { CloseIcon } from "./close-icon";
import { formatBytes } from "./format";
import { StructureInfoPanel } from "./structure-info-panel";
import { DescriptorPanel } from "./descriptor-panel";
import { SpectrumInfoPanel, SpectrumPeakTablePanel, SpectrumViewer } from "./spectrum-viewer";
import { readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import { readStructureTextDocument } from "../lib/structure-text";
import type { TextFileDocument, ViewerDocument, XyzrenderControls } from "../types";

type DockPanelProps = {
  area: DockArea;
  state: ShellViewState;
  actions: ShellActions;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
};

const dockTabIcons: Record<DockTabKind, typeof File02Icon> = {
  xyzrender: Atom01Icon,
  files: Folder01Icon,
  spectrum: Atom01Icon,
  text: File02Icon,
  inspector: Search01Icon,
  descriptors: Atom01Icon,
  "structure-basket": Atom01Icon,
  compare: Atom01Icon,
  jobs: File02Icon,
  logs: File02Icon,
  diagnostics: Search01Icon,
  review: Search01Icon,
};

export function DockPanel({ area, state, actions, onResizeStart }: DockPanelProps) {
  const [dropActive, setDropActive] = useState(false);
  const rawTabs = area === "right" ? state.rightDockTabs : state.bottomDockTabs;
  const open = area === "right" ? state.rightDockOpen : state.bottomDockOpen;
  const size = area === "right" ? state.rightDockWidth : state.bottomDockHeight;
  const dragging = area === "right" ? state.rightDockDragging : state.bottomDockDragging;
  const dockDocumentId = area === "right" ? state.rightDockDocumentId : state.bottomDockDocumentId;
  const dockTool = area === "right" ? state.rightDockTool : state.bottomDockTool;
  const dockDocument = dockDocumentId ? state.documents.find((document) => document.id === dockDocumentId) ?? null : null;
  const dockTextDocument = dockDocumentId ? state.textDocuments.find((document) => document.id === dockDocumentId) ?? null : null;
  const activeStructureDocument = dockDocument ?? state.activeDocument;
  const spectrumDocumentActive = activeStructureDocument?.renderer === "spectrum";
  const spectrumDockAvailable = area === "bottom" && (dockDocument?.renderer === "spectrum" || state.activeDocument?.renderer === "spectrum");
  const tabs = rawTabs.filter((tab) => {
    if (tab.kind === "spectrum") return spectrumDockAvailable;
    if (tab.kind === "descriptors") return !(area === "right" && spectrumDocumentActive);
    return true;
  });
  const storedActiveTabKind = area === "right" ? state.rightDockActiveTab : state.bottomDockActiveTab;
  const activeTabKind = tabs.some((tab) => tab.kind === storedActiveTabKind) ? storedActiveTabKind : tabs[0]?.kind ?? "files";
  const xyzrenderDockDocument = area === "right"
    ? (dockDocument?.renderer === "xyzrender-external" ? dockDocument : state.activeDocument?.renderer === "xyzrender-external" ? state.activeDocument : null)
    : null;
  const visibleTabs = xyzrenderDockDocument ? tabs : tabs.filter((tab) => tab.kind !== "xyzrender");
  const activeTab = visibleTabs.find((tab) => tab.kind === activeTabKind) ?? visibleTabs[0] ?? tabs[0];
  const filesTabDragPayload = dockFilesDragPayload(dockDocument, dockTextDocument, dockTool);
  const dockDrops = useMemo(
    () => state.dockDroppedStructures.filter((item) => item.area === area && item.tabKind === activeTab.kind),
    [activeTab.kind, area, state.dockDroppedStructures],
  );
  const autoOpenedXyzrenderDocumentId = useRef<string | null>(null);

  useEffect(() => {
    if (!open || area !== "right" || !xyzrenderDockDocument) return;
    if (autoOpenedXyzrenderDocumentId.current === xyzrenderDockDocument.id) return;
    autoOpenedXyzrenderDocumentId.current = xyzrenderDockDocument.id;
    actions.setDockActiveTab("right", "xyzrender");
  }, [actions, area, open, xyzrenderDockDocument]);

  const showAddMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu(
      dockTabCatalog(area).filter((kind) => {
        if (kind === "spectrum") return spectrumDockAvailable;
        if (kind === "descriptors") return !(area === "right" && spectrumDocumentActive);
        return true;
      }).map((kind) => ({
        kind: "item" as const,
        id: `dock-${area}-${kind}`,
        text: DOCK_TAB_LABELS[kind],
        disabled: tabs.some((tab) => tab.kind === kind) || (kind === "xyzrender" && !xyzrenderDockDocument),
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
            {visibleTabs.map((tab) => {
              const Icon = dockTabIcons[tab.kind];
              const active = tab.kind === activeTab.kind;
              const closeTab = () => {
                if (visibleTabs.length > 1) {
                  actions.closeDockTab(area, tab.id);
                  return;
                }
                actions.setDockOpen(area, false);
              };
              return (
                <div className="dock-tab-shell" data-active={active || undefined} key={tab.id}>
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
                  {active && (
                    <button
                      type="button"
                      className="dock-tab-close"
                      aria-label={visibleTabs.length > 1 ? `Close ${DOCK_TAB_LABELS[tab.kind]}` : `Close ${area} dock`}
                      onClick={closeTab}
                    >
                      <CloseIcon size={11} />
                    </button>
                  )}
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
  const activePageKind = state.activeTab?.location.kind ?? null;
  const dockDocumentId = area === "right" ? state.rightDockDocumentId : state.bottomDockDocumentId;
  const dockTool = area === "right" ? state.rightDockTool : state.bottomDockTool;
  const dockDocument = dockDocumentId ? state.documents.find((document) => document.id === dockDocumentId) ?? null : null;
  const dockTextDocument = dockDocumentId ? state.textDocuments.find((document) => document.id === dockDocumentId) ?? null : null;
  const dockStructureDocument = dockDocument ?? activeDocument;
  const activeTextDocument = activeTextDocumentFromState(state);
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
  if (activeTabKind === "spectrum") {
    const spectrumDocument = dockStructureDocument?.renderer === "spectrum" ? dockStructureDocument : null;
    if (area === "bottom" && spectrumDocument) {
      return (
        <div className="dock-viewer">
          <SpectrumPeakTablePanel document={spectrumDocument} />
        </div>
      );
    }
    return (
      <div className="dock-content dock-content-empty">
        <div className="dock-empty dock-empty-large">Open a spectrum to inspect peaks</div>
      </div>
    );
  }
  if (activeTabKind === "files") {
    const fileTabs = (
      <DockFileTabs
        area={area}
        entries={fileEntries}
        activeKey={activeFileEntryKey}
        actions={actions}
      />
    );
    if (dockTool === "ketcher") return <KetcherDockTool area={area} state={state} fileTabs={fileTabs} />;
    if (dockDocument) {
      return (
        <div className="dock-files-view">
          {fileTabs}
          <div className="dock-viewer">
            {dockDocument.renderer === "spectrum"
              ? <SpectrumViewer document={dockDocument} embedded />
              : <ViewerFrame document={dockDocument} />}
          </div>
        </div>
      );
    }
    if (dockTextDocument) {
      return (
        <div className="dock-files-view">
          {fileTabs}
          <div className="dock-viewer">
            <TextFileViewer document={dockTextDocument} openPaths={actions.openPaths} onStructureSelection={actions.selectTextStructure} />
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
  if (activeTabKind === "text") {
    if (area === "right" && activePageKind === "ketcher") {
      return (
        <div className="dock-content dock-content-empty">
          <div className="dock-empty dock-empty-large">Ketcher text is available from the bottom Export panel</div>
        </div>
      );
    }
    if (dockTextDocument) {
      return (
        <div className="dock-viewer">
          <TextFileViewer document={dockTextDocument} openPaths={actions.openPaths} onStructureSelection={actions.selectTextStructure} />
        </div>
      );
    }
    return (
      <ActiveDocumentTextPanel
        activeDocument={dockStructureDocument}
        activeTextDocument={activeTextDocument}
        textDocuments={state.textDocuments}
        openPaths={actions.openPaths}
        onStructureSelection={actions.selectTextStructure}
      />
    );
  }
  if (activeTabKind === "xyzrender") {
    if (dockStructureDocument?.renderer === "xyzrender-external") {
      return <XyzrenderDockPanel document={dockStructureDocument} actions={actions} />;
    }
    return (
      <div className="dock-content dock-content-empty">
        <div className="dock-empty dock-empty-large">xyzrender controls are available for xyzr previews</div>
      </div>
    );
  }
  if (activeTabKind === "inspector") {
    if (area === "right" && activePageKind === "ketcher") return <KetcherInspectorPanel state={state} />;
    if (dockTextDocument) return <TextDocumentInfoPanel document={dockTextDocument} actions={actions} />;
    if (dockStructureDocument?.renderer === "spectrum") return <SpectrumInfoPanel document={dockStructureDocument} />;
    return <StructureInfoPanel document={dockStructureDocument} dockDrops={dockDrops} actions={actions} />;
  }
  if (activeTabKind === "descriptors") {
    return <DescriptorPanel state={state} actions={actions} />;
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

const DEFAULT_XYZRENDER_DOCK_CONTROLS: XyzrenderControls = {
  transparentBackground: true,
  gradients: null,
  fog: null,
  showVdw: false,
  hideBonds: false,
  fieldMode: "auto",
  fieldIso: 0.8,
  fieldOpacity: 1,
};

function XyzrenderDockPanel({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  const [preset, setPreset] = useState(document.xyzrenderPreset || "default");
  const [controls, setControls] = useState<XyzrenderControls>(() => xyzrenderDockControls(document));
  const lastAppliedSignature = useRef("");

  useEffect(() => {
    const nextPreset = document.xyzrenderPreset || "default";
    const nextControls = xyzrenderDockControls(document);
    lastAppliedSignature.current = xyzrenderDockSignature(nextControls, nextPreset);
    setPreset(nextPreset);
    setControls(nextControls);
  }, [document.id, document.xyzrenderControls, document.xyzrenderPreset]);

  const updateControl = <K extends keyof XyzrenderControls>(key: K, value: XyzrenderControls[K]) => {
    setControls((current) => ({ ...current, [key]: value }));
  };
  const apply = useCallback((nextControls = controls, nextPreset = preset) => {
    lastAppliedSignature.current = xyzrenderDockSignature(nextControls, nextPreset);
    void actions.reloadXyzrenderDocument(document, {
      xyzrenderPreset: nextPreset,
      xyzrenderControls: nextControls,
    });
  }, [actions, controls, document, preset]);

  useEffect(() => {
    const signature = xyzrenderDockSignature(controls, preset);
    if (signature === lastAppliedSignature.current) return;
    const timer = window.setTimeout(() => {
      apply(controls, preset);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [apply, controls, preset]);

  const reset = () => {
    const nextControls = { ...DEFAULT_XYZRENDER_DOCK_CONTROLS };
    setControls(nextControls);
    setPreset("default");
    apply(nextControls, "default");
  };

  return (
    <div className="dock-content xyzrender-dock-panel">
      <section className="structure-brief-card xyzrender-dock-card">
        <div className="structure-inspector-section-header">
          <div>
            <h3>xyzrender</h3>
            <p>{document.title}</p>
          </div>
          <span className="xyzrender-dock-badge">SVG</span>
        </div>
        <label className="xyzrender-dock-field">
          <span>Preset</span>
          <select value={preset} onChange={(event) => setPreset(event.currentTarget.value)}>
            {xyzrenderPresetOptions(document).map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <XyzrenderDockCheckbox
          label="Transparent"
          checked={controls.transparentBackground === true}
          onChange={(checked) => updateControl("transparentBackground", checked)}
        />
        <XyzrenderDockTriState label="Gradients" value={controls.gradients} onChange={(value) => updateControl("gradients", value)} />
        <XyzrenderDockTriState label="Fog" value={controls.fog} onChange={(value) => updateControl("fog", value)} />
        <XyzrenderDockCheckbox label="VdW" checked={controls.showVdw === true} onChange={(checked) => updateControl("showVdw", checked)} />
        <XyzrenderDockCheckbox label="Hide bonds" checked={controls.hideBonds === true} onChange={(checked) => updateControl("hideBonds", checked)} />
      </section>
      <section className="structure-brief-card xyzrender-dock-card">
        <div className="structure-inspector-section-header">
          <div>
            <h3>Field overlay</h3>
            <p>Surface mode and opacity</p>
          </div>
        </div>
        <label className="xyzrender-dock-field">
          <span>Mode</span>
          <select
            value={controls.fieldMode ?? "auto"}
            onChange={(event) => updateControl("fieldMode", normalizeXyzrenderFieldMode(event.currentTarget.value))}
          >
            <option value="auto">Auto</option>
            <option value="off">Off</option>
            <option value="density">Density</option>
            <option value="mo">MO</option>
            <option value="esp">ESP</option>
            <option value="nci">NCI</option>
          </select>
        </label>
        <XyzrenderDockNumber label="Iso" value={controls.fieldIso} step="0.1" onChange={(value) => updateControl("fieldIso", value)} />
        <XyzrenderDockNumber label="Opacity" value={controls.fieldOpacity} min={0} max={1} step="0.05" onChange={(value) => updateControl("fieldOpacity", value)} />
      </section>
      <div className="xyzrender-dock-actions">
        <button type="button" className="dock-action" onClick={() => apply()}>Apply</button>
        <button type="button" className="dock-action" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}

function XyzrenderDockCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="xyzrender-dock-check">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
    </label>
  );
}

function XyzrenderDockTriState({ label, value, onChange }: { label: string; value: boolean | null | undefined; onChange: (value: boolean | null) => void }) {
  return (
    <label className="xyzrender-dock-field">
      <span>{label}</span>
      <select value={value === true ? "on" : value === false ? "off" : "default"} onChange={(event) => onChange(xyzrenderTriStateValue(event.currentTarget.value))}>
        <option value="default">Default</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </label>
  );
}

function XyzrenderDockNumber({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  min?: number;
  max?: number;
  step: string;
  onChange: (value: number | null) => void;
}) {
  const current = typeof value === "number" && Number.isFinite(value) ? value : "";
  return (
    <label className="xyzrender-dock-field">
      <span>{label}</span>
      <input
        type="number"
        value={current}
        min={min}
        max={max}
        step={step}
        placeholder="Auto"
        onChange={(event) => onChange(xyzrenderNumberValue(event.currentTarget.value))}
      />
    </label>
  );
}

function xyzrenderDockControls(document: ViewerDocument): XyzrenderControls {
  return {
    ...DEFAULT_XYZRENDER_DOCK_CONTROLS,
    ...document.xyzrenderControls,
  };
}

function xyzrenderDockSignature(controls: XyzrenderControls, preset: string) {
  return JSON.stringify({ preset, controls });
}

function xyzrenderPresetOptions(document: ViewerDocument) {
  const options = document.xyzrenderPresetOptions?.length
    ? document.xyzrenderPresetOptions
    : [{ value: "default", label: "Default" }];
  if (options.some((option) => option.value === (document.xyzrenderPreset || "default"))) return options;
  return [{ value: document.xyzrenderPreset || "default", label: document.xyzrenderPreset || "Default" }, ...options];
}

function xyzrenderTriStateValue(value: string) {
  if (value === "on") return true;
  if (value === "off") return false;
  return null;
}

function xyzrenderNumberValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function normalizeXyzrenderFieldMode(value: string): XyzrenderControls["fieldMode"] {
  if (value === "off" || value === "density" || value === "mo" || value === "esp" || value === "nci") return value;
  return "auto";
}

function KetcherDockTool({
  area,
  state,
  fileTabs,
}: {
  area: DockArea;
  state: ShellViewState;
  fileTabs: ReactNode;
}) {
  if (area === "right") {
    return (
      <div className="dock-files-view">
        {fileTabs}
        <KetcherInspectorPanel state={state} />
      </div>
    );
  }
  return (
    <div className="dock-files-view">
      {fileTabs}
      <div className="ketcher-dock-portal" data-ketcher-dock-portal="bottom">
        <div className="dock-content dock-content-empty">
          <div className="dock-empty dock-empty-large">Open Export or Import from Ketcher</div>
        </div>
      </div>
    </div>
  );
}

function TextDocumentInfoPanel({ document, actions }: { document: TextFileDocument; actions: ShellActions }) {
  return (
    <div className="dock-content structure-brief">
      <section className="structure-brief-card">
        <div className="structure-brief-card-header">
          <div>
            <small>TEXT FILE</small>
            <h3>{document.title}</h3>
          </div>
          <span className="structure-brief-pill">{document.extension ? document.extension.toUpperCase() : "TEXT"}</span>
        </div>
        <div className="structure-brief-rows">
          <StructureBriefTextRow label="Language" value={document.language} />
          <StructureBriefTextRow label="Size" value={formatBytes(document.byteCount)} />
          <StructureBriefTextRow label="Path" value={document.path} />
          {document.truncated && <StructureBriefTextRow label="Preview" value="Truncated" />}
        </div>
        <div className="structure-brief-actions">
          <button type="button" className="dock-action" onClick={() => void actions.showTextFileMetadata(document)}>
            Show metadata
          </button>
          <button type="button" className="dock-action" onClick={() => void actions.revealPath(document.path, "file")}>
            Reveal file
          </button>
          <button type="button" className="dock-action" onClick={() => void actions.copyPath(document.path, "file")}>
            Copy path
          </button>
        </div>
      </section>
    </div>
  );
}

function KetcherInspectorPanel({ state }: { state: ShellViewState }) {
  const sketchInfo = ketcherSketchInfo(state.ketcherDraftMolfile);
  return (
    <div className="dock-content ketcher-inspector-panel">
      <Metric label="Tool" value="Ketcher" />
      <Metric label="Sketch" value={sketchInfo.hasSketch ? "Modified" : "Empty"} />
      <Metric label="Atoms" value={sketchInfo.atomCount} />
      <Metric label="Bonds" value={sketchInfo.bondCount} />
      <Metric label="Document" value={state.activeTab?.location.kind === "ketcher" ? "Ketcher sketch" : "No active Ketcher tab"} />
    </div>
  );
}

function StructureBriefTextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="structure-brief-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ketcherSketchInfo(molfile: string) {
  const counts = molfile.split(/\r?\n/u)
    .map((line) => ketcherMolfileCounts(line))
    .find((candidate) => candidate !== null);
  if (!counts) return { hasSketch: false, atomCount: "0", bondCount: "0" };
  const { atomCount, bondCount } = counts;
  const hasSketch = atomCount > 0 || bondCount > 0;
  return {
    hasSketch,
    atomCount: String(atomCount),
    bondCount: String(bondCount),
  };
}

function ketcherMolfileCounts(line: string) {
  const v3000Counts = line.match(/^M\s+V30\s+COUNTS\s+(\d+)\s+(\d+)/u);
  if (v3000Counts) {
    return {
      atomCount: Number(v3000Counts[1]),
      bondCount: Number(v3000Counts[2]),
    };
  }
  if (!/\bV2000\b/u.test(line)) return null;
  const [fallbackAtomCount, fallbackBondCount] = line.trim().split(/\s+/u);
  const atomCount = Number(line.slice(0, 3).trim() || fallbackAtomCount);
  const bondCount = Number(line.slice(3, 6).trim() || fallbackBondCount);
  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount)) return null;
  return { atomCount, bondCount };
}

function ActiveDocumentTextPanel({
  activeDocument,
  activeTextDocument,
  textDocuments,
  openPaths,
  onStructureSelection,
}: {
  activeDocument: ViewerDocument | null;
  activeTextDocument: TextFileDocument | null;
  textDocuments: TextFileDocument[];
  openPaths: ShellActions["openPaths"];
  onStructureSelection: ShellActions["selectTextStructure"];
}) {
  const textPreviewLimit = isMaestroStructure(activeDocument) ? 1_500_000 : 3_000_000;
  const existingDocument = activeTextDocument ?? (activeDocument
    ? textDocuments.find((document) => document.path === activeDocument.path) ?? null
    : null);
  const [loadedDocument, setLoadedDocument] = useState<TextFileDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadedDocument(null);
    setError(null);
    if (!activeDocument || activeTextDocument || existingDocument) return undefined;
    let cancelled = false;
    const virtualText = readBrowserDevVirtualTextDocument(activeDocument.path);
    const documentPromise = virtualText === null
      ? readStructureTextDocument(activeDocument.path, {
        id: activeDocument.id,
        path: activeDocument.path,
        title: activeDocument.title,
        extension: activeDocument.extension,
        byteCount: activeDocument.byteCount,
      }, { maxBytes: textPreviewLimit })
      : Promise.resolve(textDocumentFromVirtualText(activeDocument, virtualText));
    void documentPromise
      .then((document) => {
        if (cancelled) return;
        setLoadedDocument(document);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [activeDocument, activeTextDocument, existingDocument, textPreviewLimit]);

  if (!activeDocument && !activeTextDocument) {
    return (
      <div className="dock-content dock-content-empty">
        <div className="dock-empty dock-empty-large">Open a structure or text file to inspect its text</div>
      </div>
    );
  }

  const document = existingDocument ?? loadedDocument;
  if (document) {
    return (
      <div className="dock-viewer">
        <TextFileViewer document={document} openPaths={openPaths} onStructureSelection={onStructureSelection} />
      </div>
    );
  }

  return (
    <div className="dock-content dock-content-empty">
      <div className="dock-empty dock-empty-large">
        {error ? `Text preview failed: ${error}` : "Loading text..."}
      </div>
    </div>
  );
}

function textDocumentFromVirtualText(document: ViewerDocument, content: string): TextFileDocument {
  return {
    id: document.id,
    path: document.path,
    title: document.title,
    extension: document.extension,
    language: document.extension,
    byteCount: content.length,
    content,
    truncated: false,
    modifiedAt: null,
  };
}

function isMaestroStructure(document: ViewerDocument | null) {
  return document ? ["mae", "maegz", "cms"].includes(document.extension.toLowerCase()) : false;
}

function activeTextDocumentFromState(state: ShellViewState) {
  const location = state.activeTab?.location;
  if (location?.kind !== "text-file") return null;
  return (
    state.textDocuments.find((document) => document.id === location.documentId) ??
    state.textDocuments.find((document) => document.path === location.path) ??
    null
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
