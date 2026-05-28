import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import previewFormatRegistry from "../../../config/preview-formats.json";
import { AppLayout } from "./components/app-layout";
import { CommandPalette } from "./components/command-palette";
import type { ShellActions, ShellViewState, StatusKind, StatusNotice } from "./components/types";
import { WindowTitle } from "./components/window-title";
import {
  useCloseCommandPalette,
  useCommandPaletteSearch,
  useIsCommandPaletteOpen,
  useOpenCommandPalette,
  useSetCommandPaletteSearch,
} from "./hooks/use-command-palette";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useMenuEvents } from "./hooks/use-menu-events";
import { useOpenDrop } from "./hooks/use-open-drop";
import { useOpenEvents } from "./hooks/use-open-events";
import { useSidebar } from "./hooks/use-sidebar";
import {
  useActiveDocument,
  useActiveTab,
  useActiveTabId,
  useAddTabs,
  useClearRecentStructures,
  useCanNavigateBack,
  useCanNavigateForward,
  useCloseActiveTab,
  useCloseAllTabs,
  useCloseDocument,
  useCloseTab,
  useOpenDocuments,
  useOpenNewTab,
  useOpenSettingsTab,
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
import { browserDevRuntimeNeedsRefresh, openBrowserDevDockingDocument, openBrowserDevDocuments, openBrowserDevMergedCollection, openBrowserDevMolstarContextDocument, readBrowserDevCollectionText } from "./lib/browser-dev-documents";
import { isMoleculeCollectionPath } from "./lib/collection-documents";
import { dockingRequestForDrop, isProteinLikeDockingSource } from "./lib/docking-documents";
import { basename, buildSidebarProjects, parentDirectory } from "./lib/sidebar-projects";
import type { StructureDragPayload } from "./lib/structure-drag";
import { isTauriRuntime } from "./lib/tauri";
import type { DockingDocumentRequest, OpenDocumentsResult, RecentStructure, ViewerDocument, ViewerReloadOptions } from "./types";
import { checkForUpdates as requestUpdateCheck, clearDismissedUpdate, dismissUpdate, loadUpdatePreferences, markAutomaticCheck, releasePageUrl, saveUpdatePreferences, shouldCheckAutomatically, shouldPromptForUpdate } from "./update";
import type { UpdatePreferences, UpdateRelease, UpdateState } from "./update";

const filters = [
  {
    name: "Molecular structures",
    extensions: previewFormatRegistry.documentTypes.extensions,
  },
];

async function browserDevFilesFromLocation() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("devDocking")) return [];
  if (params.has("devFiles")) {
    return splitDevFiles(params.get("devFiles") ?? "");
  }
  const response = await fetch("/__burette/dev-files", { cache: "no-store" });
  if (!response.ok) return [];
  const payload = await response.json() as { files?: unknown };
  return Array.isArray(payload.files)
    ? payload.files.filter((path): path is string => typeof path === "string" && path.trim().length > 0)
    : [];
}

function splitDevFiles(rawFiles: string) {
  return rawFiles.split("\n").map((path) => path.trim()).filter(Boolean);
}

function browserDevDockingFromLocation(): DockingDocumentRequest | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("devDocking")) return null;
  const paths = splitDevFiles(params.get("devDocking") ?? "");
  if (paths.length < 2) return null;
  return dockingRequestForDrop(paths[0], paths.slice(1));
}

