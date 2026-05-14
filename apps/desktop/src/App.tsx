import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { AppLayout } from "./components/app-layout";
import { CommandPalette } from "./components/command-palette";
import type { ShellActions, ShellViewState } from "./components/types";
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
  const { sidebarOpen, sidebarWidth, setSidebarWidth, toggleSidebar } = useSidebar();
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>(() => ({
    preferences: loadUpdatePreferences(),
    isChecking: false,
    isInstalling: false,
    statusText: "No update check has run yet.",
    availableRelease: null,
  }));
  const sidebarSearchRef = useRef<HTMLButtonElement | null>(null);
  const refreshedPersistedSessionRef = useRef(false);
  const openedBrowserDevFilesRef = useRef(false);
  const syncingBrowserDevFilesRef = useRef(false);
  const pendingViewerReloadOptionsRef = useRef<ViewerReloadOptions | null>(null);
  const xyzrenderOrientationRefRef = useRef<string | null>(null);
  const commandPaletteOpen = useIsCommandPaletteOpen();
  const commandPaletteQuery = useCommandPaletteSearch();
  const openCommandPalette = useOpenCommandPalette();
  const closeCommandPalette = useCloseCommandPalette();
  const setCommandPaletteQuery = useSetCommandPaletteSearch();

  const selectDocument = useCallback((id: string) => {
    setActiveDocument(id);
  }, [setActiveDocument]);

  const focusSidebarSearch = useCallback(() => {
    if (!sidebarOpen) toggleSidebar();
    requestAnimationFrame(() => sidebarSearchRef.current?.focus());
  }, [sidebarOpen, toggleSidebar]);

  const openDocuments = useCallback(
    async (paths: string[], reloadOptions?: ViewerReloadOptions) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return;
      setStatus("Opening structures...");
      try {
        const result = isTauriRuntime()
          ? await invoke<OpenDocumentsResult>("open_documents", { paths: cleanPaths, preferences, reloadOptions })
          : await openBrowserDevDocuments(cleanPaths, preferences, reloadOptions);
        addDocuments(result.documents);
        rememberRecentStructures(result.documents);
        const openedText = "Opened " + result.documents.length + " structure" + (result.documents.length === 1 ? "" : "s");
        setStatus(result.errors.length > 0 ? openedText + "; skipped " + result.errors.length : openedText);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [addDocuments, preferences, rememberRecentStructures],
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
    if (workspace) setWorkspacePath(workspace);
    closeAllDocuments();
    void openDocuments(paths).finally(() => {
      syncingBrowserDevFilesRef.current = false;
    });
  }, [closeAllDocuments, documents, openDocuments]);

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
    const selection = await open({ multiple: true, filters });
    const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
    await openDocuments(paths);
  }, [openDocuments]);

  const chooseWorkspace = useCallback(async () => {
    try {
      const selection = await open({ directory: true, multiple: false });
      if (!selection || Array.isArray(selection)) return;
      setWorkspacePath(selection);
      setStatus("Workspace selected");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const openWorkspaceFolder = useCallback(async () => {
    const fallbackPath = workspacePath ?? activeDocument?.path ?? recentStructures[0]?.path ?? null;
    if (!fallbackPath) {
      await chooseWorkspace();
      return;
    }
    const path = workspacePath ?? parentDirectory(fallbackPath);
    if (!path) return;
    try {
      await openPath(path);
      setStatus("Opened workspace folder");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [activeDocument?.path, chooseWorkspace, recentStructures, workspacePath]);

  const openSettings = useCallback(() => {
    openSettingsTab();
  }, [openSettingsTab]);

  useOpenEvents(openDocuments, setStatus);
  const { dropActive, handleBrowserDrag, handleBrowserDragLeave, handleBrowserDrop } = useOpenDrop(openDocuments, setStatus);
  const reloadActive = useCallback(async () => {
    if (!activeDocument) return;
    const reloadOptions = pendingViewerReloadOptionsRef.current ?? undefined;
    pendingViewerReloadOptionsRef.current = null;
    await openDocuments([activeDocument.path], reloadOptions);
  }, [activeDocument, openDocuments]);
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
      setStatus("Opened release page");
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
    setStatus("Installing update...");
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
      setStatus("Update install failed");
    }
  }, [update.availableRelease]);

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
    }
  }, [promptForUpdate, update.preferences.channel]);

  useMenuEvents({ chooseFiles, openSettings, checkForUpdates });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        body?: {
          type?: string;
          value?: string;
          documentId?: string;
          orientationRef?: string | null;
          text?: string | null;
        };
      } | undefined;
      if (data?.source !== "burrete-viewer") return;
      const body = data.body;
      if (!isKnownViewerMessageSource(event.source, body?.documentId)) return;
      if (body?.type === "setXyzrenderOrientation") {
        xyzrenderOrientationRefRef.current = body.text ?? body.value ?? null;
        return;
      }
      if (body?.type === "setXyzrenderPreset") {
        pendingViewerReloadOptionsRef.current = {
          xyzrenderPreset: body.value ?? null,
          xyzrenderOrientationRef: xyzrenderOrientationRefRef.current,
        };
        void reloadActive();
        return;
      }
      if (body?.type === "setRenderer") {
        const renderer = body.value;
        if (renderer === "auto" || renderer === "xyz-fast" || renderer === "molstar" || renderer === "xyzrender-external") {
          if (renderer === "xyzrender-external" && body.orientationRef) {
            xyzrenderOrientationRefRef.current = body.orientationRef;
          }
          pendingViewerReloadOptionsRef.current = renderer === "xyzrender-external" && body.orientationRef
            ? { xyzrenderOrientationRef: body.orientationRef }
            : null;
          setPreference("rendererMode", renderer);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [reloadActive, setPreference]);

  useEffect(() => {
    const loadedPreferences = loadUpdatePreferences();
    if (shouldCheckAutomatically(loadedPreferences)) {
      void checkForUpdates(true, loadedPreferences.channel);
    }
  }, [checkForUpdates]);

  useEffect(() => {
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
  }, [preferences.theme, preferences.canvasBackground, preferences.rendererMode, preferences.xyzFastStyle]);

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
    toggleSidebar,
    closeDocument,
    closeTab,
    closeActiveDocument: () => {
      closeActiveDocument();
      setStatus("Closed active structure");
    },
    clearAllDocuments: () => {
      closeAllDocuments();
      setStatus("Closed all structures");
    },
    clearRecentStructures: () => {
      clearRecentStructures();
      setStatus("Recent structures cleared");
    },
    clearCache: async () => {
      await invoke("clear_preview_cache");
      setStatus("Preview cache cleared");
    },
    resetQuickLook: async () => {
      const report = await invoke<{ ok: boolean }>("reset_quick_look");
      setStatus(report.ok ? "Quick Look reset completed" : "Quick Look reset reported issues");
    },
    openLogs: async () => {
      await invoke("open_logs_folder");
      setStatus("Opened logs folder");
    },
    checkForUpdates: async () => {
      await checkForUpdates(false);
    },
    installUpdate: async () => {
      await installUpdate();
    },
    openUpdateRelease: async () => {
      const url = releasePageUrl(update.availableRelease);
      if (isTauriRuntime()) {
        await invoke("open_external_url", { url });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      setStatus("Opened release page");
    },
    setPreference,
    setUpdatePreferences,
  }), [canNavigateBack, canNavigateForward, chooseFiles, chooseWorkspace, checkForUpdates, clearRecentStructures, closeActiveDocument, closeDocument, closeTab, closeAllDocuments, focusSidebarSearch, installUpdate, navigateBack, navigateForward, openCommandPalette, openNewTab, openRecentStructure, openSettings, openWorkspaceFolder, selectDocument, setActiveTab, setPreference, setUpdatePreferences, toggleSidebar, update.availableRelease]);

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
    workspacePath,
    page,
    sidebarOpen,
    sidebarWidth,
    sidebarDragging,
    sidebarQuery: "",
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

function parentDirectory(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : null;
}

function isKnownViewerMessageSource(source: MessageEventSource | null, documentId?: string) {
  if (!source || !documentId) return false;
  return Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).some(
    (iframe) => iframe.dataset.documentId === documentId && iframe.contentWindow === source,
  );
}
