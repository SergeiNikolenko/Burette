import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Atom01Icon,
  File02Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join, resourceDir } from "@tauri-apps/api/path";
import { DOCK_TAB_LABELS, createDockTab, dockFileEntries, dockTabCatalog, type DockArea, type DockFileEntry, type DockTabKind } from "../lib/dock";
import { hasStructureDrag, readStructureDragPayload, writeStructureDragPayload } from "../lib/structure-drag";
import type { StructureDragPayload } from "../lib/structure-drag";
import type { StructureStory } from "../lib/structure-story";
import { isTauriRuntime } from "../lib/tauri";
import type { ShellActions, ShellViewState } from "./types";
import { showNativeContextMenu } from "./native-context-menu";
import { ViewerFrame } from "./editor-area/viewer-frame";
import { TextFileViewer } from "./text-file-viewer";
import { useSourceEditing } from "../lib/source-editing/context";
import { CloseIcon } from "./close-icon";
import { formatBytes } from "./format";
import { StructureInfoPanel } from "./structure-info-panel";
import { FoldingAnalysisPanel, useFoldingResult } from "./folding-results-panel";
import { SpectrumInfoPanel, SpectrumPeakTablePanel, SpectrumViewer } from "./spectrum-viewer";
import { readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import { readStructureTextDocument } from "../lib/structure-text";
import type { ConformerJob, TextFileDocument, ViewerDocument, ViewerReloadOptions, XtbJob, XyzrenderControls } from "../types";

type DockPanelProps = {
  area: DockArea;
  state: ShellViewState;
  actions: ShellActions;
  readOnly?: boolean;
};

const dockTabIcons: Record<DockTabKind, typeof File02Icon> = {
  xyzrender: Atom01Icon,
  files: Folder01Icon,
  spectrum: Atom01Icon,
  text: File02Icon,
  story: File02Icon,
  inspector: Search01Icon,
  folding: Atom01Icon,
  "structure-basket": Atom01Icon,
  compare: Atom01Icon,
  jobs: File02Icon,
  logs: File02Icon,
  diagnostics: Search01Icon,
  review: Search01Icon,
};

export function DockPanel({ area, state, actions, readOnly = false }: DockPanelProps) {
  const [dropActive, setDropActive] = useState(false);
  const configuredTabs = area === "right" ? state.rightDockTabs : state.bottomDockTabs;
  const rawTabs = readOnly && area === "right"
    ? [configuredTabs.find((tab) => tab.kind === "inspector") ?? createDockTab("inspector")]
    : configuredTabs;
  const open = area === "right" ? state.rightDockOpen : state.bottomDockOpen;
  const dockDocumentId = area === "right" ? state.rightDockDocumentId : state.bottomDockDocumentId;
  const dockTool = area === "right" ? state.rightDockTool : state.bottomDockTool;
  const dockDocument = dockDocumentId ? state.documents.find((document) => document.id === dockDocumentId) ?? null : null;
  const dockTextDocument = dockDocumentId ? state.textDocuments.find((document) => document.id === dockDocumentId) ?? null : null;
  const activeStructureDocument = dockDocument ?? state.activeDocument;
  const spectrumDocumentActive = activeStructureDocument?.renderer === "spectrum";
  const spectrumDockAvailable = area === "bottom" && (dockDocument?.renderer === "spectrum" || state.activeDocument?.renderer === "spectrum");
  const storedActiveTabKind = area === "right" ? state.rightDockActiveTab : state.bottomDockActiveTab;
  const foldingState = useFoldingResult(area === "bottom" ? activeStructureDocument : null);
  const foldingDockAvailable = area === "bottom" && (foldingState.loading || Boolean(foldingState.bundle));
  const foldingDockRequested = area === "bottom" && storedActiveTabKind === "folding" && rawTabs.some((tab) => tab.kind === "folding");
  const catalog = dockTabCatalog(area);
  const tabs = rawTabs.filter((tab) => {
    if (!catalog.includes(tab.kind)) return false;
    if (tab.kind === "spectrum") return spectrumDockAvailable;
    if (tab.kind === "folding") return foldingDockAvailable || foldingDockRequested;
    return true;
  });
  const activeTabKind = tabs.some((tab) => tab.kind === storedActiveTabKind) ? storedActiveTabKind : tabs[0]?.kind ?? "files";
  const xyzrenderDockDocument = area === "right" && activeStructureDocument?.renderer === "xyzrender-external"
    ? activeStructureDocument
    : null;
  const runtimeTabs = xyzrenderDockDocument && !tabs.some((tab) => tab.kind === "xyzrender")
    ? [createDockTab("xyzrender"), ...tabs]
    : tabs;
  const visibleTabs = xyzrenderDockDocument ? runtimeTabs : runtimeTabs.filter((tab) => tab.kind !== "xyzrender");
  const activeTab = visibleTabs.find((tab) => tab.kind === activeTabKind) ?? visibleTabs[0] ?? tabs[0];
  const filesTabDragPayload = dockFilesDragPayload(dockDocument, dockTextDocument, dockTool);
  const dockDrops = useMemo(
    () => state.dockDroppedStructures.filter((item) => item.area === area && item.tabKind === activeTab.kind),
    [activeTab.kind, area, state.dockDroppedStructures],
  );
  const autoOpenedXyzrenderDocumentId = useRef<string | null>(null);

  useEffect(() => {
    if (area !== "right") return;
    if (!xyzrenderDockDocument) {
      autoOpenedXyzrenderDocumentId.current = null;
      return;
    }
    if (!open) return;
    if (autoOpenedXyzrenderDocumentId.current === xyzrenderDockDocument.id) return;
    autoOpenedXyzrenderDocumentId.current = xyzrenderDockDocument.id;
    actions.openDockTab("right", "xyzrender");
  }, [actions, area, open, xyzrenderDockDocument]);

  const showAddMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu(
      catalog.filter((kind) => {
        if (kind === "spectrum") return spectrumDockAvailable;
        if (kind === "folding") return foldingDockAvailable;
        if (kind === "xyzrender") return Boolean(xyzrenderDockDocument);
        if (kind === "story") return Boolean(state.structureStory);
        return true;
      }).map((kind) => ({
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
      data-drop-active={dropActive || undefined}
      aria-hidden={!open || undefined}
      inert={!open}
      onDragEnter={readOnly ? undefined : handleDrag}
      onDragOver={readOnly ? undefined : handleDrag}
      onDragLeave={readOnly ? undefined : (event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        clearDrop();
      }}
      onDrop={readOnly ? undefined : handleDrop}
      aria-label={`${area} dock`}
    >
      <div className="dock-panel-inner">
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
                  {!readOnly && active && !(tab.kind === "xyzrender" && !rawTabs.some((rawTab) => rawTab.kind === "xyzrender")) && (
                    <button
                      type="button"
                      className="dock-tab-close"
                      aria-label={visibleTabs.length > 1 ? `Close ${DOCK_TAB_LABELS[tab.kind]}` : `Close ${area} dock`}
                      onClick={closeTab}
                    >
                      <CloseIcon size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!readOnly ? (
            <>
              <button type="button" className="dock-icon-button" onClick={showAddMenu} aria-label={`Add ${area} dock tab`}>
                +
              </button>
              <button type="button" className="dock-icon-button" onClick={() => actions.setDockOpen(area, false)} aria-label={`Close ${area} dock`}>
                <CloseIcon size={15} />
              </button>
            </>
          ) : null}
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
              : <ViewerFrame document={dockDocument} readOnly />}
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
    const xyzrenderDocument = area === "right" && dockStructureDocument?.renderer === "xyzrender-external"
      ? dockStructureDocument
      : null;
    if (xyzrenderDocument) {
      return <XyzrenderDockPanel document={xyzrenderDocument} actions={actions} />;
    }
    return (
      <div className="dock-content dock-content-empty">
        <div className="dock-empty dock-empty-large">xyzrender controls are available for xyzr previews</div>
      </div>
    );
  }
  if (activeTabKind === "story") {
    return state.structureStory
      ? <StructureStoryPanel story={state.structureStory} />
      : (
          <div className="dock-content dock-content-empty">
            <div className="dock-empty dock-empty-large">Open Story from a structure sequence</div>
          </div>
        );
  }
  if (activeTabKind === "inspector") {
    if (area === "right" && activePageKind === "ketcher") return <KetcherInspectorPanel state={state} />;
    if (dockTextDocument) return <TextDocumentInfoPanel document={dockTextDocument} actions={actions} />;
    if (dockStructureDocument?.renderer === "spectrum") return <SpectrumInfoPanel document={dockStructureDocument} />;
    return (
      <StructureInfoPanel
        document={dockStructureDocument}
        textDocument={activeTextDocument}
        dockDrops={dockDrops}
        conformerStatus={state.conformerStatus}
        conformerSettings={state.conformerSettings}
        viewerLigandSelection={state.viewerLigandSelection}
        structureOverlayMode={state.structureOverlayMode}
        xtbStatus={state.xtbStatus}
        xtbSettings={state.xtbSettings}
        xtbJobs={state.xtbJobs}
        preferences={state.preferences}
        isBrowserDev={state.buildInfo.isBrowserDev}
        actions={actions}
      />
    );
  }
  if (activeTabKind === "folding") {
    return <FoldingAnalysisPanel document={dockStructureDocument} actions={actions} />;
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
    const jobCount = state.conformerJobs.length + state.xtbJobs.length;
    return (
      <div className="dock-content">
        <div className="dock-jobs-toolbar">
          <span>Job history</span>
          <button
            type="button"
            className="dock-action dock-action-compact"
            disabled={jobCount === 0}
            onClick={() => {
              actions.clearConformerJobs();
              actions.clearXtbJobs();
            }}
          >
            Clear
          </button>
        </div>
        <ConformerJobList jobs={state.conformerJobs} actions={actions} />
        <XtbJobList jobs={state.xtbJobs} actions={actions} emptyLabel={state.conformerJobs.length === 0 ? "No jobs yet" : "No xTB jobs yet"} />
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
  vdwAtoms: null,
  hullMode: "off",
  hullAtoms: null,
  hideBonds: false,
  displayHydrogens: "auto",
  bondNotation: "aromatic",
  fieldMode: "auto",
  fieldIso: 0.8,
  fieldOpacity: 1,
};

const xyzrenderGalleryImage = (name: string) => `${import.meta.env.BASE_URL}xyzrender-gallery/${name}`;
const xyzrenderGalleryResourceCache = new Map<string, Promise<string | null>>();
const XYZRENDER_GALLERY_FILENAME_PATTERN = /^[A-Za-z0-9_.-]+\.svg$/u;

function xyzrenderGalleryFilename(src: string) {
  try {
    const path = new URL(src, window.location.href).pathname;
    return decodeURIComponent(path.split("/").pop() ?? "");
  } catch {
    return src.split("/").pop()?.split("?")[0] ?? "";
  }
}

async function resolveXyzrenderGalleryResource(src: string) {
  if (!isTauriRuntime()) return null;
  const fileName = xyzrenderGalleryFilename(src);
  if (!XYZRENDER_GALLERY_FILENAME_PATTERN.test(fileName)) return null;
  let cached = xyzrenderGalleryResourceCache.get(fileName);
  if (!cached) {
    cached = (async () => {
      try {
        return convertFileSrc(await join(await resourceDir(), "xyzrender-gallery", fileName));
      } catch (error) {
        console.warn(`[Burrete] Could not resolve xyzrender gallery asset ${fileName}`, error);
        return null;
      }
    })();
    xyzrenderGalleryResourceCache.set(fileName, cached);
  }
  return cached;
}

const XYZRENDER_README_PRESET_GALLERY = [
  { value: "default", label: "Default", image: xyzrenderGalleryImage("caffeine_default.svg") },
  { value: "flat", label: "Flat", image: xyzrenderGalleryImage("caffeine_flat.svg") },
  { value: "paton", label: "Paton", image: xyzrenderGalleryImage("caffeine_paton.svg") },
  { value: "pmol", label: "PMol", image: xyzrenderGalleryImage("caffeine_pmol.svg") },
  { value: "skeletal", label: "Skeletal", image: xyzrenderGalleryImage("caffeine_skeletal.svg") },
  { value: "bubble", label: "Bubble", image: xyzrenderGalleryImage("caffeine_bubble.svg") },
  { value: "tube", label: "Tube", image: xyzrenderGalleryImage("caffeine_tube.svg") },
  { value: "btube", label: "BTube", image: xyzrenderGalleryImage("caffeine_btube.svg") },
  { value: "wire", label: "Wire", image: xyzrenderGalleryImage("caffeine_wire.svg") },
  { value: "graph", label: "Graph", image: xyzrenderGalleryImage("caffeine_graph.svg") },
  { value: "mtube", label: "MTube", image: xyzrenderGalleryImage("caffeine_mtube.svg") },
  { value: "vdw", label: "vdW", image: xyzrenderGalleryImage("caffeine_vdw.svg") },
] as const;

const XYZRENDER_README_DISPLAY_OPTIONS = [
  { group: "hydrogens", value: "all", label: "All H", image: xyzrenderGalleryImage("ethanol_all_h.svg") },
  { group: "hydrogens", value: "auto", label: "Some H", image: xyzrenderGalleryImage("ethanol_some_h.svg") },
  { group: "hydrogens", value: "none", label: "No H", image: xyzrenderGalleryImage("ethanol_no_h.svg") },
  { group: "bonds", value: "aromatic", label: "Aromatic", image: xyzrenderGalleryImage("benzene.svg") },
  { group: "bonds", value: "kekule", label: "Kekule", image: xyzrenderGalleryImage("caffeine_kekule.svg") },
] as const;

const XYZRENDER_README_VDW_OPTIONS = [
  { value: "all", label: "All atoms", image: xyzrenderGalleryImage("asparagine_vdw.svg") },
  { value: "partial", label: "Partial", image: xyzrenderGalleryImage("asparagine_vdw_partial.svg") },
  { value: "off", label: "No vdW", image: xyzrenderGalleryImage("caffeine_default.svg") },
] as const;

const XYZRENDER_README_HULL_OPTIONS = [
  { value: "off", label: "Off", image: xyzrenderGalleryImage("caffeine_default.svg") },
  { value: "auto-rings", label: "Rings", image: xyzrenderGalleryImage("anthracene_hull.svg") },
  { value: "faces", label: "Faces", image: xyzrenderGalleryImage("buckyball_faces.svg") },
] as const;

const XYZRENDER_README_PORE_OPTIONS = [
  { value: "pore", label: "Pore", image: xyzrenderGalleryImage("buckyball_pore.svg") },
  { value: "faces-pore", label: "Faces + pore", image: xyzrenderGalleryImage("mof5_faces_pore.svg") },
] as const;

const XYZRENDER_DEFAULT_HULL_OPACITY = 0.45;
const XYZRENDER_DEFAULT_PORE_OPACITY = 0.6;

function XyzrenderDockPanel({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  const controlsRef = useRef<XyzrenderControls>(xyzrenderDockControls(document));
  const presetRef = useRef(document.xyzrenderPreset || "default");
  const [preset, setPreset] = useState(presetRef.current);
  const [controls, setControls] = useState<XyzrenderControls>(() => controlsRef.current);
  const lastAppliedSignature = useRef("");
  const pendingApplyTimerRef = useRef<number | null>(null);

  const clearPendingApply = useCallback(() => {
    if (pendingApplyTimerRef.current === null) return;
    window.clearTimeout(pendingApplyTimerRef.current);
    pendingApplyTimerRef.current = null;
  }, []);

  const setPresetState = useCallback((nextPreset: string) => {
    presetRef.current = nextPreset;
    setPreset(nextPreset);
  }, []);

  const setControlsState = useCallback((nextControls: XyzrenderControls) => {
    controlsRef.current = nextControls;
    setControls(nextControls);
  }, []);

  useEffect(() => {
    const nextPreset = document.xyzrenderPreset || "default";
    const nextControls = xyzrenderDockControls(document);
    presetRef.current = nextPreset;
    controlsRef.current = nextControls;
    lastAppliedSignature.current = xyzrenderDockSignature(nextControls, nextPreset);
    setPreset(nextPreset);
    setControls(nextControls);
  }, [document.id, document.xyzrenderControls, document.xyzrenderPreset]);

  const updateControl = <K extends keyof XyzrenderControls>(key: K, value: XyzrenderControls[K]) => {
    setControlsState({ ...controlsRef.current, [key]: value });
  };
  const apply = useCallback((nextControls: XyzrenderControls = controlsRef.current, nextPreset = presetRef.current, options: Partial<ViewerReloadOptions> = {}) => {
    clearPendingApply();
    controlsRef.current = nextControls;
    presetRef.current = nextPreset;
    lastAppliedSignature.current = xyzrenderDockSignature(nextControls, nextPreset);
    void actions.reloadXyzrenderDocument(document, {
      xyzrenderPreset: nextPreset,
      xyzrenderControls: nextControls,
      ...options,
    });
  }, [actions, clearPendingApply, document]);

  useEffect(() => {
    const signature = xyzrenderDockSignature(controls, preset);
    if (signature === lastAppliedSignature.current) return;
    const timer = window.setTimeout(() => {
      apply(controlsRef.current, presetRef.current);
    }, 240);
    pendingApplyTimerRef.current = timer;
    return () => {
      if (pendingApplyTimerRef.current === timer) pendingApplyTimerRef.current = null;
      window.clearTimeout(timer);
    };
  }, [apply, controls, preset]);

  const reset = () => {
    const nextControls = { ...DEFAULT_XYZRENDER_DOCK_CONTROLS };
    setControlsState(nextControls);
    setPresetState("default");
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
          <select value={preset} onChange={(event) => setPresetState(event.currentTarget.value)}>
            {xyzrenderPresetOptions(document).map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <XyzrenderPresetGallery
          preset={preset}
          onSelect={(value) => {
            setPresetState(value);
            apply(controlsRef.current, value);
          }}
        />
        <XyzrenderDisplayOptionsGallery
          controls={controls}
          onSelect={(nextControls) => {
            setControlsState(nextControls);
            apply(nextControls, presetRef.current);
          }}
        />
        <XyzrenderVdwGallery
          controls={controls}
          onSelect={(mode) => {
            const currentControls = controlsRef.current;
            const selectedMode = currentControls.showVdw === true
              ? currentControls.vdwAtoms ? "partial" : "all"
              : "off";
            if (mode === "off" || mode === selectedMode) {
              const nextControls = { ...currentControls, showVdw: false, vdwAtoms: null };
              setControlsState(nextControls);
              apply(nextControls, presetRef.current);
              return;
            }
            const nextControls = { ...currentControls, showVdw: true, vdwAtoms: null };
            setControlsState(nextControls);
            apply(nextControls, presetRef.current, mode === "partial" ? { xyzrenderSelectionAction: "vdw" } : {});
          }}
        />
        <XyzrenderHullGallery
          controls={controls}
          onSelect={(mode) => {
            const currentControls = controlsRef.current;
            const nextMode: XyzrenderControls["hullMode"] = mode;
            const nextControls = {
              ...currentControls,
              hullMode: nextMode,
              hullAtoms: null,
              hullOpacity: nextMode === "off" ? null : xyzrenderVisibleOpacity(currentControls.hullOpacity, XYZRENDER_DEFAULT_HULL_OPACITY),
              poreOpacity: nextMode === "off" ? null : currentControls.poreOpacity,
            };
            setControlsState(nextControls);
            apply(nextControls, presetRef.current);
          }}
        />
        <XyzrenderPoreGallery
          controls={controls}
          onSelect={(mode) => {
            const currentControls = controlsRef.current;
            const nextMode: XyzrenderControls["hullMode"] = mode;
            const nextControls = {
              ...currentControls,
              hullMode: nextMode,
              hullAtoms: null,
              hullOpacity: xyzrenderVisibleOpacity(currentControls.hullOpacity, XYZRENDER_DEFAULT_HULL_OPACITY),
              poreOpacity: xyzrenderVisibleOpacity(currentControls.poreOpacity, XYZRENDER_DEFAULT_PORE_OPACITY),
            };
            setControlsState(nextControls);
            apply(nextControls, presetRef.current);
          }}
        />
        <XyzrenderDockCheckbox
          label="Transparent"
          checked={controls.transparentBackground === true}
          onChange={(checked) => updateControl("transparentBackground", checked)}
        />
        <XyzrenderDockTriState label="Gradients" value={controls.gradients} onChange={(value) => updateControl("gradients", value)} />
        <XyzrenderDockTriState label="Fog" value={controls.fog} onChange={(value) => updateControl("fog", value)} />
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

function XyzrenderPresetGallery({ preset, onSelect }: { preset: string; onSelect: (preset: string) => void }) {
  return (
    <div className="xyzrender-dock-preset-gallery" aria-label="xyzrender preset gallery">
      {XYZRENDER_README_PRESET_GALLERY.map((option) => (
        <button
          type="button"
          className="xyzrender-dock-preset-tile"
          key={option.value}
          aria-pressed={preset === option.value}
          onClick={() => onSelect(option.value)}
        >
          <span>{option.label}</span>
          <XyzrenderGalleryTileImage src={option.image} />
        </button>
      ))}
    </div>
  );
}

function XyzrenderDisplayOptionsGallery({
  controls,
  onSelect,
}: {
  controls: XyzrenderControls;
  onSelect: (controls: XyzrenderControls) => void;
}) {
  return (
    <div className="xyzrender-dock-display-options" aria-label="xyzrender display options">
      <div className="xyzrender-dock-subtitle">Display options</div>
      <div className="xyzrender-dock-display-grid">
        {XYZRENDER_README_DISPLAY_OPTIONS.map((option) => {
          const active = option.group === "hydrogens"
            ? (controls.displayHydrogens ?? "auto") === option.value
            : (controls.bondNotation ?? "aromatic") === option.value;
          return (
            <button
              type="button"
              className="xyzrender-dock-preset-tile"
              key={`${option.group}-${option.value}`}
              aria-pressed={active}
              onClick={() => onSelect(option.group === "hydrogens"
                ? { ...controls, displayHydrogens: option.value as XyzrenderControls["displayHydrogens"] }
                : { ...controls, bondNotation: option.value as XyzrenderControls["bondNotation"] })}
            >
              <span>{option.label}</span>
              <XyzrenderGalleryTileImage src={option.image} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function XyzrenderVdwGallery({
  controls,
  onSelect,
}: {
  controls: XyzrenderControls;
  onSelect: (mode: (typeof XYZRENDER_README_VDW_OPTIONS)[number]["value"]) => void;
}) {
  const active = controls.showVdw === true
    ? controls.vdwAtoms ? "partial" : "all"
    : "off";
  return (
    <div className="xyzrender-dock-vdw-options" aria-label="xyzrender vdW spheres">
      <div className="xyzrender-dock-subtitle">vdW spheres</div>
      <div className="xyzrender-dock-vdw-grid">
        {XYZRENDER_README_VDW_OPTIONS.map((option) => (
          <button
            type="button"
            className="xyzrender-dock-preset-tile"
            key={option.value}
            aria-pressed={active === option.value}
            onClick={() => onSelect(option.value)}
          >
            <span>{option.label}</span>
            <XyzrenderGalleryTileImage src={option.image} />
          </button>
        ))}
      </div>
    </div>
  );
}

function XyzrenderHullGallery({
  controls,
  onSelect,
}: {
  controls: XyzrenderControls;
  onSelect: (mode: (typeof XYZRENDER_README_HULL_OPTIONS)[number]["value"]) => void;
}) {
  return (
    <div className="xyzrender-dock-hull-options" aria-label="xyzrender convex hull">
      <div className="xyzrender-dock-subtitle">Convex hull</div>
      <div className="xyzrender-dock-hull-grid">
        {XYZRENDER_README_HULL_OPTIONS.map((option) => (
          <button
            type="button"
            className="xyzrender-dock-preset-tile"
            key={option.value}
            aria-pressed={controls.hullMode === option.value}
            onClick={() => onSelect(option.value)}
          >
            <span>{option.label}</span>
            <XyzrenderGalleryTileImage src={option.image} />
          </button>
        ))}
      </div>
    </div>
  );
}

function XyzrenderPoreGallery({
  controls,
  onSelect,
}: {
  controls: XyzrenderControls;
  onSelect: (mode: (typeof XYZRENDER_README_PORE_OPTIONS)[number]["value"]) => void;
}) {
  return (
    <div className="xyzrender-dock-pore-options" aria-label="xyzrender hull faces and pore detection">
      <div className="xyzrender-dock-subtitle">Hull faces &amp; pore detection</div>
      <div className="xyzrender-dock-pore-grid">
        {XYZRENDER_README_PORE_OPTIONS.map((option) => (
          <button
            type="button"
            className="xyzrender-dock-preset-tile"
            key={option.value}
            aria-pressed={controls.hullMode === option.value}
            onClick={() => onSelect(option.value)}
          >
            <span>{option.label}</span>
            <XyzrenderGalleryTileImage src={option.image} />
          </button>
        ))}
      </div>
    </div>
  );
}

function XyzrenderGalleryTileImage({ src }: { src: string }) {
  const [resolvedSrc, setResolvedSrc] = useState(src);

  useEffect(() => {
    setResolvedSrc(src);
  }, [src]);

  const handleError = useCallback(() => {
    if (resolvedSrc !== src) return;
    void resolveXyzrenderGalleryResource(src).then((fallback) => {
      if (fallback) setResolvedSrc(fallback);
    });
  }, [resolvedSrc, src]);

  return <img src={resolvedSrc} alt="" loading="lazy" draggable={false} onError={handleError} />;
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
  const controls = {
    ...DEFAULT_XYZRENDER_DOCK_CONTROLS,
    ...document.xyzrenderControls,
  };
  const hullMode = xyzrenderDockHullMode(controls.hullMode);
  return {
    ...controls,
    hullMode,
    hullOpacity: hullMode === "off" ? null : xyzrenderVisibleOpacity(controls.hullOpacity, XYZRENDER_DEFAULT_HULL_OPACITY),
    poreOpacity: xyzrenderPoreMode(hullMode) ? xyzrenderVisibleOpacity(controls.poreOpacity, XYZRENDER_DEFAULT_PORE_OPACITY) : controls.poreOpacity,
  };
}

function xyzrenderDockSignature(controls: XyzrenderControls, preset: string) {
  return JSON.stringify({ preset, controls });
}

function xyzrenderDockHullMode(mode: XyzrenderControls["hullMode"]): XyzrenderControls["hullMode"] {
  if (mode === "benzene-ring" || mode === "anthracene-rings") return "auto-rings";
  if (mode === "mof5-faces") return "faces";
  if (mode === "mof5-pore") return "pore";
  return mode ?? "off";
}

function xyzrenderPoreMode(mode: XyzrenderControls["hullMode"]) {
  return mode === "pore" || mode === "faces-pore";
}

function xyzrenderVisibleOpacity(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
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

function XtbJobList({
  jobs,
  actions,
  emptyLabel,
}: {
  jobs: XtbJob[];
  actions: ShellActions;
  emptyLabel: string;
}) {
  return (
    <div className="dock-drop-list">
      {jobs.length === 0 ? (
        emptyLabel ? <div className="dock-empty">{emptyLabel}</div> : null
      ) : jobs.map((job) => {
        const primaryOpenPath = job.result?.primaryOpenPath;
        const isRunning = job.status === "running";
        const openJobResult = () => {
          if (!primaryOpenPath) return;
          void actions.openPaths([primaryOpenPath]);
        };
        const showJobMenu = (event: React.MouseEvent<HTMLDivElement>) => {
          const items = [
            isRunning ? {
              kind: "item" as const,
              id: `xtb-job-${job.id}-cancel`,
              text: "Cancel",
              action: () => void actions.cancelXtbJob(job.id),
            } : null,
            job.result?.logPath ? {
              kind: "item" as const,
              id: `xtb-job-${job.id}-log`,
              text: "Log",
              action: () => void actions.openTextPaths([job.result!.logPath]),
            } : null,
            primaryOpenPath ? {
              kind: "item" as const,
              id: `xtb-job-${job.id}-open`,
              text: "Open result",
              action: openJobResult,
            } : null,
          ].filter((item) => item !== null);
          if (items.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          void showNativeContextMenu(items, { x: event.clientX, y: event.clientY }, { forceWeb: true });
        };
        return (
          <div
            className="dock-drop-item dock-xtb-job-item"
            key={job.id}
            data-status={job.status}
            data-has-primary-result={primaryOpenPath ? true : undefined}
            role={primaryOpenPath ? "button" : undefined}
            tabIndex={primaryOpenPath ? 0 : undefined}
            onClick={primaryOpenPath ? openJobResult : undefined}
            onContextMenu={showJobMenu}
            onKeyDown={primaryOpenPath ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              openJobResult();
            } : undefined}
          >
            <div className="dock-drop-item-header">
              <div className="dock-drop-item-title">
                <strong>{job.title}</strong>
                <span className="dock-job-meta">
                  <span className="dock-job-status">{job.status === "running" ? <span className="dock-job-spinner" aria-hidden="true" /> : null}{job.status}</span>
                  {" · "}
                  {job.inputLabel}
                </span>
              </div>
              {isRunning || job.result ? (
                <div className="dock-inline-action-row">
                  {isRunning ? (
                    <button
                      type="button"
                      className="dock-action dock-action-compact"
                      onClick={(event) => {
                        event.stopPropagation();
                        void actions.cancelXtbJob(job.id);
                      }}
                    >
                      Cancel
                    </button>
                  ) : null}
                  {job.result ? (
                    <button
                      type="button"
                      className="dock-action dock-action-compact"
                      onClick={(event) => {
                        event.stopPropagation();
                        void actions.openTextPaths([job.result!.logPath]);
                      }}
                    >
                      Log
                    </button>
                  ) : null}
                  {primaryOpenPath ? (
                    <button
                      type="button"
                      className="dock-action dock-action-compact"
                      onClick={(event) => {
                        event.stopPropagation();
                        openJobResult();
                      }}
                    >
                      Open result
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {!job.result && job.error ? <span>{job.error}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function ConformerJobList({
  jobs,
  actions,
}: {
  jobs: ConformerJob[];
  actions: ShellActions;
}) {
  if (jobs.length === 0) return null;
  return (
    <div className="dock-drop-list">
      {jobs.map((job) => {
        const primaryOpenPath = job.result?.primaryOpenPath;
        const isRunning = job.status === "running";
        const openJobResult = () => {
          if (!primaryOpenPath) return;
          void actions.openPaths([primaryOpenPath]);
        };
        const showJobMenu = (event: React.MouseEvent<HTMLDivElement>) => {
          const items = [
            isRunning ? {
              kind: "item" as const,
              id: `conformer-job-${job.id}-cancel`,
              text: "Cancel",
              action: () => void actions.cancelConformerJob(job.id),
            } : null,
            job.logPath ? {
              kind: "item" as const,
              id: `conformer-job-${job.id}-log`,
              text: "Log",
              action: () => void actions.openTextPaths([job.logPath!]),
            } : null,
            primaryOpenPath ? {
              kind: "item" as const,
              id: `conformer-job-${job.id}-open`,
              text: "Open result",
              action: openJobResult,
            } : null,
          ].filter((item) => item !== null);
          if (items.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          void showNativeContextMenu(items, { x: event.clientX, y: event.clientY }, { forceWeb: true });
        };
        return (
          <div
            className="dock-drop-item dock-xtb-job-item"
            key={job.id}
            data-status={job.status}
            data-has-primary-result={primaryOpenPath ? true : undefined}
            role={primaryOpenPath ? "button" : undefined}
            tabIndex={primaryOpenPath ? 0 : undefined}
            onClick={primaryOpenPath ? openJobResult : undefined}
            onContextMenu={showJobMenu}
            onKeyDown={primaryOpenPath ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              openJobResult();
            } : undefined}
          >
            <div className="dock-drop-item-header">
              <div className="dock-drop-item-title">
                <strong>{job.title}</strong>
                <span className="dock-job-meta">
                  <span className="dock-job-status">{job.status === "running" ? <span className="dock-job-spinner" aria-hidden="true" /> : null}{job.status}</span>
                  {" · "}
                  {job.inputTitle}
                </span>
              </div>
              {isRunning || job.logPath || primaryOpenPath ? (
                <div className="dock-inline-action-row">
                  {isRunning ? (
                    <button
                      type="button"
                      className="dock-action dock-action-compact"
                      onClick={(event) => {
                        event.stopPropagation();
                        void actions.cancelConformerJob(job.id);
                      }}
                    >
                      Cancel
                    </button>
                  ) : null}
                  {job.logPath ? (
                    <button
                      type="button"
                      className="dock-action dock-action-compact"
                      onClick={(event) => {
                        event.stopPropagation();
                        void actions.openTextPaths([job.logPath!]);
                      }}
                    >
                      Log
                    </button>
                  ) : null}
                  {primaryOpenPath ? (
                    <button
                      type="button"
                      className="dock-action dock-action-compact"
                      onClick={(event) => {
                        event.stopPropagation();
                        openJobResult();
                      }}
                    >
                      Open result
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {job.error ? <span>{job.error}</span> : null}
          </div>
        );
      })}
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
  const dockingTextSources = dockingTextSourcesForDocument(activeDocument);
  if (dockingTextSources.length > 0) {
    return (
      <DockingDocumentTextPanel
        activeDocument={activeDocument!}
        sources={dockingTextSources}
        textDocuments={textDocuments}
        openPaths={openPaths}
        onStructureSelection={onStructureSelection}
      />
    );
  }
  return (
    <SingleDocumentTextPanel
      activeDocument={activeDocument}
      activeTextDocument={activeTextDocument}
      textDocuments={textDocuments}
      openPaths={openPaths}
      onStructureSelection={onStructureSelection}
    />
  );
}

function SingleDocumentTextPanel({
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
  const sourceEditing = useSourceEditing();
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
    const sourceSession = sourceEditing?.sessionForDocument(activeDocument) ?? null;
    const sourceEditingProps = activeDocument && activeDocument.path === document.path && sourceEditing
      ? sourceSession
        ? {
          editable: sourceSession.editable,
          content: sourceSession.content,
          status: sourceSession.status,
          dirty: sourceSession.dirty,
          saving: sourceSession.saving,
          diagnostic: sourceSession.diagnostic,
          saveDisabledReason: sourceSession.saveDisabledReason,
          showApplyPreview: sourceSession.previewMode === "manual" && sourceSession.dirty,
          onChange: (content: string) => sourceEditing.updateDraft(activeDocument, content),
          onSave: () => sourceEditing.save(activeDocument),
          onApplyPreview: () => sourceEditing.applyPreview(activeDocument),
        }
        : {
          editable: false,
          content: document.content,
          status: "Read Only",
          dirty: false,
          saving: false,
          diagnostic: null,
          saveDisabledReason: null,
          showApplyPreview: false,
          onBeginEditing: () => sourceEditing.beginEditing(activeDocument),
        }
      : undefined;
    return (
      <div className="dock-viewer">
        <TextFileViewer document={document} openPaths={openPaths} onStructureSelection={onStructureSelection} sourceEditing={sourceEditingProps} />
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

type DockingTextSource = {
  key: string;
  path: string;
  title: string;
  extension: string;
};

function DockingDocumentTextPanel({
  activeDocument,
  sources,
  textDocuments,
  openPaths,
  onStructureSelection,
}: {
  activeDocument: ViewerDocument;
  sources: DockingTextSource[];
  textDocuments: TextFileDocument[];
  openPaths: ShellActions["openPaths"];
  onStructureSelection: ShellActions["selectTextStructure"];
}) {
  const [activeSourceKey, setActiveSourceKey] = useState(sources[0]?.key ?? "");
  const [loadedDocuments, setLoadedDocuments] = useState<Record<string, TextFileDocument>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const activeSource = sources.find((source) => source.key === activeSourceKey) ?? sources[0];
  const existingDocument = activeSource ? textDocuments.find((document) => document.path === activeSource.path) ?? null : null;
  const loadedDocument = activeSource ? loadedDocuments[activeSource.key] ?? null : null;

  useEffect(() => {
    setActiveSourceKey(sources[0]?.key ?? "");
    setLoadedDocuments({});
    setErrors({});
  }, [activeDocument.id]);

  useEffect(() => {
    if (!activeSource || existingDocument || loadedDocument || errors[activeSource.key]) return undefined;
    let cancelled = false;
    void readStructureTextDocument(activeSource.path, {
      id: `${activeDocument.id}:${activeSource.key}`,
      path: activeSource.path,
      title: activeSource.title,
      extension: activeSource.extension,
      byteCount: 0,
    }, { maxBytes: textPreviewLimitForExtension(activeSource.extension) })
      .then((document) => {
        if (cancelled) return;
        setLoadedDocuments((current) => ({ ...current, [activeSource.key]: document }));
      })
      .catch((error) => {
        if (cancelled) return;
        setErrors((current) => ({ ...current, [activeSource.key]: error instanceof Error ? error.message : String(error) }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeDocument.id, activeSource, errors, existingDocument, loadedDocument]);

  if (!activeSource) {
    return (
      <div className="dock-content dock-content-empty">
        <div className="dock-empty dock-empty-large">No source files are attached to this view.</div>
      </div>
    );
  }

  const document = existingDocument ?? loadedDocument;
  return (
    <div className="dock-files-view">
      <div className="dock-file-tabs" role="tablist" aria-label="Docking source text files">
        {sources.map((source) => (
          <button
            type="button"
            key={source.key}
            className="dock-file-tab"
            data-active={source.key === activeSource.key || undefined}
            title={source.path}
            onClick={() => setActiveSourceKey(source.key)}
            role="tab"
            aria-selected={source.key === activeSource.key}
          >
            <span>{source.title}</span>
          </button>
        ))}
      </div>
      {document ? (
        <div className="dock-viewer">
          <TextFileViewer document={document} openPaths={openPaths} onStructureSelection={onStructureSelection} />
        </div>
      ) : (
        <div className="dock-content dock-content-empty">
          <div className="dock-empty dock-empty-large">
            {errors[activeSource.key] ? `Text preview failed for ${activeSource.title}: ${errors[activeSource.key]}` : `Loading ${activeSource.title}...`}
          </div>
        </div>
      )}
    </div>
  );
}

function dockingTextSourcesForDocument(document: ViewerDocument | null): DockingTextSource[] {
  if (!document?.dockingRequest) return [];
  return uniqueDockingTextPaths([
    document.dockingRequest.receptorPath,
    ...document.dockingRequest.ligandPaths,
  ]).map((path, index) => {
    const title = fileName(path);
    const extension = extensionFromPath(path);
    return { key: `${index}:${path}`, path, title, extension };
  });
}

function uniqueDockingTextPaths(paths: string[]) {
  return Array.from(new Set(paths.filter((path) => path.trim().length > 0)));
}

function textPreviewLimitForExtension(extension: string) {
  return ["mae", "maegz", "cms"].includes(extension.toLowerCase()) ? 1_500_000 : 3_000_000;
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

function extensionFromPath(path: string) {
  const name = fileName(path).toLowerCase();
  if (name.endsWith(".mae.gz")) return "maegz";
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1) : "";
}

function fileName(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
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

function StructureStoryPanel({ story }: { story: StructureStory }) {
  return (
    <div className="dock-content structure-story-dock">
      <section className="structure-brief-card structure-story-card">
        <div className="structure-brief-card-header">
          <div>
            <small>Step {story.stepIndex + 1} of {story.stepCount}</small>
            <h3>{story.stage}</h3>
          </div>
        </div>
        <p className="structure-story-file" title={story.fileName}>{story.fileName}</p>
        <p className="structure-story-summary">{story.summary}</p>
      </section>
      {story.comparison ? (
        <>
          <Metric label="Cα RMSD vs previous" value={`${story.comparison.rmsd.toFixed(2)} Å`} />
          <Metric label="Largest shared chain" value={story.comparison.chain} />
          <Metric label="Compared residues" value={String(story.comparison.residueCount)} />
        </>
      ) : (
        <Metric label="Comparison" value={story.stepIndex === 0 ? "Reference state" : "Unavailable"} />
      )}
    </div>
  );
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
