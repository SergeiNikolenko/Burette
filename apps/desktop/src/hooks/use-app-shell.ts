import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { ShellActions, ShellViewState } from "../components/types";
import { devInstanceBadge, devInstanceBadgeFor, isDevInstance } from "../dev-instance";
import {
  useCloseCommandPalette,
  useCommandPaletteIntent,
  useIsCommandPaletteOpen,
  useOpenCommandPalette,
} from "./use-command-palette";
import { useFileWatcher } from "./use-file-watcher";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { useMenuEvents } from "./use-menu-events";
import { useOpenDrop } from "./use-open-drop";
import { useRecentFiles } from "./use-recent-files";
import { useSidebar } from "./use-sidebar";
import { useTabs } from "./use-tabs";
import { useTheme } from "./use-theme";
import { useWorkspace } from "./use-workspace";
import { basename, isTauriRuntime, saveWorkspaceSession } from "./workspace-api";
import * as tauri from "../lib/tauri";
import { applyTheme } from "../lib/theme";
import { useAppStore } from "../store";
import { hydrateSettingsFromBackend, setSetting } from "../stores/settings-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import type { ViewerDocument, ViewerPreferences } from "../types";
import {
  checkForUpdates as requestUpdateCheck,
  loadUpdatePreferences,
  markAutomaticCheck,
  releasePageUrl,
  saveUpdatePreferences,
  shouldCheckAutomatically,
} from "../update";
import type { UpdatePreferences, UpdateState } from "../update";

function clampSidebarWidth(width: number, viewportWidth: number) {
  const maxSidebarWidth = Math.max(280, Math.min(420, Math.floor(viewportWidth * 0.35)));
  return Math.max(220, Math.min(maxSidebarWidth, Math.round(width)));
}

