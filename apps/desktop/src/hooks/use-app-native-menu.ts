import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ShellActions, ShellViewState, StructureViewerAction } from "../components/types";
import { canInspectConformerEnsemble } from "../lib/conformer-ensemble";
import { isMolstarViewerExtension } from "../lib/docking-documents";
import { isKetcherImportExtension } from "../lib/drop-actions";
import {
  EXIT_PREFLIGHT_EVENT,
  EXIT_TRANSITION_RESUMED_EVENT,
  type ExitPreflightRequest,
  type GridNativeMenuState,
  type NativeMenuCommand,
  type NativeMenuState,
  nextDocumentRegistryRevision,
} from "../lib/native-menu";
import {
  fileBackedViewerDocumentPath,
  isAbsoluteNativeFilePath,
  nativeOpenDocumentPaths,
} from "../lib/native-menu-paths";
import { isTauriRuntime, trackTauriListener } from "../lib/tauri";
import { activeViewerIframeForDocument } from "../lib/viewer-bridge";
import {
  resumeWindowMutations,
  sealWindowMutations,
  type WindowCloseMutationPermit,
} from "../lib/window-mutation-barrier";
import type { ViewerPreferences, ViewerReloadOptions } from "../types";
import { useMenuEvents } from "./use-menu-events";

const PROJECT_URL = "https://github.com/SergeiNikolenko/Burrete";
const GENERATE_3D_EXTENSIONS = new Set(["sdf", "sd", "mol", "smi", "smiles"]);
const DIRECT_XTB_EXTENSIONS = new Set(["sdf", "sd", "mol", "xyz", "pdb"]);
const CREST_OPENBABEL_EXTENSIONS = new Set(["sdf", "sd", "mol", "mol2", "pdb", "pdbqt", "ent", "cif", "mmcif", "mcif"]);
const MAX_RECENT_PATH_CHARS = 4096;
const MAX_RECENT_TITLE_CHARS = 512;

type OpenDocuments = (
  paths: string[],
  reloadOptions?: ViewerReloadOptions,
  preferences?: Partial<ViewerPreferences>,
  options?: { replace?: boolean; inActiveTab?: boolean },
) => void | Promise<unknown>;

type UseAppNativeMenuOptions = {
  state: ShellViewState;
  actions: ShellActions;
  gridMenuState: GridNativeMenuState | null;
  openDocuments: OpenDocuments;
  confirmCloseWindow: () => Promise<WindowCloseMutationPermit | null>;
  getWindowDocumentDirtySnapshot: () => {
    dirty: boolean;
    revision: number;
    closeTransitionActive: boolean;
  };
  windowDocumentDirty: boolean;
  sourceSaveEnabled: boolean;
  saveActiveSource: () => void | Promise<void>;
};

function postGridMenuCommand(documentId: string, command: string) {
  activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
    source: "burrete-grid-host",
    body: { type: "gridMenuCommand", command },
  }, "*");
}

async function openExternalUrl(url: string) {
  await invoke("open_external_url", { url });
}

