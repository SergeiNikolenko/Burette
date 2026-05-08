import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragDropEvent } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { AppLayout } from "./components/AppLayout";
import { matchesQuery } from "./components/format";
import type { AppPage, ShellActions, ShellViewState } from "./components/types";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAppStore } from "./store";
import type { ViewerDocument } from "./types";
import { checkForUpdates as requestUpdateCheck, loadUpdatePreferences, markAutomaticCheck, releasePageUrl, saveUpdatePreferences, shouldCheckAutomatically } from "./update";
import type { UpdatePreferences, UpdateState } from "./update";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const filters = [
  {
    name: "Molecular structures",
    extensions: ["pdb", "cif", "mmcif", "bcif", "sdf", "sd", "smi", "smiles", "csv", "tsv", "mol", "mol2", "xyz", "gro", "cub", "cube"],
  },
];

export default function App() {
  const {
    documents,
    activeDocumentId,
    sidebarOpen,
    preferences,
    addDocuments,
    setActiveDocument,
    closeDocument,
    closeActiveDocument,
    closeAllDocuments,
    toggleSidebar,
    setPreference,
  } = useAppStore();
  const [sidebarWidth, setSidebarWidth] = useState(268);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [page, setPage] = useState<AppPage>("viewer");
  const [dropActive, setDropActive] = useState(false);
  const [update, setUpdate] = useState<UpdateState>(() => ({
    preferences: loadUpdatePreferences(),
    isChecking: false,
    statusText: "No update check has run yet.",
    availableRelease: null,
  }));
  const sidebarSearchRef = useRef<HTMLInputElement | null>(null);

  const activeDocument = useMemo(
    () => documents.find((document) => document.id === activeDocumentId) ?? null,
    [documents, activeDocumentId],
  );
  const visibleDocuments = useMemo(
    () => documents.filter((document) => matchesQuery(document, sidebarQuery)),
    [documents, sidebarQuery],
  );

  const selectDocument = useCallback((id: string) => {
    setActiveDocument(id);
    setPage("viewer");
  }, [setActiveDocument]);

  const focusSidebarSearch = useCallback(() => {
    if (!sidebarOpen) toggleSidebar();
    requestAnimationFrame(() => sidebarSearchRef.current?.focus());
  }, [sidebarOpen, toggleSidebar]);

  const openDocuments = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      setStatus("Opening structures...");
      try {
        const opened = await invoke<ViewerDocument[]>("open_documents", { paths, preferences });
        addDocuments(opened);
        setPage("viewer");
        setStatus("Opened " + opened.length + " structure" + (opened.length === 1 ? "" : "s"));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [addDocuments, preferences],
  );

  const chooseFiles = useCallback(async () => {
    const selection = await open({ multiple: true, filters });
    const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
    await openDocuments(paths);
  }, [openDocuments]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke<string[]>("startup_documents")
      .then((paths) => {
        if (paths.length > 0) void openDocuments(paths);
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      });
  }, [openDocuments]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen<string[]>("open-documents", (event) => {
      void openDocuments(event.payload);
    }).then((next) => {
      unlisten = next;
    });
    return () => {
      unlisten?.();
    };
  }, [openDocuments]);

  const handleFileDrop = useCallback(
    (event: DragDropEvent) => {
      if (event.type === "enter" || event.type === "over") {
        setDropActive(true);
        return;
      }
      setDropActive(false);
      if (event.type === "drop") {
        void openDocuments(event.paths);
      }
    },
    [openDocuments],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onDragDropEvent((event) => {
      handleFileDrop(event.payload);
    }).then((next) => {
      unlisten = next;
    }).catch((error) => {
      setStatus("File drop setup failed: " + (error instanceof Error ? error.message : String(error)));
    });
    return () => {
      unlisten?.();
    };
  }, [handleFileDrop]);

  const handleBrowserDrag = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }, []);

  const handleBrowserDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  }, []);

  const handleBrowserDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    setDropActive(false);
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      void openDocuments(paths);
    } else if (!isTauriRuntime()) {
      setStatus("Drop files into the installed app window to open them.");
    }
  }, [openDocuments]);

  useEffect(() => {
    document.title = activeDocument ? activeDocument.title + " - Burrete" : "Burrete";
  }, [activeDocument]);

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
      const startWidth = sidebarWidth;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (move: PointerEvent) => {
        setSidebarWidth(Math.max(220, Math.min(420, startWidth + move.clientX - startX)));
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
    [sidebarWidth],
  );

  const actions = useMemo<ShellActions>(() => ({
    chooseFiles,
    selectDocument,
    focusSidebarSearch,
    openSettings: () => setPage("settings"),
    closeDocument,
    closeActiveDocument: () => {
      closeActiveDocument();
      setStatus("Closed active structure");
    },
    clearAllDocuments: () => {
      closeAllDocuments();
      setStatus("Closed all structures");
    },
    clearCache: async () => {
      await invoke("clear_preview_cache");
      setStatus("Preview cache cleared");
    },
    resetQuickLook: async () => {
      await invoke("reset_quick_look");
      setStatus("Quick Look reset requested");
    },
    openLogs: async () => {
      await invoke("open_logs_folder");
      setStatus("Opened logs folder");
    },
    checkForUpdates: async () => {
      await checkForUpdates(false);
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
  }), [chooseFiles, checkForUpdates, closeActiveDocument, closeDocument, closeAllDocuments, focusSidebarSearch, selectDocument, setPreference, setUpdatePreferences, update.availableRelease]);

  const state: ShellViewState = {
    documents,
    activeDocument,
    activeDocumentId,
    visibleDocuments,
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

  useKeyboardShortcuts(state, actions, toggleSidebar);

  return (
    <AppLayout
      state={state}
      actions={actions}
      searchRef={sidebarSearchRef}
      onQueryChange={setSidebarQuery}
      onToggleSidebar={toggleSidebar}
      onResizeStart={startSidebarResize}
      onDragEnter={handleBrowserDrag}
      onDragOver={handleBrowserDrag}
      onDragLeave={handleBrowserDragLeave}
      onDrop={handleBrowserDrop}
    />
  );
}