export default function App() {
  const preferences = useViewerPreferences();
  const setPreference = useSetViewerPreference();
  const tabs = useOpenTabs();
  const documents = useOpenDocuments();
  const activeTabId = useActiveTabId();
  const activeTab = useActiveTab();
  const activeDocument = useActiveDocument();
  const addDocuments = useAddTabs();
  const setDocuments = useSetDocuments();
  const openNewTab = useOpenNewTab();
  const openSettingsTab = useOpenSettingsTab();
  const canNavigateBack = useCanNavigateBack();
  const canNavigateForward = useCanNavigateForward();
  const navigateBack = useNavigateBack();
  const navigateForward = useNavigateForward();
  const recentStructures = useRecentStructures();
  const rememberRecentStructures = useRememberRecentStructures();
  const clearRecentStructures = useClearRecentStructures();
  const setActiveTab = useSetActiveTab();
  const setActiveDocument = useSetActiveDocument();
  const closeTab = useCloseTab();
  const closeDocument = useCloseDocument();
  const closeActiveDocument = useCloseActiveTab();
  const closeAllDocuments = useCloseAllTabs();
  const {
    sidebarOpen,
    sidebarWidth,
    projectsOpen,
    projectRoots,
    expandedProjectIds,
    pinnedStructurePaths,
    sidebarQuery,
    setSidebarWidth,
    toggleProjectsOpen,
    setExpandedProjectIds,
    addProjectRoot,
    togglePinnedStructure,
    setSidebarQuery,
    toggleProjectExpanded,
    toggleSidebar,
  } = useSidebar();
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [structureDragActive, setStructureDragActive] = useState(false);
  const [status, setStatus] = useState<StatusNotice | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>(() => ({
    preferences: loadUpdatePreferences(),
    isChecking: false,
    isInstalling: false,
    statusText: "No update check has run yet.",
    availableRelease: null,
  }));
  const refreshedPersistedSessionRef = useRef(false);
  const openedBrowserDevFilesRef = useRef<string | null>(null);
  const openedBrowserDevDockingRef = useRef<string | null>(null);
  const syncingBrowserDevFilesRef = useRef(false);
  const pendingViewerReloadOptionsRef = useRef<ViewerReloadOptions | null>(null);
  const pendingViewerReloadDocumentIdRef = useRef<string | null>(null);
  const pendingXyzrenderSheetDropRef = useRef<{ documentId: string; payload: StructureDragPayload } | null>(null);
  const xyzrenderOrientationRefRef = useRef<string | null>(null);
  const skipNextPreferenceRefreshRef = useRef(false);
  const statusSequenceRef = useRef(0);
  const commandPaletteOpen = useIsCommandPaletteOpen();
  const commandPaletteQuery = useCommandPaletteSearch();
  const openCommandPalette = useOpenCommandPalette();
  const closeCommandPalette = useCloseCommandPalette();
  const setCommandPaletteQuery = useSetCommandPaletteSearch();

  const pushStatus = useCallback((message: string, kind: StatusKind = "info", details: string[] = []) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setStatus({
      id: ++statusSequenceRef.current,
      kind,
      message: trimmed,
      details: details.filter(Boolean),
    });
  }, []);

  const pushErrorStatus = useCallback((error: unknown, prefix?: string, details: string[] = []) => {
    const message = error instanceof Error ? error.message : String(error);
    pushStatus(prefix ? `${prefix}: ${message}` : message, "error", details.length > 0 ? details : [message]);
  }, [pushStatus]);

  const clearStatus = useCallback(() => {
    setStatus(null);
  }, []);

  useEffect(() => {
    if (!status || status.kind === "error") return undefined;
    const timeout = window.setTimeout(() => {
      setStatus((current) => (current?.id === status.id ? null : current));
    }, 3200);
    return () => window.clearTimeout(timeout);
  }, [status]);

  const selectDocument = useCallback((id: string) => {
    setActiveDocument(id);
  }, [setActiveDocument]);

  const focusSidebarSearch = useCallback(() => {
    openCommandPalette();
  }, [openCommandPalette]);

  const allSidebarProjects = useMemo(() => buildSidebarProjects({
    documents,
    recentStructures: documents.length === 0 ? recentStructures : [],
    projectRoots,
    activeDocumentId: activeDocument?.id ?? null,
    pinnedStructurePaths,
  }), [activeDocument?.id, documents, pinnedStructurePaths, projectRoots, recentStructures]);

  const activeProject = useMemo(
    () => allSidebarProjects.find((project) => project.isActive) ?? null,
    [allSidebarProjects],
  );

  const openDocuments = useCallback(
    async (
      paths: string[],
      reloadOptions?: ViewerReloadOptions,
      preferencesOverride?: Partial<typeof preferences>,
      options: { replace?: boolean } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return;
      pushStatus("Opening structures...");
      try {
        const effectivePreferences = preferencesOverride ? { ...preferences, ...preferencesOverride } : preferences;
        const result = isTauriRuntime()
          ? await invoke<OpenDocumentsResult>("open_documents", { paths: cleanPaths, preferences: effectivePreferences, reloadOptions })
          : await openBrowserDevDocuments(cleanPaths, effectivePreferences, reloadOptions);
        if (options.replace) setDocuments(result.documents);
        else addDocuments(result.documents);
        rememberRecentStructures(result.documents);
        const openedText = "Opened " + result.documents.length + " structure" + (result.documents.length === 1 ? "" : "s");
        if (result.errors.length > 0) {
          pushStatus(`${openedText}. ${summarizeErrors(result.errors)}`, "error", result.errors);
        } else {
          pushStatus(openedText);
        }
      } catch (error) {
        pushErrorStatus(error);
      }
    },
    [addDocuments, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setDocuments],
  );

  useEffect(() => {
    if (isTauriRuntime() || syncingBrowserDevFilesRef.current) return;
    let cancelled = false;
    void (async () => {
      const paths = await browserDevFilesFromLocation();
      if (cancelled || paths.length === 0) return;
      const normalizedFiles = paths.join("\n");
      const needsInitialOpen = openedBrowserDevFilesRef.current !== normalizedFiles;
      const needsRuntimeRefresh = !needsInitialOpen
        && documents.some((document) => paths.includes(document.path) && browserDevRuntimeNeedsRefresh(document));
      if (!needsInitialOpen && !needsRuntimeRefresh) return;
      openedBrowserDevFilesRef.current = normalizedFiles;
      syncingBrowserDevFilesRef.current = true;
      const workspace = paths[0] ? parentDirectory(paths[0]) : null;
      if (workspace) {
        setWorkspacePath(workspace);
        addProjectRoot(workspace);
      }
      closeAllDocuments();
      await openDocuments(paths, undefined, undefined, { replace: true });
      syncingBrowserDevFilesRef.current = false;
    })().catch((error) => {
      if (!cancelled) pushErrorStatus(error, "Open dev files failed");
      syncingBrowserDevFilesRef.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [addProjectRoot, closeAllDocuments, documents, openDocuments, pushErrorStatus, setWorkspacePath]);

  useEffect(() => {
    if (refreshedPersistedSessionRef.current) return;
    if (!isTauriRuntime() || documents.length === 0) return;
    refreshedPersistedSessionRef.current = true;
    const activePath = activeDocument?.path;
    const paths = documents
      .map((document) => document.path)
      .sort((a, b) => (a === activePath ? -1 : b === activePath ? 1 : 0));
    void openDocuments(paths);
  }, [activeDocument, documents, openDocuments]);

  const openRecentStructure = useCallback(
    async (structure: RecentStructure) => {
      await openDocuments([structure.path]);
    },
    [openDocuments],
  );

  const chooseFiles = useCallback(async () => {
    try {
      const selection = isTauriRuntime()
        ? await invoke<string[]>("pick_open_targets")
        : await open({ multiple: true, filters });
      const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
      await openDocuments(paths);
    } catch (error) {
      pushErrorStatus(error, "Open failed");
    }
  }, [openDocuments, pushErrorStatus]);

  const openDockingDocument = useCallback(async (targetPath: string, droppedPaths: string[]) => {
    const existingDockingRequest = documents.find((document) => document.path === targetPath || document.id === targetPath)?.dockingRequest;
    const request = dockingRequestForDrop(targetPath, droppedPaths, existingDockingRequest);
    if (!request) return;
    if (request.ligandPaths.length === 0) return;
    pushStatus("Opening Mol* docking view...");
    try {
      const document = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_docking_document", { request, preferences })
        : await openBrowserDevDockingDocument(request.receptorPath, request.ligandPaths, preferences);
      addDocuments([document]);
      rememberRecentStructures([document]);
      setStructureDragActive(false);
      pushStatus(`Opened docking view with ${request.ligandPaths.length} ligand${request.ligandPaths.length === 1 ? "" : "s"}`);
    } catch (error) {
      setStructureDragActive(false);
      pushErrorStatus(error, "Docking view failed");
    }
  }, [addDocuments, documents, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  const collectionSourcePaths = useCallback((path: string | null) => {
    if (!path) return [];
    const document = documents.find((candidate) => candidate.path === path || candidate.id === path);
    if (document?.mergedCollection) return document.mergedCollection.sourcePaths;
    return [path];
  }, [documents]);

  const mergeMoleculeCollections = useCallback(async (targetPath: string | null, paths: string[]) => {
    const sourcePaths = Array.from(new Set([
      ...collectionSourcePaths(targetPath),
      ...paths.flatMap((path) => collectionSourcePaths(path)),
    ].filter(isMoleculeCollectionPath)));
    if (sourcePaths.length < 2) {
      pushStatus("Drop another SDF, SMILES, CSV, or TSV collection to merge it.", "error");
      return;
    }
    pushStatus("Merging molecule collections...");
    try {
      const document = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_merged_collection", {
            request: { paths: sourcePaths },
            preferences,
          })
        : await openBrowserDevMergedCollection(sourcePaths, preferences);
      addDocuments([document]);
      setStructureDragActive(false);
      pushStatus(`Merged ${sourcePaths.length} collection${sourcePaths.length === 1 ? "" : "s"}`);
    } catch (error) {
      setStructureDragActive(false);
      pushErrorStatus(error, "Merge collections failed");
    }
  }, [addDocuments, collectionSourcePaths, preferences, pushErrorStatus, pushStatus]);

  const saveMoleculeCollectionAs = useCallback(async (targetPath: string) => {
    const document = documents.find((candidate) => candidate.path === targetPath || candidate.id === targetPath);
    const path = document?.path ?? targetPath;
    const suggestedFileName = document?.mergedCollection?.suggestedFileName ?? basename(path);
    try {
      if (isTauriRuntime()) {
        const outputPath = await save({
          defaultPath: suggestedFileName,
          filters: [{ name: "Molecule collections", extensions: ["sdf", "sd", "smi", "smiles", "csv", "tsv"] }],
        });
        if (!outputPath) return;
        await invoke("save_molecule_collection_as", { path, outputPath });
        pushStatus(`Saved ${basename(outputPath)}`);
        return;
      }

      const text = document?.mergedCollection?.text ?? await readBrowserDevCollectionText(path);
      downloadTextFile(suggestedFileName || "molecule-collection.sdf", text);
      pushStatus(`Saved ${suggestedFileName}`);
    } catch (error) {
      pushErrorStatus(error, "Save collection failed");
    }
  }, [documents, pushErrorStatus, pushStatus]);

  useEffect(() => {
    if (isTauriRuntime()) return;
    const request = browserDevDockingFromLocation();
    if (!request) return;
    const normalizedDocking = [request.receptorPath, ...request.ligandPaths].join("\n");
    if (openedBrowserDevDockingRef.current === normalizedDocking) return;
    openedBrowserDevDockingRef.current = normalizedDocking;
    const workspace = parentDirectory(request.receptorPath);
    if (workspace) {
      setWorkspacePath(workspace);
      addProjectRoot(workspace);
    }
    closeAllDocuments();
    void openDockingDocument(request.receptorPath, request.ligandPaths);
  }, [addProjectRoot, closeAllDocuments, openDockingDocument]);

  const chooseWorkspace = useCallback(async () => {
    try {
      const selection = await open({ directory: true, multiple: false });
      if (!selection || Array.isArray(selection)) return;
      setWorkspacePath(selection);
      addProjectRoot(selection);
      pushStatus("Project folder added");
    } catch (error) {
      pushErrorStatus(error, "Workspace selection failed");
    }
  }, [addProjectRoot, pushErrorStatus, pushStatus]);

  const openWorkspaceFolder = useCallback(async () => {
    const fallbackPath = activeProject?.rootPath ?? workspacePath ?? activeDocument?.path ?? recentStructures[0]?.path ?? null;
    if (!fallbackPath) {
      await chooseWorkspace();
      return;
    }
    const path = activeProject?.rootPath ?? workspacePath ?? parentDirectory(fallbackPath);
    if (!path) return;
    try {
      await openPath(path);
      pushStatus("Opened project folder");
    } catch (error) {
      pushErrorStatus(error, "Open project folder failed");
    }
  }, [activeDocument?.path, activeProject?.rootPath, chooseWorkspace, pushErrorStatus, pushStatus, recentStructures, workspacePath]);

  const openProjectFolder = useCallback(async (path: string | null) => {
    if (!path) return;
    try {
      await openPath(path);
      pushStatus("Opened project folder");
    } catch (error) {
      pushErrorStatus(error, "Open project folder failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const openSettings = useCallback(() => {
    openSettingsTab();
  }, [openSettingsTab]);

  const postXyzrenderSheetItems = useCallback((documentId: string, payload: StructureDragPayload) => {
    const iframe = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).find(
      (item) => item.dataset.documentId === documentId,
    );
    if (!iframe?.contentWindow) return false;
    iframe.contentWindow.postMessage(
      {
        source: "burrete-host",
        body: {
          type: "addXyzrenderSheetItems",
          documentId,
          paths: payload.paths,
          records: payload.records,
        },
      },
      "*",
    );
    return true;
  }, []);

  const addXyzrenderSheetItemsToDocument = useCallback((targetDocumentId: string, payload: StructureDragPayload) => {
    const targetDocument = documents.find((document) => document.id === targetDocumentId);
    if (
      !targetDocument ||
      targetDocument.renderer !== "xyzrender-external" ||
      (payload.paths.length === 0 && payload.records.length === 0)
    ) return false;
    const posted = postXyzrenderSheetItems(targetDocument.id, payload);
    if (!posted) {
      pendingXyzrenderSheetDropRef.current = { documentId: targetDocument.id, payload };
      const tab = tabs.find((item) => item.location.kind === "file" && (
        item.location.documentId === targetDocument.id ||
        item.location.path === targetDocument.path
      ));
      if (tab) setActiveTab(tab.id);
    }
    const count = payload.paths.length + payload.records.length;
    pushStatus(`Adding ${count} structure${count === 1 ? "" : "s"} to xyzrender sheet`);
    return true;
  }, [documents, postXyzrenderSheetItems, pushStatus, setActiveTab, tabs]);

  const addXyzrenderSheetItems = useCallback((payload: StructureDragPayload) => {
    if (!activeDocument) return false;
    return addXyzrenderSheetItemsToDocument(activeDocument.id, payload);
  }, [activeDocument, addXyzrenderSheetItemsToDocument]);

  useEffect(() => {
    const pending = pendingXyzrenderSheetDropRef.current;
    if (!pending || activeDocument?.id !== pending.documentId) return;
    if (postXyzrenderSheetItems(pending.documentId, pending.payload)) {
      pendingXyzrenderSheetDropRef.current = null;
    }
  }, [activeDocument?.id, postXyzrenderSheetItems]);

  useOpenEvents(openDocuments, pushErrorStatus);
  const { dropActive, handleBrowserDrag, handleBrowserDragLeave, handleBrowserDrop } = useOpenDrop(openDocuments, pushStatus, {
    activeDocumentPath: activeDocument?.path ?? null,
    activeDockingRequest: activeDocument?.dockingRequest ?? null,
    openDockingDocument,
    addXyzrenderSheetItems,
    mergeMoleculeCollections: activeDocument?.renderer === "grid2d"
      ? (paths) => {
          if (!paths.some(isMoleculeCollectionPath)) return false;
          void mergeMoleculeCollections(activeDocument.path, paths);
          return true;
        }
      : undefined,
  });
  const reloadActive = useCallback(async () => {
    const targetDocument = (pendingViewerReloadDocumentIdRef.current
      ? documents.find((document) => document.id === pendingViewerReloadDocumentIdRef.current)
      : null) ?? activeDocument;
    if (!targetDocument) return;
    const reloadOptions = pendingViewerReloadOptionsRef.current ?? undefined;
    pendingViewerReloadOptionsRef.current = null;
    pendingViewerReloadDocumentIdRef.current = null;
    await openDocuments([targetDocument.path], reloadOptions);
  }, [activeDocument, documents, openDocuments]);
  const setUpdatePreferences = useCallback((preferences: UpdatePreferences) => {
    saveUpdatePreferences(preferences);
    setUpdate((previous) => ({
      ...previous,
      preferences,
      availableRelease: preferences.channel === previous.preferences.channel ? previous.availableRelease : null,
      statusText: preferences.channel === previous.preferences.channel ? previous.statusText : "Update channel changed. Check for updates again.",
    }));
  }, []);

  const installUpdate = useCallback(async (releaseOverride?: UpdateRelease | null) => {
    const release = releaseOverride ?? update.availableRelease;
    if (!release) return;
    if (!release.installAsset) {
      const url = releasePageUrl(release);
      if (isTauriRuntime()) {
        await invoke("open_external_url", { url });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      pushStatus("Opened release page");
      return;
    }

    if (!isTauriRuntime()) {
      window.open(release.htmlUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setUpdate((previous) => ({
      ...previous,
      isInstalling: true,
      statusText: "Installing " + release.displayName + "... Burrete will restart when the update is ready.",
    }));
    pushStatus("Installing update...");
    try {
      clearDismissedUpdate();
      await invoke("install_update", {
        request: {
          tagName: release.tagName,
          assetName: release.installAsset.name,
          browserDownloadUrl: release.installAsset.browserDownloadUrl,
          size: release.installAsset.size,
          sha256AssetName: release.installAsset.sha256AssetName,
          sha256BrowserDownloadUrl: release.installAsset.sha256BrowserDownloadUrl,
          sha256Size: release.installAsset.sha256Size,
          manifestAssetName: release.installAsset.manifestAssetName,
          manifestBrowserDownloadUrl: release.installAsset.manifestBrowserDownloadUrl,
          manifestSize: release.installAsset.manifestSize,
          manifestSignatureAssetName: release.installAsset.manifestSignatureAssetName,
          manifestSignatureBrowserDownloadUrl: release.installAsset.manifestSignatureBrowserDownloadUrl,
          manifestSignatureSize: release.installAsset.manifestSignatureSize,
        },
      });
    } catch (error) {
      setUpdate((previous) => ({
        ...previous,
        isInstalling: false,
        statusText: "Update install failed: " + (error instanceof Error ? error.message : String(error)),
      }));
      pushErrorStatus(error, "Update install failed");
    }
  }, [pushErrorStatus, pushStatus, update.availableRelease]);

  const promptForUpdate = useCallback(async (release: UpdateRelease, automatic: boolean) => {
    if (!shouldPromptForUpdate(release, automatic)) return;
    const canInstall = release.installAsset !== null;
    const message = canInstall
      ? "Burrete " + release.tagName + " is available. Install it now and restart Burrete when the update is ready?"
      : "Burrete " + release.tagName + " is available, but this release does not include an installable app archive.";
    const accepted = isTauriRuntime()
      ? await ask(message, {
        title: "Update Available",
        kind: "info",
        okLabel: canInstall ? "Install and Restart" : "Open Release Page",
        cancelLabel: "Later",
      })
      : window.confirm(message);
    if (accepted) {
      await installUpdate(release);
    } else {
      dismissUpdate(release);
    }
  }, [installUpdate]);

  const checkForUpdates = useCallback(async (automatic = false, channelOverride?: UpdatePreferences["channel"]) => {
    const channel = channelOverride ?? update.preferences.channel;
    setUpdate((previous) => ({
      ...previous,
      isChecking: true,
      statusText: automatic ? previous.statusText : "Checking GitHub releases...",
    }));
    try {
      const release = await requestUpdateCheck(channel);
      setUpdate((previous) => ({
        ...previous,
        isChecking: false,
        availableRelease: release,
        statusText: release
          ? "Update available: " + release.displayName + " (" + release.tagName + ")." + (release.installAsset ? "" : " No downloadable app archive is attached to this release.")
          : "Burrete is up to date on " + channel + ".",
      }));
      if (release) {
        await promptForUpdate(release, automatic);
      } else {
        clearDismissedUpdate();
      }
      if (automatic) markAutomaticCheck(true);
    } catch (error) {
      setUpdate((previous) => ({
        ...previous,
        isChecking: false,
        statusText: "Update check failed: " + (error instanceof Error ? error.message : String(error)),
      }));
      if (automatic) markAutomaticCheck(false);
      if (!automatic) pushErrorStatus(error, "Update check failed");
    }
  }, [promptForUpdate, pushErrorStatus, update.preferences.channel]);

  useMenuEvents({ chooseFiles, openSettings, checkForUpdates });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        body?: {
          type?: string;
          requestId?: string;
          message?: string;
          value?: string;
          documentId?: string;
          path?: string | null;
          orientationRef?: string | null;
          preset?: string | null;
          text?: string | null;
          query?: string | null;
          sort?: string | null;
          offset?: number | null;
          limit?: number | null;
          controls?: ViewerReloadOptions["xyzrenderControls"];
          contextDocument?: Parameters<typeof openBrowserDevMolstarContextDocument>[0];
          inputDataBase64?: string | null;
          inputExtension?: string | null;
        };
      } | undefined;
      if (data?.source !== "burrete-viewer" && data?.source !== "burrete-grid") return;
      const body = data.body;
      if (!isKnownViewerMessageSource(event.source, body?.documentId)) return;
      if (data.source === "burrete-viewer" && body?.type === "renderXyzrenderSheetItem") {
        if (!body.requestId) return;
        const reply = (bodyPayload: Record<string, unknown>) => {
          postMessageToViewerSource(event.source, {
            source: "burrete-host",
            body: {
              requestId: body.requestId,
              documentId: body.documentId,
              ...bodyPayload,
            },
          });
        };
        if (!isTauriRuntime()) {
          reply({
            type: "xyzrenderSheetItemError",
            error: "Desktop xyzrender sheet rendering is unavailable outside the Tauri runtime.",
          });
          return;
        }
        void (async () => {
          try {
            const result = await invoke<{
              svg: string;
              preset?: string;
              elapsedMs?: number;
              log?: string;
            }>("render_xyzrender_sheet_item", {
              request: {
                path: body.path,
                preset: body.preset ?? null,
                controls: body.controls ?? null,
                inputDataBase64: body.inputDataBase64 ?? null,
                inputExtension: body.inputExtension ?? null,
              },
            });
            reply({
              type: "xyzrenderSheetItemRendered",
              svg: result.svg,
              preset: result.preset ?? null,
              elapsedMs: result.elapsedMs ?? null,
              log: result.log ?? "",
            });
          } catch (error) {
            reply({
              type: "xyzrenderSheetItemError",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();
        return;
      }
      if (data.source === "burrete-grid") {
        if (body?.type === "gridFetchPage") {
          if (!body.requestId || !body.documentId) return;
          if (!isTauriRuntime()) {
            postMessageToViewerSource(event.source, {
              source: "burrete-grid-host",
              body: {
                type: "gridError",
                requestId: body.requestId,
                documentId: body.documentId,
                error: "Desktop grid paging is unavailable outside the Tauri runtime.",
              },
            });
            return;
          }
          void (async () => {
            try {
              const result = await invoke("grid_fetch_page", {
                request: {
                  documentId: body.documentId,
                  query: typeof body.query === "string" ? body.query : "",
                  sort: typeof body.sort === "string" ? body.sort : "index",
                  offset: typeof body.offset === "number" ? body.offset : 0,
                  limit: typeof body.limit === "number" ? body.limit : 96,
                },
              });
              postMessageToViewerSource(event.source, {
                source: "burrete-grid-host",
                body: {
                  type: "gridPage",
                  requestId: body.requestId,
                  documentId: body.documentId,
                  result,
                },
              });
            } catch (error) {
              postMessageToViewerSource(event.source, {
                source: "burrete-grid-host",
                body: {
                  type: "gridError",
                  requestId: body.requestId,
                  documentId: body.documentId,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
            }
          })();
          return;
        }
      }
      if (body?.type === "error") {
        pushStatus(formatViewerError(body.message, body.documentId, documents), "error", body.message ? [body.message] : []);
        return;
      }
      if (body?.type === "setXyzrenderOrientation") {
        xyzrenderOrientationRefRef.current = body.text ?? body.value ?? null;
        return;
      }
      if (body?.type === "setXyzrenderPreset") {
        pendingViewerReloadDocumentIdRef.current = body.documentId ?? null;
        pendingViewerReloadOptionsRef.current = {
          xyzrenderPreset: body.value ?? null,
          xyzrenderOrientationRef: xyzrenderOrientationRefRef.current,
          xyzrenderControls: pendingViewerReloadOptionsRef.current?.xyzrenderControls ?? null,
        };
        void reloadActive();
        return;
      }
      if (body?.type === "setXyzrenderControls") {
        pendingViewerReloadDocumentIdRef.current = body.documentId ?? null;
        pendingViewerReloadOptionsRef.current = {
          xyzrenderPreset: pendingViewerReloadOptionsRef.current?.xyzrenderPreset ?? null,
          xyzrenderOrientationRef: xyzrenderOrientationRefRef.current,
          xyzrenderControls: body.controls ?? null,
        };
        void reloadActive();
        return;
      }
      if (body?.type === "openSdfPoseDocument") {
        const targetDocument = (body.documentId
          ? documents.find((document) => document.id === body.documentId)
          : null) ?? activeDocument;
        if (targetDocument) {
          const receptorDocument = documents.find((document) => (
            document.path !== targetDocument.path && isProteinLikeDockingSource(document.path)
          ));
          if (receptorDocument) {
            pushStatus("Opening SDF poses in Mol* docking view...");
            void openDockingDocument(receptorDocument.path, [targetDocument.path]);
          } else {
            pushStatus("Opening SDF poses in Mol*...");
            void openDocuments([targetDocument.path], {}, { rendererMode: "molstar" });
          }
        }
        return;
      }
      if (body?.type === "openSdfGridDocument") {
        const targetDocument = (body.documentId
          ? documents.find((document) => document.id === body.documentId)
          : null) ?? activeDocument;
        const targetPath = typeof body.path === "string" && body.path.trim().length > 0
          ? body.path.trim()
          : targetDocument?.path;
        if (targetPath) {
          pushStatus("Opening SDF grid...");
          void openDocuments([targetPath], undefined, { rendererMode: "auto" });
        }
        return;
      }
      if (body?.type === "openMolstarContextDocument") {
        if (body.contextDocument && typeof body.contextDocument === "object") {
          pushStatus("Opening selected Mol* context...");
          void openBrowserDevMolstarContextDocument(body.contextDocument, preferences)
            .then((document) => {
              addDocuments([document]);
              rememberRecentStructures([document]);
              pushStatus("Opened selected Mol* context");
            })
            .catch((error) => pushErrorStatus(error, "Mol* context view failed"));
          return;
        }
        const targetDocument = (body.documentId
          ? documents.find((document) => document.id === body.documentId)
          : null) ?? activeDocument;
        if (targetDocument?.dockingRequest) {
          pushStatus("Opening separate Mol* docking view...");
          void openDockingDocument(targetDocument.dockingRequest.receptorPath, targetDocument.dockingRequest.ligandPaths);
        } else if (targetDocument?.path && !targetDocument.virtual) {
          pushStatus("Opening separate Mol* view...");
          void openDocuments([targetDocument.path], undefined, { rendererMode: "molstar" });
        } else {
          pushStatus("This virtual structure cannot be opened separately.", "error");
        }
        return;
      }
      if (body?.type === "setRenderer") {
        const renderer = body.value;
        if (renderer === "auto" || renderer === "xyz-fast" || renderer === "molstar" || renderer === "xyzrender-external") {
          const targetDocument = (body.documentId
            ? documents.find((document) => document.id === body.documentId)
            : null) ?? activeDocument;
          const reloadOptions = renderer === "xyzrender-external"
            ? {
                xyzrenderOrientationRef: body.orientationRef ?? xyzrenderOrientationRefRef.current,
                xyzrenderPreset: body.preset ?? pendingViewerReloadOptionsRef.current?.xyzrenderPreset ?? null,
                xyzrenderControls: body.controls ?? pendingViewerReloadOptionsRef.current?.xyzrenderControls ?? null,
              }
            : undefined;
          if (renderer === "xyzrender-external" && body.orientationRef) {
            xyzrenderOrientationRefRef.current = body.orientationRef;
          }
          pendingViewerReloadOptionsRef.current = renderer === "xyzrender-external"
            ? {
                xyzrenderOrientationRef: body.orientationRef ?? xyzrenderOrientationRefRef.current,
                xyzrenderPreset: body.preset ?? pendingViewerReloadOptionsRef.current?.xyzrenderPreset ?? null,
                xyzrenderControls: body.controls ?? pendingViewerReloadOptionsRef.current?.xyzrenderControls ?? null,
              }
            : null;
          pendingViewerReloadDocumentIdRef.current = renderer === "xyzrender-external"
            ? body.documentId ?? null
            : null;
          skipNextPreferenceRefreshRef.current = true;
          setPreference("rendererMode", renderer);
          if (targetDocument) {
            pendingViewerReloadOptionsRef.current = null;
            pendingViewerReloadDocumentIdRef.current = null;
            void openDocuments([targetDocument.path], reloadOptions, { rendererMode: renderer });
          }
        }
        return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [activeDocument, documents, openDockingDocument, openDocuments, pushStatus, reloadActive, setPreference]);

  useEffect(() => {
    const loadedPreferences = loadUpdatePreferences();
    if (shouldCheckAutomatically(loadedPreferences)) {
      void checkForUpdates(true, loadedPreferences.channel);
    }
  }, [checkForUpdates]);

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
    const paths = Array.from(new Set(tabs
      .map((tab) => tab.location.kind === "file" ? tab.location.path : null)
      .filter((path): path is string => Boolean(path))));
    if (paths.length === 0) return;
    const restoreTabId = activeTabId;
    void openDocuments(paths).then(() => {
      if (restoreTabId) setActiveTab(restoreTabId);
    });
    // Preferences refresh all open runtimes so inactive tabs do not keep stale renderer/theme output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences]);

  const startSidebarResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setSidebarDragging(true);
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (move: PointerEvent) => {
        setSidebarWidth(startWidth + move.clientX - startX);
      };
      const stop = () => {
        setSidebarDragging(false);
        document.documentElement.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [setSidebarWidth, sidebarWidth],
  );

  const actions = useMemo<ShellActions>(() => ({
    chooseFiles,
    openRecentStructure,
    selectDocument,
    selectTab: setActiveTab,
    openNewTab,
    canNavigateBack,
    canNavigateForward,
    navigateBack,
    navigateForward,
    focusSidebarSearch,
    openCommandPalette,
    openSettings,
    chooseWorkspace,
    openWorkspaceFolder,
    openProjectFolder,
    toggleSidebar,
    toggleProjectsOpen,
    setExpandedProjectIds,
    setSidebarQuery,
    toggleProjectExpanded,
    togglePinnedStructure,
    closeDocument,
    closeTab,
    closeActiveDocument: () => {
      closeActiveDocument();
      pushStatus("Closed active structure");
    },
    clearAllDocuments: () => {
      closeAllDocuments();
      pushStatus("Closed all structures");
    },
    openDockingDocument,
    addXyzrenderSheetItems: addXyzrenderSheetItemsToDocument,
    mergeMoleculeCollections,
    saveMoleculeCollectionAs,
    setStructureDragActive,
    clearRecentStructures: () => {
      clearRecentStructures();
      pushStatus("Recent structures cleared");
    },
    clearCache: async () => {
      try {
        await invoke("clear_preview_cache");
        pushStatus("Preview cache cleared");
      } catch (error) {
        pushErrorStatus(error, "Preview cache clear failed");
      }
    },
    resetQuickLook: async () => {
      try {
        const report = await invoke<{ ok: boolean }>("reset_quick_look");
        pushStatus(report.ok ? "Quick Look reset completed" : "Quick Look reset reported issues", report.ok ? "info" : "error");
      } catch (error) {
        pushErrorStatus(error, "Quick Look reset failed");
      }
    },
    openLogs: async () => {
      try {
        await invoke("open_logs_folder");
        pushStatus("Opened logs folder");
      } catch (error) {
        pushErrorStatus(error, "Open logs folder failed");
      }
    },
    checkForUpdates: async () => {
      await checkForUpdates(false);
    },
    installUpdate: async () => {
      await installUpdate();
    },
    openUpdateRelease: async () => {
      try {
        const url = releasePageUrl(update.availableRelease);
        if (isTauriRuntime()) {
          await invoke("open_external_url", { url });
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        pushStatus("Opened release page");
      } catch (error) {
        pushErrorStatus(error, "Open release page failed");
      }
    },
    setPreference,
    setUpdatePreferences,
  }), [addXyzrenderSheetItemsToDocument, canNavigateBack, canNavigateForward, checkForUpdates, chooseFiles, chooseWorkspace, clearRecentStructures, closeActiveDocument, closeAllDocuments, closeDocument, closeTab, focusSidebarSearch, installUpdate, mergeMoleculeCollections, navigateBack, navigateForward, openCommandPalette, openDockingDocument, openNewTab, openProjectFolder, openRecentStructure, openSettings, openWorkspaceFolder, pushErrorStatus, pushStatus, saveMoleculeCollectionAs, selectDocument, setActiveTab, setExpandedProjectIds, setPreference, setSidebarQuery, setUpdatePreferences, togglePinnedStructure, toggleProjectExpanded, toggleProjectsOpen, toggleSidebar, update.availableRelease]);

  const page = activeTab?.location.kind === "settings" ? "settings" : "viewer";

  const state: ShellViewState = {
    documents,
    tabs,
    activeTab,
    activeTabId,
    activeDocument,
    activeDocumentId: activeDocument?.id ?? null,
    visibleDocuments: documents,
    recentStructures,
    sidebarProjects: allSidebarProjects,
    projectsOpen,
    expandedProjectIds,
    pinnedStructurePaths,
    workspacePath,
    page,
    sidebarOpen,
    sidebarWidth,
    sidebarDragging,
    structureDragActive,
    sidebarQuery,
    status,
    dropActive,
    preferences,
    update,
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
        onDragEnter={handleBrowserDrag}
        onDragOver={handleBrowserDrag}
        onDragLeave={handleBrowserDragLeave}
        onDrop={handleBrowserDrop}
      />
      <CommandPalette
        state={state}
        actions={actions}
        isOpen={commandPaletteOpen}
        query={commandPaletteQuery}
        onQueryChange={setCommandPaletteQuery}
        onClose={closeCommandPalette}
      />
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
  if (!source || typeof source !== "object" || !("postMessage" in source) || typeof source.postMessage !== "function") {
    return;
  }
  (source as Window).postMessage(payload, "*");
}

function summarizeErrors(errors: string[]) {
  const [first = "Unknown error", ...rest] = errors.map(summarizeErrorText);
  return rest.length > 0
    ? `${first} (+${rest.length} more ${rest.length === 1 ? "issue" : "issues"})`
    : first;
}

function summarizeErrorText(message: string) {
  return (message || "Unknown error").trim().split(/\r?\n| Error:| at /)[0]?.trim() || "Unknown error";
}

function downloadTextFile(fileName: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatViewerError(
  message: string | undefined,
  documentId: string | undefined,
  documents: { id: string; title: string }[],
) {
  const text = (message || "Viewer error").trim();
  const title = documentId
    ? documents.find((document) => document.id === documentId)?.title
    : null;
  const summary = summarizeErrorText(text);
  return title ? `${title}: ${summary}` : summary;
}
