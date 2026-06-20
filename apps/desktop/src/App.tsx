import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { AppLayout } from "./components/app-layout";
import type { AppSettingsSectionId, KetcherSketchRequest, ShellActions, ShellViewState, StructureViewerAction, ViewerLigandSelection } from "./components/types";
import { WindowTitle } from "./components/window-title";
import {
  useCloseCommandPalette,
  useCommandPaletteSearch,
  useIsCommandPaletteOpen,
  useOpenCommandPalette,
  useSetCommandPaletteSearch,
} from "./hooks/use-command-palette";
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
import { useAppGridControlMessages } from "./hooks/use-app-grid-control-messages";
import { useAppGridFileActions } from "./hooks/use-app-grid-file-actions";
import { useAppGridRuntimeMessages } from "./hooks/use-app-grid-runtime-messages";
import { useAppGridWorkflows } from "./hooks/use-app-grid-workflows";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useAppKetcherActions } from "./hooks/use-app-ketcher-actions";
import { useAppKetcherViewerMessages } from "./hooks/use-app-ketcher-viewer-messages";
import { useAppMaintenance } from "./hooks/use-app-maintenance";
import { useAppOpenActions } from "./hooks/use-app-open-actions";
import { useAppQuickLook } from "./hooks/use-app-quick-look";
import { useAppResize } from "./hooks/use-app-resize";
import { useAppRendererMessage } from "./hooks/use-app-renderer-message";
import { useAppSidebarProjects } from "./hooks/use-app-sidebar-projects";
import { useAppSdfViewerMessages } from "./hooks/use-app-sdf-viewer-messages";
import { useAppStartupEffects } from "./hooks/use-app-startup-effects";
import { useAppStatus } from "./hooks/use-app-status";
import { useAppUpdates } from "./hooks/use-app-updates";
import { useAppViewerFileActions } from "./hooks/use-app-viewer-file-actions";
import { useAppViewerConformerMessages } from "./hooks/use-app-viewer-conformer-messages";
import { useAppViewerHostMessages } from "./hooks/use-app-viewer-host-messages";
import { useAppViewerRuntimeFileMessages } from "./hooks/use-app-viewer-runtime-file-messages";
import { useAppViewerRuntimeMessages } from "./hooks/use-app-viewer-runtime-messages";
import { useAppViewerStateMessages } from "./hooks/use-app-viewer-state-messages";
import { useAppWorkspaceActions } from "./hooks/use-app-workspace-actions";
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
import { generateBrowserDev3DConformer, openBrowserDevDocuments, openBrowserDevMolstarContextDocument, openBrowserDevTextDocument, readBrowserDevVirtualTextDocument, writeBrowserDevVirtualTextDocument } from "./lib/browser-dev-documents";
import { openBrowserDevTextFiles } from "./lib/browser-dev-text-files";
import { cancelConformerRequest, cancelXtbRequest, installXtbRequest, prepareConformerRequest, requestConformerStatus, requestXtbStatus, runConformerRequest, runXtbRequest } from "./lib/chemistry-job-requests";
import { conformerOperationLabel, conformerStatusLine, normalizeConformerSettings, normalizeXtbSettings, readConformerSettings, readXtbSettings, saveConformerSettings, saveXtbSettings, xtbOperationLabel } from "./lib/chemistry-settings";
import { isMoleculeCollectionPath } from "./lib/collection-documents";
import { isProteinLikeDockingSource } from "./lib/docking-documents";
import { canInspectConformerEnsemble, canUseConformerWorkflow } from "./lib/conformer-ensemble";
import { conformerGenerationPreferences, conformerGenerationTaskLabel, generated3DPoseSetText, generated3DPoseSetTitle, generated3DStatus, normalizeMolstarStylePreference, textToBase64, type ConformerGenerationMode, type ConformerGenerationResult, type MolstarStylePreference } from "./lib/conformer-generation";
import { directChemistryJobGuardMessage } from "./lib/direct-chemistry-guard";
import type { DockArea, DockTabKind } from "./lib/dock";
import { pathExtension, preferredTextExtensions, structureAndTextExtensions, structureExtensionFromPath, structureExtensions } from "./lib/file-routing";
import { browserDevFolderFromLocation, browserDevHasExplicitWorkspace, browserDevQuickLookFileFromLocation } from "./lib/browser-dev-startup";
import { basename, parentDirectory } from "./lib/sidebar-projects";
import type { StructureDragPayload } from "./lib/structure-drag";
import { readStructureText } from "./lib/structure-text";
import { isSpectrumPath, isSubformulaSpectrumJsonText, isTabularSpectrumExtension, isTabularSpectrumText, spectrumDocumentFromText } from "./lib/spectrum";
import type { TextStructureSelection } from "./lib/text-structure-selection";
import { isTauriRuntime } from "./lib/tauri";
import { isTemporaryDocumentPath } from "./lib/temporary-documents";
import type { ConformerJob, ConformerOperation, ConformerPreparedRun, ConformerRunRequest, ConformerRunResult, ConformerSettings, ConformerStatus, FepSetupRequest, OpenDocumentsMode, TextFileDocument, ViewerDocument, ViewerPreferences, ViewerReloadOptions, XtbJob, XtbOperation, XtbRunRequest, XtbRunResult, XtbSettings, XtbStatus } from "./types";

const CommandPalette = lazy(() => import("./components/command-palette").then((module) => ({
  default: module.CommandPalette,
})));

const GRID_PERF_REPORT_PATH = "/private/tmp/burrete-grid-real-app-perf.jsonl";
type MolstarContextDocument = Parameters<typeof openBrowserDevMolstarContextDocument>[0];
type MolstarContextEntry = NonNullable<MolstarContextDocument["entries"]>[number];
type PendingMolstarReplaceResolver = (ok: boolean) => void;
type XtbRunJobOptions = {
  title?: string;
  inputLabel?: string;
  openPrimary?: boolean;
  openOptimizedPoseInCurrentView?: boolean;
  poseSourceDocument?: ViewerDocument | null;
};

