import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { AppLayout } from "./components/app-layout";
import type { AppSettingsSectionId, ViewerLigandSelection } from "./components/types";
import { WindowTitle } from "./components/window-title";
import {
  useCloseCommandPalette,
  useCommandPaletteSearch,
  useIsCommandPaletteOpen,
  useOpenCommandPalette,
  useSetCommandPaletteSearch,
} from "./hooks/use-command-palette";
import { useAppChemistryJobs } from "./hooks/use-app-chemistry-jobs";
import { useAppConformerWorkflows } from "./hooks/use-app-conformer-workflows";
import { useAppDescriptors } from "./hooks/use-app-descriptors";
import { useAppDiagnostics } from "./hooks/use-app-diagnostics";
import { useAppDirtyGridDocuments } from "./hooks/use-app-dirty-grid-documents";
import { useAppDockingPoseMessages } from "./hooks/use-app-docking-pose-messages";
import { useAppDockingWorkflows } from "./hooks/use-app-docking-workflows";
import { useAppDockPayloadOpen } from "./hooks/use-app-dock-payload-open";
import { useAppDropActions } from "./hooks/use-app-drop-actions";
import { useAppFileActions } from "./hooks/use-app-file-actions";
import { useAppFileOpen } from "./hooks/use-app-file-open";
import { useAppFepWorkflows } from "./hooks/use-app-fep-workflows";
import { useAppGenerate3DConformer, type PendingMolstarReplaceResolver } from "./hooks/use-app-generate-3d-conformer";
import { useAppGridControlMessages } from "./hooks/use-app-grid-control-messages";
import { useAppGridConformerMessages } from "./hooks/use-app-grid-conformer-messages";
import { useAppGridFileActions } from "./hooks/use-app-grid-file-actions";
import { useAppGridRuntimeMessages } from "./hooks/use-app-grid-runtime-messages";
import { useAppGridWorkflows } from "./hooks/use-app-grid-workflows";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useAppKetcherActions } from "./hooks/use-app-ketcher-actions";
import { useAppKetcherViewerMessages } from "./hooks/use-app-ketcher-viewer-messages";
import { useAppMaintenance } from "./hooks/use-app-maintenance";
import { useAppMolstarContextMessages } from "./hooks/use-app-molstar-context-messages";
import { useAppMolstarActionSenders } from "./hooks/use-app-molstar-action-senders";
import { useAppMolstarXtbContext } from "./hooks/use-app-molstar-xtb-context";
import { useAppOpenActions } from "./hooks/use-app-open-actions";
import { useAppQuickLook } from "./hooks/use-app-quick-look";
import { useAppResize } from "./hooks/use-app-resize";
import { useAppRendererMessage } from "./hooks/use-app-renderer-message";
import { useAppSidebarProjects } from "./hooks/use-app-sidebar-projects";
import { useAppSdfViewerMessages } from "./hooks/use-app-sdf-viewer-messages";
import { useAppShellActions } from "./hooks/use-app-shell-actions";
import { createAppShellViewState } from "./hooks/use-app-shell-view-state";
import { useAppStartupEffects } from "./hooks/use-app-startup-effects";
import { useAppStatus } from "./hooks/use-app-status";
import { useAppUpdates } from "./hooks/use-app-updates";
import { useAppViewerFileActions } from "./hooks/use-app-viewer-file-actions";
import { useAppViewerBridgeMessages } from "./hooks/use-app-viewer-bridge-messages";
import { useAppViewerConformerMessages } from "./hooks/use-app-viewer-conformer-messages";
import { useAppViewerHostMessages } from "./hooks/use-app-viewer-host-messages";
import { useAppViewerRuntimeFileMessages } from "./hooks/use-app-viewer-runtime-file-messages";
import { useAppViewerRuntimeMessages } from "./hooks/use-app-viewer-runtime-messages";
import { useAppViewerStateMessages } from "./hooks/use-app-viewer-state-messages";
import { useAppWorkspaceActions } from "./hooks/use-app-workspace-actions";
import { useAppXtbWorkflows } from "./hooks/use-app-xtb-workflows";
import { useAppXyzrenderSheetMessages } from "./hooks/use-app-xyzrender-sheet-messages";
import { useAgentSession } from "./hooks/use-agent-session";
import { useAppClipboard } from "./hooks/use-app-clipboard";
import { useMenuEvents } from "./hooks/use-menu-events";
import { useDockLayout } from "./hooks/use-dock-layout";
import { useOpenDrop } from "./hooks/use-open-drop";
import { useOpenEvents } from "./hooks/use-open-events";
import { useSidebar } from "./hooks/use-sidebar";
import {
  useActiveDocument,
  useActiveTab,
  useActiveTabId,
  useActivateLastNonSettingsTab,
  useAddBackgroundDocuments,
  useAddBackgroundTextDocuments,
  useAddTextTabs,
  useAddTabs,
  useClearRecentStructures,
  useCanNavigateBack,
  useCanNavigateForward,
  useCloseActiveTab,
  useCloseAllTabs,
  useCloseDocument,
  useCloseTab,
  useMoveTab,
  useOpenDocuments,
  useOpenDocumentsInActiveTab,
  useOpenFepNetworkTab,
  useOpenFepSetupTab,
  useOpenKetcherTab,
  useOpenNewTab,
  useOpenPoseReviewTab,
  usePruneRecentStructures,
  useOpenSettingsTab,
  useOpenSettingsSection,
  useOpenTextDocuments,
  useOpenTextDocumentsInActiveTab,
  useOpenTabs,
  useRecentStructures,
  useRememberRecentStructures,
  useNavigateBack,
  useNavigateForward,
  useSetActiveDocument,
  useSetActiveTab,
  useSetDocuments,
} from "./hooks/use-tabs";
import { useSetViewerPreference, useViewerPreferences } from "./hooks/use-settings";
import { openBrowserDevDocuments, openBrowserDevMolstarContextDocument, openBrowserDevTextDocument } from "./lib/browser-dev-documents";
import { openBrowserDevTextFiles } from "./lib/browser-dev-text-files";
import { isMoleculeCollectionPath } from "./lib/collection-documents";
import { isProteinLikeDockingSource } from "./lib/docking-documents";
import type { DockArea, DockTabKind } from "./lib/dock";
import { pathExtension, preferredTextExtensions, structureAndTextExtensions, structureExtensionFromPath, structureExtensions } from "./lib/file-routing";
import { browserDevFolderFromLocation, browserDevHasExplicitWorkspace, browserDevQuickLookFileFromLocation } from "./lib/browser-dev-startup";
import { basename } from "./lib/sidebar-projects";
import type { StructureDragPayload } from "./lib/structure-drag";
import { readStructureText } from "./lib/structure-text";
import { isSpectrumPath, isSubformulaSpectrumJsonText, isTabularSpectrumExtension, isTabularSpectrumText, spectrumDocumentFromText } from "./lib/spectrum";
import { isTauriRuntime } from "./lib/tauri";
import { isTemporaryDocumentPath } from "./lib/temporary-documents";
import type { TextFileDocument, ViewerDocument, ViewerReloadOptions } from "./types";