function tabInstanceId(id: string) {
  return `${id}:${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function asNewTabDocuments(documents: ViewerDocument[]) {
  return documents.map((document) => ({ ...document, id: tabInstanceId(document.id) }));
}

export function useAppShell() {
  const documents = useAppStore((state) => state.documents);
  const activeDocumentId = useAppStore((state) => state.activeDocumentId);
  const preferences = useAppStore((state) => state.preferences);
  const recentFiles = useAppStore((state) => state.recentFiles);
  const addDocuments = useAppStore((state) => state.addDocuments);
  const appendDocuments = useAppStore((state) => state.appendDocuments);
  const pushRecentFiles = useAppStore((state) => state.pushRecentFiles);
  const pruneRecentFiles = useAppStore((state) => state.pruneRecentFiles);
  const setActiveDocument = useAppStore((state) => state.setActiveDocument);
  const closeDocument = useAppStore((state) => state.closeDocument);
  const closeActiveDocument = useAppStore((state) => state.closeActiveDocument);
  const closeAllDocuments = useAppStore((state) => state.closeAllDocuments);
  const closeWorkspace = useAppStore((state) => state.closeWorkspace);
  const workspaceRoot = useWorkspaceStore((state) => state.workspaceRoot);
  const recentWorkspaces = useWorkspaceStore((state) => state.recentWorkspaces);
  const setWorkspaceRoot = useWorkspaceStore((state) => state.setWorkspaceRoot);
  const setRecentWorkspaces = useWorkspaceStore((state) => state.setRecentWorkspaces);
  const setWorkspaceDirectory = useWorkspaceStore((state) => state.setWorkspaceDirectory);
  const {
    isSidebarVisible: sidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebar,
  } = useSidebar();
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1200 : window.innerWidth,
  );
  const [draftSidebarWidth, setDraftSidebarWidth] = useState(() =>
    clampSidebarWidth(sidebarWidth, typeof window === "undefined" ? 1200 : window.innerWidth),
  );
  const draftSidebarWidthRef = useRef(draftSidebarWidth);
  const [status, setStatus] = useState("Ready");
  const setPreference = useCallback(
    <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => {
      setSetting(key, value);
    },
    [],
  );
  const [dropActive, setDropActive] = useState(false);
  const commandPaletteOpen = useIsCommandPaletteOpen();
  const commandPaletteIntent = useCommandPaletteIntent();
  const openCommandPalette = useOpenCommandPalette();
  const closeCommandPalette = useCloseCommandPalette();
  const [update, setUpdate] = useState<UpdateState>(() => ({
    preferences: loadUpdatePreferences(),
    isChecking: false,
    statusText: "No update check has run yet.",
    availableRelease: null,
  }));

  const activeDocument = useMemo(
    () => documents.find((document) => document.id === activeDocumentId) ?? null,
    [documents, activeDocumentId],
  );
  const workspaceRecentFiles = useRecentFiles(recentFiles, workspaceRoot, pruneRecentFiles);
  const { toggleTheme } = useTheme();
  const [nativeInstanceName, setNativeInstanceName] = useState<string | null>(null);
  const instanceLabel = nativeInstanceName
    ? devInstanceBadgeFor(nativeInstanceName)
    : isDevInstance()
      ? devInstanceBadge()
      : null;

  useEffect(() => {
    applyTheme(preferences);
  }, [preferences]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void tauri.developmentInstanceName()
      .then(setNativeInstanceName)
      .catch(() => setNativeInstanceName(null));
  }, []);

  useEffect(() => {
    void hydrateSettingsFromBackend().catch((error) => {
      setStatus("Settings restore failed: " + (error instanceof Error ? error.message : String(error)));
    });
  }, []);

  const {
    page,
    tabs,
    activeTabId,
    tabIds,
    canNavigateBack,
    canNavigateForward,
    selectDocument,
    selectTab,
    cycleDocument,
    navigateBack,
    navigateForward,
    closeTab,
    closeDocumentWithHistory,
    closeActiveDocumentWithHistory,
    closeAllDocumentsWithHistory,
    closeAllTabs,
    closeWorkspaceWithHistory,
    activateOpenedDocuments,
    activateNewTabDocuments,
    openLauncher,
    openSettings,
  } = useTabs({
    documents,
    activeDocumentId,
    setActiveDocument,
    closeDocument,
    closeActiveDocument,
    closeAllDocuments,
    closeWorkspace,
  });

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  const setClampedDraftSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampSidebarWidth(width, viewportWidth);
    draftSidebarWidthRef.current = nextWidth;
    setDraftSidebarWidth(nextWidth);
    return nextWidth;
  }, [viewportWidth]);

  useEffect(() => {
    if (sidebarDragging) return;
    setClampedDraftSidebarWidth(sidebarWidth);
  }, [setClampedDraftSidebarWidth, sidebarDragging, sidebarWidth]);

  const focusSidebarSearch = useCallback(() => {
    openCommandPalette("search");
  }, [openCommandPalette]);

  const openDocuments = useCallback(
    async (paths: string[]) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return [];
      setStatus("Opening structures...");
      try {
        const result = await tauri.openDocuments(cleanPaths, preferences);
        const nextActiveId = result.documents[0]?.id ?? null;
        pushRecentFiles(result.documents.map((document) => document.path));
        addDocuments(result.documents);
        activateOpenedDocuments(nextActiveId);
        const openedText = "Opened " + result.documents.length + " structure" + (result.documents.length === 1 ? "" : "s");
        setStatus(result.errors.length > 0 ? openedText + "; skipped " + result.errors.length : openedText);
        return result.documents;
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
        return [];
      }
    },
    [activateOpenedDocuments, addDocuments, preferences, pushRecentFiles],
  );

  const {
    rememberWorkspace,
    openWorkspace,
    chooseFiles,
    chooseFolder,
    removeRecentWorkspace,
  } = useWorkspace({
    workspaceRoot,
    recentWorkspaces,
    setWorkspaceRoot,
    setRecentWorkspaces,
    setWorkspaceDirectory,
    setActiveDocument,
    closeWorkspace: closeWorkspaceWithHistory,
    openDocuments,
    setStatus,
  });

  const openWorkspaceFile = useCallback(async (path: string) => {
    await openDocuments([path]);
  }, [openDocuments]);

  const openWorkspaceFileInNewTab = useCallback(async (path: string) => {
    setStatus("Opening structure...");
    try {
      const result = await tauri.openDocuments([path], preferences);
      const documents = asNewTabDocuments(result.documents);
      const nextActiveId = documents[0]?.id ?? null;
      pushRecentFiles(result.documents.map((document) => document.path));
      appendDocuments(documents);
      activateNewTabDocuments(nextActiveId);
      const openedText = "Opened " + result.documents.length + " structure" + (result.documents.length === 1 ? "" : "s");
      setStatus(result.errors.length > 0 ? openedText + "; skipped " + result.errors.length : openedText);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [activateNewTabDocuments, appendDocuments, preferences, pushRecentFiles]);

  const createWorkspaceFile = useCallback(async (path: string) => {
    if (!workspaceRoot) return;
    try {
      const exists = await tauri.fileExists(path);
      if (exists) {
        window.alert(`${path} already exists`);
        return;
      }
      await tauri.createEmptyFile(path);
      window.dispatchEvent(new CustomEvent("burrete:workspace-files-changed"));
      await openDocuments([path]);
      setStatus("Created " + basename(path));
    } catch (error) {
      setStatus("Create failed: " + (error instanceof Error ? error.message : String(error)));
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [openDocuments, workspaceRoot]);

  const {
    handleBrowserDrag,
    handleBrowserDragLeave,
    handleBrowserDrop,
  } = useOpenDrop({
    workspaceRoot,
    openDocuments,
    openWorkspace,
    rememberWorkspace,
    setDropActive,
    setRecentWorkspaces,
    setStatus,
  });

  useFileWatcher({
    workspaceRoot,
    openDocuments,
    closeDocument: closeDocumentWithHistory,
    setStatus,
  });

  useEffect(() => {
    if (!isTauriRuntime() || !workspaceRoot) return;
    const paths = documents.map((document) => document.path);
    const activePath = activeDocument?.path ?? null;
    const timer = window.setTimeout(() => {
      void saveWorkspaceSession(workspaceRoot, paths, activePath).catch((error) => {
        setStatus("Workspace session save failed: " + (error instanceof Error ? error.message : String(error)));
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeDocument?.path, documents, workspaceRoot]);

  const reloadActive = useCallback(async () => {
    if (!activeDocument) return;
    await openDocuments([activeDocument.path]);
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
      if (automatic) markAutomaticCheck(true);
    } catch (error) {
      setUpdate((previous) => ({
        ...previous,
        isChecking: false,
        statusText: "Update check failed: " + (error instanceof Error ? error.message : String(error)),
      }));
      if (automatic) markAutomaticCheck(false);
    }
  }, [update.preferences.channel]);

  useMenuEvents({
    openSettings,
    checkForUpdates: () => checkForUpdates(false),
  });

  useEffect(() => {
    const loadedPreferences = loadUpdatePreferences();
    if (shouldCheckAutomatically(loadedPreferences)) {
      void checkForUpdates(true, loadedPreferences.channel);
    }
  }, [checkForUpdates]);

  useEffect(() => {
    if (activeDocument) void reloadActive();
    // Preferences intentionally refresh only the active runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.theme, preferences.canvasBackground, preferences.rendererMode, preferences.xyzFastStyle]);

  const startSidebarResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setSidebarDragging(true);
      const startX = event.clientX;
      const startWidth = draftSidebarWidthRef.current;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (move: PointerEvent) => {
        setClampedDraftSidebarWidth(startWidth + move.clientX - startX);
      };
      const stop = (shouldPersist: boolean) => {
        setSidebarDragging(false);
        document.documentElement.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        if (shouldPersist) {
          setSidebarWidth(draftSidebarWidthRef.current);
        } else {
          setClampedDraftSidebarWidth(sidebarWidth);
        }
      };
      const onPointerUp = () => {
        stop(true);
      };
      const onPointerCancel = () => {
        stop(false);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    },
    [setClampedDraftSidebarWidth, setSidebarWidth, sidebarWidth],
  );

  const actions = useMemo<ShellActions>(() => ({
    chooseFiles,
    chooseFolder,
    openWorkspace,
    openWorkspaceFile,
    openWorkspaceFileInNewTab,
    createWorkspaceFile,
    removeRecentWorkspace,
    toggleSidebar,
    toggleTheme,
    selectTab,
    selectDocument,
    cycleDocument,
    navigateBack,
    navigateForward,
    reloadActive,
    focusSidebarSearch,
    openLauncher,
    openSettings,
    openCommandPalette,
    closeCommandPalette,
    closeTab,
    closeDocument: closeDocumentWithHistory,
    closeActiveDocument: () => {
      if (activeTabId && tabIds.has(activeTabId)) {
        closeTab(activeTabId);
        setStatus("Closed tab");
        return;
      }
      closeActiveDocumentWithHistory();
      setStatus("Closed active structure");
    },
    clearAllDocuments: () => {
      closeAllDocumentsWithHistory();
      setStatus("Closed all structures");
    },
    closeAllTabs: () => {
      closeAllTabs();
      setStatus("Closed all tabs");
    },
    closeWorkspace: () => {
      closeWorkspaceWithHistory();
      setStatus("Closed workspace");
    },
    clearCache: async () => {
      await tauri.clearPreviewCache();
      setStatus("Preview cache cleared");
    },
    resetQuickLook: async () => {
      await tauri.resetQuickLook();
      setStatus("Quick Look reset requested");
    },
    openLogs: async () => {
      await tauri.openLogsFolder();
      setStatus("Opened logs folder");
    },
    checkForUpdates: async () => {
      await checkForUpdates(false);
    },
    openUpdateRelease: async () => {
      const url = releasePageUrl(update.availableRelease);
      if (isTauriRuntime()) {
        await tauri.openExternalUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      setStatus("Opened release page");
    },
    setPreference,
    setUpdatePreferences,
  }), [activeTabId, chooseFiles, chooseFolder, openWorkspace, openWorkspaceFile, openWorkspaceFileInNewTab, createWorkspaceFile, removeRecentWorkspace, toggleSidebar, toggleTheme, checkForUpdates, closeActiveDocumentWithHistory, closeDocumentWithHistory, closeAllDocumentsWithHistory, closeAllTabs, closeWorkspaceWithHistory, closeTab, cycleDocument, reloadActive, focusSidebarSearch, navigateBack, navigateForward, openLauncher, openSettings, openCommandPalette, selectDocument, selectTab, setPreference, setUpdatePreferences, tabIds, update.availableRelease]);

  const state: ShellViewState = {
    tabs,
    activeTabId,
    documents,
    activeDocument,
    activeDocumentId,
    workspaceRoot,
    recentWorkspaces,
    recentFiles: workspaceRecentFiles,
    page,
    canNavigateBack,
    canNavigateForward,
    sidebarOpen,
    sidebarWidth: draftSidebarWidth,
    sidebarDragging,
    commandPaletteOpen,
    commandPaletteIntent,
    status,
    dropActive,
    preferences,
    update,
    instanceLabel,
  };

  useKeyboardShortcuts(state, actions);

  return {
    state,
    actions,
    toggleSidebar,
    startSidebarResize,
    handleBrowserDrag: handleBrowserDrag as (event: React.DragEvent<HTMLElement>) => void,
    handleBrowserDragLeave: handleBrowserDragLeave as (event: React.DragEvent<HTMLElement>) => void,
    handleBrowserDrop: handleBrowserDrop as (event: React.DragEvent<HTMLElement>) => void,
  };
}
