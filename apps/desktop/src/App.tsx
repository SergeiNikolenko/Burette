import { Suspense, lazy, useRef, useState } from "react";
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
import { useAppDockingPoseMessages } from "./hooks/use-app-docking-pose-messages";
import { useAppDockingPoseSelection } from "./hooks/use-app-docking-pose-selection";
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
import { useAppHostRuntimeOperations } from "./hooks/use-app-host-runtime-operations";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useAppKetcherActions } from "./hooks/use-app-ketcher-actions";
import { useAppKetcherViewerMessages } from "./hooks/use-app-ketcher-viewer-messages";
import { useAppMaintenance } from "./hooks/use-app-maintenance";
import { useAppMolstarContextMessages } from "./hooks/use-app-molstar-context-messages";
import { useAppMolstarActionSenders } from "./hooks/use-app-molstar-action-senders";
import { useAppMolstarXtbContext } from "./hooks/use-app-molstar-xtb-context";
import { useAppOpenActions } from "./hooks/use-app-open-actions";
import { useAppOpenDropMergeCollections } from "./hooks/use-app-open-drop-merge-collections";
import { useAppPreferenceEffects } from "./hooks/use-app-preference-effects";
import { useAppResize } from "./hooks/use-app-resize";
import { useAppRendererMessage } from "./hooks/use-app-renderer-message";
import { useAppSidebarProjects } from "./hooks/use-app-sidebar-projects";
import { useAppSdfViewerMessages } from "./hooks/use-app-sdf-viewer-messages";
import { useAppShellActions } from "./hooks/use-app-shell-actions";
import { useAppShellNavigationActions } from "./hooks/use-app-shell-navigation-actions";
import { useAppShellViewState } from "./hooks/use-app-shell-view-state";
import { useAppStartupEffects } from "./hooks/use-app-startup-effects";
import { useAppStatus } from "./hooks/use-app-status";
import { useAppUpdates } from "./hooks/use-app-updates";
import { useAppViewerFileActions } from "./hooks/use-app-viewer-file-actions";
import { useAppViewerBridgeMessages } from "./hooks/use-app-viewer-bridge-messages";
import { useAppViewerConformerMessages } from "./hooks/use-app-viewer-conformer-messages";
import { useAppViewerHostMessages } from "./hooks/use-app-viewer-host-messages";
import { useAppViewerReloadActions } from "./hooks/use-app-viewer-reload-actions";
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
import { openBrowserDevMolstarContextDocument, openBrowserDevTextDocument } from "./lib/browser-dev-documents";
import { expandBrowserDevStructureBundles } from "./lib/browser-dev-structure-bundles";
import { writeClipboardText } from "./lib/clipboard";
import { detectContentSpectrumPaths } from "./lib/content-spectrum-detection";
import { isProteinLikeDockingSource } from "./lib/docking-documents";
import { structureExtensionFromPath } from "./lib/file-routing";
import type { StructureDragPayload } from "./lib/structure-drag";
import {
  activeViewerIframeForDocument,
  isKnownViewerMessageSource,
  postMessageToViewerSource,
} from "./lib/viewer-bridge";
import type { ViewerDocument, ViewerReloadOptions } from "./types";

const CommandPalette = lazy(() => import("./components/command-palette").then((module) => ({
  default: module.CommandPalette,
})));

type MolstarContextDocument = Parameters<typeof openBrowserDevMolstarContextDocument>[0];

export default function App() {
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
  const { toggleDockTab } = useAppDockActions({
    bottomDockActiveTab,
    bottomDockOpen,
    openDockTab,
    rightDockActiveTab,
    rightDockOpen,
    setDockOpen,
  });

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
  const [structureOverlayModes, setStructureOverlayModes] = useState<Record<string, StructureOverlayMode>>({});
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
    openDockTab,
    pushStatus,
  });
  const pendingViewerReloadOptionsRef = useRef<ViewerReloadOptions | null>(null);
  const pendingViewerReloadDocumentIdRef = useRef<string | null>(null);
  const pendingMolstarReplaceRef = useRef<Map<string, PendingMolstarReplaceResolver>>(new Map());
  const xyzrenderOrientationRefRef = useRef<string | null>(null);
  const skipNextPreferenceRefreshRef = useRef(false);
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
    browserDevExplicitFolder,
    browserDevHasExplicitWorkspaceQuery,
  } = useAppBrowserDevStartup();
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

  const activeTextDocument = useAppActiveTextDocument({ activeTab, textDocuments });
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
    setDockDocument,
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

  const {
    backToApp,
    focusSidebarSearch,
    openSettings,
    openSettingsSection,
    selectDocument,
  } = useAppShellNavigationActions({
    activateLastNonSettingsTab,
    openCommandPalette,
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
  const mergeDroppedMoleculeCollections = useAppOpenDropMergeCollections({
    activeDocument,
    mergeMoleculeCollections,
  });
  useAgentSession({
    activeDocument,
    documents,
    openTextDocuments,
    openPaths,
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
    mergeMoleculeCollections: mergeDroppedMoleculeCollections,
  });
  const { openClipboard } = useAppClipboard({ openClipboardText, pushErrorStatus, pushStatus });
  const { reloadActive, reloadXyzrenderDocument } = useAppViewerReloadActions({
    activeDocument,
    documents,
    openDocuments,
    pendingViewerReloadDocumentIdRef,
    pendingViewerReloadOptionsRef,
    xyzrenderOrientationRefRef,
  });
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
    setStructureOverlayModes,
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
    runExternalRuntimeDoctor,
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

  const state = useAppShellViewState({
    documents,
    textDocuments,
    tabs,
    activeTab,
    activeTabId,
    activeDocument,
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
    structureOverlayMode: activeDocument ? structureOverlayModes[activeDocument.id] ?? "single" : "single",
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