const CommandPalette = lazy(() => import("./components/command-palette").then((module) => ({
  default: module.CommandPalette,
})));

const GRID_PERF_REPORT_PATH = "/private/tmp/burrete-grid-real-app-perf.jsonl";
type MolstarContextDocument = Parameters<typeof openBrowserDevMolstarContextDocument>[0];

async function expandBrowserDevStructureBundles(paths: string[]) {
  if (isTauriRuntime()) return paths;
  const expanded: string[] = [];
  const seen = new Set<string>();
  const addPath = (path: string) => {
    const extension = pathExtension(path);
    if (
      !extension ||
      (!structureExtensions.has(extension) &&
        !isXtbOptimizationTrajectoryLogPath(path) &&
        !isSpectrumPath(path, extension) &&
        !structureAndTextExtensions.has(extension) &&
        !preferredTextExtensions.has(extension))
    ) {
      return;
    }
    if (!seen.has(path)) {
      seen.add(path);
      expanded.push(path);
    }
  };
  for (const path of paths) {
    addPath(path);
    try {
      const response = await fetch(`/__burette/file-bundle?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      if (!response.ok) continue;
      const bundle = await response.json() as {
        kind?: string;
        primaryPath?: string;
        attachments?: Array<{ path?: string }>;
      };
      if (bundle.kind === "single") continue;
      if (bundle.primaryPath) addPath(bundle.primaryPath);
      for (const attachment of bundle.attachments ?? []) {
        if (attachment.path) addPath(attachment.path);
      }
    } catch {
      // Browser-dev companion discovery is opportunistic; opening the requested file still works.
    }
  }
  return expanded;
}

async function detectContentSpectrumPaths(paths: string[]) {
  const matches = new Set<string>();
  await Promise.all(paths.map(async (path) => {
    const extension = pathExtension(path);
    const canDetectByContent = isTabularSpectrumExtension(extension) || extension === "json";
    if (!canDetectByContent) return;
    try {
      const text = await readStructureText(path, { maxBytes: 256 * 1024 });
      if (
        (isTabularSpectrumExtension(extension) && isTabularSpectrumText(text, extension))
        || (extension === "json" && isSubformulaSpectrumJsonText(text))
      ) {
        matches.add(path);
      }
    } catch {}
  }));
  return matches;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function svgToPngBase64(svg: string) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Preview SVG could not be rasterized"));
    });
    image.src = url;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.naturalWidth || image.width);
    canvas.height = Math.max(1, image.naturalHeight || image.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(image, 0, 0);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("PNG export failed"));
      }, "image/png");
    });
    return arrayBufferToBase64(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function App() {
  const browserDevQuickLookPath = browserDevQuickLookFileFromLocation();
  const preferences = useViewerPreferences();
  const setPreference = useSetViewerPreference();
  const tabs = useOpenTabs();
  const documents = useOpenDocuments();
  const textDocuments = useOpenTextDocuments();
  const activeTabId = useActiveTabId();
  const activeTab = useActiveTab();
  const activeDocument = useActiveDocument();
  const addBackgroundDocuments = useAddBackgroundDocuments();
  const addBackgroundTextDocuments = useAddBackgroundTextDocuments();
  const addDocuments = useAddTabs();
  const addTextDocuments = useAddTextTabs();
  const openDocumentsInActiveTab = useOpenDocumentsInActiveTab();
  const openTextDocumentsInActiveTab = useOpenTextDocumentsInActiveTab();
  const setDocuments = useSetDocuments();
  const openNewTab = useOpenNewTab();
  const openKetcherTab = useOpenKetcherTab();
  const openFepNetworkTab = useOpenFepNetworkTab();
  const openFepSetupTab = useOpenFepSetupTab();
  const openPoseReviewTab = useOpenPoseReviewTab();
  const openSettingsTab = useOpenSettingsTab();
  const openSettingsSectionTab = useOpenSettingsSection();
  const activateLastNonSettingsTab = useActivateLastNonSettingsTab();
  const canNavigateBack = useCanNavigateBack();
  const canNavigateForward = useCanNavigateForward();
  const navigateBack = useNavigateBack();
  const navigateForward = useNavigateForward();
  const recentStructures = useRecentStructures();
  const rememberRecentStructures = useRememberRecentStructures();
  const pruneRecentStructures = usePruneRecentStructures();
  const clearRecentStructures = useClearRecentStructures();
  const setActiveTab = useSetActiveTab();
  const setActiveDocument = useSetActiveDocument();
  const closeTab = useCloseTab();
  const closeDocument = useCloseDocument();
  const closeActiveDocument = useCloseActiveTab();
  const closeAllDocuments = useCloseAllTabs();
  const moveTab = useMoveTab();
  const {
    sidebarOpen,
    sidebarWidth,
    projectsOpen,
    projectRoots,
    pinnedProjectRoots,
    projectNameOverrides,
    expandedProjectIds,
    hiddenProjectRoots,
    pinnedStructurePaths,
    sidebarQuery,
    setSidebarWidth,
    toggleProjectsOpen,
    setExpandedProjectIds,
    addProjectRoot,
    togglePinnedProjectRoot,
    renameProjectRoot,
    removeProjectRoot,
    togglePinnedStructure,
    pruneSidebarPaths,
    setSidebarQuery,
    toggleProjectExpanded,
    toggleSidebar,
    closeSidebar,
  } = useSidebar();
  const {
    rightDockOpen,
    rightDockWidth,
    rightDockTabs,
    rightDockActiveTab,
    rightDockDocumentId,
    rightDockTool,
    bottomDockOpen,
    bottomDockHeight,
    bottomDockTabs,
    bottomDockActiveTab,
    bottomDockDocumentId,
    bottomDockTool,
    dockDroppedStructures,
    toggleDock,
    setDockOpen,
    setDockSize,
    openDockTab,
    closeDockTab,
    setDockActiveTab,
    setDockDocument,
    setDockTool,
    addDockDrop,
  } = useDockLayout();
  const {
    bottomDockDragging,
    rightDockDragging,
    sidebarDragging,
    startBottomDockResize,
    startRightDockResize,
    startSidebarResize,
  } = useAppResize({
    bottomDockHeight,
    closeSidebar,
    rightDockWidth,
    setDockOpen,
    setDockSize,
    setSidebarWidth,
    sidebarWidth,
  });
  const toggleDockTab = useCallback((area: DockArea, kind: DockTabKind) => {
    const open = area === "right" ? rightDockOpen : bottomDockOpen;
    const activeKind = area === "right" ? rightDockActiveTab : bottomDockActiveTab;
    if (open && activeKind === kind) {
      setDockOpen(area, false);
      return;
    }
    openDockTab(area, kind);
  }, [bottomDockActiveTab, bottomDockOpen, openDockTab, rightDockActiveTab, rightDockOpen, setDockOpen]);

  const closeGridRuntime = useCallback((documentId: string | null | undefined) => {
    if (!documentId || !isTauriRuntime()) return;
    void invoke("grid_close_runtime", { documentId }).catch(() => {});
  }, []);
  const [structureDragActive, setStructureDragActive] = useState(false);
  const { status, pushStatus, pushErrorStatus, clearStatus, recentErrorsRef } = useAppStatus();
  const {
    clearDirtyGridDocuments,
    confirmDiscardDirtyGridDocument,
    confirmDiscardDirtyGridDocuments,
    forgetDirtyGridDocument,
    forgetDirtyGridDocuments,
    updateDirtyGridDocument,
  } = useAppDirtyGridDocuments();
  const [poseReviewSelections, setPoseReviewSelections] = useState<Record<string, number>>({});
  const [viewerLigandSelections, setViewerLigandSelections] = useState<Record<string, ViewerLigandSelection | null>>({});
  const {
    cancelConformerJob,
    cancelXtbJob,
    cancelledConformerJobIdsRef,
    cancelledXtbJobIdsRef,
    checkConformerStatus,
    checkXtbStatus,
    conformerJobs,
    conformerSettings,
    conformerStatus,
    installXtb,
    setConformerJobs,
    setConformerSettings,
    setConformerStatus,
    setXtbJobs,
    setXtbSettings,
    setXtbStatus,
    xtbJobs,
    xtbSettings,
    xtbStatus,
  } = useAppChemistryJobs({ pushErrorStatus, pushStatus });
  const {
    buildInfo,
    checkForUpdates,
    installUpdate,
    openUpdateRelease,
    setUpdatePreferences,
    update,
  } = useAppUpdates({ pushErrorStatus, pushStatus });
  const {
    clearCache,
    openLogs,
    openNewWindow,
    resetQuickLook,
  } = useAppMaintenance({ pushErrorStatus, pushStatus });
  const { exportDiagnostics } = useAppDiagnostics({
    pushErrorStatus,
    pushStatus,
    recentErrorsRef,
  });
  const {
    applyGridDescriptorControls,
    applyGridDescriptorResults,
    calculateGridDescriptors,
    clearDescriptorSource,
    descriptorSource,
    openDescriptorSource,
  } = useAppDescriptors({
    documents,
    openDockTab,
    pushStatus,
  });
  const pendingViewerReloadOptionsRef = useRef<ViewerReloadOptions | null>(null);
  const pendingViewerReloadDocumentIdRef = useRef<string | null>(null);
  const pendingMolstarReplaceRef = useRef<Map<string, PendingMolstarReplaceResolver>>(new Map());
  const xyzrenderOrientationRefRef = useRef<string | null>(null);
  const skipNextPreferenceRefreshRef = useRef(false);
  const gridPerfMetricsRef = useRef<string[]>([]);
  const commandPaletteOpen = useIsCommandPaletteOpen();
  const commandPaletteQuery = useCommandPaletteSearch();
  const openCommandPalette = useOpenCommandPalette();
  const closeCommandPalette = useCloseCommandPalette();
  const setCommandPaletteQuery = useSetCommandPaletteSearch();

  const openQuickLookDocument = useCallback(async (quickLookPath: string) => {
    const extension = pathExtension(quickLookPath);
    const contentSpectrumPaths = await detectContentSpectrumPaths([quickLookPath]);
    if (isSpectrumPath(quickLookPath, extension) || contentSpectrumPaths.has(quickLookPath)) {
      const result = await openBrowserDevTextFiles([quickLookPath]);
      const textDocument = result.documents[0] ?? null;
      if (!textDocument) return null;
      return spectrumDocumentFromText(textDocument);
    }
    const result = await openBrowserDevDocuments([quickLookPath], preferences);
    return result.documents[0] ?? null;
  }, [preferences]);
  const {
    closeQuickLookPreview,
    quickLookDocument,
    quickLookError,
    quickLookStandalone,
  } = useAppQuickLook({
    browserDevQuickLookPath,
    openQuickLookDocument,
    pushErrorStatus,
  });

  const { requestMolstarXtbContextDocument } = useAppMolstarXtbContext({
    activeViewerIframeForDocument,
    isKnownViewerMessageSource,
  });

  const selectDocument = useCallback((id: string) => {
    setActiveDocument(id);
  }, [setActiveDocument]);

  const focusSidebarSearch = useCallback(() => {
    openCommandPalette("search");
  }, [openCommandPalette]);

  const browserDevExplicitFolder = useMemo(() => browserDevFolderFromLocation(), []);
  const browserDevHasExplicitWorkspaceQuery = useMemo(() => browserDevHasExplicitWorkspace(), []);
  const {
    activeProject,
    setWorkspacePath,
    sidebarProjects,
    workspacePath,
  } = useAppSidebarProjects({
    activeDocumentId: activeDocument?.id ?? null,
    browserDevExplicitFolder,
    browserDevHasExplicitWorkspace: browserDevHasExplicitWorkspaceQuery,
    documents,
    hiddenProjectRoots,
    pinnedProjectRoots,
    pinnedStructurePaths,
    projectNameOverrides,
    projectRoots,
    pruneRecentStructures,
    pruneSidebarPaths,
    pushErrorStatus,
    recentStructures,
  });

  const activeTextDocument = useMemo(() => {
    const location = activeTab?.location;
    if (location?.kind !== "text-file") return null;
    return textDocuments.find((document) => document.id === location.documentId || document.path === location.path) ?? null;
  }, [activeTab?.location, textDocuments]);
  const {
    copyActiveDocumentPath,
    copyDocumentPath,
    copyPath,
    listChemicalEditorTargets,
    openPathInChemicalEditor,
    openPathWithDefaultApp,
    revealActiveDocument,
    revealDocument,
    revealPath,
    showActiveDocumentMetadata,
    showDocumentMetadata,
    showTextFileMetadata,
  } = useAppFileActions({
    activeDocument,
    activeTextDocument,
    pushErrorStatus,
    pushStatus,
    writeClipboardText,
  });

  const {
    openDocuments,
    openPaths,
    openStructureRecordDocuments,
    openStructureRecords,
    openTextDocuments,
  } = useAppFileOpen({
    addBackgroundDocuments,
    addBackgroundTextDocuments,
    addDocuments,
    addTextDocuments,
    closeDocument,
    detectContentSpectrumPaths,
    expandStructureBundles: expandBrowserDevStructureBundles,
    openDockTab,
    openDocumentsInActiveTab,
    openFepNetworkTab,
    openTextDocumentsInActiveTab,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    setActiveDocument,
    setDockActiveTab,
    setDockOpen,
    setDocuments,
  });

  const openDockPayload = useAppDockPayloadOpen({
    addBackgroundDocuments,
    addBackgroundTextDocuments,
    addDockDrop,
    detectContentSpectrumPaths,
    openStructureRecordDocuments,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    setDockDocument,
    setDockTool,
  });

  const {
    chooseFiles,
    openMostRecentStructure,
    openRecentStructure,
  } = useAppOpenActions({
    openPaths,
    pushErrorStatus,
    pushStatus,
    recentStructures,
  });
  const { runConformerOperation } = useAppConformerWorkflows({
    activeDocument,
    cancelledConformerJobIdsRef,
    conformerSettings,
    openPaths,
    openTextDocuments,
    pushErrorStatus,
    pushStatus,
    requestMolstarXtbContextDocument,
    setConformerJobs,
    setConformerStatus,
  });
  const {
    runXtbActiveOperation,
    runXtbFepPreflight,
    runXtbGridScoring,
    runXtbJob,
    runXtbKetcherSketch,
    runXtbPoseRefinement,
  } = useAppXtbWorkflows({
    activeDocument,
    addDockDrop,
    cancelledXtbJobIdsRef,
    dockDroppedStructures,
    openDockTab,
    openDocumentsInActiveTab,
    openPaths,
    openTextDocuments,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    requestMolstarXtbContextDocument,
    setDockActiveTab,
    setDockOpen,
    setXtbJobs,
    setXtbStatus,
    xtbSettings,
  });

  const notifyGridPoseReviewSelection = useCallback((targetDocumentId: string, activePose: number) => {
    const iframe = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).find(
      (item) => item.dataset.documentId === targetDocumentId,
    );
    iframe?.contentWindow?.postMessage({
      source: "burrete-grid-host",
      body: {
        type: "poseReviewSelection",
        documentId: targetDocumentId,
        activePose,
      },
    }, "*");
  }, []);

  const {
    mergeMoleculeCollections,
    openDockingDocument,
    openDockingStructureRecords,
    openPoseReviewWorkspace,
    saveMoleculeCollectionAs,
  } = useAppDockingWorkflows({
    addDocuments,
    documents,
    notifyGridPoseReviewSelection,
    openPoseReviewTab,
    openStructureRecordDocuments,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    rightDockActiveTab,
    rightDockOpen,
    setDockOpen,
    setStructureDragActive,
  });

  useAppStartupEffects({
    activeDocument,
    activeTabId,
    addProjectRoot,
    browserDevExplicitFolder,
    closeAllDocuments,
    documents,
    openDockingDocument,
    openDocuments,
    openPaths,
    pushErrorStatus,
    setActiveTab,
    setWorkspacePath,
    tabs,
  });

  const {
    runStructureViewerAction,
    selectTextStructure,
  } = useAppMolstarActionSenders({
    activeDocument,
    activeViewerIframeForDocument,
    documents,
    pushStatus,
  });

  const { generate3DConformer } = useAppGenerate3DConformer({
    activeViewerIframeForDocument,
    openDocumentsInActiveTab,
    pendingMolstarReplaceRef,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
  });

  const readActiveExternalPreviewSvg = useCallback(async () => {
    if (!activeDocument) throw new Error("No active structure preview to export");
    if (!isTauriRuntime()) throw new Error("Preview export is available in the desktop app only");
    return invoke<string>("read_external_preview_svg", { runtimePath: activeDocument.runtimePath });
  }, [activeDocument]);

  const exportActivePreviewAsSvg = useCallback(async () => {
    try {
      const svg = await readActiveExternalPreviewSvg();
      const outputPath = await save({
        defaultPath: `${activeDocument?.title ?? "preview"}.svg`,
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (!outputPath) return;
      const savedPath = await invoke<string>("write_text_file", {
        request: { outputPath, contents: svg },
      });
      pushStatus(`Exported preview to ${basename(savedPath)}`);
    } catch (error) {
      pushErrorStatus(error, "Export SVG failed");
    }
  }, [activeDocument?.title, pushErrorStatus, pushStatus, readActiveExternalPreviewSvg]);

  const exportActivePreviewAsPng = useCallback(async () => {
    try {
      const svg = await readActiveExternalPreviewSvg();
      const pngBase64 = await svgToPngBase64(svg);
      const outputPath = await save({
        defaultPath: `${activeDocument?.title ?? "preview"}.png`,
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (!outputPath) return;
      const savedPath = await invoke<string>("write_base64_file", {
        request: { outputPath, contentsBase64: pngBase64 },
      });
      pushStatus(`Exported preview to ${basename(savedPath)}`);
    } catch (error) {
      pushErrorStatus(error, "Export PNG failed");
    }
  }, [activeDocument?.title, pushErrorStatus, pushStatus, readActiveExternalPreviewSvg]);

  const writeGridPerfMetric = useCallback((body: unknown) => {
    if (!isTauriRuntime()) return;
    const line = JSON.stringify({
      receivedAtMs: Date.now(),
      metric: body,
    });
    gridPerfMetricsRef.current = [...gridPerfMetricsRef.current.slice(-399), line];
    void invoke("write_text_file", {
      request: {
        outputPath: GRID_PERF_REPORT_PATH,
        contents: `${gridPerfMetricsRef.current.join("\n")}\n`,
      },
    }).catch(() => {});
  }, []);

  const { handleGridFileMessage } = useAppGridFileActions({
    documents,
    forgetDirtyGridDocument,
    postMessageToViewerSource,
    pushErrorStatus,
    pushStatus,
  });
  const { handleGridRuntimeMessage } = useAppGridRuntimeMessages({
    postMessageToViewerSource,
  });

  const {
    chooseWorkspace,
    openProjectFolder,
    openWorkspaceFolder,
  } = useAppWorkspaceActions({
    activeDocumentPath: activeDocument?.path,
    activeProjectRoot: activeProject?.rootPath,
    addProjectRoot,
    pushErrorStatus,
    pushStatus,
    recentStructures,
    setWorkspacePath,
    workspacePath,
  });

  const openSettings = useCallback(() => {
    if (!sidebarOpen) toggleSidebar();
    openSettingsTab();
  }, [openSettingsTab, sidebarOpen, toggleSidebar]);

  const openSettingsSection = useCallback((section: AppSettingsSectionId) => {
    if (!sidebarOpen) toggleSidebar();
    openSettingsSectionTab(section as Parameters<typeof openSettingsSectionTab>[0]);
  }, [openSettingsSectionTab, sidebarOpen, toggleSidebar]);

  const backToApp = useCallback(() => {
    activateLastNonSettingsTab();
  }, [activateLastNonSettingsTab]);

  const {
    applyKetcherToGridRow,
    clearKetcherImportRequest,
    ketcherDraftMolfile,
    ketcherImportRequest,
    openKetcher,
    openKetcherExportRaw,
    openKetcherSketch,
    openKetcherWithFragment,
    openKetcherWithStructures,
    saveKetcherDraft,
    saveKetcherExportFile,
  } = useAppKetcherActions({
    addDocuments,
    addTextDocuments,
    closeTab,
    mergeMoleculeCollections,
    openDocumentsInActiveTab,
    openKetcherTab,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    setActiveDocument,
    setStructureDragActive,
    tabs,
  });

  const { handleGridControlMessage } = useAppGridControlMessages({
    activeDocument,
    calculateGridDescriptors,
    documents,
    openKetcherWithFragment,
    openKetcherWithStructures,
    pushErrorStatus,
    pushStatus,
    updateDirtyGridDocument,
    writeClipboardText,
    writeGridPerfMetric,
  });
  const { handleGridConformerMessage } = useAppGridConformerMessages({
    openDocumentsInActiveTab,
    postMessageToViewerSource,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
  });
  const { handleKetcherViewerMessage } = useAppKetcherViewerMessages({
    activeDocument,
    documents,
    openKetcherWithFragment,
    openKetcherWithStructures,
    pushStatus,
  });
  const { handleViewerHostMessage } = useAppViewerHostMessages({
    pendingMolstarReplaceRef,
    pushStatus,
  });
  const { handleViewerConformerMessage } = useAppViewerConformerMessages({
    activeDocument,
    documents,
    generate3DConformer,
    postMessageToViewerSource,
    pushStatus,
  });
  const { handleMolstarContextMessage } = useAppMolstarContextMessages({
    activeDocument,
    addDocuments,
    documents,
    openDockingDocument,
    openDocuments,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
  });

  const { handleViewerFileMessage } = useAppViewerFileActions({
    pushErrorStatus,
    pushStatus,
  });

  const { handleXyzrenderSheetMessage } = useAppXyzrenderSheetMessages({
    postMessageToViewerSource,
  });

  const {
    addXyzrenderSheetItems,
    addXyzrenderSheetItemsToDocument,
    appendGridRecords,
  } = useAppGridWorkflows({
    activeDocument,
    documents,
    notifyGridPoseReviewSelection,
    poseReviewSelections,
    pushErrorStatus,
    pushStatus,
    setActiveTab,
    tabs,
  });

  const {
    currentFepSetupRequest,
    openFepNetworkPreview,
    openFepSetupWorkspace,
  } = useAppFepWorkflows({
    activeTab,
    documents,
    openFepNetworkTab,
    openFepSetupTab,
    poseReviewSelections,
    pushStatus,
  });

  const {
    addDroppedProjectRoots,
    chooseDropAction,
  } = useAppDropActions({
    addProjectRoot,
    pushErrorStatus,
    pushStatus,
    setWorkspacePath,
  });

  useOpenEvents(openPaths, pushErrorStatus);
  const agentTabActions = useMemo(() => ({
    openNewTab,
    setActiveTab,
    closeTab,
    moveTab,
  }), [openNewTab, setActiveTab, closeTab, moveTab]);
  useAgentSession({
    activeDocument,
    documents,
    tabs,
    activeTabId,
    openTextDocuments,
    openPaths,
    openDockingView: openDockingDocument,
    tabActions: agentTabActions,
    pushErrorStatus,
    setDockDocument,
  });
  const { dropActive, handleBrowserDrag, handleBrowserDragLeave, handleBrowserDrop, handleBrowserPaste, openClipboardText } = useOpenDrop(openPaths, pushStatus, {
    activeTabKind: activeTab?.location.kind ?? null,
    activeDocumentId: activeDocument?.id ?? null,
    activeDocumentPath: activeDocument?.path ?? null,
    activeDocumentRenderer: activeDocument?.renderer ?? null,
    activeDockingRequest: activeDocument?.dockingRequest ?? null,
    documents,
    fepSetupRequest: currentFepSetupRequest,
    openDockingDocument,
    openDockingStructureRecords,
    openStructureRecords,
    openTextDocuments,
    openKetcherWithStructures,
    openFepSetupWorkspace,
    openDockPayload,
    appendGridRecords,
    addXyzrenderSheetItems,
    addProjectRoots: addDroppedProjectRoots,
    chooseDropAction,
    mergeMoleculeCollections: activeDocument?.renderer === "grid2d"
      ? (paths) => {
          if (!paths.some(isMoleculeCollectionPath)) return false;
          void mergeMoleculeCollections(activeDocument.path, paths);
          return true;
        }
      : undefined,
  });
  const { openClipboard } = useAppClipboard({ openClipboardText, pushErrorStatus, pushStatus });
  const reloadActive = useCallback(async () => {
    const targetDocument = (pendingViewerReloadDocumentIdRef.current
      ? documents.find((document) => document.id === pendingViewerReloadDocumentIdRef.current)
      : null) ?? activeDocument;
    if (!targetDocument) return;
    const reloadOptions = pendingViewerReloadOptionsRef.current ?? undefined;
    pendingViewerReloadOptionsRef.current = null;
    pendingViewerReloadDocumentIdRef.current = null;
    await openDocuments([targetDocument.path], reloadOptions, undefined, { inActiveTab: true });
  }, [activeDocument, documents, openDocuments]);
  const { handleViewerRuntimeMessage, markViewerFirstRenderMessage } = useAppViewerRuntimeMessages({
    documents,
    pendingViewerReloadDocumentIdRef,
    pendingViewerReloadOptionsRef,
    pushStatus,
    reloadActive,
    xyzrenderOrientationRefRef,
  });
  const { handleRendererMessage } = useAppRendererMessage({
    activeDocument,
    documents,
    openDocuments,
    pendingViewerReloadDocumentIdRef,
    pendingViewerReloadOptionsRef,
    setPreference,
    skipNextPreferenceRefreshRef,
    xyzrenderOrientationRefRef,
  });
  const { handleViewerRuntimeFileMessage } = useAppViewerRuntimeFileMessages({
    activeDocument,
    documents,
    postMessageToViewerSource,
  });
  const { handleViewerStateMessage } = useAppViewerStateMessages({
    activeDocument,
    addDocuments,
    documents,
    openCommandPalette,
    setViewerLigandSelections,
    toggleSidebar,
  });
  const { handleDockingPoseMessage } = useAppDockingPoseMessages({
    activeDocument,
    addBackgroundDocuments,
    documents,
    notifyGridPoseReviewSelection,
    setPoseReviewSelections,
  });
  const { handleSdfViewerMessage } = useAppSdfViewerMessages({
    activeDocument,
    documents,
    openBrowserDevTextDocument,
    openDockingDocument,
    openDocuments,
    openDocumentsInActiveTab,
    openPoseReviewWorkspace,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    setPoseReviewSelections,
  });
  const reloadXyzrenderDocument = useCallback(async (document: ViewerDocument, reloadOptions: ViewerReloadOptions) => {
    const effectiveReloadOptions = {
      ...reloadOptions,
      xyzrenderOrientationRef: reloadOptions.xyzrenderOrientationRef ?? xyzrenderOrientationRefRef.current,
    };
    const iframe = activeViewerIframeForDocument(document.id);
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        source: "burrete-host",
        body: {
          type: "setXyzrenderControls",
          documentId: document.id,
          preset: effectiveReloadOptions.xyzrenderPreset ?? null,
          controls: effectiveReloadOptions.xyzrenderControls ?? null,
        },
      }, "*");
      return;
    }
    pendingViewerReloadDocumentIdRef.current = document.id;
    pendingViewerReloadOptionsRef.current = effectiveReloadOptions;
    await openDocuments([document.path], effectiveReloadOptions, undefined, { inActiveTab: true });
    pendingViewerReloadOptionsRef.current = null;
    pendingViewerReloadDocumentIdRef.current = null;
  }, [openDocuments]);
  useMenuEvents({
    chooseFiles,
    openMostRecentStructure,
    revealActiveDocument,
    copyActiveDocumentPath,
    showActiveDocumentMetadata,
    exportActivePreviewAsPng,
    exportActivePreviewAsSvg,
    clearCache,
    resetQuickLook,
    openLogs,
    openSettings,
    checkForUpdates,
  });

  useAppViewerBridgeMessages({
    handleDockingPoseMessage,
    handleGridConformerMessage,
    handleGridControlMessage,
    handleGridFileMessage,
    handleGridRuntimeMessage,
    handleKetcherViewerMessage,
    handleMolstarContextMessage,
    handleRendererMessage,
    handleSdfViewerMessage,
    handleViewerConformerMessage,
    handleViewerFileMessage,
    handleViewerHostMessage,
    handleViewerRuntimeFileMessage,
    handleViewerRuntimeMessage,
    handleViewerStateMessage,
    handleXyzrenderSheetMessage,
    isKnownViewerMessageSource,
    markViewerFirstRenderMessage,
  });

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("sync_viewer_preferences", { preferences }).catch((error) => {
      pushErrorStatus(error, "Preview preference sync failed");
    });
  }, [preferences, pushErrorStatus]);

  useEffect(() => {
    if (skipNextPreferenceRefreshRef.current) {
      skipNextPreferenceRefreshRef.current = false;
      return;
    }
    const path = activeTab?.location.kind === "file" && !isTemporaryDocumentPath(activeTab.location.path)
      ? activeTab.location.path
      : null;
    if (!path) return;
    const restoreTabId = activeTabId;
    void openDocuments([path]).then(() => {
      if (restoreTabId) setActiveTab(restoreTabId);
    });
    // Preferences refresh only the mounted file runtime. Inactive file tabs are unloaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences]);

  const actions = useAppShellActions({
    activeDocument,
    addDockDrop,
    addXyzrenderSheetItemsToDocument,
    appendGridRecords,
    applyGridDescriptorControls,
    applyGridDescriptorResults,
    applyKetcherToGridRow,
    backToApp,
    calculateGridDescriptors,
    canNavigateBack,
    canNavigateForward,
    cancelConformerJob,
    cancelXtbJob,
    checkConformerStatus,
    checkForUpdates,
    checkXtbStatus,
    chooseFiles,
    chooseWorkspace,
    clearCache,
    clearDescriptorSource,
    clearDirtyGridDocuments,
    clearKetcherImportRequest,
    clearRecentStructures,
    closeActiveDocument,
    closeAllDocuments,
    closeDocument,
    closeDockTab,
    closeGridRuntime,
    closeQuickLookPreview,
    closeTab,
    confirmDiscardDirtyGridDocument,
    confirmDiscardDirtyGridDocuments,
    copyActiveDocumentPath,
    copyDocumentPath,
    copyPath,
    documents,
    exportActivePreviewAsPng,
    exportActivePreviewAsSvg,
    exportDiagnostics,
    focusSidebarSearch,
    forgetDirtyGridDocument,
    forgetDirtyGridDocuments,
    generate3DConformer,
    installUpdate,
    installXtb,
    listChemicalEditorTargets,
    mergeMoleculeCollections,
    moveTab,
    navigateBack,
    navigateForward,
    openClipboard,
    openCommandPalette,
    openDescriptorSource,
    openDockPayload,
    openDockTab,
    openDockingDocument,
    openDockingStructureRecords,
    openDocuments,
    openFepNetworkPreview,
    openFepSetupWorkspace,
    openKetcher,
    openKetcherExportRaw,
    openKetcherSketch,
    openKetcherWithStructures,
    openLogs,
    openMostRecentStructure,
    openNewTab,
    openNewWindow,
    openPathInChemicalEditor,
    openPathWithDefaultApp,
    openPaths,
    openProjectFolder,
    openRecentStructure,
    openSettings,
    openSettingsSection,
    openStructureRecords,
    openTextDocuments,
    openUpdateRelease,
    openWorkspaceFolder,
    pushErrorStatus,
    pushStatus,
    reloadXyzrenderDocument,
    removeProjectRoot,
    renameProjectRoot,
    resetQuickLook,
    revealActiveDocument,
    revealDocument,
    revealPath,
    runConformerOperation,
    runStructureViewerAction,
    runXtbActiveOperation,
    runXtbFepPreflight,
    runXtbGridScoring,
    runXtbJob,
    runXtbKetcherSketch,
    runXtbPoseRefinement,
    saveKetcherDraft,
    saveKetcherExportFile,
    saveMoleculeCollectionAs,
    selectDocument,
    selectTextStructure,
    setActiveTab,
    setConformerJobs,
    setConformerSettings,
    setDockActiveTab,
    setDockDocument,
    setDockOpen,
    setDockSize,
    setDockTool,
    setExpandedProjectIds,
    setPreference,
    setSidebarQuery,
    setStructureDragActive,
    setUpdatePreferences,
    setXtbJobs,
    setXtbSettings,
    showActiveDocumentMetadata,
    showDocumentMetadata,
    showTextFileMetadata,
    tabs,
    toggleDock,
    toggleDockTab,
    togglePinnedProjectRoot,
    togglePinnedStructure,
    toggleProjectExpanded,
    toggleProjectsOpen,
    toggleSidebar,
  });

  const page = activeTab?.location.kind === "settings" ? "settings" : "viewer";

  const state = createAppShellViewState({
    documents,
    textDocuments,
    tabs,
    activeTab,
    activeTabId,
    activeDocument,
    quickLookDocument,
    quickLookError,
    quickLookStandalone,
    recentStructures,
    sidebarProjects,
    projectsOpen,
    expandedProjectIds,
    pinnedStructurePaths,
    workspacePath,
    page,
    sidebarOpen,
    sidebarWidth,
    sidebarDragging,
    rightDockOpen,
    rightDockWidth,
    rightDockTabs,
    rightDockActiveTab,
    rightDockDocumentId,
    rightDockTool,
    rightDockDragging,
    bottomDockOpen,
    bottomDockHeight,
    bottomDockTabs,
    bottomDockActiveTab,
    bottomDockDocumentId,
    bottomDockTool,
    bottomDockDragging,
    dockDroppedStructures,
    structureDragActive,
    poseReviewSelections,
    ketcherImportRequest,
    ketcherDraftMolfile,
    descriptorSource,
    sidebarQuery,
    status,
    dropActive,
    preferences,
    conformerStatus,
    conformerSettings,
    conformerJobs,
    viewerLigandSelections,
    xtbStatus,
    xtbSettings,
    xtbJobs,
    update,
    buildInfo,
  });

  useKeyboardShortcuts(state, actions, toggleSidebar, !commandPaletteOpen);

  return (
    <>
      <WindowTitle activeDocument={activeDocument} />
      <AppLayout
        state={state}
        actions={actions}
        onDismissStatus={clearStatus}
        onToggleSidebar={toggleSidebar}
        onResizeStart={startSidebarResize}
        onRightDockResizeStart={startRightDockResize}
        onBottomDockResizeStart={startBottomDockResize}
        onDragEnter={handleBrowserDrag}
        onDragOver={handleBrowserDrag}
        onDragLeave={handleBrowserDragLeave}
        onDrop={handleBrowserDrop}
        onPaste={handleBrowserPaste}
      />
      {commandPaletteOpen ? (
        <Suspense fallback={null}>
          <CommandPalette
            state={state}
            actions={actions}
            isOpen={commandPaletteOpen}
            query={commandPaletteQuery}
            onQueryChange={setCommandPaletteQuery}
            onClose={closeCommandPalette}
          />
        </Suspense>
      ) : null}
    </>
  );
}

function isKnownViewerMessageSource(source: MessageEventSource | null, documentId?: string) {
  if (!source) return false;
  return Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).some(
    (iframe) => (!documentId || iframe.dataset.documentId === documentId) && iframe.contentWindow === source,
  );
}

function postMessageToViewerSource(source: MessageEventSource | null, payload: unknown) {
  if (source && typeof source === "object" && "postMessage" in source && typeof source.postMessage === "function") {
    (source as Window).postMessage(payload, "*");
    return;
  }
  const documentId = payload && typeof payload === "object"
    && "body" in payload
    && payload.body
    && typeof payload.body === "object"
    && "documentId" in payload.body
    && typeof payload.body.documentId === "string"
    ? payload.body.documentId
    : null;
  if (!documentId) return;
  const iframe = document.querySelector<HTMLIFrameElement>(`.viewer-iframe[data-document-id="${CSS.escape(documentId)}"]`);
  iframe?.contentWindow?.postMessage(payload, "*");
}

function activeViewerIframeForDocument(documentId: string) {
  const escapedId = CSS.escape(documentId);
  return document.querySelector<HTMLIFrameElement>(
    `.page-surface[data-active="true"] .viewer-iframe[data-document-id="${escapedId}"]`,
  ) ?? document.querySelector<HTMLIFrameElement>(
    `.viewer-iframe[data-document-id="${escapedId}"]`,
  );
}

function isXtbOptimizationTrajectoryLogPath(path: string) {
  return (path.split(/[\\/]/).filter(Boolean).pop() ?? "").toLowerCase() === "xtbopt.log";
}

async function writeClipboardText(text: string) {
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (error) {
    if (!copyTextWithSelectionFallback(text)) throw error;
    return;
  }
  if (!copyTextWithSelectionFallback(text)) throw new Error("Clipboard write is unavailable.");
}

function copyTextWithSelectionFallback(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}