export function useAppNativeMenu({
  state,
  actions,
  gridMenuState,
  openDocuments,
  confirmCloseWindow,
  getWindowDocumentDirtySnapshot,
  windowDocumentDirty,
  sourceSaveEnabled,
  saveActiveSource,
}: UseAppNativeMenuOptions) {
  const [shellEditingText, setShellEditingText] = useState(false);
  const activeDocument = state.activeDocument;
  const isGrid = activeDocument?.renderer === "grid2d";
  const extension = activeDocument?.extension.trim().toLowerCase().replace(/^\./u, "") ?? "";
  const activeDocumentFileBacked = Boolean(activeDocument
    && fileBackedViewerDocumentPath(activeDocument));
  const activeDocumentReadable = activeDocumentFileBacked;
  const activeTextTabFileBacked = state.activeTab?.location.kind === "text-file"
    && isAbsoluteNativeFilePath(state.activeTab.location.path);
  const selectedMoleculeCount = isGrid ? gridMenuState?.selectedStructureCount ?? 0 : 0;
  const activeTabClosable = Boolean(state.activeTab && state.activeTab.location.kind !== "launcher");
  const closableTabCount = state.tabs.filter((tab) => tab.location.kind !== "launcher").length;
  const activeLigandSelection = state.viewerLigandSelection?.documentId === activeDocument?.id
    ? state.viewerLigandSelection
    : null;
  const conformerSelection: StructureViewerAction | null = activeLigandSelection ? {
    type: "focus_ligand",
    label: activeLigandSelection.label,
    selector: activeLigandSelection.selector,
  } : null;
  const hasAvailableXtb = state.xtbStatus?.installed === true;
  const canOpenInMolstar = Boolean(activeDocument && (isGrid
    ? gridMenuState?.canOpenSelectedInMolstar
    : activeDocumentReadable
      && activeDocument.renderer !== "molstar"
      && isMolstarViewerExtension(extension)));
  const canEditInKetcher = Boolean(activeDocument && (isGrid
    ? gridMenuState?.canOpenSelectedInKetcher
    : activeDocumentReadable && isKetcherImportExtension(extension)));
  const canGenerate3d = Boolean(activeDocument && (isGrid
    ? gridMenuState?.canGenerate3dForSelection
    : activeDocumentReadable && GENERATE_3D_EXTENSIONS.has(extension)));
  const crestInputReady = extension === "xyz"
    || (CREST_OPENBABEL_EXTENSIONS.has(extension)
      && state.conformerStatus?.openbabel?.installed === true);
  const canRunCrest = Boolean(activeDocument
    && !isGrid
    && activeDocumentReadable
    && crestInputReady
    && (!activeLigandSelection
      || (activeLigandSelection.atoms !== null && activeLigandSelection.atoms <= 300))
    && hasAvailableXtb
    && state.conformerStatus?.crest.installed === true);
  const canRunPrism = Boolean(activeDocument
    && !isGrid
    && activeDocumentReadable
    && canInspectConformerEnsemble(extension)
    && state.conformerStatus?.prism.installed === true);
  const canRunXtb = Boolean(activeDocument
    && !isGrid
    && activeDocumentReadable
    && hasAvailableXtb
    && (activeLigandSelection
      ? activeLigandSelection.atoms !== null && activeLigandSelection.atoms <= 300
      : DIRECT_XTB_EXTENSIONS.has(extension)));
  const recentDocuments = useMemo(() => {
    const seenPaths = new Set<string>();
    const documents: NonNullable<NativeMenuState["recentDocuments"]> = [];
    for (const { path, title } of state.recentStructures) {
      if (!isAbsoluteNativeFilePath(path) || !path.trim() || path.length > MAX_RECENT_PATH_CHARS || seenPaths.has(path)) continue;
      seenPaths.add(path);
      documents.push({ path, title: title.slice(0, MAX_RECENT_TITLE_CHARS) });
      if (documents.length === 10) break;
    }
    return documents;
  }, [state.recentStructures]);
  const openDocumentPaths = useMemo(
    () => nativeOpenDocumentPaths(state.documents, state.textDocuments),
    [state.documents, state.textDocuments],
  );
  const documentRegistryRevision = useMemo(
    () => nextDocumentRegistryRevision(),
    [openDocumentPaths],
  );

  useEffect(() => {
    let updateTimer = 0;
    const syncEditingState = () => {
      const activeElement = document.activeElement;
      const tagName = activeElement?.tagName.toLowerCase();
      setShellEditingText(activeElement instanceof HTMLElement && (
        activeElement.isContentEditable
        || tagName === "input"
        || tagName === "textarea"
        || tagName === "select"
      ));
    };
    const scheduleEditingStateSync = () => {
      if (updateTimer) window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(syncEditingState, 0);
    };
    document.addEventListener("focusin", syncEditingState, true);
    document.addEventListener("focusout", scheduleEditingStateSync, true);
    syncEditingState();
    return () => {
      if (updateTimer) window.clearTimeout(updateTimer);
      document.removeEventListener("focusin", syncEditingState, true);
      document.removeEventListener("focusout", scheduleEditingStateSync, true);
    };
  }, []);

  const nativeState = useMemo<NativeMenuState>(() => ({
    documentRegistryRevision,
    hasActiveTab: state.activeTab !== null,
    activeTabClosable,
    tabCount: state.tabs.length,
    closableTabCount,
    hasActiveFile: activeDocumentFileBacked || activeTextTabFileBacked,
    hasActiveDocument: activeDocument !== null,
    canExportExternalPreview: activeDocument?.renderer === "xyzrender-external",
    documentDirty: windowDocumentDirty,
    isGrid,
    sidebarOpen: state.sidebarOpen,
    rightDockOpen: state.rightDockOpen,
    bottomDockOpen: state.bottomDockOpen,
    canSave: sourceSaveEnabled
      || Boolean(isGrid && gridMenuState?.saveEnabled && gridMenuState.dirty && !activeDocument?.virtual),
    canSaveAs: Boolean(isGrid && gridMenuState?.saveEnabled && gridMenuState.hasMolecules),
    canUndo: Boolean(isGrid && gridMenuState?.canUndo),
    canRedo: Boolean(isGrid && gridMenuState?.canRedo),
    undoLabel: isGrid ? gridMenuState?.undoLabel ?? null : null,
    redoLabel: isGrid ? gridMenuState?.redoLabel ?? null : null,
    gridEditingText: Boolean(isGrid && (shellEditingText || gridMenuState?.editingText !== false)),
    gridViewMode: isGrid ? gridMenuState?.viewMode ?? null : null,
    gridPropertiesShown: Boolean(isGrid && gridMenuState?.showProperties),
    gridCardRenderer: isGrid ? gridMenuState?.cardRenderer ?? null : null,
    selectedMoleculeCount,
    selectedGridRowCount: isGrid ? gridMenuState?.selectedCount ?? 0 : 0,
    gridHasMolecules: Boolean(isGrid && gridMenuState?.hasMolecules),
    gridDirty: Boolean(isGrid && gridMenuState?.dirty),
    gridExportEnabled: Boolean(isGrid && gridMenuState?.exportEnabled),
    gridSelectionEnabled: Boolean(isGrid && gridMenuState?.selectionEnabled),
    gridSupportsXyzrender: Boolean(isGrid && gridMenuState?.supportsXyzrender),
    gridGenerating3d: Boolean(isGrid && gridMenuState?.generating3d),
    canOpenInMolstar,
    canEditInKetcher,
    canGenerate3d,
    canRunCrest,
    canRunPrism,
    canRunXtb,
    openDocumentPaths,
    recentDocuments: null,
  }), [activeDocument, activeTabClosable, canEditInKetcher, canGenerate3d, canOpenInMolstar, canRunCrest, canRunPrism, canRunXtb, closableTabCount, documentRegistryRevision, gridMenuState, isGrid, openDocumentPaths, selectedMoleculeCount, shellEditingText, sourceSaveEnabled, state.activeTab, state.bottomDockOpen, state.rightDockOpen, state.sidebarOpen, state.tabs.length, windowDocumentDirty]);
  const nativeStateRef = useRef<NativeMenuState>({ ...nativeState, recentDocuments });
  const confirmCloseWindowRef = useRef(confirmCloseWindow);
  const closeConfirmationPendingRef = useRef(false);
  const closingWindowRef = useRef(false);
  const getWindowDocumentDirtySnapshotRef = useRef(getWindowDocumentDirtySnapshot);
  nativeStateRef.current = { ...nativeState, recentDocuments };
  confirmCloseWindowRef.current = confirmCloseWindow;
  getWindowDocumentDirtySnapshotRef.current = getWindowDocumentDirtySnapshot;

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("sync_native_menu", { state: nativeState }).catch((error) => {
      console.warn("Native menu state sync failed", error);
    });
  }, [nativeState]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("sync_native_menu", {
      state: nativeStateRef.current,
    }).catch((error) => {
      console.warn("Native recent menu sync failed", error);
    });
  }, [recentDocuments]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    return trackTauriListener(getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      void invoke("sync_native_menu", { state: nativeStateRef.current }).catch((error) => {
        console.warn("Native menu focus sync failed", error);
      });
    }), "native menu focus sync");
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    return trackTauriListener(getCurrentWindow().onCloseRequested((event) => {
      if (closingWindowRef.current) return;
      event.preventDefault();
      if (closeConfirmationPendingRef.current) return;
      closeConfirmationPendingRef.current = true;
      void (async () => {
        let permit: WindowCloseMutationPermit | null = null;
        try {
          permit = await confirmCloseWindowRef.current();
          // Only an explicit "cancel" in the unsaved-changes prompt stops the
          // close. Past this point nothing may gate it: the window shuts down
          // immediately rather than waiting on in-flight work, because that
          // wait was unbounded and left the shell frozen when it never settled.
          if (!permit) return;
          permit.release();
          closingWindowRef.current = true;
          await getCurrentWindow().close();
        } catch (error) {
          closingWindowRef.current = false;
          permit?.release();
          console.warn("Native window close failed", error);
        } finally {
          closeConfirmationPendingRef.current = false;
        }
      })();
    }), "native window close guard");
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let active = true;
    let registrationId: string | null = null;
    const listener = listen<ExitPreflightRequest>(EXIT_PREFLIGHT_EVENT, ({ payload }) => {
      const barrier = sealWindowMutations();
      const snapshot = getWindowDocumentDirtySnapshotRef.current();
      void invoke("respond_to_exit_preflight", {
        requestId: payload.requestId,
        closeTransitionActive: snapshot.closeTransitionActive
          || barrier.closeTransitionActive
          || barrier.pendingCount > 0,
        dirty: snapshot.dirty || barrier.pendingCount > 0,
        revision: snapshot.revision,
      }).catch((error) => {
        console.warn("Native exit preflight response failed", error);
      });
    });
    const cleanup = trackTauriListener(listener, EXIT_PREFLIGHT_EVENT, () => {
      if (!active) return;
      void invoke<string>("register_exit_preflight_listener").then((token) => {
        registrationId = token;
        if (!active) void invoke("unregister_exit_preflight_listener", { registrationId: token });
      }).catch((error) => {
        console.warn("Native exit protection registration failed", error);
      });
    });
    return () => {
      active = false;
      cleanup();
      if (registrationId) {
        void invoke("unregister_exit_preflight_listener", { registrationId });
      }
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    return trackTauriListener(
      listen(EXIT_TRANSITION_RESUMED_EVENT, resumeWindowMutations),
      EXIT_TRANSITION_RESUMED_EVENT,
    );
  }, []);

  const handleNativeMenuCommand = useCallback(async ({ command, recentPath }: NativeMenuCommand) => {
    if (closingWindowRef.current) return;
    const gridCommand = () => {
      if (activeDocument?.renderer === "grid2d") postGridMenuCommand(activeDocument.id, command);
    };
    const selectAdjacentTab = (offset: -1 | 1) => {
      if (state.tabs.length === 0) return;
      const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const currentIndex = activeIndex >= 0 ? activeIndex : 0;
      const nextIndex = (currentIndex + offset + state.tabs.length) % state.tabs.length;
      actions.selectTab(state.tabs[nextIndex].id);
    };

    switch (command) {
      case "settings.open":
        actions.openSettings();
        return;
      case "file.new-window":
        await actions.openNewWindow();
        return;
      case "file.new-tab":
        actions.openNewTab();
        return;
      case "file.open":
        await actions.chooseFiles();
        return;
      case "file.open-clipboard":
        await actions.openClipboard();
        return;
      case "file.open-recent": {
        if (recentPath
          && isAbsoluteNativeFilePath(recentPath)
          && recentPath.length <= MAX_RECENT_PATH_CHARS) {
          await openDocuments([recentPath]);
          return;
        }
        console.warn("Native recent menu item did not contain a valid absolute path.");
        void invoke("sync_native_menu", { state: nativeStateRef.current });
        return;
      }
      case "file.clear-recent":
        await actions.clearRecentStructures();
        return;
      case "file.reveal-active":
        await actions.revealActiveDocument();
        return;
      case "file.copy-active-path":
        await actions.copyActiveDocumentPath();
        return;
      case "file.show-active-metadata":
        await actions.showActiveDocumentMetadata();
        return;
      case "file.export-preview-png":
        await actions.exportActivePreviewAsPng();
        return;
      case "file.export-preview-svg":
        await actions.exportActivePreviewAsSvg();
        return;
      case "maintenance.clear-preview-cache":
        await actions.clearCache();
        return;
      case "maintenance.reset-quick-look":
        await actions.resetQuickLook();
        return;
      case "maintenance.open-logs":
        await actions.openLogs();
        return;
      case "updater.check":
        await actions.checkForUpdates();
        return;
      case "file.save":
        if (sourceSaveEnabled) await saveActiveSource();
        else gridCommand();
        return;
      case "file.save-as":
      case "file.export-smiles":
      case "file.export-csv":
      case "edit.undo-grid":
      case "edit.redo-grid":
      case "edit.find":
      case "view.grid-cards":
      case "view.grid-table":
      case "view.grid-properties":
      case "view.grid-renderer-rdkit":
      case "view.grid-renderer-xyzrender":
      case "collection.copy-selected":
      case "collection.select-all":
      case "collection.clear-selection":
      case "collection.calculate-descriptors":
        if (command === "edit.find" && !isGrid) actions.focusSidebarSearch();
        else gridCommand();
        return;
      case "file.close-tab":
        await actions.closeActiveDocument();
        return;
      case "file.close-other-tabs":
        if (!state.activeTabId) return;
        await actions.closeOtherTabs(state.activeTabId);
        return;
      case "file.close-all-tabs":
        await actions.clearAllDocuments();
        return;
      case "file.close-window":
        await getCurrentWindow().close();
        return;
      case "view.toggle-sidebar": actions.toggleSidebar(); return;
      case "view.toggle-inspector": actions.toggleDock("right"); return;
      case "view.toggle-bottom-panel": actions.toggleDock("bottom"); return;
      case "view.command-palette": actions.openCommandPalette(); return;
      case "structure.open-in-molstar":
        if (!activeDocument || !canOpenInMolstar) return;
        if (isGrid) gridCommand();
        else await openDocuments([activeDocument.path], undefined, { rendererMode: "molstar" }, { inActiveTab: true });
        return;
      case "structure.edit-in-ketcher":
        if (!activeDocument || !canEditInKetcher) return;
        if (isGrid) gridCommand();
        else await actions.openKetcherWithStructures([activeDocument.path]);
        return;
      case "structure.generate-3d":
        if (!activeDocument || !canGenerate3d) return;
        if (isGrid) gridCommand();
        else await actions.generate3DConformer(activeDocument);
        return;
      case "structure.crest-generate":
        if (!activeDocument || isGrid || !canRunCrest) return;
        await actions.runConformerOperation("crest-generate", activeDocument, conformerSelection);
        return;
      case "structure.prism-prune":
        if (!activeDocument || isGrid || !canRunPrism) return;
        await actions.runConformerOperation("prism-prune", activeDocument);
        return;
      case "structure.xtb-optimize":
        if (!activeDocument || isGrid || !canRunXtb) return;
        await actions.runXtbActiveOperation("optimize");
        return;
      case "structure.xtb-properties":
        if (!activeDocument || isGrid || !canRunXtb) return;
        await actions.runXtbActiveOperation("properties");
        return;
      case "structure.xtb-frequencies":
        if (!activeDocument || isGrid || !canRunXtb) return;
        await actions.runXtbActiveOperation("optimized-hessian");
        return;
      case "structure.xtb-vipea":
        if (!activeDocument || isGrid || !canRunXtb) return;
        await actions.runXtbActiveOperation("vipea");
        return;
      case "structure.xtb-fukui":
        if (!activeDocument || isGrid || !canRunXtb) return;
        await actions.runXtbActiveOperation("vfukui");
        return;
      case "window.previous-tab": selectAdjacentTab(-1); return;
      case "window.next-tab": selectAdjacentTab(1); return;
      case "help.open": await openExternalUrl(PROJECT_URL); return;
      case "help.keyboard-shortcuts": actions.openSettingsSection("keyboard"); return;
      case "help.whats-new": await openExternalUrl(`${PROJECT_URL}/releases`); return;
      case "help.report-issue": await openExternalUrl(`${PROJECT_URL}/issues/new`); return;
      case "help.runtime-doctor": await actions.runExternalRuntimeDoctor(); return;
      case "help.export-diagnostics": await actions.exportDiagnostics(); return;
      default:
        console.warn(`Unknown native menu command: ${command}`);
    }
  }, [actions, activeDocument, canEditInKetcher, canGenerate3d, canOpenInMolstar, canRunCrest, canRunPrism, canRunXtb, conformerSelection, isGrid, openDocuments, saveActiveSource, sourceSaveEnabled, state.activeTabId, state.tabs]);

  useMenuEvents({
    handleNativeMenuCommand,
  });
}
