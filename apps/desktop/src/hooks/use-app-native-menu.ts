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
import type { DerivedColumnKind } from "../lib/derived-columns";
import { isTauriRuntime, trackTauriListener } from "../lib/tauri";
import { postGridCommand } from "../lib/viewer-bridge";
import {
  resumeWindowMutations,
  sealWindowMutations,
} from "../lib/window-mutation-barrier";
import type { ViewerPreferences, ViewerReloadOptions } from "../types";
import { useMenuEvents } from "./use-menu-events";

const PROJECT_URL = "https://github.com/SergeiNikolenko/Burette";
const ADD_COLUMN_COMMAND_KINDS: Record<string, DerivedColumnKind> = {
  "collection.add-column.formula": "formula",
  "collection.add-column.smiles": "canonical-smiles",
  "collection.add-column.inchi": "inchi",
  "collection.add-column.inchikey": "inchikey",
  "collection.add-column.idcode": "idcode",
  // Transform writes a column the same way Add Column does, so it dispatches
  // through the same map rather than growing a parallel one.
  "collection.transform.largest-fragment": "largest-fragment",
  "collection.reaction.add-smiles": "reaction-smiles",
  "collection.reaction.extract-reactants": "reaction-reactants",
  "collection.reaction.extract-catalysts": "reaction-catalysts",
  "collection.reaction.extract-products": "reaction-products",
  "collection.reaction.extract-transformation": "reaction-transformation",
};
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
  getWindowDocumentDirtySnapshot: () => {
    dirty: boolean;
    revision: number;
    closeTransitionActive: boolean;
  };
  windowDocumentDirty: boolean;
  sourceSaveEnabled: boolean;
  saveActiveSource: () => void | Promise<void>;
};

const postGridMenuCommand = postGridCommand;

async function openExternalUrl(url: string) {
  await invoke("open_external_url", { url });
}

