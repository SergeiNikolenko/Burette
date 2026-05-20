import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
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
} from "./hooks/use-tabs";
import { useSetViewerPreference, useViewerPreferences } from "./hooks/use-settings";
import { browserDevRuntimeNeedsRefresh, openBrowserDevDocuments } from "./lib/browser-dev-documents";
import { buildSidebarProjects, parentDirectory } from "./lib/sidebar-projects";
import { isTauriRuntime } from "./lib/tauri";
import type { OpenDocumentsResult, RecentStructure, ViewerReloadOptions } from "./types";
import { checkForUpdates as requestUpdateCheck, clearDismissedUpdate, dismissUpdate, loadUpdatePreferences, markAutomaticCheck, releasePageUrl, saveUpdatePreferences, shouldCheckAutomatically, shouldPromptForUpdate } from "./update";
import type { UpdatePreferences, UpdateRelease, UpdateState } from "./update";

const filters = [
  {
    name: "Molecular structures",
    extensions: ["pdb", "ent", "pdbqt", "pqr", "cif", "mcif", "mmcif", "bcif", "sdf", "sd", "smi", "smiles", "csv", "tsv", "mol", "mol2", "xyz", "gro", "cub", "cube", "in", "log", "out", "vasp"],
  },
];

export default function App() {
  const preferences = useViewerPreferences();
  const setPreference = useSetViewerPreference();
  const tabs = useOpenTabs();
  const documents = useOpenDocuments();
  const activeTabId = useActiveTabId();
  const activeTab = useActiveTab();
  const activeDocument = useActiveDocument();
  const addDocuments = useAddTabs();
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
    projectRoots,
    expandedProjectIds,
    sidebarQuery,
    setSidebarWidth,
    addProjectRoot,
    setSidebarQuery,
    toggleProjectExpanded,
    toggleSidebar,
  } = useSidebar();
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [status, setStatus] = useState<StatusNotice | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>(() => ({
    preferences: loadUpdatePreferences(),
    isChecking: false,
    isInstalling: false,
    statusText: "No update check has run yet.",
    availableRelease: null,
  }));
  const sidebarSearchRef = useRef<HTMLInputElement | null>(null);
  const refreshedPersistedSessionRef = useRef(false);
  const openedBrowserDevFilesRef = useRef(false);
  const syncingBrowserDevFilesRef = useRef(false);
  const pendingViewerReloadOptionsRef = useRef<ViewerReloadOptions | null>(null);
  const pendingViewerReloadDocumentIdRef = useRef<string | null>(null);
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
    if (!sidebarOpen) toggleSidebar();
    requestAnimationFrame(() => sidebarSearchRef.current?.focus());
  }, [sidebarOpen, toggleSidebar]);

  const allSidebarProjects = useMemo(() => buildSidebarProjects({
    documents,
    recentStructures,
    projectRoots,
    activeDocumentId: activeDocument?.id ?? null,
  }), [activeDocument?.id, documents, projectRoots, recentStructures]);

  const activeProject = useMemo(
    () => allSidebarProjects.find((project) => project.isActive) ?? null,
    [allSidebarProjects],
  );

  const openDocuments = useCallback(
    async (
      paths: string[],
      reloadOptions?: ViewerReloadOptions,
      preferencesOverride?: Partial<typeof preferences>,
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return;
      pushStatus("Opening structures...");
      try {
        const effectivePreferences = preferencesOverride ? { ...preferences, ...preferencesOverride } : preferences;
        const result = isTauriRuntime()
          ? await invoke<OpenDocumentsResult>("open_documents", { paths: cleanPaths, preferences: effectivePreferences, reloadOptions })
          : await openBrowserDevDocuments(cleanPaths, effectivePreferences, reloadOptions);
        addDocuments(result.documents);
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
    [addDocuments, preferences, pushErrorStatus, pushStatus, rememberRecentStructures],
  );

  useEffect(() => {
    if (isTauriRuntime() || syncingBrowserDevFilesRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const rawFiles = params.get("devFiles");
    if (!rawFiles) return;
    const paths = rawFiles.split("\n").map((path) => path.trim()).filter(Boolean);
    const needsInitialOpen = !openedBrowserDevFilesRef.current;
    const needsRuntimeRefresh = openedBrowserDevFilesRef.current
      && documents.some((document) => paths.includes(document.path) && browserDevRuntimeNeedsRefresh(document));
    if (!needsInitialOpen && !needsRuntimeRefresh) return;
    openedBrowserDevFilesRef.current = true;
    syncingBrowserDevFilesRef.current = true;
    const workspace = paths[0] ? parentDirectory(paths[0]) : null;
    if (workspace) {
      setWorkspacePath(workspace);
      addProjectRoot(workspace);
    }
    closeAllDocuments();
    void openDocuments(paths).finally(() => {
      syncingBrowserDevFilesRef.current = false;
    });
  }, [addProjectRoot, closeAllDocuments, documents, openDocuments]);

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

  useOpenEvents(openDocuments, pushErrorStatus);
  const { dropActive, handleBrowserDrag, handleBrowserDragLeave, handleBrowserDrop } = useOpenDrop(openDocuments, pushStatus);
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
          message?: string;
          value?: string;
          documentId?: string;
          orientationRef?: string | null;
          text?: string | null;
          controls?: ViewerReloadOptions["xyzrenderControls"];
        };
      } | undefined;
      if (data?.source !== "burrete-viewer" && data?.source !== "burrete-grid") return;
      const body = data.body;
      if (!isKnownViewerMessageSource(event.source, body?.documentId)) return;
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
      if (body?.type === "setRenderer") {
        const renderer = body.value;
        if (renderer === "auto" || renderer === "xyz-fast" || renderer === "molstar" || renderer === "xyzrender-external") {
          const targetDocument = (body.documentId
            ? documents.find((document) => document.id === body.documentId)
            : null) ?? activeDocument;
          const reloadOptions = renderer === "xyzrender-external" && body.orientationRef
            ? { xyzrenderOrientationRef: body.orientationRef }
            : undefined;
          if (renderer === "xyzrender-external" && body.orientationRef) {
            xyzrenderOrientationRefRef.current = body.orientationRef;
          }
          pendingViewerReloadOptionsRef.current = renderer === "xyzrender-external" && body.orientationRef
            ? {
                xyzrenderOrientationRef: body.orientationRef,
                xyzrenderPreset: pendingViewerReloadOptionsRef.current?.xyzrenderPreset ?? null,
                xyzrenderControls: pendingViewerReloadOptionsRef.current?.xyzrenderControls ?? null,
              }
            : null;
          pendingViewerReloadDocumentIdRef.current = renderer === "xyzrender-external" && body.orientationRef
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
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [activeDocument, documents, openDocuments, pushStatus, reloadActive, setPreference]);

  useEffect(() => {
    const loadedPreferences = loadUpdatePreferences();
    if (shouldCheckAutomatically(loadedPreferences)) {
      void checkForUpdates(true, loadedPreferences.channel);
    }
  }, [checkForUpdates]);

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
  }, [preferences.theme, preferences.canvasBackground, preferences.rendererMode, preferences.molstarStyle, preferences.xyzFastStyle]);

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
    setSidebarQuery,
    toggleProjectExpanded,
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
  }), [canNavigateBack, canNavigateForward, checkForUpdates, chooseFiles, chooseWorkspace, clearRecentStructures, closeActiveDocument, closeAllDocuments, closeDocument, closeTab, focusSidebarSearch, installUpdate, navigateBack, navigateForward, openCommandPalette, openNewTab, openProjectFolder, openRecentStructure, openSettings, openWorkspaceFolder, pushErrorStatus, pushStatus, selectDocument, setActiveTab, setPreference, setSidebarQuery, setUpdatePreferences, toggleProjectExpanded, toggleSidebar, update.availableRelease]);

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
    expandedProjectIds,
    workspacePath,
    page,
    sidebarOpen,
    sidebarWidth,
    sidebarDragging,
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
        searchRef={sidebarSearchRef}
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

function summarizeErrors(errors: string[]) {
  const [first = "Unknown error", ...rest] = errors;
  return rest.length > 0
    ? `${first} (+${rest.length} more ${rest.length === 1 ? "issue" : "issues"})`
    : first;
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
  return title ? `${title}: ${text}` : text;
}