function molstarContextEntryExtension(format: string | undefined) {
  const value = String(format || "pdb").toLowerCase();
  if (value === "cif" || value === "mmcif" || value === "mcif") return "cif";
  if (value === "sd") return "sdf";
  return value || "pdb";
}

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
  const [conformerStatus, setConformerStatus] = useState<ConformerStatus | null>(null);
  const [conformerSettings, setConformerSettingsState] = useState<ConformerSettings>(() => readConformerSettings());
  const [conformerJobs, setConformerJobs] = useState<ConformerJob[]>([]);
  const [viewerLigandSelections, setViewerLigandSelections] = useState<Record<string, ViewerLigandSelection | null>>({});
  const [xtbStatus, setXtbStatus] = useState<XtbStatus | null>(null);
  const [xtbSettings, setXtbSettingsState] = useState<XtbSettings>(() => readXtbSettings());
  const [xtbJobs, setXtbJobs] = useState<XtbJob[]>([]);
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
  const cancelledConformerJobIdsRef = useRef(new Set<string>());
  const cancelledXtbJobIdsRef = useRef(new Set<string>());
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

  const setConformerSettings = useCallback((settings: ConformerSettings) => {
    const normalized = normalizeConformerSettings(settings);
    setConformerSettingsState(normalized);
    saveConformerSettings(normalized);
  }, []);

  const checkConformerStatus = useCallback(async () => {
    try {
      const status = await requestConformerStatus();
      setConformerStatus(status);
      pushStatus(conformerStatusLine(status));
    } catch (error) {
      pushErrorStatus(error, "CREST/PRISM status failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const setXtbSettings = useCallback((settings: XtbSettings) => {
    const normalized = normalizeXtbSettings(settings);
    setXtbSettingsState(normalized);
    saveXtbSettings(normalized);
  }, []);

  const checkXtbStatus = useCallback(async () => {
    try {
      const status = await requestXtbStatus();
      setXtbStatus(status);
      pushStatus(status.installed ? `xTB ready: ${status.version ?? status.executablePath ?? "installed"}` : status.installHint, status.installed ? "success" : "error");
    } catch (error) {
      pushErrorStatus(error, "xTB status failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const installXtb = useCallback(async () => {
    try {
      pushStatus("Installing xTB...");
      const status = await installXtbRequest();
      setXtbStatus(status);
      pushStatus(status.installed ? `xTB installed: ${status.version ?? status.executablePath ?? "ready"}` : status.installHint, status.installed ? "success" : "error");
    } catch (error) {
      pushErrorStatus(error, "xTB install failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const openXtbOptimizedPoseInCurrentView = useCallback(async (
    sourceDocument: ViewerDocument | null | undefined,
    sourcePath: string | null | undefined,
    result: XtbRunResult,
  ) => {
    const sourceTitle = sourceDocument?.title ?? (sourcePath ? basename(sourcePath) : "structure");
    const trajectoryArtifact = result.artifacts.find((artifact) => artifact.title === "xtbopt.log");
    if (trajectoryArtifact) {
      const trajectoryText = await readStructureText(trajectoryArtifact.path);
      const trajectoryFrames = countXyzFrames(trajectoryText);
      if (trajectoryFrames > 1) {
        const title = `${sourceTitle} xTB optimization.xyz`;
        const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
        const reloadOptions = { trajectoryAutoPlayOnce: true, molstarStyle: preferences.molstarStyle };
        const document = isTauriRuntime()
          ? await invoke<ViewerDocument>("open_text_structure", {
              request: {
                title,
                extension: "xyz",
                text: trajectoryText.endsWith("\n") ? trajectoryText : `${trajectoryText}\n`,
              },
              preferences: molstarPreferences,
              reloadOptions,
            })
          : await openBrowserDevTextDocument(
              title,
              "xyz",
              trajectoryText.endsWith("\n") ? trajectoryText : `${trajectoryText}\n`,
              molstarPreferences,
              reloadOptions,
            );
        const documentWithSource = sourcePath ? { ...document, sourcePath } : document;
        openDocumentsInActiveTab([documentWithSource]);
        rememberRecentStructures([documentWithSource]);
        pushStatus("Opened xTB optimization trajectory in the current Mol* view", "success");
        return;
      }
    }
    if (!sourcePath || !result.primaryOpenPath) return;
    const [sourceText, optimizedText] = await Promise.all([
      readStructureText(sourcePath),
      readStructureText(result.primaryOpenPath),
    ]);
    const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
    const document = await openBrowserDevMolstarContextDocument({
      label: `${sourceTitle} xTB optimized`,
      entries: [
        {
          role: "receptor",
          label: `${sourceTitle} input`,
          format: structureExtensionFromPath(sourcePath),
          data: sourceText,
        },
        {
          role: "ligand",
          label: "xTB optimized pose",
          format: structureExtensionFromPath(result.primaryOpenPath),
          data: optimizedText,
        },
      ],
      context: { scope: "xtb-optimization" },
    }, molstarPreferences);
    openDocumentsInActiveTab([document]);
    rememberRecentStructures([document]);
    pushStatus("Opened xTB optimized pose in the current Mol* view", "success");
  }, [openDocumentsInActiveTab, preferences, pushStatus, rememberRecentStructures]);

  const runXtbJob = useCallback(async (
    request: XtbRunRequest,
    options: XtbRunJobOptions = {},
  ) => {
    const title = options.title ?? xtbOperationLabel(request.operation);
    const inputLabel = options.inputLabel ?? request.label ?? request.inputPath ?? "Ketcher sketch";
    const guardMessage = await directChemistryJobGuardMessage("xTB", request.inputText ?? null, request.inputExtension ?? structureExtensionFromPath(request.inputPath ?? request.sourcePath), request.inputPath ?? request.sourcePath ?? null);
    if (guardMessage) {
      pushStatus(guardMessage, "error");
      return;
    }
    const jobId = `xtb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const pendingJob: XtbJob = {
      id: jobId,
      title,
      operation: request.operation,
      status: "running",
      inputLabel,
      startedAt,
      completedAt: null,
      result: null,
      error: null,
    };
    setXtbJobs((previous) => [pendingJob, ...previous].slice(0, 20));
    try {
      const saveRunFiles = request.saveRunFiles ?? xtbSettings.saveRunFiles;
      const result = await runXtbRequest({
        method: xtbSettings.method,
        optLevel: xtbSettings.optLevel,
        charge: xtbSettings.charge,
        uhf: xtbSettings.uhf,
        threads: xtbSettings.threads,
        accuracy: xtbSettings.accuracy,
        electronicTemperature: xtbSettings.electronicTemperature,
        solvationModel: xtbSettings.solvationModel,
        solvent: xtbSettings.solvent === "none" ? null : xtbSettings.solvent,
        properties: xtbSettings.properties,
        mdTemperature: xtbSettings.mdTemperature,
        mdTimePs: xtbSettings.mdTimePs,
        mdStepFs: xtbSettings.mdStepFs,
        mdSnapshots: xtbSettings.mdSnapshots,
        timeoutSeconds: request.operation === "md" || request.operation === "metadyn"
          ? Math.max(xtbSettings.timeoutSeconds, 600)
          : xtbSettings.timeoutSeconds,
        saveRunFiles,
        ...request,
        jobId,
      });
      const cancelled = cancelledXtbJobIdsRef.current.has(jobId) || /cancelled/iu.test(result.error ?? "");
      const recovered = !result.ok && Boolean(result.primaryOpenPath);
      const jobStatus: XtbJob["status"] = cancelled ? "cancelled" : result.ok ? "success" : recovered ? "recovered" : "failed";
      setXtbJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: jobStatus,
        completedAt: Date.now(),
        result,
        error: result.error ?? null,
      } : job));
      if (cancelled) {
        pushStatus(`xTB cancelled: ${title}`);
        return;
      }
      void requestXtbStatus().then(setXtbStatus).catch(() => {});
      const textArtifacts = [result.reportPath, result.logPath].filter(Boolean);
      if (textArtifacts.length > 0) {
        void openTextDocuments(textArtifacts, { background: true });
      }
      const sourcePath = request.sourcePath ?? request.inputPath ?? null;
      if ((result.ok || recovered) && options.openOptimizedPoseInCurrentView && request.operation === "optimize") {
        await openXtbOptimizedPoseInCurrentView(options.poseSourceDocument, sourcePath, result);
      }
      if (options.openPrimary !== false && result.primaryOpenPath) {
        void openPaths([result.primaryOpenPath]);
      }
      if (!options.openOptimizedPoseInCurrentView && result.ok && request.operation === "optimize" && sourcePath && result.primaryOpenPath) {
        openDockTab("bottom", "compare");
        setDockActiveTab("bottom", "compare");
        setDockOpen("bottom", true);
        addDockDrop({
          area: "bottom",
          tabKind: "compare",
          payload: { paths: [sourcePath, result.primaryOpenPath], records: [] },
        });
      }
      if (result.ok) {
        pushStatus(`xTB finished: ${title}`, "success");
      } else if (recovered) {
        pushStatus(`xTB produced partial results: ${title}`, "info", result.error ? [result.error] : []);
      } else {
        pushStatus(`xTB failed: ${result.error ?? title}`, "error", result.error ? [result.error] : []);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = cancelledXtbJobIdsRef.current.has(jobId);
      setXtbJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: cancelled ? "cancelled" : "failed",
        completedAt: Date.now(),
        error: cancelled ? "xTB job cancelled." : message,
      } : job));
      if (cancelled) {
        pushStatus(`xTB cancelled: ${title}`);
        return;
      }
      pushErrorStatus(error, `xTB ${request.operation} failed`);
    }
  }, [addDockDrop, openDockTab, openXtbOptimizedPoseInCurrentView, pushErrorStatus, pushStatus, setDockActiveTab, setDockOpen, xtbSettings]);

  const cancelXtbJob = useCallback(async (jobId: string) => {
    cancelledXtbJobIdsRef.current.add(jobId);
    setXtbJobs((previous) => previous.map((job) => job.id === jobId && job.status === "running" ? {
      ...job,
      status: "cancelled",
      completedAt: Date.now(),
      error: "xTB job cancelled.",
    } : job));
    try {
      await cancelXtbRequest(jobId);
      pushStatus("xTB job cancelled");
    } catch (error) {
      pushErrorStatus(error, "Cancel xTB job failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const requestMolstarXtbContextDocument = useCallback(async (document: ViewerDocument): Promise<MolstarContextDocument | null> => {
    if (document.renderer !== "molstar") return null;
    const iframe = activeViewerIframeForDocument(document.id);
    if (!iframe?.contentWindow) return null;
    const actionId = `xtb-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const finish = (contextDocument: MolstarContextDocument | null) => {
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(contextDocument);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data;
        const body = data?.body;
        if (data?.source !== "burrete-agent-viewer" || body?.type !== "agent-action-result" || body.id !== actionId) return;
        if (!isKnownViewerMessageSource(event.source, document.id)) return;
        const contextDocument = body.result?.result?.contextDocument;
        finish(contextDocument && typeof contextDocument === "object" ? contextDocument : null);
      };
      const timeout = window.setTimeout(() => finish(null), 500);
      window.addEventListener("message", onMessage);
      iframe.contentWindow?.postMessage({
        source: "burrete-agent-host",
        body: {
          type: "agent-action",
          id: actionId,
          action: { type: "get_xtb_context" },
        },
      }, "*");
    });
  }, []);

  const runXtbActiveOperation = useCallback(async (operation: XtbOperation) => {
    if (!activeDocument) {
      pushStatus("Open a structure before running xTB.", "error");
      return;
    }
    const contextDocument = await requestMolstarXtbContextDocument(activeDocument);
    const contextInputRequest = xtbInputRequestForMolstarContextDocument(contextDocument, activeDocument.sourcePath ?? activeDocument.path);
    const inputRequest = contextInputRequest ?? xtbInputRequestForDocument(activeDocument);
    if (!inputRequest) {
      pushStatus("This generated structure cannot be used for xTB because its source text is unavailable.", "error");
      return;
    }
    const secondaryPaths = operation === "dock"
      ? dockDroppedStructures.flatMap((item) => item.payload.paths).filter((path) => path !== activeDocument.path).slice(0, 1)
      : [];
    if (operation === "dock" && secondaryPaths.length === 0) {
      pushStatus("Drop a ligand or second structure into a dock before running xTB docking.", "error");
      return;
    }
    const openOptimizedPoseInCurrentView = operation === "optimize";
    await runXtbJob({
      operation,
      ...inputRequest,
      secondaryPaths,
    }, {
      title: xtbOperationLabel(operation),
      inputLabel: inputRequest.label ?? activeDocument.title,
      openPrimary: operation !== "properties" && !openOptimizedPoseInCurrentView,
      openOptimizedPoseInCurrentView,
      poseSourceDocument: openOptimizedPoseInCurrentView ? activeDocument : null,
    });
  }, [activeDocument, dockDroppedStructures, pushStatus, requestMolstarXtbContextDocument, runXtbJob]);

  const runXtbKetcherSketch = useCallback(async (request: KetcherSketchRequest) => {
    await runXtbJob({
      operation: "optimize",
      inputText: request.text,
      inputExtension: request.extension,
      label: request.title,
    }, {
      title: "xTB Optimize Ketcher Sketch",
      inputLabel: request.title,
    });
  }, [runXtbJob]);

  const runXtbGridScoring = useCallback(async (document: ViewerDocument | null = activeDocument) => {
    if (!document) {
      pushStatus("Open a grid or structure before running xTB scoring.", "error");
      return;
    }
    const inputRequest = xtbInputRequestForDocument(document);
    if (!inputRequest) {
      pushStatus("This generated structure cannot be used for xTB because its source text is unavailable.", "error");
      return;
    }
    await runXtbJob({
      operation: document.renderer === "grid2d" ? "grid-properties" : "properties",
      ...inputRequest,
    }, {
      title: document.renderer === "grid2d" ? "xTB Grid Properties" : "xTB Properties",
      inputLabel: document.title,
      openPrimary: false,
    });
  }, [activeDocument, pushStatus, runXtbJob]);

  const runXtbPoseRefinement = useCallback(async (request: FepSetupRequest) => {
    await runXtbJob({
      operation: "pose-refine",
      inputPath: request.gridPath,
      secondaryPaths: [request.receptorPath, request.dockingPath],
      label: `pose-${request.referencePose + 1}`,
    }, {
      title: `xTB Refine Pose ${request.referencePose + 1}`,
      inputLabel: basename(request.gridPath),
    });
  }, [runXtbJob]);

  const runXtbFepPreflight = useCallback(async (request: FepSetupRequest) => {
    await runXtbJob({
      operation: "fep-preflight",
      inputPath: request.gridPath,
      secondaryPaths: [request.receptorPath, request.dockingPath],
      label: "fep-preflight",
    }, {
      title: "xTB FEP Preflight",
      inputLabel: basename(request.gridPath),
      openPrimary: false,
    });
  }, [runXtbJob]);

  const runConformerJob = useCallback(async (request: ConformerRunRequest) => {
    const title = conformerOperationLabel(request.operation);
    const jobId = `conformer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullRequest: ConformerRunRequest = {
      ...request,
      jobId,
      method: conformerSettings.method,
      solvent: conformerSettings.solvent === "none" ? null : conformerSettings.solvent,
      charge: conformerSettings.charge,
      uhf: conformerSettings.uhf,
      threads: conformerSettings.threads,
      timeoutSeconds: request.operation === "prism-prune" ? conformerSettings.prismTimeoutSeconds : conformerSettings.timeoutSeconds,
      energyWindowKcalMol: conformerSettings.energyWindowKcalMol,
      rmsdThresholdAngstrom: conformerSettings.rmsdThresholdAngstrom,
      samplingMode: conformerSettings.samplingMode,
      prismEnergySort: conformerSettings.prismEnergySort,
      prismRotamerPruning: conformerSettings.prismRotamerPruning,
    };
    let preparedRun: ConformerPreparedRun;
    try {
      preparedRun = await prepareConformerRequest(fullRequest);
    } catch (error) {
      pushErrorStatus(error, `${title} setup failed`);
      return;
    }
    const pendingJob: ConformerJob = {
      id: jobId,
      title,
      operation: request.operation,
      inputTitle: request.title,
      status: "running",
      startedAt: Date.now(),
      workDir: preparedRun.workDir,
      logPath: preparedRun.logPath,
      result: null,
      error: null,
    };
    setConformerJobs((previous) => [pendingJob, ...previous].slice(0, 20));
    try {
      const result = await runConformerRequest({ ...fullRequest, workDir: preparedRun.workDir });
      const cancelled = cancelledConformerJobIdsRef.current.has(jobId) || /cancelled/iu.test(result.errorSummary ?? "");
      setConformerJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: cancelled ? "cancelled" : result.ok ? (result.exitCode === 0 ? "success" : "recovered") : "failed",
        completedAt: Date.now(),
        workDir: result.workDir,
        logPath: result.logPath,
        result,
        error: result.errorSummary ?? (result.ok ? null : `Exited with code ${result.exitCode}`),
      } : job));
      if (cancelled) {
        pushStatus(`${title} cancelled: ${request.title}`);
        return;
      }
      if (result.reportPath) {
        void openTextDocuments([result.reportPath], { background: true });
      }
      if (result.ok && result.primaryOpenPath) {
        void openPaths([result.primaryOpenPath]);
      }
      void requestConformerStatus().then(setConformerStatus).catch(() => {});
      pushStatus(`${title} ${result.ok ? "finished" : "failed"}: ${request.title}`, result.ok ? "success" : "error", [
        ...(result.errorSummary ? [result.errorSummary] : []),
        `Exit code: ${result.exitCode}`,
        `Run folder: ${result.workDir}`,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = cancelledConformerJobIdsRef.current.has(jobId);
      setConformerJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: cancelled ? "cancelled" : "failed",
        completedAt: Date.now(),
        error: cancelled ? "Conformer job cancelled." : message,
      } : job));
      if (cancelled) {
        pushStatus(`${title} cancelled: ${request.title}`);
        return;
      }
      pushErrorStatus(error, `${title} failed`);
    }
  }, [conformerSettings, pushErrorStatus, pushStatus]);

  const cancelConformerJob = useCallback(async (jobId: string) => {
    cancelledConformerJobIdsRef.current.add(jobId);
    setConformerJobs((previous) => previous.map((job) => job.id === jobId && job.status === "running" ? {
      ...job,
      status: "cancelled",
      completedAt: Date.now(),
      error: "Conformer job cancelled.",
    } : job));
    try {
      await cancelConformerRequest(jobId);
      pushStatus("Conformer job cancelled");
    } catch (error) {
      pushErrorStatus(error, "Cancel conformer job failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const runConformerOperation = useCallback(async (
    operation: ConformerOperation,
    document: ViewerDocument | null | undefined = activeDocument,
    selection: StructureViewerAction | null = null,
  ) => {
    if (!document) {
      pushStatus("Open a small molecule or conformer ensemble before running CREST/PRISM.", "error");
      return;
    }
    let selectedInput: SelectedConformerInput | null = null;
    if (selection && operation === "crest-generate") {
      try {
        selectedInput = await selectedPdbLigandConformerInput(document, selection);
      } catch (error) {
        pushErrorStatus(error, "Selected object extraction failed");
        return;
      }
    }
    if (!selectedInput && operation === "crest-generate") {
      const contextDocument = await requestMolstarXtbContextDocument(document);
      selectedInput = conformerInputForMolstarContextDocument(contextDocument);
    }
    if (selection && operation === "crest-generate" && !selectedInput) {
      pushStatus("Selected object could not be extracted for CREST.", "error");
      return;
    }
    if (!selectedInput && !canUseConformerWorkflow(document.extension)) {
      pushStatus("CREST/PRISM needs a small-molecule file or a selected object.", "error");
      return;
    }
    if (operation === "prism-prune" && !canInspectConformerEnsemble(document.extension)) {
      pushStatus("PRISM pruning expects an ensemble file such as XYZ or SDF.", "error");
      return;
    }
    const virtualText = !isTauriRuntime() ? readBrowserDevVirtualTextDocument(document.path) : null;
    const inputText = selectedInput?.text ?? virtualText;
    const guardMessage = await directChemistryJobGuardMessage(
      operation === "crest-generate" ? "CREST" : "PRISM",
      inputText,
      selectedInput?.extension ?? document.extension,
      inputText ? null : document.sourcePath ?? document.path,
    );
    if (guardMessage) {
      pushStatus(guardMessage, "error");
      return;
    }
    const inputBytes = inputText === null ? null : new TextEncoder().encode(inputText);
    await runConformerJob({
      operation,
      path: document.sourcePath ?? document.path,
      title: selectedInput?.title ?? document.title,
      extension: selectedInput?.extension ?? document.extension,
      inputDataBase64: inputBytes ? arrayBufferToBase64(inputBytes.buffer) : null,
      outputDirectory: conformerOutputDirectory(document),
    });
  }, [activeDocument, pushErrorStatus, pushStatus, requestMolstarXtbContextDocument, runConformerJob]);

  useEffect(() => {
    let cancelled = false;
    void requestXtbStatus()
      .then((status) => {
        if (!cancelled) setXtbStatus(status);
      })
      .catch(() => {});
    void requestConformerStatus()
      .then((status) => {
        if (!cancelled) setConformerStatus(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  const selectTextStructure = useCallback((textDocument: TextFileDocument, selection: TextStructureSelection) => {
    const targetDocument = documents.find((document) => document.path === textDocument.path) ??
      (activeDocument?.path === textDocument.path ? activeDocument : null);
    if (!targetDocument || targetDocument.renderer !== "molstar") return;
    const iframe = activeViewerIframeForDocument(targetDocument.id);
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({
      source: "burrete-agent-host",
      body: {
        type: "agent-action",
        id: `text-selection-${Date.now()}`,
        action: {
          type: "select_residues",
          label: selection.label,
          selector: selection.selector,
          granularity: selection.granularity,
          mode: "replace",
        },
      },
    }, "*");
  }, [activeDocument, documents]);

  const runStructureViewerAction = useCallback((document: ViewerDocument, action: StructureViewerAction) => {
    if (document.renderer !== "molstar") {
      pushStatus(`${action.label} needs a Mol* viewer`, "error");
      return;
    }
    const iframe = activeViewerIframeForDocument(document.id);
    if (!iframe?.contentWindow) {
      pushStatus(`Open ${document.title} in the main viewer first`, "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burrete-agent-host",
      body: {
        type: "agent-action",
        id: `structure-action-${Date.now()}`,
        action,
      },
    }, "*");
    if (!("notify" in action) || action.notify !== false) {
      pushStatus(action.label);
    }
  }, [pushStatus]);

  const generate3DConformer = useCallback(async (document: ViewerDocument, mode: ConformerGenerationMode = "single", molstarStyle?: MolstarStylePreference | null) => {
    if (!["sdf", "sd", "mol", "smi", "smiles"].includes(document.extension.trim().toLowerCase())) {
      pushStatus("3D conformer generation supports SDF, MOL, and SMILES structures.", "error");
      return;
    }
    pushStatus(`Generating ${conformerGenerationTaskLabel(mode)} with ${preferences.conformerEngine.toUpperCase()}...`);
    try {
      const text = readBrowserDevVirtualTextDocument(document.path) ?? await readStructureText(document.path);
      const request = {
        title: document.title,
        extension: document.extension,
        text,
        ...conformerGenerationPreferences(preferences),
        mode,
        source3d: null,
      };
      const conformer = isTauriRuntime()
        ? await invoke<ConformerGenerationResult>("generate_3d_conformer", { request })
        : await generateBrowserDev3DConformer(request);
      const poseSetText = generated3DPoseSetText(text, document.extension, conformer.text, mode);
      const poseSetTitle = generated3DPoseSetTitle(document.title, poseSetText);
      const effectiveMolstarStyle = molstarStyle ?? preferences.molstarStyle;
      const molstarPreferences = { ...preferences, rendererMode: "molstar" as const, molstarStyle: effectiveMolstarStyle };
      const generatedDocument = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_text_structure", {
            request: { title: poseSetTitle, extension: conformer.extension, text: poseSetText },
            preferences: molstarPreferences,
            reloadOptions: {},
          })
        : await openBrowserDevTextDocument(
            poseSetTitle,
            conformer.extension,
            poseSetText,
            molstarPreferences,
            {},
          );
      const replacedInPlace = await replaceMolstarStructureInPlace(
        document,
        generatedDocument,
        { ...conformer, title: poseSetTitle, text: poseSetText },
        pendingMolstarReplaceRef.current,
        effectiveMolstarStyle,
      );
      if (replacedInPlace) {
        if (!isTauriRuntime()) writeBrowserDevVirtualTextDocument(generatedDocument.path, poseSetText);
        openDocumentsInActiveTab([generatedDocument], {
          backLocation: { kind: "file", documentId: document.id, path: document.path },
        });
        rememberRecentStructures([generatedDocument]);
        pushStatus(generated3DStatus(conformer, "added it as a new Molstar pose"));
        return;
      }
      if (document.renderer === "molstar") {
        pushStatus(
          "3D conformer was generated, but the current Molstar viewer did not apply it in place. Reload the viewer tab once and try again.",
          "error",
        );
        return;
      }
      openDocumentsInActiveTab([generatedDocument]);
      rememberRecentStructures([generatedDocument]);
      pushStatus(generated3DStatus(conformer, "opened it in Molstar"));
    } catch (error) {
      pushErrorStatus(error, "3D conformer generation failed");
    }
  }, [documents, openDocumentsInActiveTab, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setActiveDocument, setDocuments]);

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

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        body?: {
          type?: string;
          requestId?: string;
          message?: string;
          value?: string;
          mode?: string;
          molstarStyle?: string | null;
          documentId?: string;
          path?: string | null;
          receptorPath?: string | null;
          title?: string | null;
          extension?: string | null;
          textBase64?: string | null;
          controlLabel?: string | null;
          orientationRef?: string | null;
          preset?: string | null;
          text?: string | null;
          base64?: string | null;
          query?: string | null;
          sort?: string | null;
          offset?: number | null;
          limit?: number | null;
          activePose?: number | null;
          poseMode?: string | null;
          sourcePath?: string | null;
          controls?: ViewerReloadOptions["xyzrenderControls"];
          renderer?: string | null;
          presetOptions?: Array<{ value?: string | null; label?: string | null }> | null;
          contextDocument?: Parameters<typeof openBrowserDevMolstarContextDocument>[0];
          inputDataBase64?: string | null;
          inputExtension?: string | null;
          fragments?: Array<{ title?: string | null; textBase64?: string | null }> | null;
          molecules?: Array<{ title?: string | null; extension?: string | null; textBase64?: string | null }> | null;
          items?: Record<string, unknown>[] | null;
          name?: string | null;
          mimeType?: string | null;
          requestToken?: string | null;
          dirty?: boolean | null;
          dirtyReason?: string | null;
          gridEdit?: boolean | null;
          rowIndex?: number | null;
          rowIndexes?: number[] | null;
          descriptorFilters?: Array<{ id?: string | null; min?: number | null; max?: number | null }> | null;
          descriptorSort?: { id?: string | null; direction?: string | null } | null;
          selection?: {
            label?: string | null;
            value?: string | null;
            selector?: Record<string, string | number | Array<string | number>> | null;
            atoms?: number | null;
          } | null;
          id?: string | null;
          result?: {
            ok?: boolean;
            command?: string;
            result?: {
              counts?: {
                atoms?: number;
                residues?: number;
              };
            };
            error?: {
              message?: string;
              details?: unknown;
            };
          } | null;
        };
      } | undefined;
      if (data?.source !== "burrete-viewer" && data?.source !== "burrete-grid" && data?.source !== "burrete-agent-viewer") return;
      const body = data.body;
      if (!isKnownViewerMessageSource(event.source, body?.documentId)) return;
      if (handleViewerHostMessage(data.source, body)) {
        return;
      }
      if (handleViewerStateMessage(data.source, body)) {
        return;
      }
      if (handleViewerRuntimeFileMessage(data.source, body, event.source)) {
        return;
      }
      if (handleDockingPoseMessage(data.source, body)) {
        return;
      }
      markViewerFirstRenderMessage(data.source, body);
      if (data.source === "burrete-viewer" && handleViewerFileMessage(body)) {
        return;
      }
      if (handleXyzrenderSheetMessage(data.source, body, event.source)) {
        return;
      }
      if (data.source === "burrete-grid") {
        if (handleGridControlMessage(body)) {
          return;
        }
        if (handleGridFileMessage(body, event.source)) {
          return;
        }
        if (handleGridRuntimeMessage(body, event.source)) {
          return;
        }
      }
      if (handleViewerRuntimeMessage(body)) {
        return;
      }
      if (await handleSdfViewerMessage(body)) {
        return;
      }
      if (body?.type === "generate3dGridSelection") {
        const molecules = Array.isArray(body.molecules) ? body.molecules : [];
        const title = typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : "selected-3d-molecules.sdf";
        const reply = (type: "gridGenerate3DStarted" | "gridGenerate3DFinished" | "gridGenerate3DError", payload: Record<string, unknown> = {}) => {
          postMessageToViewerSource(event.source, {
            source: "burrete-grid-host",
            body: { type, ...payload },
          });
        };
        if (!molecules.length) {
          reply("gridGenerate3DError", { error: "Select one or more molecules before generating 3D." });
          pushStatus("Select one or more molecules before generating 3D.", "error");
          return;
        }
        reply("gridGenerate3DStarted");
        void (async () => {
          const generatedTexts: string[] = [];
          const errors: string[] = [];
          for (const molecule of molecules) {
            const item = molecule && typeof molecule === "object" ? molecule as Record<string, unknown> : {};
            const itemTitle = typeof item.title === "string" && item.title.trim() ? item.title.trim() : "molecule.smi";
            const extension = typeof item.extension === "string" && item.extension.trim() ? item.extension.trim() : pathExtension(itemTitle);
            const textBase64 = typeof item.textBase64 === "string" ? item.textBase64.trim() : "";
            if (!textBase64) {
              errors.push(`${itemTitle}: empty structure text`);
              continue;
            }
            try {
              const bytes = Uint8Array.from(atob(textBase64), (char) => char.charCodeAt(0));
              const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
              const request = {
                title: itemTitle,
                extension,
                text,
                ...conformerGenerationPreferences(preferences),
                mode: "single" as const,
                source3d: null,
              };
              const conformer = isTauriRuntime()
                ? await invoke<ConformerGenerationResult>("generate_3d_conformer", { request })
                : await generateBrowserDev3DConformer(request);
              generatedTexts.push(generated3DPoseSetText(text, extension, conformer.text, "single").trimEnd());
            } catch (error) {
              errors.push(`${itemTitle}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          if (!generatedTexts.length) {
            throw new Error(errors.length ? errors.join("; ") : "3D generation did not return any structures.");
          }
          const text = `${generatedTexts.join("\n")}\n`;
          const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
          const generatedDocument = isTauriRuntime()
            ? await invoke<ViewerDocument>("open_text_structure", {
                request: { title, extension: "sdf", text },
                preferences: molstarPreferences,
                reloadOptions: {},
              })
            : await openBrowserDevTextDocument(
                title,
                "sdf",
                text,
                molstarPreferences,
                {},
              );
          openDocumentsInActiveTab([generatedDocument]);
          rememberRecentStructures([generatedDocument]);
          const suffix = errors.length ? ` ${errors.length} failed.` : "";
          pushStatus(`Generated 3D for ${generatedTexts.length} molecule${generatedTexts.length === 1 ? "" : "s"} and opened it in Molstar.${suffix}`);
        })()
          .catch((error) => {
            reply("gridGenerate3DError", { error: error instanceof Error ? error.message : String(error) });
            pushErrorStatus(error, "Grid 3D generation failed");
          })
          .finally(() => reply("gridGenerate3DFinished"));
        return;
      }
      if (handleViewerConformerMessage(body, event.source)) {
        return;
      }
      if (body?.type === "openMolstarContextDocument") {
        if (body.contextDocument && typeof body.contextDocument === "object") {
          pushStatus("Opening selected Molstar context...");
          const contextDocument = body.contextDocument;
          const requestedMolstarStyle = normalizeMolstarStylePreference(body.molstarStyle);
          const molstarPreferences = {
            ...preferences,
            rendererMode: "molstar" as const,
            molstarStyle: requestedMolstarStyle ?? preferences.molstarStyle,
          };
          const openContextDocument = async () => {
            if (!isTauriRuntime()) return openBrowserDevMolstarContextDocument(contextDocument, molstarPreferences);
            const entries = (contextDocument.entries ?? []).filter((entry): entry is MolstarContextEntry & { data: string } => (
              typeof entry?.data === "string" && entry.data.length > 0
            ));
            if (entries.length !== 1) {
              throw new Error("Native Molstar context view supports one inline structure at a time.");
            }
            const entry = entries[0];
            const extension = molstarContextEntryExtension(entry.format);
            const label = contextDocument.label?.trim() || entry.label?.trim() || "Molstar context";
            return invoke<ViewerDocument>("open_text_structure", {
              request: {
                title: `${label}.${extension}`,
                extension,
                text: entry.data,
              },
              preferences: molstarPreferences,
              reloadOptions: {},
            });
          };
          void openContextDocument()
            .then((document) => {
              addDocuments([document]);
              rememberRecentStructures([document]);
              pushStatus("Opened selected Molstar context");
            })
            .catch((error) => pushErrorStatus(error, "Molstar context view failed"));
          return;
        }
        const targetDocument = (body.documentId
          ? documents.find((document) => document.id === body.documentId)
          : null) ?? activeDocument;
        if (targetDocument?.dockingRequest) {
          pushStatus("Opening separate Molstar docking view...");
          void openDockingDocument(targetDocument.dockingRequest.receptorPath, targetDocument.dockingRequest.ligandPaths);
        } else if (targetDocument?.path && !targetDocument.virtual) {
          pushStatus("Opening separate Molstar view...");
          void openDocuments([targetDocument.path], undefined, { rendererMode: "molstar" }, { inActiveTab: true });
        } else {
          pushStatus("This virtual structure cannot be opened separately.", "error");
        }
        return;
      }
      if (handleKetcherViewerMessage(body)) {
        return;
      }
      if (handleRendererMessage(body)) {
        return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [activeDocument, addBackgroundDocuments, addDocuments, documents, handleDockingPoseMessage, handleGridControlMessage, handleGridFileMessage, handleGridRuntimeMessage, handleKetcherViewerMessage, handleRendererMessage, handleSdfViewerMessage, handleViewerConformerMessage, handleViewerFileMessage, handleViewerHostMessage, handleViewerRuntimeFileMessage, handleViewerRuntimeMessage, handleViewerStateMessage, handleXyzrenderSheetMessage, markViewerFirstRenderMessage, notifyGridPoseReviewSelection, openCommandPalette, openDockingDocument, openDocuments, openDocumentsInActiveTab, openPoseReviewWorkspace, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, reloadActive, setPreference, toggleSidebar]);

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

  const actions = useMemo<ShellActions>(() => ({
    chooseFiles,
    openStructurePaths: async (paths: string[], options?: { mode?: OpenDocumentsMode }) => {
      await openDocuments(paths, undefined, undefined, options);
    },
    openTextPaths: async (paths: string[]) => {
      await openTextDocuments(paths);
    },
    openPaths,
    openStructureRecords,
    openRecentStructure,
    openMostRecentStructure,
    selectDocument,
    selectTab: setActiveTab,
    openNewTab,
    canNavigateBack,
    canNavigateForward,
    navigateBack,
    navigateForward,
    focusSidebarSearch,
    openCommandPalette,
    openClipboard,
    openNewWindow,
    openSettings,
    openSettingsSection,
    backToApp,
    openKetcher,
    openKetcherWithStructures,
    openKetcherExportRaw,
    saveKetcherExportFile,
    openFepNetworkPreview,
    applyKetcherToGridRow,
    openFepSetupWorkspace,
    openKetcherSketch,
    openDescriptorSource,
    clearDescriptorSource,
    applyGridDescriptorControls,
    applyGridDescriptorResults,
    calculateGridDescriptors,
    checkConformerStatus,
    runConformerOperation,
    cancelConformerJob,
    clearConformerJobs: () => {
      setConformerJobs([]);
      pushStatus("Job history cleared");
    },
    setConformerSettings,
    checkXtbStatus,
    installXtb,
    runXtbActiveOperation,
    runXtbJob,
    cancelXtbJob,
    runXtbKetcherSketch,
    runXtbGridScoring,
    runXtbPoseRefinement,
    runXtbFepPreflight,
    clearXtbJobs: () => {
      setXtbJobs([]);
      pushStatus("xTB job history cleared");
    },
    setXtbSettings,
    saveKetcherDraft,
    clearKetcherImportRequest,
    moveTab,
    chooseWorkspace,
    openWorkspaceFolder,
    openProjectFolder,
    togglePinnedProjectRoot: (root: string) => {
      togglePinnedProjectRoot(root);
      pushStatus("Project pin updated");
    },
    renameProjectRoot: (root: string, name: string) => {
      renameProjectRoot(root, name);
      pushStatus(name.trim() ? "Project renamed" : "Project name reset");
    },
    removeProjectRoot: (root: string) => {
      removeProjectRoot(root);
      pushStatus("Project removed");
    },
    toggleSidebar,
    toggleDock,
    toggleDockTab,
    setDockOpen,
    setDockSize,
    openDockTab,
    closeDockTab,
    setDockActiveTab,
    setDockDocument,
    setDockTool,
    addDockDrop: (input) => {
      addDockDrop(input);
      const count = input.payload.paths.length + input.payload.records.length + (input.payload.items?.length ?? 0);
      const target = input.area === "right" ? "right dock" : "bottom dock";
      pushStatus(`Added ${count} item${count === 1 ? "" : "s"} to ${target}`);
    },
    openDockPayload,
    toggleProjectsOpen,
    setExpandedProjectIds,
    setSidebarQuery,
    toggleProjectExpanded,
    togglePinnedStructure,
    closeDocument: (id: string) => {
      if (!confirmDiscardDirtyGridDocument(id)) return;
      closeGridRuntime(id);
      forgetDirtyGridDocument(id);
      closeDocument(id);
    },
    closeTab: (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      const documentIds: string[] = [];
      if (tab?.location.kind === "file") {
        const location = tab.location;
        const document = documents.find((candidate) => (
          candidate.id === location.documentId ||
          candidate.path === location.path
        ));
        const targetDocumentId = document?.id ?? location.documentId ?? null;
        if (targetDocumentId) documentIds.push(targetDocumentId);
        if (!confirmDiscardDirtyGridDocuments(documentIds)) return;
        closeGridRuntime(targetDocumentId);
      }
      if (documentIds.length > 0) {
        forgetDirtyGridDocuments(documentIds);
      }
      closeTab(id);
    },
    closeActiveDocument: () => {
      if (!confirmDiscardDirtyGridDocument(activeDocument?.id)) return;
      closeGridRuntime(activeDocument?.id);
      forgetDirtyGridDocument(activeDocument?.id);
      closeActiveDocument();
      pushStatus("Closed active tab");
    },
    clearAllDocuments: () => {
      if (!confirmDiscardDirtyGridDocuments(documents.map((document) => document.id))) return;
      for (const document of documents) closeGridRuntime(document.id);
      clearDirtyGridDocuments();
      closeAllDocuments();
      pushStatus("Closed all tabs");
    },
    openDockingDocument,
    openDockingStructureRecords,
    appendGridRecords,
    addXyzrenderSheetItems: addXyzrenderSheetItemsToDocument,
    mergeMoleculeCollections,
    saveMoleculeCollectionAs,
    listChemicalEditorTargets,
    openPathInChemicalEditor,
    openPathWithDefaultApp,
    revealActiveDocument,
    revealDocument,
    revealPath,
    copyActiveDocumentPath,
    copyDocumentPath,
    copyPath,
    showActiveDocumentMetadata,
    showDocumentMetadata,
    showTextFileMetadata,
    closeQuickLookPreview,
    generate3DConformer,
    runStructureViewerAction,
    reloadXyzrenderDocument,
    selectTextStructure,
    exportActivePreviewAsPng,
    exportActivePreviewAsSvg,
    setStructureDragActive,
    clearRecentStructures: () => {
      clearRecentStructures();
      pushStatus("Recent structures cleared");
    },
    clearCache,
    resetQuickLook,
    openLogs,
    exportDiagnostics,
    checkForUpdates: async () => {
      await checkForUpdates(false);
    },
    installUpdate: async () => {
      await installUpdate();
    },
    openUpdateRelease,
    setPreference,
    setUpdatePreferences,
  }), [activeDocument, addDockDrop, addXyzrenderSheetItemsToDocument, appendGridRecords, applyGridDescriptorControls, applyGridDescriptorResults, applyKetcherToGridRow, backToApp, calculateGridDescriptors, canNavigateBack, canNavigateForward, checkForUpdates, chooseFiles, chooseWorkspace, clearCache, clearDescriptorSource, clearDirtyGridDocuments, clearKetcherImportRequest, clearRecentStructures, closeActiveDocument, closeAllDocuments, closeDocument, closeDockTab, closeGridRuntime, closeQuickLookPreview, closeTab, confirmDiscardDirtyGridDocument, confirmDiscardDirtyGridDocuments, copyActiveDocumentPath, copyDocumentPath, copyPath, documents, exportActivePreviewAsPng, exportActivePreviewAsSvg, exportDiagnostics, focusSidebarSearch, forgetDirtyGridDocument, forgetDirtyGridDocuments, generate3DConformer, installUpdate, listChemicalEditorTargets, mergeMoleculeCollections, moveTab, navigateBack, navigateForward, openClipboard, openCommandPalette, openDescriptorSource, openDockingDocument, openDockingStructureRecords, openDockPayload, openDockTab, openDocuments, openFepNetworkPreview, openFepSetupWorkspace, openKetcher, openKetcherExportRaw, openKetcherSketch, openKetcherWithStructures, openLogs, openMostRecentStructure, openNewTab, openNewWindow, openPathInChemicalEditor, openPathWithDefaultApp, openPaths, openProjectFolder, openRecentStructure, openSettings, openSettingsSection, openStructureRecords, openTextDocuments, openUpdateRelease, openWorkspaceFolder, pushErrorStatus, pushStatus, reloadXyzrenderDocument, removeProjectRoot, renameProjectRoot, resetQuickLook, revealActiveDocument, revealDocument, revealPath, runStructureViewerAction, saveKetcherDraft, saveKetcherExportFile, saveMoleculeCollectionAs, selectDocument, selectTextStructure, setActiveTab, setDockActiveTab, setDockDocument, setDockOpen, setDockSize, setDockTool, setExpandedProjectIds, setPreference, setSidebarQuery, setUpdatePreferences, showActiveDocumentMetadata, showDocumentMetadata, showTextFileMetadata, tabs, toggleDock, toggleDockTab, togglePinnedProjectRoot, togglePinnedStructure, toggleProjectExpanded, toggleProjectsOpen, toggleSidebar]);

  const page = activeTab?.location.kind === "settings" ? "settings" : "viewer";

  const state: ShellViewState = {
    documents,
    textDocuments,
    tabs,
    activeTab,
    activeTabId,
    activeDocument,
    activeDocumentId: activeDocument?.id ?? null,
    quickLookDocument,
    quickLookError,
    quickLookStandalone,
    visibleDocuments: documents,
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
    viewerLigandSelection: activeDocument ? viewerLigandSelections[activeDocument.id] ?? null : null,
    xtbStatus,
    xtbSettings,
    xtbJobs,
    update,
    buildInfo,
  };

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

function replaceMolstarStructureInPlace(
  sourceDocument: ViewerDocument,
  generatedDocument: ViewerDocument,
  conformer: ConformerGenerationResult,
  pendingReplacements: Map<string, PendingMolstarReplaceResolver>,
  molstarStyle: MolstarStylePreference,
) {
  if (sourceDocument.renderer !== "molstar") return Promise.resolve(false);
  const iframe = activeViewerIframeForDocument(sourceDocument.id);
  if (!iframe?.contentWindow) return Promise.resolve(false);
  const requestId = `molstar-replace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => {
      pendingReplacements.delete(requestId);
      resolve(false);
    }, 8000);
    pendingReplacements.set(requestId, (ok) => {
      window.clearTimeout(timeout);
      resolve(ok);
    });
    try {
      iframe.contentWindow?.postMessage({
        source: "burrete-host",
        body: {
          type: "replaceMolstarStructure",
          requestId,
          documentId: sourceDocument.id,
          title: conformer.title,
          extension: conformer.extension,
          path: generatedDocument.path,
          byteCount: new TextEncoder().encode(conformer.text).byteLength,
          textBase64: textToBase64(conformer.text),
          method: conformer.method,
          molstarStyle,
        },
      }, "*");
    } catch {
      window.clearTimeout(timeout);
      pendingReplacements.delete(requestId);
      resolve(false);
    }
  });
}

function conformerOutputDirectory(document: ViewerDocument) {
  const sourcePath = document.sourcePath?.trim() || (!document.virtual ? document.path : "");
  if (!sourcePath || /^[a-z][a-z0-9+.-]*:/iu.test(sourcePath)) return null;
  return parentDirectory(sourcePath);
}

function countXyzFrames(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let index = 0;
  let frames = 0;
  while (index < lines.length && frames < 100000) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    const atomCount = Number.parseInt(lines[index]?.trim().split(/\s+/u)[0] ?? "", 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) break;
    if (index + atomCount + 1 >= lines.length) break;
    const atomLines = lines.slice(index + 2, index + 2 + atomCount);
    if (atomLines.length !== atomCount || atomLines.some((line) => !line.trim())) break;
    frames += 1;
    index += atomCount + 2;
  }
  return frames;
}

function isXtbOptimizationTrajectoryLogPath(path: string) {
  return (path.split(/[\\/]/).filter(Boolean).pop() ?? "").toLowerCase() === "xtbopt.log";
}

function xtbInputRequestForDocument(document: ViewerDocument): Pick<XtbRunRequest, "inputPath" | "inputText" | "inputExtension" | "sourcePath" | "label"> | null {
  if (document.virtual && !isTauriRuntime()) {
    const text = readBrowserDevVirtualTextDocument(document.path);
    if (text === null) return null;
    return {
      inputText: text,
      inputExtension: document.extension || structureExtensionFromPath(document.path),
      sourcePath: document.sourcePath ?? null,
      label: document.title,
    };
  }
  return {
    inputPath: document.path,
    sourcePath: document.sourcePath ?? null,
    label: document.title,
  };
}

function xtbInputRequestForMolstarContextDocument(
  contextDocument: MolstarContextDocument | null | undefined,
  sourcePath: string | null | undefined,
): Pick<XtbRunRequest, "inputText" | "inputExtension" | "sourcePath" | "label"> | null {
  const entry = (contextDocument?.entries ?? []).find((candidate): candidate is MolstarContextEntry & { data: string } => (
    typeof candidate?.data === "string" && candidate.data.trim().length > 0
  ));
  if (!entry) return null;
  return {
    inputText: entry.data,
    inputExtension: molstarContextEntryExtension(entry.format),
    sourcePath: sourcePath ?? null,
    label: contextDocument?.label?.trim() || entry.label?.trim() || "Molstar selection",
  };
}

type SelectedConformerInput = {
  title: string;
  extension: string;
  text: string;
};

async function selectedPdbLigandConformerInput(
  document: ViewerDocument,
  action: StructureViewerAction,
): Promise<SelectedConformerInput | null> {
  if (action.type !== "focus_ligand") return null;
  const extension = document.extension.toLowerCase();
  if (extension !== "pdb" && extension !== "pdbqt" && extension !== "ent") return null;
  const comp = selectorText(action.selector, "label_comp_id") ?? selectorText(action.selector, "auth_comp_id");
  const chain = selectorText(action.selector, "auth_asym_id") ?? selectorText(action.selector, "label_asym_id");
  const seq = selectorText(action.selector, "auth_seq_id") ?? selectorText(action.selector, "label_seq_id");
  const icode = selectorText(action.selector, "pdbx_PDB_ins_code");
  if (!comp || !chain || !seq) return null;
  const sourceText = await readStructureText(document.sourcePath ?? document.path);
  const records = sourceText.split(/\r?\n/u).filter((line) => pdbAtomLineMatchesLigand(line, comp, chain, seq, icode));
  if (records.length === 0) return null;
  const ligandCode = comp.toUpperCase();
  const title = [ligandCode, chain, seq].filter(Boolean).join(" ");
  const selectorSummary = [ligandCode, chain, seq + (icode ?? "")].filter(Boolean).join(" ");
  const text = [
    `${ligandCode} PDB ligand selection`,
    `REMARK PDB ligand selection from ${document.title}`,
    `REMARK Selected ${selectorSummary}`,
    ...records,
    "END",
    "",
  ].join("\n");
  return { title, extension: "pdb", text };
}

function conformerInputForMolstarContextDocument(
  contextDocument: MolstarContextDocument | null | undefined,
): SelectedConformerInput | null {
  const entry = (contextDocument?.entries ?? []).find((candidate): candidate is MolstarContextEntry & { data: string } => (
    typeof candidate?.data === "string" && candidate.data.trim().length > 0
  ));
  if (!entry) return null;
  return {
    title: contextDocument?.label?.trim() || entry.label?.trim() || "Molstar selection",
    extension: molstarContextEntryExtension(entry.format),
    text: entry.data,
  };
}

function pdbAtomLineMatchesLigand(line: string, comp: string, chain: string, seq: string, icode: string | null) {
  const record = line.slice(0, 6).trim();
  if (record !== "ATOM" && record !== "HETATM") return false;
  const lineComp = line.slice(17, 20).trim().toUpperCase();
  const lineChain = line.slice(21, 22).trim() || "-";
  const lineSeq = line.slice(22, 26).trim();
  const lineIcode = line.slice(26, 27).trim();
  return lineComp === comp.toUpperCase()
    && lineChain === chain
    && lineSeq === seq
    && (icode ? lineIcode === icode : true);
}

function selectorText(
  selector: Record<string, string | number | Array<string | number>>,
  key: string,
) {
  const value = selector[key];
  if (Array.isArray(value) || value === undefined || value === null) return null;
  return String(value);
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