export function useAppNativeMenu({
  state,
  actions,
  gridMenuState,
  openDocuments,
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
  const activeDocumentTabPath = state.activeTab?.location.kind === "document" && isAbsoluteNativeFilePath(state.activeTab.location.path)
    ? state.activeTab.location.path
    : null;
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
    () => nativeOpenDocumentPaths(
      state.documents,
      state.textDocuments,
      state.tabs.flatMap((tab) => (tab.location.kind === "document" ? [tab.location.path] : [])),
    ),
    [state.documents, state.textDocuments, state.tabs],
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
    hasActiveFile: activeDocumentFileBacked || activeTextTabFileBacked || activeDocumentTabPath !== null,
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
    gridHasReactions: Boolean(isGrid && gridMenuState?.hasReactions),
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
    rgroupRuntimeAvailable: state.rgroupRuntimeAvailable,
    openDocumentPaths,
    recentDocuments: null,
  }), [activeDocument, activeTabClosable, canEditInKetcher, canGenerate3d, canOpenInMolstar, canRunCrest, canRunPrism, canRunXtb, closableTabCount, documentRegistryRevision, gridMenuState, isGrid, openDocumentPaths, selectedMoleculeCount, shellEditingText, sourceSaveEnabled, state.activeTab, state.rgroupRuntimeAvailable, state.bottomDockOpen, state.rightDockOpen, state.sidebarOpen, state.tabs.length, windowDocumentDirty]);
  const nativeStateRef = useRef<NativeMenuState>({ ...nativeState, recentDocuments });
  const closingWindowRef = useRef(false);
  const getWindowDocumentDirtySnapshotRef = useRef(getWindowDocumentDirtySnapshot);
  nativeStateRef.current = { ...nativeState, recentDocuments };
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
      // The close button quits the whole application, matching Cmd+Q and the
      // "Quit Burette" menu item. Preventing the default window close and
      // routing through request_app_quit is deliberate: a plain window close
      // left a windowless process alive (macOS default) that then recreated a
      // window, so the button looked like it did nothing. request_quit runs the
      // unsaved-changes preflight before it exits.
      event.preventDefault();
      void invoke("request_app_quit").catch((error) => {
        console.warn("App quit request failed", error);
      });
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
          await actions.openPaths([recentPath]);
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
        if (command === "edit.find" && !isGrid) actions.focusSidebarSearch();
        else gridCommand();
        return;
      case "collection.calculate-descriptors":
        // Opens the Calculate Properties dialog; the Mordred descriptor run is
        // one of its options rather than the whole command.
        if (activeDocument && isGrid) actions.openCalculateProperties(activeDocument.id);
        return;
      case "collection.add-column.formula":
      case "collection.add-column.smiles":
      case "collection.add-column.inchi":
      case "collection.add-column.inchikey":
      case "collection.add-column.idcode":
      case "collection.transform.largest-fragment":
      case "collection.reaction.add-smiles":
      case "collection.reaction.extract-reactants":
      case "collection.reaction.extract-catalysts":
      case "collection.reaction.extract-products":
      case "collection.reaction.extract-transformation": {
        if (!activeDocument || !isGrid) return;
        const kind = ADD_COLUMN_COMMAND_KINDS[command];
        if (kind) actions.addDerivedGridColumn(activeDocument.id, kind);
        return;
      }
      case "collection.delete-rows.selected":
        // The grid owns the selection, so it performs this one itself.
        if (isGrid) gridCommand();
        return;
      case "collection.delete-rows.duplicates":
        if (activeDocument && isGrid) actions.deleteDuplicateGridRows(activeDocument.id);
        return;
      case "analyze.chemical-space":
        if (isGrid) actions.openDockTab("bottom", "chemical-space");
        return;
      case "analyze.cluster":
      case "analyze.diverse":
        // Clustering lives in the grid; the command is forwarded whole and the
        // grid re-checks its own capability before doing anything.
        if (activeDocument && isGrid) postGridMenuCommand(activeDocument.id, command);
        return;
      case "analyze.scaffolds":
        if (activeDocument && isGrid) actions.addScaffoldGridColumns(activeDocument.id);
        return;
      case "analyze.substructure-count":
        if (activeDocument && isGrid) actions.openSubstructureCount(activeDocument.id);
        return;
      case "analyze.find-similar":
        if (activeDocument && isGrid) await actions.findSimilarInFile(activeDocument.id);
        return;
      case "analyze.rgroups":
        if (activeDocument && isGrid) actions.openRGroupDecomposition(activeDocument.id);
        return;
      case "collection.add-column.calculated":
        if (activeDocument && isGrid) actions.openCalculatedColumn(activeDocument.id);
        return;
      case "collection.merge-columns":
        if (activeDocument && isGrid) actions.openMergeColumns(activeDocument.id);
        return;
      case "collection.add-column.bins":
        if (activeDocument && isGrid) await actions.openBinsColumn(activeDocument.id);
        return;
      case "collection.add-column.row-number":
        if (activeDocument && isGrid) actions.addRowNumberGridColumn(activeDocument.id);
        return;
      case "collection.delete-columns":
        if (activeDocument && isGrid) await actions.openDeleteColumns(activeDocument.id);
        return;
      case "collection.transform.value-range":
        // Limits a column the grid already holds, so the dialog opens with the
        // grid's own column catalog and the grid applies the range itself.
        if (activeDocument && isGrid) actions.openSetValueRange(activeDocument.id);
        return;
      case "collection.transform.split-rows":
        if (activeDocument && isGrid) actions.openSplitValueRows(activeDocument.id);
        return;
      case "collection.merge-rows":
        // No dialog: what counts as equivalent is the identity Delete Duplicate
        // Molecules already uses, and the merge is one undo entry.
        if (activeDocument && isGrid) actions.mergeEquivalentGridRows(activeDocument.id);
        return;
      case "collection.reaction.perform":
        // Runs a reaction over the collection's molecules, so it opens a dialog
        // for the reaction rather than reading one off the rows.
        if (activeDocument && isGrid) actions.openPerformReaction(activeDocument.id);
        return;
      case "collection.transform.logarithmic":
        // The same dialog, opened with the transform already written: naming the
        // column and picking which one to take the logarithm of is the only part
        // left, and the formula editor validates it the way it validates any
        // other computed column.
        if (activeDocument && isGrid) {
          actions.openCalculatedColumn(activeDocument.id, { formula: "log10()", label: "log10" });
        }
        return;
      case "analyze.correlation-matrix":
        if (activeDocument && isGrid) actions.openCorrelationMatrix(activeDocument.id);
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
      case "database.search-chembl": actions.openDatabaseQuery("chembl"); return;
      case "database.chembl-actives": actions.openDatabaseQuery("chembl-actives"); return;
      case "database.search-cod": actions.openDatabaseQuery("cod"); return;
      case "database.retrieve-wikipedia": actions.openDatabaseQuery("wikipedia"); return;
      case "database.search-building-blocks": actions.openDatabaseQuery("building-blocks"); return;
      case "database.search-chemspace": actions.openDatabaseQuery("chemspace"); return;
      case "database.search-google-patents": actions.openDatabaseQuery("patents"); return;
      case "database.retrieve-url": actions.openDatabaseQuery("url"); return;
      case "database.retrieve-sql": actions.openDatabaseQuery("sql"); return;
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
