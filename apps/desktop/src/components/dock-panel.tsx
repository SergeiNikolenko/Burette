import { OrbitalsDockContent } from "./workbench/orbitals-dock-content";
import { useOrbitalsAvailable } from "../lib/workbench/orbitals-tool";
import { useScientificSourceLifetime } from "../lib/workbench/scientific-source-lifetime";
import { VibrationsDockContent } from "./workbench/vibrations-dock-content";
import { useVibrationsAvailable } from "../lib/workbench/vibrations-tool";
import { GeometryPanel, geometryPanelAvailable } from "./geometry-panel";
import { StructureEditPanel } from "./workbench/structure-edit-panel";
import { structureEditAvailable } from "../lib/workbench/graph-draft";
import { dockScreenLocation, openDockScreen } from "./workspace-panes/dock-screen";
import { chemicalSpaceDocument as resolveCollection, chemicalSpaceSourceMatches } from "../lib/chemical-space-documents";
import { Spinner } from "@/components/ui/spinner";
import { useSidebarStructureDrag } from "./sidebar/use-sidebar-structure-drag";
import { isHostedMcpWidget } from "../lib/hosted-mcp-widget";
import { activeViewerIframeForDocument, postToXyzrenderViewer } from "../lib/viewer-bridge";
import type { AnimationSource } from "./xyzrender-animation-dialog";
import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ChevronDown, FileBlank, Warning } from "./ui/app-icons";
import { XyzrenderProperties } from "./xyzrender-properties";
import { StoryMarkdown } from "./story-markdown";
import { DockHeader } from "./dock-header";
import { DockFileViews } from "./dock-file-views";
import { DockFileTabs } from "./dock-file-tabs";
import { requestContextualGuide } from "./onboarding/request";
import { useDropHighlightReset } from "../hooks/use-drop-highlight-reset";
import { Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join, resourceDir } from "@tauri-apps/api/path";
import { DOCK_TAB_LABELS, dockMediaId, dockMediaPath, createDockTab, dockFileEntries, dockTabCatalog, type DockArea, type DockFileEntry, type DockTabKind } from "../lib/dock";
import { hasStructureDrag, readStructureDragPayload, writeStructureDragPayload } from "../lib/structure-drag";
import type { StructureDragPayload } from "../lib/structure-drag";
import type { StructureStory } from "../lib/structure-story";
import { isTauriRuntime } from "../lib/tauri";
import type { ShellActions, ShellViewState } from "./types";
import { showNativeContextMenu } from "./native-context-menu";
import { ViewerFrame } from "./editor-area/viewer-frame";
import { TextFileViewer } from "./text-file-viewer";
import { MarkdownRichViewer } from "./text-file-viewer/markdown-rich-viewer";
import { useSourceEditing } from "../lib/source-editing/context";
import { TextDocumentInfoPanel } from "./text-document-info-panel";
import { FileInfoPanel } from "./file-info-panel";
import { basename } from "../lib/sidebar-projects";
import { pathExtension } from "../lib/file-routing";
import { StructureInfoPanel } from "./structure-info-panel";
import { JobsPanel } from "./jobs-panel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelEmptyState } from "./ui/panel-empty-state";
import { FoldingAnalysisPanel, useFoldingResult } from "./folding-results-panel";
import { SpectrumInfoPanel, SpectrumPeakTablePanel, SpectrumViewer } from "./spectrum-viewer";
import { readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import { readStructureTextDocument } from "../lib/structure-text";
import type { TextFileDocument, ViewerDocument, ViewerReloadOptions, XyzrenderControls } from "../types";
import { isMesoscaleViewerDocument } from "../lib/mesoscale-documents";
import { MesoscaleScenePanel } from "./mesoscale/mesoscale-scene-panel";
import { MesoscaleInfoPanel } from "./mesoscale/mesoscale-info-panel";

// Chemical Space reaches three.js through chemical-space-3d, and this panel is
// always mounted, so a static import put that whole stack in the entry chunk.
const ChemicalSpacePanel = lazy(() => import("./chemical-space-panel").then((module) => ({
  default: module.ChemicalSpacePanel,
})));

type DockPanelProps = {
  area: DockArea;
  state: ShellViewState;
  actions: ShellActions;
  readOnly?: boolean;
};

function resolveChemicalSpaceDocument(
  state: ShellViewState,
  dockDocument: ViewerDocument | null,
) {
  // A structure may be a selected subset of a grid, or the original SDF.
  // Never substitute the first unrelated collection in the workspace.
  return resolveCollection(dockDocument ?? state.activeDocument ?? state.quickLookDocument, state.documents);
}

export function DockPanel({ area, state, actions, readOnly = false }: DockPanelProps) {
  useScientificSourceLifetime(area, state.documents);
  const panelId = useId();
  const panel = useRef<HTMLElement>(null);
  const [dropActive, setDropActive] = useState(false);
  useDropHighlightReset(setDropActive);

  const configuredTabs = area === "right" ? state.rightDockTabs : state.bottomDockTabs;
  const rawTabs = readOnly && area === "right"
    ? [configuredTabs.find((tab) => tab.kind === "inspector") ?? createDockTab("inspector")]
    : configuredTabs;
  const open = area === "right" ? state.rightDockOpen : state.bottomDockOpen;
  useLayoutEffect(() => {
    if (open || !panel.current?.contains(document.activeElement)) return;
    panel.current.closest(".app-shell")?.querySelector<HTMLButtonElement>(`button[aria-label="Show ${area} dock"]`)?.focus();
  }, [open, area]);
  const dockDocumentId = area === "right" ? state.rightDockDocumentId : state.bottomDockDocumentId;
  const dockTool = area === "right" ? state.rightDockTool : state.bottomDockTool;
  const dockDocument = dockDocumentId ? state.documents.find((document) => document.id === dockDocumentId) ?? null : null;
  const dockTextDocument = dockDocumentId ? state.textDocuments.find((document) => document.id === dockDocumentId) ?? null : null;
  const activeStructureDocument = dockDocumentId ? dockDocument : state.activeDocument;
  const spectrumDocumentActive = activeStructureDocument?.renderer === "spectrum";
  const spectrumDockAvailable = area === "bottom" && (dockDocument?.renderer === "spectrum" || state.activeDocument?.renderer === "spectrum");
  const chemicalSpaceDockAvailable = Boolean(resolveChemicalSpaceDocument(state, dockDocument));
  const hasOrbitals = useOrbitalsAvailable(activeStructureDocument);
  const orbitalsDockAvailable = area === "right" && hasOrbitals;
  const hasVibrations = useVibrationsAvailable(activeStructureDocument);
  const vibrationsDockAvailable = area === "right" && hasVibrations;
  const geometryDockAvailable = area === "right" && geometryPanelAvailable(activeStructureDocument);
  const structureEditDockAvailable = area === "right" && structureEditAvailable(activeStructureDocument);
  const storedActiveTabKind = area === "right" ? state.rightDockActiveTab : state.bottomDockActiveTab;
  // File screens use the same editable page in every group. Legacy Files entry
  // points become placements instead of creating a second read-only renderer.
  useEffect(() => {
    if (!readOnly && open && storedActiveTabKind === "files" && dockScreenLocation(area, "files", state)) {
      openDockScreen(area, "files", state, actions, area);
    }
  }, [open, storedActiveTabKind, dockDocumentId, dockTool, area, readOnly, state, actions]);
  const foldingState = useFoldingResult(area === "bottom" && open ? activeStructureDocument : null);
  const foldingDockAvailable = area === "bottom" && (foldingState.loading || Boolean(foldingState.bundle));
  const foldingDockRequested = area === "bottom" && storedActiveTabKind === "folding" && rawTabs.some((tab) => tab.kind === "folding");
  const pluginSurface = isHostedMcpWidget() || (typeof window !== "undefined" && Boolean(window.BuretteMcpWorkspace));
  const catalog = dockTabCatalog(area).filter(kind => !pluginSurface || !["jobs", "chemical-space", "folding"].includes(kind));
  const tabs = rawTabs.filter((tab) => {
    if (!catalog.includes(tab.kind)) return false;
    if (tab.kind === "orbitals") return orbitalsDockAvailable;
    if (tab.kind === "vibrations") return vibrationsDockAvailable;
    if (tab.kind === "geometry") return geometryDockAvailable;
    if (tab.kind === "structure-edit") return structureEditDockAvailable;
    if (tab.kind === "spectrum") return spectrumDockAvailable;
    if (tab.kind === "folding") return foldingDockAvailable || foldingDockRequested;
    if (tab.kind === "chemical-space") return chemicalSpaceDockAvailable;
    return true;
  });
  // A restored desktop layout can contain only panels unavailable in a plugin.
  if (pluginSurface && tabs.length === 0) tabs.push(createDockTab(area === "right" ? "inspector" : "files"));
  const activeTabKind = tabs.some((tab) => tab.kind === storedActiveTabKind) ? storedActiveTabKind : tabs[0]?.kind ?? "files";
  const xyzrenderDockDocument = area === "right" && activeStructureDocument?.renderer === "xyzrender-external"
    ? activeStructureDocument
    : null;
  const mesoscaleDockDocument = area === "right" && isMesoscaleViewerDocument(activeStructureDocument)
    ? activeStructureDocument
    : null;
  const mesoscaleTabs = mesoscaleDockDocument && !tabs.some((tab) => tab.kind === "scene")
    ? [createDockTab("scene"), ...tabs]
    : tabs;
  const runtimeTabs = xyzrenderDockDocument && !mesoscaleTabs.some((tab) => tab.kind === "xyzrender")
    ? [createDockTab("xyzrender"), ...mesoscaleTabs]
    : mesoscaleTabs;
  const visibleTabs = runtimeTabs.filter((tab) => (
    (tab.kind !== "xyzrender" || Boolean(xyzrenderDockDocument))
    && (tab.kind !== "scene" || Boolean(mesoscaleDockDocument))
  ));
  const activeTab = visibleTabs.find((tab) => tab.kind === activeTabKind) ?? visibleTabs[0] ?? tabs[0];
  // Keep visited panels (including local analysis results) alive on Hide, but
  // don't make them follow/read each new active file while they are closed.
  const lastVisibleState = useRef<{ state: ShellViewState; kind: DockTabKind } | null>(null);
  if (open || dockDocumentId || dockTool) lastVisibleState.current = { state, kind: activeTab.kind };
  const contentSource = lastVisibleState.current?.state ?? null;
  const contentKind = lastVisibleState.current?.kind ?? activeTab.kind;
  const contentState = useMemo(() => contentSource && ({
    ...contentSource,
    [area === "right" ? "rightDockOpen" : "bottomDockOpen"]: open,
  }), [area, contentSource, open]);
  const fileSelection = dockFileDocuments(state, area);
  const mediaPath = dockMediaPath(dockDocumentId) ?? (!dockDocumentId && !dockTool && state.activeTab?.location.kind === "document" ? state.activeTab.location.path : null);
  const filesTabDragPayload = mediaPath ? { paths: [mediaPath], records: [] } : dockFilesDragPayload(fileSelection.document, fileSelection.textDocument, dockTool);
  const filesTabDrag = useSidebarStructureDrag({ state, actions, disabled: readOnly, getPayload: () => filesTabDragPayload });
  const dockDrops = useMemo(
    () => contentState?.dockDroppedStructures.filter((item) => item.area === area && item.tabKind === contentKind) ?? [],
    [contentKind, area, contentState],
  );
  const filesVisited = useRef(false);
  if (contentKind === "files" && contentState) filesVisited.current = true;
  const autoOpenedXyzrenderDocumentId = useRef<string | null>(null);
  // Point at the Text tab once it exists; the add menu creates it on this action.
  const showDockTab = (kind: DockTabKind, open: () => void) => {
    open();
    if (kind === "text" && activeStructureDocument) {
      window.requestAnimationFrame(() => requestContextualGuide("source-dock", document.getElementById(`${panelId}-text`)));
    }
  };

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
        if (kind === "orbitals") return orbitalsDockAvailable;
        if (kind === "vibrations") return vibrationsDockAvailable;
        if (kind === "geometry") return geometryDockAvailable;
        if (kind === "structure-edit") return structureEditDockAvailable;
        if (kind === "spectrum") return spectrumDockAvailable;
        if (kind === "folding") return foldingDockAvailable;
        if (kind === "xyzrender") return Boolean(xyzrenderDockDocument);
        if (kind === "scene") return Boolean(mesoscaleDockDocument);
        if (kind === "chemical-space") return chemicalSpaceDockAvailable;
        if (kind === "story") return Boolean(state.structureStory);
        return true;
      }).map((kind) => ({
        kind: "item" as const,
        id: `dock-${area}-${kind}`,
        text: DOCK_TAB_LABELS[kind],
        disabled: tabs.some((tab) => tab.kind === kind),
        action: () => showDockTab(kind, () => actions.openDockTab(area, kind)),
      })),
      { x: rect.left, y: rect.bottom + 6 },
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
      ref={panel}
      className="dock-panel"
      data-area={area}
      data-document-id={activeStructureDocument?.id}
      data-workspace-id={contentState?.activeTab?.id}
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
        <DockHeader area={area} tabs={visibleTabs} activeKind={activeTab.kind} panelId={panelId} readOnly={readOnly}
          transientTabId={rawTabs.some(tab => tab.kind === "xyzrender") ? undefined : visibleTabs.find(tab => tab.kind === "xyzrender")?.id}
          fileDragProps={{ ...filesTabDrag, draggable: Boolean(filesTabDragPayload) }}
          onSelect={kind => showDockTab(kind, () => actions.setDockActiveTab(area, kind))} onClose={id => actions.closeDockTab(area, id)}
          onOpenScreen={dockScreenLocation(area, activeTab.kind, state) ? () => openDockScreen(area, activeTab.kind, state, actions) : undefined}
          onAdd={showAddMenu} onHide={() => actions.setDockOpen(area, false)} />
        <div className="dock-panel-body" role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${activeTab.kind}`} tabIndex={0}>
        {contentState && filesVisited.current && <div key={contentState.activeTab?.id} className="dock-files-view" hidden={contentKind !== "files"}
          inert={contentKind !== "files"} style={contentKind === "files" ? undefined : { display: "none" }}>
          <DockPanelContent area={area} activeTabKind="files" state={contentState} actions={actions} filesVisible={open && contentKind === "files"}
            dockDrops={contentState.dockDroppedStructures.filter(item => item.area === area && item.tabKind === "files")} />
        </div>}
        {contentState && contentKind !== "files" && <DockPanelContent
          key={contentState.activeTab?.id}
          area={area} activeTabKind={contentKind} state={contentState} actions={actions} dockDrops={dockDrops}
        />}
        </div>
      </div>
    </aside>
  );
}

export function DockPanelContent({
  filesVisible = true,
  area,
  activeTabKind,
  state,
  actions,
  dockDrops,
}: {
  filesVisible?: boolean;
  area: DockArea;
  activeTabKind: DockTabKind;
  state: ShellViewState;
  actions: ShellActions;
  dockDrops: ShellViewState["dockDroppedStructures"];
}) {
  const [textViews, setTextViews] = useState<Record<string, boolean>>({});
  const activeDocument = state.activeDocument;
  const activePageKind = state.activeTab?.location.kind ?? null;
  const dockDocumentId = area === "right" ? state.rightDockDocumentId : state.bottomDockDocumentId;
  const dockTool = area === "right" ? state.rightDockTool : state.bottomDockTool;
  const dockDocument = dockDocumentId ? state.documents.find((document) => document.id === dockDocumentId) ?? null : null;
  const dockTextDocument = dockDocumentId ? state.textDocuments.find((document) => document.id === dockDocumentId) ?? null : null;
  const dockStructureDocument = dockDocument ?? activeDocument;
  const hoveredGridRow = state.hoveredGridRows[(dockDocument ?? activeDocument)?.id ?? ""] ?? null;
  const chemicalSpaceDocument = resolveChemicalSpaceDocument(state, dockDocument);
  const activeTextDocument = activeTextDocumentFromState(state);
  const { document: effectiveDockDocument, textDocument: effectiveDockTextDocument } = dockFileDocuments(state, area);
  const mediaPath = dockMediaPath(dockDocumentId) ?? (!dockDocumentId && !dockTool && state.activeTab?.location.kind === "document" ? state.activeTab.location.path : null);
  const fileEntries = activeTabKind === "files"
    ? dockFileEntries({
        dockDrops,
        documents: state.documents,
        textDocuments: state.textDocuments,
        activeDocumentId: (mediaPath ? dockMediaId(mediaPath) : dockDocumentId) ?? effectiveDockDocument?.id ?? effectiveDockTextDocument?.id ?? null,
        activeTool: dockTool,
      })
    : [];
  const activeFileEntryKey = mediaPath ? dockMediaId(mediaPath) : activeDockFileEntryKey(effectiveDockDocument, effectiveDockTextDocument, dockTool);
  if (activeTabKind === "scene") {
    return isMesoscaleViewerDocument(dockStructureDocument)
      ? <MesoscaleScenePanel document={dockStructureDocument} />
      : <DockEmptyState title="No model selected" />;
  }
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
      <DockEmptyState
        title="No spectrum selected"
        action={{ label: "Open file", run: () => void actions.chooseFiles() }}
      />
    );
  }
  if (activeTabKind === "files") {
    // Following the main tab must not instantiate a second renderer in a hidden
    // dock. Explicitly selected dock files retain their existing keep-alive.
    const open = area === "right" ? state.rightDockOpen : state.bottomDockOpen;
    if (!open && !dockDocumentId && !dockTool) return null;
    const fileTabs = (
      <DockFileTabs
        state={state}
        area={area}
        entries={fileEntries}
        activeKey={activeFileEntryKey}
        textViews={textViews}
        onTextView={(key, text) => setTextViews((previous) => ({ ...previous, [key]: text }))}
        actions={actions}
      />
    );
    if (dockTool === "ketcher") return <KetcherDockTool area={area} state={state} fileTabs={fileTabs} actions={actions} />;
    return <div className="dock-files-view">
      {fileTabs}
      <DockFileViews visible={filesVisible} entries={fileEntries} activeKey={activeFileEntryKey} textViews={textViews} state={state} actions={actions}
        renderText={entry => <SingleDocumentTextPanel
          activeDocument={entry.kind === "document" ? state.documents.find(doc => doc.id === entry.documentId) ?? null : null}
          activeTextDocument={entry.kind === "text-document" ? state.textDocuments.find(doc => doc.id === entry.documentId) ?? null : null}
          textDocuments={state.textDocuments} openPaths={actions.openPaths} onStructureSelection={actions.selectTextStructure} />} />
      {!activeFileEntryKey && <DockEmptyState title="No file selected" />}
    </div>;
  }

  if (activeTabKind === "text") {
    if (area === "right" && activePageKind === "ketcher") {
      return (
        <DockEmptyState
          title="Sketch text lives in Export"
          description="While Ketcher is open, its molfile is available from the Export panel in the bottom dock."
        />
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
      <DockEmptyState
        title="No surface selected"
        action={{ label: "Open file", run: () => void actions.chooseFiles() }}
      />
    );
  }
  if (activeTabKind === "story") {
    return state.structureStory
      ? <StructureStoryPanel story={state.structureStory} document={state.activeDocument} actions={actions} />
      : (
          <DockEmptyState
            title="No story selected"
            action={{ label: "Open structures", run: () => void actions.chooseFiles() }}
          />
        );
  }
  if (activeTabKind === "inspector") {
    if (area === "right" && activePageKind === "ketcher") return <KetcherInspectorPanel state={state} />;
    if (effectiveDockTextDocument) return <TextDocumentInfoPanel document={effectiveDockTextDocument} actions={actions} />;
    // Document pages have a path, not a molecular/text record. Do not fabricate
    // metadata or override an explicitly pinned inspector source.
    if (!dockDocumentId && !dockTool && state.activeTab?.location.kind === "document") {
      const path = state.activeTab.location.path;
      return <FileInfoPanel file={{ path, title: basename(path), extension: pathExtension(path) }} actions={actions} />;
    }
    if (dockStructureDocument?.renderer === "spectrum") return <SpectrumInfoPanel document={dockStructureDocument} />;
    if (isMesoscaleViewerDocument(dockStructureDocument)) return <MesoscaleInfoPanel document={dockStructureDocument} />;
    return (
      <StructureInfoPanel
        document={dockStructureDocument}
        hoveredGridRow={hoveredGridRow}
        gridFilterModel={state.gridFilterModel}
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
  if (activeTabKind === "orbitals") return <OrbitalsDockContent document={dockStructureDocument} actions={actions} />;
  if (activeTabKind === "vibrations") return <VibrationsDockContent document={dockStructureDocument} actions={actions} />;
  if (activeTabKind === "geometry") {
    return geometryPanelAvailable(dockStructureDocument)
      ? <GeometryPanel key={dockStructureDocument.id} document={dockStructureDocument} actions={actions} />
      : <DockEmptyState title="No molecule selected" />;
  }
  if (activeTabKind === "structure-edit") {
    return structureEditAvailable(dockStructureDocument)
      ? <StructureEditPanel key={dockStructureDocument.id} document={dockStructureDocument} actions={actions} />
      : <DockEmptyState title="No molecule selected" />;
  }
  if (activeTabKind === "chemical-space") {
    return (
      <Suspense fallback={null}>
        <ChemicalSpacePanel
          document={chemicalSpaceDocument}
          viewerDocument={[state.activeDocument, ...state.visibleDocuments].find(document =>
            document?.renderer === "molstar" && chemicalSpaceDocument
            && chemicalSpaceSourceMatches(document, chemicalSpaceDocument)) ?? null}
          visible={area === "right" ? state.rightDockOpen : state.bottomDockOpen}
          inspectorOpen={state.rightDockOpen && state.rightDockActiveTab === "inspector"}
        />
      </Suspense>
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
    return (
      <div className="dock-content">
        <JobsPanel state={state} actions={actions} />
        {dockDrops.length ? <DockDropList items={dockDrops} actions={actions} emptyLabel="" /> : null}
      </div>
    );
  }
  // Logs and Diagnostics were two tabs of two lines and one button each, and
  // Diagnostics could not even be opened from the interface. They are one.
  if (activeTabKind === "logs" || activeTabKind === "diagnostics") {
    return (
      <div className="dock-content">
        <Metric label="Last status" value={state.status?.message ?? "No status yet"} />
        <Metric label="Runtime" value={state.buildInfo.isAgentShell ? "Agent shell" : state.buildInfo.isBrowserDev ? "Browser dev" : "Desktop"} />
        <Metric label="Build" value={state.buildInfo.version} />
        <Metric label="Flavor" value={state.buildInfo.flavor ?? "Release"} />
        <div className="dock-action-row">
          <Button type="button" variant="secondary" size="sm" onClick={() => void actions.openLogs()}>
            Open logs folder
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void actions.exportDiagnostics()}>
            Export diagnostics
          </Button>
        </div>
        <DockDropList items={dockDrops} actions={actions} emptyLabel="No log inputs" />
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

function DockEmptyState(props: Omit<React.ComponentProps<typeof PanelEmptyState>, "icon">) {
  return <div className="dock-content dock-content-empty"><PanelEmptyState {...props} icon={<FileBlank />} /></div>;
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
        console.warn(`[Burette] Could not resolve xyzrender gallery asset ${fileName}`, error);
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
  const activeItem = useRef<AnimationSource | null>(null);
  const [itemLabel, setItemLabel] = useState(document.title);
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
    if (activeItem.current?.documentId === document.id) return;
    const nextPreset = document.xyzrenderPreset || "default";
    const nextControls = xyzrenderDockControls(document);
    presetRef.current = nextPreset;
    controlsRef.current = nextControls;
    lastAppliedSignature.current = xyzrenderDockSignature(nextControls, nextPreset);
    setPreset(nextPreset);
    setControls(nextControls);
  }, [document.id, document.xyzrenderControls, document.xyzrenderPreset]);

  useEffect(() => {
    activeItem.current = null;
    setItemLabel(document.title);
    const receive = (event: Event) => {
      const item = (event as CustomEvent<AnimationSource>).detail;
      if (item.documentId !== document.id) return;
      clearPendingApply();
      activeItem.current = item;
      setItemLabel(item.label);
      const nextControls = xyzrenderDockControls({ ...document, xyzrenderControls: item.controls as XyzrenderControls });
      lastAppliedSignature.current = xyzrenderDockSignature(nextControls, item.preset);
      setControlsState(nextControls);
      setPresetState(item.preset);
    };
    window.addEventListener('burette:xyzrender-active-item', receive);
    window.addEventListener('burette:xyzrender-animation', receive);
    return () => { clearPendingApply(); window.removeEventListener('burette:xyzrender-active-item', receive); window.removeEventListener('burette:xyzrender-animation', receive); };
  }, [document.id, clearPendingApply, setControlsState, setPresetState]);

  const updateControl = <K extends keyof XyzrenderControls>(key: K, value: XyzrenderControls[K]) => {
    setControlsState({ ...controlsRef.current, [key]: value });
  };
  const apply = useCallback((nextControls: XyzrenderControls = controlsRef.current, nextPreset = presetRef.current, options: Partial<ViewerReloadOptions> = {}) => {
    clearPendingApply();
    controlsRef.current = nextControls;
    presetRef.current = nextPreset;
    lastAppliedSignature.current = xyzrenderDockSignature(nextControls, nextPreset);
    window.dispatchEvent(new CustomEvent("burette:xyzrender-style", { detail: { documentId: document.id, itemId: activeItem.current?.itemId, label: document.title, path: document.path, preset: nextPreset, controls: nextControls } }));
    if (activeItem.current?.itemId) {
      postToXyzrenderViewer(document.id, {
        type: 'setXyzrenderControls', documentId: document.id, itemId: activeItem.current.itemId,
        controls: nextControls, preset: nextPreset, selectionAction: options.xyzrenderSelectionAction,
      });
      return;
    }
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
      <section className="xyzrender-dock-card grid min-w-0">
        <Button type="button" variant="secondary" className="xyzrender-editor-launch w-full" onClick={() => { activeViewerIframeForDocument(document.id)?.contentWindow?.postMessage({ source: "burette-host", body: { type: "openXyzrenderEditor", documentId: document.id } }, "*"); }}>Orientation & animation…</Button>
        <div id="xyzrender-editor-controls" />
        <div className="structure-inspector-section-header">
          <h3 className="min-w-0 wrap-anywhere">{itemLabel}</h3>
          <Badge variant="secondary">SVG</Badge>
        </div>
        <XyzrenderPresetGallery
          preset={preset}
          onSelect={(value) => {
            // xyzrender rejects vdW spheres on the 2D skeletal drawing.
            const nextControls = value === "skeletal" && controlsRef.current.showVdw
              ? { ...controlsRef.current, showVdw: false, vdwAtoms: null }
              : controlsRef.current;
            setControlsState(nextControls);
            setPresetState(value);
            apply(nextControls, value);
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
            // xyzrender cannot draw vdW spheres on the flat skeletal style.
            const nextPreset = presetRef.current === "skeletal" ? "default" : presetRef.current;
            setPresetState(nextPreset);
            // Partial needs the viewer's atom selection (or asks for one), so the
            // tile only lights up once the viewer reports the applied atoms.
            if (mode === "partial") {
              apply(currentControls, nextPreset, { xyzrenderSelectionAction: "vdw" });
              return;
            }
            const nextControls = { ...currentControls, showVdw: true, vdwAtoms: null };
            setControlsState(nextControls);
            apply(nextControls, nextPreset);
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
      <Collapsible className="xyzrender-advanced-settings">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between">
            Advanced settings<ChevronDown data-icon="inline-end" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <XyzrenderProperties controls={controls} onChange={setControlsState} />
        </CollapsibleContent>
      </Collapsible>
      <div className="xyzrender-dock-actions">
        <Button type="button" variant="secondary" size="sm" onClick={() => apply()}>Apply</Button>
        <Button type="button" variant="secondary" size="sm" onClick={reset}>Reset</Button>
      </div>
    </div>
  );
}

function XyzrenderPresetGallery({ preset, onSelect }: { preset: string; onSelect: (preset: string) => void }) {
  return (
    <div className="xyzrender-dock-preset-gallery" role="group" aria-label="Rendering style">
      {XYZRENDER_README_PRESET_GALLERY.map((option) => (
        <XyzrenderGalleryTile
          key={option.value}
          label={option.label}
          image={option.image}
          pressed={preset === option.value}
          onSelect={() => onSelect(option.value)}
        />
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
    <div className="xyzrender-dock-display-options" role="group" aria-label="Display options">
      <div className="xyzrender-dock-subtitle">Display options</div>
      <div className="xyzrender-dock-display-grid">
        {XYZRENDER_README_DISPLAY_OPTIONS.map((option) => {
          const active = option.group === "hydrogens"
            ? (controls.displayHydrogens ?? "auto") === option.value
            : (controls.bondNotation ?? "aromatic") === option.value;
          return (
            <XyzrenderGalleryTile
              key={`${option.group}-${option.value}`}
              label={option.label}
              image={option.image}
              pressed={active}
              onSelect={() => onSelect(option.group === "hydrogens"
                ? { ...controls, displayHydrogens: option.value as XyzrenderControls["displayHydrogens"] }
                : { ...controls, bondNotation: option.value as XyzrenderControls["bondNotation"] })}
            />
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
    <div className="xyzrender-dock-vdw-options" role="group" aria-label="Van der Waals spheres">
      <div className="xyzrender-dock-subtitle">vdW spheres</div>
      <div className="xyzrender-dock-vdw-grid">
        {XYZRENDER_README_VDW_OPTIONS.map((option) => (
          <XyzrenderGalleryTile
            key={option.value}
            label={option.label}
            image={option.image}
            pressed={active === option.value}
            onSelect={() => onSelect(option.value)}
          />
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
    <div className="xyzrender-dock-hull-options" role="group" aria-label="Convex hull">
      <div className="xyzrender-dock-subtitle">Convex hull</div>
      <div className="xyzrender-dock-hull-grid">
        {XYZRENDER_README_HULL_OPTIONS.map((option) => (
          <XyzrenderGalleryTile
            key={option.value}
            label={option.label}
            image={option.image}
            pressed={controls.hullMode === option.value}
            onSelect={() => onSelect(option.value)}
          />
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
    <div className="xyzrender-dock-pore-options" role="group" aria-label="Hull faces and pore detection">
      <div className="xyzrender-dock-subtitle">Hull faces &amp; pore detection</div>
      <div className="xyzrender-dock-pore-grid">
        {XYZRENDER_README_PORE_OPTIONS.map((option) => (
          <XyzrenderGalleryTile
            key={option.value}
            label={option.label}
            image={option.image}
            pressed={controls.hullMode === option.value}
            onSelect={() => onSelect(option.value)}
          />
        ))}
      </div>
    </div>
  );
}

function XyzrenderGalleryTile({ label, image, pressed, onSelect }: { label: string; image: string; pressed: boolean; onSelect: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="xyzrender-dock-preset-tile" aria-pressed={pressed} onClick={onSelect}>
      <XyzrenderGalleryTileImage src={image} />
      <span className="xyzrender-dock-preset-label">{label}</span>
    </Button>
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

  return <img src={resolvedSrc} alt="" width={96} height={58} loading="lazy" draggable={false} onError={handleError} />;
}

function XyzrenderDockCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="xyzrender-dock-check">
      <span>{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function XyzrenderDockTriState({ label, value, onChange }: { label: string; value: boolean | null | undefined; onChange: (value: boolean | null) => void }) {
  return (
    <label className="xyzrender-dock-field">
      <span>{label}</span>
      <Select value={value === true ? "on" : value === false ? "off" : "default"} onValueChange={next => onChange(xyzrenderTriStateValue(next))}>
        <SelectTrigger aria-label={label} className="w-28"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup><SelectItem value="default">Default</SelectItem><SelectItem value="on">On</SelectItem><SelectItem value="off">Off</SelectItem></SelectGroup></SelectContent>
      </Select>
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


function xyzrenderTriStateValue(value: string) {
  if (value === "on") return true;
  if (value === "off") return false;
  return null;
}

function KetcherDockTool({
  actions,
  area,
  state,
  fileTabs,
}: {
  area: DockArea;
  state: ShellViewState;
  fileTabs: ReactNode;
  actions: ShellActions;
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
      <div className="ketcher-dock-portal">
        <div className="dock-content dock-content-empty">
          <Button variant="outline" size="sm" onClick={() => actions.setDockTool("right", "ketcher")}>Import / export</Button>
        </div>
      </div>
    </div>
  );
}

function KetcherInspectorPanel({ state }: { state: ShellViewState }) {
  return (
    <div className="ketcher-dock-portal" data-ketcher-dock-portal="right">
      <div className="dock-content dock-content-empty">
        <div className="dock-empty">{state.activeTab?.location.kind === "ketcher" ? <Spinner className="mx-auto" aria-label="Loading structure text" /> : "Open Ketcher to import or export a structure"}</div>
      </div>
    </div>
  );
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
      <DockEmptyState title="No file selected" />
    );
  }

  const document = existingDocument ?? loadedDocument;
  if (document) {
    const sourceSession = sourceEditing?.sessionForDocument(activeDocument) ?? null;
    const sourceEditingProps = activeDocument && activeDocument.path === document.path && sourceEditing
      ? sourceSession
        ? {
          sessionId: sourceSession.sessionId,
          editable: sourceSession.editable,
          content: sourceSession.content,
          status: sourceSession.status,
          dirty: sourceSession.dirty,
          saving: sourceSession.saving,
          diagnostic: sourceSession.diagnostic,
          saveDisabledReason: sourceSession.saveDisabledReason,
          saveLabel: sourceSession.saveLabel,
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
      {error ? <PanelEmptyState title="Couldn’t load this preview" description={error} icon={<Warning />} /> : (
        <div className="dock-empty dock-empty-large"><Spinner className="mx-auto" aria-label="Loading text" /></div>
      )}
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
        <PanelEmptyState title="No source files attached" icon={<FileBlank />} />
      </div>
    );
  }

  const document = existingDocument ?? loadedDocument;
  return (
    <div className="dock-files-view">
      <Tabs
        className="dock-file-tabs"
        value={activeSource.key}
        onValueChange={setActiveSourceKey}
      >
        <TabsList variant="line" aria-label="Docking source text files">
          {sources.map((source) => (
            <TabsTrigger key={source.key} value={source.key} className="dock-file-tab" title={source.path}>
              <span>{source.title}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {document ? (
        <div className="dock-viewer">
          <TextFileViewer document={document} openPaths={openPaths} onStructureSelection={onStructureSelection} />
        </div>
      ) : (
        <div className="dock-content dock-content-empty">
          {errors[activeSource.key] ? (
            <PanelEmptyState title={`Couldn’t load ${activeSource.title}`} description={errors[activeSource.key]} icon={<Warning />} />
          ) : (
            <div className="dock-empty dock-empty-large"><Spinner className="mx-auto" aria-label={`Loading ${activeSource.title}`} /></div>
          )}
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

// The tab label, preview and drag payload must resolve the same selection.
// A stale explicit pin stays empty rather than silently switching documents.
function dockFileDocuments(state: ShellViewState, area: DockArea) {
  const documentId = area === "right" ? state.rightDockDocumentId : state.bottomDockDocumentId;
  const tool = area === "right" ? state.rightDockTool : state.bottomDockTool;
  return {
    document: documentId ? state.documents.find(document => document.id === documentId) ?? null : tool ? null : state.activeDocument,
    textDocument: documentId ? state.textDocuments.find(document => document.id === documentId) ?? null : tool ? null : activeTextDocumentFromState(state),
  };
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

function StructureStoryPanel({ story, document, actions }: { story: StructureStory; document: ViewerDocument | null; actions: ShellActions }) {
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
        {story.descriptionFormat === "markdown" ? (
          <StoryMarkdown text={story.summary} />
        ) : (
          <p className="structure-story-summary">{story.summary}</p>
        )}
        {story.source === "mvs" && document ? (
          <div className="structure-story-controls" aria-label="MolViewSpec Story controls">
            <Button size="sm" variant="outline" onClick={() => actions.runStructureViewerAction(document, { type: "story_control", operation: "previous", label: "Previous Story step", notify: false })}>Previous</Button>
            <Button size="sm" variant="secondary" onClick={() => actions.runStructureViewerAction(document, { type: "story_control", operation: story.isPlaying ? "pause" : "play", label: story.isPlaying ? "Pause Story" : "Play Story", notify: false })}>{story.isPlaying ? "Pause" : "Play"}</Button>
            <Button size="sm" variant="outline" onClick={() => actions.runStructureViewerAction(document, { type: "story_control", operation: "next", label: "Next Story step", notify: false })}>Next</Button>
          </div>
        ) : null}
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
