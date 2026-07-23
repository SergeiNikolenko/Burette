import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { AppLayout } from "./components/app-layout";
import type { StructureOverlayMode, ViewerLigandSelection } from "./components/types";
import { WindowTitle } from "./components/window-title";
import {
  useCloseCommandPalette,
  useCommandPaletteSearch,
  useIsCommandPaletteOpen,
  useOpenCommandPalette,
  useSetCommandPaletteSearch,
} from "./hooks/use-command-palette";
import { useAppActiveTextDocument } from "./hooks/use-app-active-text-document";
import { useAppBrowserDevStartup } from "./hooks/use-app-browser-dev-startup";
import { useAppChemistryJobs } from "./hooks/use-app-chemistry-jobs";
import { useAppConformerWorkflows } from "./hooks/use-app-conformer-workflows";
import { useAppDescriptors } from "./hooks/use-app-descriptors";
import { useAppDiagnostics } from "./hooks/use-app-diagnostics";
import { useAppDockActions } from "./hooks/use-app-dock-actions";
import { useAppDirtyGridDocuments } from "./hooks/use-app-dirty-grid-documents";
import { useAppDockingPoseSelection } from "./hooks/use-app-docking-pose-selection";
import { useAppDockingWorkflows } from "./hooks/use-app-docking-workflows";
import { useAppDockPayloadOpen } from "./hooks/use-app-dock-payload-open";
import { useAppDropActions } from "./hooks/use-app-drop-actions";
import { useAppFileActions } from "./hooks/use-app-file-actions";
import { useAppFileOpen } from "./hooks/use-app-file-open";
import { useAppFepWorkflows } from "./hooks/use-app-fep-workflows";
import { useAppGenerate3DConformer } from "./hooks/use-app-generate-3d-conformer";
import { useAppGridWorkflows } from "./hooks/use-app-grid-workflows";
import { useGridNativeMenuState } from "./hooks/use-grid-native-menu-state";
import { useAppHostRuntimeOperations } from "./hooks/use-app-host-runtime-operations";
import { useAgentFocusLayout } from "./hooks/use-agent-focus-layout";
import { useHostedMcpWidget } from "./hooks/use-hosted-mcp-widget";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useAppKetcherActions } from "./hooks/use-app-ketcher-actions";
import { useAppMaintenance } from "./hooks/use-app-maintenance";
import { useAppNativeMenu } from "./hooks/use-app-native-menu";
import { useAppMolstarActionSenders } from "./hooks/use-app-molstar-action-senders";
import { useAppMolstarXtbContext } from "./hooks/use-app-molstar-xtb-context";
import { useAppOpenActions } from "./hooks/use-app-open-actions";
import { useAppOpenDropController } from "./hooks/use-app-open-drop-controller";
import { useAppPreferenceEffects } from "./hooks/use-app-preference-effects";
import { useAppQuickLook } from "./hooks/use-app-quick-look";
import { useAppQuickLookDocumentOpen } from "./hooks/use-app-quick-look-document-open";
import { useAppSidebarProjects } from "./hooks/use-app-sidebar-projects";
import { useAppShellActions } from "./hooks/use-app-shell-actions";
import { useAppShellNavigationActions } from "./hooks/use-app-shell-navigation-actions";
import { useAppShellViewState } from "./hooks/use-app-shell-view-state";
import { useAppSpectrumDockLifecycle } from "./hooks/use-app-spectrum-dock-lifecycle";
import { useAppStartupEffects } from "./hooks/use-app-startup-effects";
import { useAppStatus } from "./hooks/use-app-status";
import { useAppUpdates } from "./hooks/use-app-updates";
import { useAppViewerBridgeController } from "./hooks/use-app-viewer-bridge-controller";
import { useAppViewerReloadActions } from "./hooks/use-app-viewer-reload-actions";
import { useAppViewerRuntimeRefs } from "./hooks/use-app-viewer-runtime-refs";
import { useAppWorkspaceActions } from "./hooks/use-app-workspace-actions";
import { useAppXtbWorkflows } from "./hooks/use-app-xtb-workflows";
import { useSourceEditingController } from "./hooks/use-source-editing";
import { SourceEditingProvider } from "./lib/source-editing/context";
import { useDockLayout } from "./hooks/use-dock-layout";
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
  useReplaceDocument,
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
import { expandBrowserDevStructureBundles } from "./lib/browser-dev-structure-bundles";
import { writeClipboardText } from "./lib/clipboard";
import { detectContentSpectrumPaths } from "./lib/content-spectrum-detection";
import { structureExtensionFromPath } from "./lib/file-routing";
import { isHostedKetcherWidget, isHostedMcpWidget } from "./lib/hosted-mcp-widget";
import type { StructureDragPayload } from "./lib/structure-drag";
import { activeViewerIframeForDocument, isKnownViewerMessageSource } from "./lib/viewer-bridge";
import { trackWebDemoScreenView, trackWebDemoStructureView } from "./lib/web-demo-analytics";
import {
  configureWorkspaceHistoryExtras,
  useWorkspaceHistoryStore,
} from "./stores/workspace-history-store";

const CommandPalette = lazy(() => import("./components/command-palette").then((module) => ({
  default: module.CommandPalette,
})));

export default function App() {
  useAgentFocusLayout();
  const hostedMcpWidget = isHostedMcpWidget();
  const preferences = useViewerPreferences();
  const setPreference = useSetViewerPreference();
  const tabs = useOpenTabs();
  const documents = useOpenDocuments();
  const textDocuments = useOpenTextDocuments();
  const activeTabId = useActiveTabId();
  const activeTab = useActiveTab();
  const activeDocument = useActiveDocument();
  useEffect(() => {
    trackWebDemoScreenView(activeTab?.location.kind, activeDocument?.renderer);
  }, [activeDocument?.renderer, activeTab?.id, activeTab?.location.kind]);
  useEffect(() => {
    if (!activeDocument) return;
    trackWebDemoStructureView(activeDocument.extension, activeDocument.renderer);
  }, [activeDocument?.id, activeDocument?.extension, activeDocument?.renderer]);
  const addBackgroundDocuments = useAddBackgroundDocuments();
  const addBackgroundTextDocuments = useAddBackgroundTextDocuments();
  const addDocuments = useAddTabs();
  const addTextDocuments = useAddTextTabs();
  const openDocumentsInActiveTab = useOpenDocumentsInActiveTab();
  const openTextDocumentsInActiveTab = useOpenTextDocumentsInActiveTab();
  const setDocuments = useSetDocuments();
  const openNewTab = useOpenNewTab();
  const openKetcherTab = useOpenKetcherTab();
  const hostedKetcherWidget = isHostedKetcherWidget();
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
  const replaceDocument = useReplaceDocument();
  const clearRecentStructures = useClearRecentStructures();
  const setActiveTab = useSetActiveTab();
  const setActiveDocument = useSetActiveDocument();
  const closeTab = useCloseTab();
  const closeDocument = useCloseDocument();
  const closeActiveDocument = useCloseActiveTab();
  const closeAllDocuments = useCloseAllTabs();

  useEffect(() => {
    if (!hostedKetcherWidget || activeTab?.location.kind === "ketcher") return;
    openKetcherTab();
  }, [activeTab?.location.kind, hostedKetcherWidget, openKetcherTab]);
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
    renameProjectFolder,
    removeProjectRoot,
    togglePinnedStructure,
    pruneSidebarPaths,
    setSidebarQuery,
    toggleProjectExpanded,
    toggleSidebar,
    closeSidebar,
  } = useSidebar();
  const beginWorkspaceHistoryGroup = useWorkspaceHistoryStore((state) => state.beginHistoryGroup);
  const commitWorkspaceHistoryGroup = useWorkspaceHistoryStore((state) => state.commitHistoryGroup);
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
  const { toggleDockTab } = useAppDockActions({
    bottomDockActiveTab,
    bottomDockOpen,
    openDockTab,
    rightDockActiveTab,
    rightDockOpen,
    setDockOpen,
  });
  useAppSpectrumDockLifecycle({
    activeDocument,
    bottomDockActiveTab,
    bottomDockDocumentId,
    bottomDockTabs,
    closeDockTab,
    documents,
    rightDockActiveTab,
    rightDockDocumentId,
    setDockActiveTab,
    setDockDocument,
    setDockOpen,
  });

  const [structureDragActive, setStructureDragActiveState] = useState(false);
  const setStructureDragActive = useCallback((active: boolean) => {
    setStructureDragActiveState(active);
    if (typeof document === "undefined") return;
    const shell = document.querySelector<HTMLElement>(".app-shell");
    if (!shell) return;
    if (active) shell.dataset.structureDragActive = "true";
    else delete shell.dataset.structureDragActive;
  }, []);
  const { status, pushStatus, pushErrorStatus, clearStatus, recentErrorsRef } = useAppStatus();
  const {
    clearDirtyGridDocuments,
    confirmDiscardAllDirtyGridDocuments,
    confirmDiscardDirtyGridDocument,
    confirmDiscardDirtyGridDocuments,
    forgetDirtyGridDocument,
    forgetDirtyGridDocuments,
    getWindowDocumentDirtySnapshot: getGridWindowDocumentDirtySnapshot,
    hasDirtyGridDocuments,
    isDirtyGridDocument,
    updateDirtyGridDocument,
  } = useAppDirtyGridDocuments();
  const { activeGridMenuState, updateGridMenuState } = useGridNativeMenuState(activeDocument, documents);
  const [poseReviewSelections, setPoseReviewSelections] = useState<Record<string, number>>({});
  const [viewerLigandSelections, setViewerLigandSelections] = useState<Record<string, ViewerLigandSelection | null>>({});
  const [structureOverlayModes, setStructureOverlayModes] = useState<Record<string, StructureOverlayMode>>({});
  const {
    cancelConformerJob,
    cancelXtbJob,
    cancelledConformerJobIdsRef,
    cancelledXtbJobIdsRef,
    checkConformerStatus,
    checkXtbStatus,
    chooseXtbExecutable,
    clearXtbExecutableSelection,
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
  } = useAppUpdates({
    enabled: !hostedMcpWidget,
    pushErrorStatus,
    pushStatus,
  });
  useEffect(() => {
    configureWorkspaceHistoryExtras({
      capture: () => ({
        conformerSettings,
        updatePreferences: update.preferences,
        xtbSettings,
      }),
      restore: (extras) => {
        const values = extras as {
          conformerSettings?: typeof conformerSettings;
          updatePreferences?: typeof update.preferences;
          xtbSettings?: typeof xtbSettings;
        };
        if (values.conformerSettings) setConformerSettings(values.conformerSettings);
        if (values.updatePreferences) setUpdatePreferences(values.updatePreferences);
        if (values.xtbSettings) setXtbSettings(values.xtbSettings);
      },
    });
    return () => configureWorkspaceHistoryExtras({});
  }, [
    conformerSettings,
    setConformerSettings,
    setUpdatePreferences,
    setXtbSettings,
    update.preferences,
    xtbSettings,
  ]);
  const {
    clearCache,
    openLogs,
    openNewWindow,
    resetQuickLook,
    runExternalRuntimeDoctor,
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
    pushStatus,
  });
  const {
    pendingViewerReloadOptionsRef,
    pendingViewerReloadDocumentIdRef,
    pendingMolstarReplaceRef,
    xyzrenderOrientationRefRef,
    skipNextPreferenceRefreshRef,
  } = useAppViewerRuntimeRefs();
  const commandPaletteOpen = useIsCommandPaletteOpen();
  const commandPaletteQuery = useCommandPaletteSearch();
  const openCommandPalette = useOpenCommandPalette();
  const closeCommandPalette = useCloseCommandPalette();
  const setCommandPaletteQuery = useSetCommandPaletteSearch();

  const { requestMolstarXtbContextDocument } = useAppMolstarXtbContext({
    activeViewerIframeForDocument,
    isKnownViewerMessageSource,
  });

  const {
    browserDevExplicitFolders,
    browserDevHasExplicitWorkspaceQuery,
    browserDevQuickLookPath,
  } = useAppBrowserDevStartup();
  const { openQuickLookDocument } = useAppQuickLookDocumentOpen({ preferences });
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
  const {
    activeProject,
    setWorkspacePath,
    sidebarProjects,
    workspacePath,
  } = useAppSidebarProjects({
    activeDocumentId: activeDocument?.id ?? null,
    browserDevExplicitFolders,
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

  const activeTextDocument = useAppActiveTextDocument({ activeTab, textDocuments });
  const sourceEditing = useSourceEditingController({
    activeDocument,
    preferences,
    pushErrorStatus,
    setDockActiveTab,
    setDockOpen,
  });
  const activeSourceSession = sourceEditing.sessionForDocument(activeDocument);
  const sourceSaveEnabled = Boolean(activeDocument
    && activeSourceSession?.editable
    && activeSourceSession.dirty
    && !activeSourceSession.saving
    && !activeSourceSession.saveDisabledReason);
  const saveActiveSource = useCallback(async () => {
    if (!activeDocument) return;
    const session = sourceEditing.sessionForDocument(activeDocument);
    if (!session?.editable || !session.dirty || session.saving || session.saveDisabledReason) return;
    await sourceEditing.save(activeDocument);
  }, [activeDocument, sourceEditing]);
  const confirmCloseWindow = useCallback(async () => {
    const sourceBefore = sourceEditing.getWindowDirtySnapshot();
    if (!await sourceEditing.confirmCloseWindow()) return null;
    const permit = await confirmDiscardAllDirtyGridDocuments();
    if (!permit) return null;
    try {
      const sourceAfter = sourceEditing.getWindowDirtySnapshot();
      if (sourceAfter.revision === sourceBefore.revision
        || await sourceEditing.confirmCloseWindow()) return permit;
      permit.release();
      return null;
    } catch (error) {
      permit.release();
      throw error;
    }
  }, [confirmDiscardAllDirtyGridDocuments, sourceEditing]);
  const combinedWindowDirtyRevisionRef = useRef({
    gridRevision: null as number | null,
    sourceRevision: null as number | null,
    revision: 0,
  });
  const getWindowDocumentDirtySnapshot = useCallback(() => {
    const gridSnapshot = getGridWindowDocumentDirtySnapshot();
    const sourceSnapshot = sourceEditing.getWindowDirtySnapshot();
    const combined = combinedWindowDirtyRevisionRef.current;
    if (combined.gridRevision !== gridSnapshot.revision
      || combined.sourceRevision !== sourceSnapshot.revision) {
      combined.gridRevision = gridSnapshot.revision;
      combined.sourceRevision = sourceSnapshot.revision;
      combined.revision += 1;
    }
    return {
      dirty: gridSnapshot.dirty || sourceSnapshot.dirty,
      revision: combined.revision,
      closeTransitionActive: sourceSnapshot.closeTransitionActive,
    };
  }, [getGridWindowDocumentDirtySnapshot, sourceEditing]);
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
    rebindSavedGridDocument,
    openStructureRecordDocuments,
    openStructureRecords,
    openStructureUrlInMolstar,
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
    replaceDocument,
    setActiveDocument,
    setDockActiveTab,
    setDockDocument,
    setDockOpen,
    setDocuments,
  });

  const openDockPayload = useAppDockPayloadOpen({
    addBackgroundDocuments,
    addBackgroundTextDocuments,
    addDockDrop,
    detectContentSpectrumPaths,
    documents,
    openStructureRecordDocuments,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    setDockDocument,
    setDockTool,
    textDocuments,
  });

  const {
    chooseFiles,
    fetchPdbStructure,
    openMostRecentStructure,
    openRecentStructure,
  } = useAppOpenActions({
    openPaths,
    openStructureRecords,
    pushErrorStatus,
    pushStatus,
    recentStructures,
  });
  useHostedMcpWidget({
    addDocuments,
    closeAllDocuments,
    preferences,
    pushErrorStatus,
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
    runXtbGridScoring,
    runXtbJob,
    runXtbKetcherSketch,
  } = useAppXtbWorkflows({
    activeDocument,
    addDockDrop,
    cancelledXtbJobIdsRef,
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

  const { notifyGridPoseReviewSelection } = useAppDockingPoseSelection();

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
    browserDevExplicitFolders,
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

  const { generate3DConformer, runMolecularCompute } = useAppGenerate3DConformer({
    activeViewerIframeForDocument,
    openDocumentsInActiveTab,
    pendingMolstarReplaceRef,
    openDocuments,
    openTextDocuments,
    openTextDocumentsInActiveTab,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
  });

  const {
    closeGridRuntime,
    exportActivePreviewAsPng,
    exportActivePreviewAsSvg,
    writeGridPerfMetric,
  } = useAppHostRuntimeOperations({
    activeDocument,
    pushErrorStatus,
    pushStatus,
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

  const {
    backToApp,
    focusSidebarSearch,
    openSettings,
    openSettingsSection,
    selectDocument,
  } = useAppShellNavigationActions({
    activateLastNonSettingsTab,
    openSettingsSectionTab,
    openSettingsTab,
    setActiveDocument,
    sidebarOpen,
    toggleSidebar,
  });

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
    documents,
    isDirtyGridDocument,
    openDocuments,
    openDocumentsInActiveTab,
    openTextDocuments,
    openKetcherTab,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    setActiveDocument,
    setStructureDragActive,
    tabs,
    updateDirtyGridDocument,
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
    updateDirtyGridDocument,
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

  const {
    dropActive,
    dropPreview,
    handleBrowserDrag,
    handleBrowserDragLeave,
    handleBrowserDrop,
    handleBrowserPaste,
    openClipboard,
  } = useAppOpenDropController({
    activeDocument,
    activeTabId,
    activeTabKind: activeTab?.location.kind ?? null,
    openKetcherTab,
    addProjectRoots: addDroppedProjectRoots,
    addXyzrenderSheetItems,
    appendGridRecords,
    chooseDropAction,
    documents,
    fepSetupRequest: currentFepSetupRequest,
    mergeMoleculeCollections,
    openDockPayload,
    openDockingDocument,
    openDockingStructureRecords,
    openFepSetupWorkspace,
    openKetcherWithStructures,
    openPaths,
    openStructureRecords,
    openTextDocuments,
    pushErrorStatus,
    pushStatus,
    setDockDocument,
  });
  const { reloadActive, reloadXyzrenderDocument } = useAppViewerReloadActions({
    activeDocument,
    documents,
    openDocuments,
    pendingViewerReloadDocumentIdRef,
    pendingViewerReloadOptionsRef,
    xyzrenderOrientationRefRef,
  });
  useAppViewerBridgeController({
    activeDocument,
    addBackgroundDocuments,
    addDocuments,
    calculateGridDescriptors,
    closeGridRuntime,
    documents,
    forgetDirtyGridDocument,
    generate3DConformer,
    runMolecularCompute,
    notifyGridPoseReviewSelection,
    openDockingDocument,
    openDocuments,
    openTextDocuments,
    openDocumentsInActiveTab,
    openKetcherWithFragment,
    openKetcherWithStructures,
    openCommandPalette,
    openDockTab,
    openPoseReviewWorkspace,
    pendingMolstarReplaceRef,
    pendingViewerReloadDocumentIdRef,
    pendingViewerReloadOptionsRef,
    preferences,
    pushErrorStatus,
    pushStatus,
    rebindSavedGridDocument,
    reloadActive,
    rememberRecentStructures,
    setPreference,
    setPoseReviewSelections,
    setStructureOverlayModes,
    setViewerLigandSelections,
    skipNextPreferenceRefreshRef,
    toggleSidebar,
    updateDirtyGridDocument,
    updateGridMenuState,
    writeGridPerfMetric,
    xyzrenderOrientationRefRef,
  });
  useAppPreferenceEffects({
    activeTab,
    activeTabId,
    openDocuments,
    preferences,
    pushErrorStatus,
    setActiveTab,
    skipNextPreferenceRefreshRef,
  });

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
    chooseXtbExecutable,
    clearXtbExecutableSelection,
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
    confirmCloseSourceDocuments: sourceEditing.closeDocuments,
    copyActiveDocumentPath,
    copyDocumentPath,
    copyPath,
    documents,
    exportActivePreviewAsPng,
    exportActivePreviewAsSvg,
    exportDiagnostics,
    fetchPdbStructure,
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
    openStructureUrlInMolstar,
    openTextDocuments,
    openUpdateRelease,
    openWorkspaceFolder,
    pushErrorStatus,
    pushStatus,
    reloadXyzrenderDocument,
    removeProjectRoot,
    renameProjectRoot,
    renameProjectFolder,
    resetQuickLook,
    revealActiveDocument,
    revealDocument,
    revealPath,
    runConformerOperation,
    runExternalRuntimeDoctor,
    runStructureViewerAction,
    runXtbActiveOperation,
    runXtbGridScoring,
    runXtbJob,
    runXtbKetcherSketch,
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

  const state = useAppShellViewState({
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
    projectNameOverrides,
    pinnedStructurePaths,
    workspacePath,
    page,
    sidebarOpen,
    sidebarWidth,
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
    structureOverlayMode: activeDocument ? structureOverlayModes[activeDocument.id] ?? "single" : "single",
    xtbStatus,
    xtbSettings,
    xtbJobs,
    update,
    buildInfo,
  });

  useAppNativeMenu({
    state,
    actions,
    gridMenuState: activeGridMenuState,
    openDocuments,
    confirmCloseWindow,
    getWindowDocumentDirtySnapshot,
    windowDocumentDirty: hasDirtyGridDocuments || sourceEditing.hasUnsavedOrSavingSessions,
    sourceSaveEnabled,
    saveActiveSource,
  });

  useKeyboardShortcuts(
    state,
    actions,
    toggleSidebar,
    !commandPaletteOpen && !hostedMcpWidget,
  );

  return (
    <SourceEditingProvider value={sourceEditing}>
      <WindowTitle activeDocument={activeDocument} />
      <AppLayout
        state={state}
        actions={actions}
        onDismissStatus={clearStatus}
        onToggleSidebar={toggleSidebar}
        onSidebarWidthChange={setSidebarWidth}
        dropPreview={dropPreview}
        onDragEnter={handleBrowserDrag}
        onDragOver={handleBrowserDrag}
        onDragLeave={handleBrowserDragLeave}
        onDrop={handleBrowserDrop}
        onPaste={handleBrowserPaste}
      />
      {commandPaletteOpen && !hostedMcpWidget ? (
        <Suspense fallback={null}>
          <CommandPalette
            state={state}
            actions={actions}
            isOpen={commandPaletteOpen}
            query={commandPaletteQuery}
            onQueryChange={setCommandPaletteQuery}
            onClose={closeCommandPalette}
            onRunError={pushErrorStatus}
          />
        </Suspense>
      ) : null}
    </SourceEditingProvider>
  );
}
