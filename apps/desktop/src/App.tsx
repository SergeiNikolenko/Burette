import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import previewFormatRegistry from "../../../config/preview-formats.json";
import { AppLayout } from "./components/app-layout";
import { formatBytes } from "./components/format";
import { showNativeContextMenu } from "./components/native-context-menu";
import type { KetcherImportRequest, KetcherSketchRequest, ShellActions, ShellViewState, StatusKind, StatusNotice } from "./components/types";
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
import { useDockLayout } from "./hooks/use-dock-layout";
import { useOpenDrop } from "./hooks/use-open-drop";
import { useOpenEvents } from "./hooks/use-open-events";
import { useSidebar } from "./hooks/use-sidebar";
import {
  useActiveDocument,
  useActiveTab,
  useActiveTabId,
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
  useOpenFepSetupTab,
  useOpenKetcherTab,
  useOpenNewTab,
  useOpenPoseReviewTab,
  useOpenSettingsTab,
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
import { browserDevRuntimeNeedsRefresh, openBrowserDevDockingDocument, openBrowserDevDocuments, openBrowserDevMergedCollection, openBrowserDevMolstarContextDocument, openBrowserDevTextDocument, readBrowserDevCollectionText, readBrowserDevVirtualTextDocument } from "./lib/browser-dev-documents";
import { openBrowserDevTextFiles } from "./lib/browser-dev-text-files";
import { defaultBuildInfo, loadBuildInfo } from "./lib/build-info";
import { isMoleculeCollectionPath } from "./lib/collection-documents";
import { dockingRequestForDrop, isProteinLikeDockingSource } from "./lib/docking-documents";
import type { DropActionChoice } from "./lib/drop-actions";
import { collectPerformanceMarks, markPerformanceOnce, measureAsync } from "./lib/performance";
import { basename, buildSidebarProjects, parentDirectory } from "./lib/sidebar-projects";
import type { StructureDragPayload, StructureDragRecord } from "./lib/structure-drag";
import { isTauriRuntime } from "./lib/tauri";
import { isTemporaryDocumentPath } from "./lib/temporary-documents";
import type { DockingDocumentRequest, FepSetupRequest, OpenDocumentsResult, OpenTextFilesResult, RecentStructure, TextFileDocument, ViewerDocument, ViewerPreferences, ViewerReloadOptions } from "./types";
import { checkForUpdates as requestUpdateCheck, clearDismissedUpdate, dismissUpdate, loadUpdatePreferences, markAutomaticCheck, releasePageUrl, saveUpdatePreferences, shouldCheckAutomatically, shouldPromptForUpdate } from "./update";
import type { UpdatePreferences, UpdateRelease, UpdateState } from "./update";

const CommandPalette = lazy(() => import("./components/command-palette").then((module) => ({
  default: module.CommandPalette,
})));

const filters = [
  {
    name: "Files",
    extensions: [...previewFormatRegistry.documentTypes.extensions, "md", "markdown", "mdx", "txt", "log", "err", "sh", "bash", "zsh", "py", "rs", "js", "jsx", "ts", "tsx", "json", "yaml", "yml", "toml", "xml", "html", "css"],
  },
];

const structureExtensions = new Set(previewFormatRegistry.documentTypes.extensions.map((extension) => extension.toLowerCase()));
const preferredTextExtensions = new Set([
  "md",
  "markdown",
  "mdx",
  "txt",
  "log",
  "err",
  "sh",
  "bash",
  "zsh",
  "py",
  "rs",
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "css",
]);
const structureFirstTextExtensions = new Set(["out"]);

const GRID_PERF_REPORT_PATH = "/private/tmp/burrete-grid-real-app-perf.jsonl";
const SIDEBAR_DRAG_CLOSE_WIDTH = 180;
const RIGHT_DOCK_CLOSE_THRESHOLD = 180;
const BOTTOM_DOCK_CLOSE_THRESHOLD = 120;

type GridAppendResult = {
  recordsAppended: number;
  totalRows: number;
  errors: string[];
};

type GridDelimitedColumnChoice = {
  index: number;
  name: string;
};

function isDelimitedColumnAmbiguity(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("multiple possible structure columns");
}

function delimitedColumnChoiceLabel(choice: GridDelimitedColumnChoice) {
  return `${choice.name} (column ${choice.index})`;
}

async function browserDevFilesFromLocation() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("devDocking")) return [];
  if (params.has("devFiles")) {
    return splitDevFiles(params.get("devFiles") ?? "");
  }
  return [];
}

function splitDevFiles(rawFiles: string) {
  return rawFiles.split("\n").map((path) => path.trim()).filter(Boolean);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
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
  const openFepSetupTab = useOpenFepSetupTab();
  const openPoseReviewTab = useOpenPoseReviewTab();
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
  const moveTab = useMoveTab();
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
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [rightDockDragging, setRightDockDragging] = useState(false);
  const [bottomDockDragging, setBottomDockDragging] = useState(false);

  const closeGridRuntime = useCallback((documentId: string | null | undefined) => {
    if (!documentId || !isTauriRuntime()) return;
    void invoke("grid_close_runtime", { documentId }).catch(() => {});
  }, []);
  const [structureDragActive, setStructureDragActive] = useState(false);
  const [ketcherImportRequest, setKetcherImportRequest] = useState<KetcherImportRequest | null>(null);
  const [ketcherDraftMolfile, setKetcherDraftMolfile] = useState("");
  const [status, setStatus] = useState<StatusNotice | null>(null);
  const [buildInfo, setBuildInfo] = useState(defaultBuildInfo);
  const [poseReviewSelections, setPoseReviewSelections] = useState<Record<string, number>>({});
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>(() => ({
    preferences: loadUpdatePreferences(),
    isChecking: false,
    isInstalling: false,
    statusText: "No update check has run yet.",
    availableRelease: null,
  }));
  const openedBrowserDevFilesRef = useRef<string | null>(null);
  const openedBrowserDevDockingRef = useRef<string | null>(null);
  const refreshedPersistedSessionRef = useRef(false);
  const openedPersistedTabsRef = useRef(false);
  const syncingBrowserDevFilesRef = useRef(false);
  const pendingViewerReloadOptionsRef = useRef<ViewerReloadOptions | null>(null);
  const pendingViewerReloadDocumentIdRef = useRef<string | null>(null);
  const pendingXyzrenderSheetDropRef = useRef<{ documentId: string; payload: StructureDragPayload } | null>(null);
  const xyzrenderOrientationRefRef = useRef<string | null>(null);
  const skipNextPreferenceRefreshRef = useRef(false);
  const statusSequenceRef = useRef(0);
  const recentErrorsRef = useRef<Array<{ message: string; details: string[]; timestampMs: number }>>([]);
  const gridPerfMetricsRef = useRef<string[]>([]);
  const ketcherImportSequenceRef = useRef(0);
  const commandPaletteOpen = useIsCommandPaletteOpen();
  const commandPaletteQuery = useCommandPaletteSearch();
  const openCommandPalette = useOpenCommandPalette();
  const closeCommandPalette = useCloseCommandPalette();
  const setCommandPaletteQuery = useSetCommandPaletteSearch();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      markPerformanceOnce("app:shell-visible");
      window.__BURRETE_BOOT_OVERLAY__?.markMounted();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadBuildInfo().then((info) => {
      if (!cancelled) setBuildInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pushStatus = useCallback((message: string, kind: StatusKind = "info", details: string[] = []) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const normalizedDetails = details.filter(Boolean);
    if (kind === "error") {
      recentErrorsRef.current.push({
        message: trimmed,
        details: normalizedDetails,
        timestampMs: Date.now(),
      });
      recentErrorsRef.current = recentErrorsRef.current.slice(-20);
    }
    setStatus({
      id: ++statusSequenceRef.current,
      kind,
      message: trimmed,
      details: normalizedDetails,
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
    openCommandPalette("search");
  }, [openCommandPalette]);

  const allSidebarProjects = useMemo(() => buildSidebarProjects({
    documents,
    recentStructures,
    projectRoots,
    activeDocumentId: activeDocument?.id ?? null,
    pinnedStructurePaths,
  }), [activeDocument?.id, documents, pinnedStructurePaths, projectRoots, recentStructures]);

  const activeTextDocument = useMemo(() => {
    const location = activeTab?.location;
    if (location?.kind !== "text-file") return null;
    return textDocuments.find((document) => document.id === location.documentId || document.path === location.path) ?? null;
  }, [activeTab?.location, textDocuments]);

  const activeProject = useMemo(
    () => allSidebarProjects.find((project) => project.isActive) ?? null,
    [allSidebarProjects],
  );

  const openDelimitedGridDocument = useCallback(
    async (
      path: string,
      smilesColumn: string,
      effectivePreferences: ViewerPreferences,
      replace: boolean,
    ) => {
      const document = await invoke<ViewerDocument>("open_delimited_grid_document", {
        request: { path, smilesColumn },
        preferences: effectivePreferences,
      });
      if (replace) setDocuments([document]);
      else addDocuments([document]);
      rememberRecentStructures([document]);
      pushStatus(`Opened ${document.title}`);
    },
    [addDocuments, pushStatus, rememberRecentStructures, setDocuments],
  );

  const showDelimitedGridColumnOpenMenu = useCallback(
    async (path: string, effectivePreferences: ViewerPreferences, replace: boolean) => {
      const choices = await invoke<GridDelimitedColumnChoice[]>("grid_delimited_columns", {
        request: { path },
      });
      if (choices.length === 0) {
        pushStatus("No structure columns were found in the delimited file", "error");
        return;
      }
      pushStatus("Choose a structure column for the delimited file");
      await showNativeContextMenu(
        choices.map((choice) => ({
          kind: "item" as const,
          id: `delimited-column-open-${choice.index}`,
          text: delimitedColumnChoiceLabel(choice),
          action: () => {
            void openDelimitedGridDocument(path, String(choice.index), effectivePreferences, replace)
              .catch((error) => pushErrorStatus(error, "Open failed"));
          },
        })),
      );
    },
    [openDelimitedGridDocument, pushErrorStatus, pushStatus],
  );

  const openDocuments = useCallback(
    async (
      paths: string[],
      reloadOptions?: ViewerReloadOptions,
      preferencesOverride?: Partial<typeof preferences>,
      options: { replace?: boolean; inActiveTab?: boolean } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return;
      const effectivePreferences = preferencesOverride ? { ...preferences, ...preferencesOverride } : preferences;
      pushStatus("Opening structures...");
      try {
        const result = isTauriRuntime()
          ? await invoke<OpenDocumentsResult>("open_documents", { paths: cleanPaths, preferences: effectivePreferences, reloadOptions })
          : await openBrowserDevDocuments(cleanPaths, effectivePreferences, reloadOptions);
        if (options.replace) setDocuments(result.documents);
        else if (options.inActiveTab) openDocumentsInActiveTab(result.documents);
        else addDocuments(result.documents);
        if (!options.replace && !options.inActiveTab && result.documents[0]) {
          setActiveDocument(result.documents[0].id);
        }
        if (result.documents.length > 0) markPerformanceOnce("app:first-document-opened");
        rememberRecentStructures(result.documents);
        const openedText = "Opened " + result.documents.length + " structure" + (result.documents.length === 1 ? "" : "s");
        if (result.errors.length > 0) {
          pushStatus(`${openedText}. ${summarizeErrors(result.errors)}`, "error", result.errors);
        } else {
          pushStatus(openedText);
        }
        return result;
      } catch (error) {
        if (isTauriRuntime() && cleanPaths.length === 1 && isDelimitedColumnAmbiguity(error)) {
          void showDelimitedGridColumnOpenMenu(cleanPaths[0], effectivePreferences, options.replace === true)
            .catch((menuError) => pushErrorStatus(menuError, "Structure column menu failed"));
          return null;
        }
        pushErrorStatus(error);
        return null;
      }
    },
    [addDocuments, openDocumentsInActiveTab, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setActiveDocument, setDocuments, showDelimitedGridColumnOpenMenu],
  );
  useOpenEvents(
    (paths, options) => {
      void openDocuments(paths, undefined, undefined, options);
    },
    pushErrorStatus,
  );

  const openTextDocuments = useCallback(
    async (
      paths: string[],
      options: { inActiveTab?: boolean; background?: boolean } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return null;
      pushStatus("Opening text files...");
      try {
        const result = isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", { paths: cleanPaths })
          : await openBrowserDevTextFiles(cleanPaths);
        if (options.background) addBackgroundTextDocuments(result.documents);
        else if (options.inActiveTab) openTextDocumentsInActiveTab(result.documents);
        else addTextDocuments(result.documents);
        const openedText = "Opened " + result.documents.length + " text file" + (result.documents.length === 1 ? "" : "s");
        if (result.errors.length > 0) {
          pushStatus(`${openedText}. ${summarizeErrors(result.errors)}`, "error", result.errors);
        } else {
          pushStatus(openedText);
        }
        return result;
      } catch (error) {
        pushErrorStatus(error, "Open text file failed");
        return null;
      }
    },
    [addBackgroundTextDocuments, addTextDocuments, openTextDocumentsInActiveTab, pushErrorStatus, pushStatus],
  );

  const openPaths = useCallback(async (paths: string[]) => {
    const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
    if (!cleanPaths.length) return;

    const structurePaths: string[] = [];
    const textPaths: string[] = [];
    const structureFirstTextPaths: string[] = [];

    for (const path of cleanPaths) {
      const extension = pathExtension(path);
      if (structureFirstTextExtensions.has(extension)) {
        structureFirstTextPaths.push(path);
      } else if (structureExtensions.has(extension)) {
        structurePaths.push(path);
      } else if (preferredTextExtensions.has(extension) || extension.length > 0) {
        textPaths.push(path);
      } else {
        textPaths.push(path);
      }
    }

    if (structurePaths.length > 0) {
      await openDocuments(structurePaths);
    }

    const fallbackTextPaths: string[] = [];
    for (const path of structureFirstTextPaths) {
      const result = await openDocuments([path]);
      if (!result || result.documents.length === 0) fallbackTextPaths.push(path);
    }

    const textOpenPaths = [...textPaths, ...fallbackTextPaths];
    if (textOpenPaths.length > 0) {
      await openTextDocuments(textOpenPaths);
    }
  }, [openDocuments, openTextDocuments]);

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
      await openPaths(paths);
      syncingBrowserDevFilesRef.current = false;
    })().catch((error) => {
      if (!cancelled) pushErrorStatus(error, "Open dev files failed");
      syncingBrowserDevFilesRef.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [addProjectRoot, closeAllDocuments, documents, openPaths, pushErrorStatus, setWorkspacePath]);

  useEffect(() => {
    if (refreshedPersistedSessionRef.current) return;
    if (!isTauriRuntime() || documents.length === 0) return;
    refreshedPersistedSessionRef.current = true;
    const activePath = activeDocument?.path;
    const paths = documents
      .map((document) => document.path)
      .filter((path) => !isTemporaryDocumentPath(path))
      .sort((a, b) => (a === activePath ? -1 : b === activePath ? 1 : 0));
    if (paths.length === 0) return;
    void openDocuments(paths);
  }, [activeDocument, documents, openDocuments]);

  useEffect(() => {
    if (openedPersistedTabsRef.current) return;
    if (!isTauriRuntime() || documents.length > 0) return;
    const paths = Array.from(new Set(tabs
      .map((tab) => tab.location.kind === "file" || tab.location.kind === "text-file" ? tab.location.path : null)
      .filter((path): path is string => typeof path === "string" && !isTemporaryDocumentPath(path))));
    if (paths.length === 0) return;
    openedPersistedTabsRef.current = true;
    const restoreTabId = activeTabId;
    void openPaths(paths).then(() => {
      if (restoreTabId) setActiveTab(restoreTabId);
    });
  }, [activeTabId, documents.length, openPaths, setActiveTab, tabs]);

  const openRecentStructure = useCallback(
    async (structure: RecentStructure) => {
      await openDocuments([structure.path]);
    },
    [openDocuments],
  );

  const openStructureRecordDocuments = useCallback(async (records: StructureDragRecord[]) => {
    const cleanRecords = records.filter((record) => record.text.trim().length > 0);
    if (cleanRecords.length === 0) return { opened: [], errors: [] };
    const opened: ViewerDocument[] = [];
    const errors: string[] = [];
    for (const record of cleanRecords) {
      try {
        const document = isTauriRuntime()
          ? await invoke<ViewerDocument>("open_text_structure", {
              request: {
                title: record.path,
                extension: record.inputExtension,
                text: record.text,
              },
              preferences,
              reloadOptions: undefined,
            })
          : await openBrowserDevTextDocument(record.path, record.inputExtension, record.text, preferences);
        opened.push(document);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { opened, errors };
  }, [preferences]);

  const openStructureRecords = useCallback(async (records: StructureDragRecord[]) => {
    pushStatus("Opening pasted structures...");
    const { opened, errors } = await openStructureRecordDocuments(records);
    if (opened.length === 0 && errors.length === 0) return;
    if (opened.length > 0) {
      addDocuments(opened);
      rememberRecentStructures(opened);
    }
    const openedText = "Opened " + opened.length + " pasted structure" + (opened.length === 1 ? "" : "s");
    if (errors.length > 0) {
      pushStatus(opened.length > 0 ? `${openedText}. ${summarizeErrors(errors)}` : summarizeErrors(errors), "error", errors);
      return;
    }
    pushStatus(openedText);
  }, [addDocuments, openStructureRecordDocuments, pushStatus, rememberRecentStructures]);

  const openDockPayload = useCallback(async (input: Parameters<ShellActions["openDockPayload"]>[0]) => {
    const ketcherItem = input.payload.items?.find((item) => item.kind === "ketcher") ?? null;
    const itemPaths = (input.payload.items ?? [])
      .map((item) => item.path)
      .filter((path): path is string => Boolean(path));
    const cleanPaths = Array.from(new Set([...input.payload.paths, ...itemPaths].map((path) => path.trim()).filter(Boolean)));
    const cleanRecords = input.payload.records;
    if (ketcherItem && cleanPaths.length === 0 && cleanRecords.length === 0) {
      setDockTool(input.area, "ketcher");
      addDockDrop(input);
      pushStatus(`Opened Ketcher in ${input.area === "right" ? "right dock" : "bottom dock"}`);
      return;
    }
    if (cleanPaths.length === 0 && cleanRecords.length === 0) {
      addDockDrop(input);
      return;
    }

    pushStatus(`Opening in ${input.area === "right" ? "right dock" : "bottom dock"}...`);
    try {
      const structurePaths: string[] = [];
      const textPaths: string[] = [];
      const structureFirstTextPaths: string[] = [];
      for (const path of cleanPaths) {
        const extension = pathExtension(path);
        if (structureFirstTextExtensions.has(extension)) {
          structureFirstTextPaths.push(path);
        } else if (structureExtensions.has(extension)) {
          structurePaths.push(path);
        } else if (preferredTextExtensions.has(extension) || extension.length > 0) {
          textPaths.push(path);
        } else {
          textPaths.push(path);
        }
      }

      const structurePathResult = structurePaths.length > 0
        ? isTauriRuntime()
          ? await invoke<OpenDocumentsResult>("open_documents", { paths: structurePaths, preferences, reloadOptions: undefined })
          : await openBrowserDevDocuments(structurePaths, preferences, undefined)
        : { documents: [], errors: [] };
      const fallbackTextPaths: string[] = [];
      const structureFirstResults: OpenDocumentsResult[] = [];
      for (const path of structureFirstTextPaths) {
        try {
          const result = isTauriRuntime()
            ? await invoke<OpenDocumentsResult>("open_documents", { paths: [path], preferences, reloadOptions: undefined })
            : await openBrowserDevDocuments([path], preferences, undefined);
          if (result.documents.length > 0) {
            structureFirstResults.push(result);
          } else {
            fallbackTextPaths.push(path);
          }
        } catch {
          fallbackTextPaths.push(path);
        }
      }
      const textOpenPaths = [...textPaths, ...fallbackTextPaths];
      const textResult = textOpenPaths.length > 0
        ? isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", { paths: textOpenPaths })
          : await openBrowserDevTextFiles(textOpenPaths)
        : { documents: [], errors: [] };
      const recordResult = cleanRecords.length > 0
        ? await openStructureRecordDocuments(cleanRecords)
        : { opened: [], errors: [] };
      const openedStructures = [
        ...structurePathResult.documents,
        ...structureFirstResults.flatMap((result) => result.documents),
        ...recordResult.opened,
      ];
      const openedTextDocuments = textResult.documents;
      const errors = [
        ...structurePathResult.errors,
        ...structureFirstResults.flatMap((result) => result.errors),
        ...textResult.errors,
        ...recordResult.errors,
      ];
      if (openedStructures.length > 0) {
        addBackgroundDocuments(openedStructures);
        rememberRecentStructures(openedStructures);
      }
      if (openedTextDocuments.length > 0) {
        addBackgroundTextDocuments(openedTextDocuments);
      }
      const firstDockDocumentId = openedStructures[0]?.id ?? openedTextDocuments[0]?.id ?? null;
      if (firstDockDocumentId) {
        setDockDocument(input.area, firstDockDocumentId);
        addDockDrop(input);
      }
      const openedCount = openedStructures.length + openedTextDocuments.length;
      const openedText = `Opened ${openedCount} item${openedCount === 1 ? "" : "s"} in ${input.area === "right" ? "right dock" : "bottom dock"}`;
      if (errors.length > 0) {
        pushStatus(openedCount > 0 ? `${openedText}. ${summarizeErrors(errors)}` : summarizeErrors(errors), "error", errors);
        return;
      }
      pushStatus(openedText);
    } catch (error) {
      pushErrorStatus(error, "Dock open failed");
    }
  }, [addBackgroundDocuments, addBackgroundTextDocuments, addDockDrop, openStructureRecordDocuments, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setDockDocument, setDockTool]);

  const openMostRecentStructure = useCallback(async () => {
    const structure = recentStructures[0];
    if (!structure) {
      pushStatus("No recent structures to open", "error");
      return;
    }
    await openRecentStructure(structure);
  }, [openRecentStructure, pushStatus, recentStructures]);

  const chooseFiles = useCallback(async () => {
    try {
      const selection = isTauriRuntime()
        ? await invoke<string[]>("pick_open_targets")
        : await open({ multiple: true, filters });
      const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
      await openPaths(paths);
    } catch (error) {
      pushErrorStatus(error, "Open failed");
    }
  }, [openPaths, pushErrorStatus]);

  const openDockingDocument = useCallback(async (
    targetPath: string,
    droppedPaths: string[],
    options: { activePose?: number | null } = {},
  ) => {
    const existingDockingRequest = documents.find((document) => document.path === targetPath || document.id === targetPath)?.dockingRequest;
    const request = dockingRequestForDrop(targetPath, droppedPaths, existingDockingRequest);
    if (!request) return null;
    if (request.ligandPaths.length === 0) return null;
    request.activePose = options.activePose ?? null;
    pushStatus("Opening Molstar docking view...");
    try {
      const document = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_docking_document", { request, preferences })
        : await openBrowserDevDockingDocument(request.receptorPath, request.ligandPaths, preferences, options);
      addDocuments([document]);
      rememberRecentStructures([document]);
      setStructureDragActive(false);
      pushStatus(`Opened docking view with ${request.ligandPaths.length} ligand${request.ligandPaths.length === 1 ? "" : "s"}`);
      return document;
    } catch (error) {
      setStructureDragActive(false);
      pushErrorStatus(error, "Docking view failed");
      return null;
    }
  }, [addDocuments, documents, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  const openDockingStructureRecords = useCallback(async (
    receptorPath: string,
    ligandPaths: string[],
    records: StructureDragRecord[],
  ) => {
    const cleanLigandPaths = Array.from(new Set(ligandPaths.map((path) => path.trim()).filter(Boolean)));
    const cleanRecords = records.filter((record) => record.text.trim().length > 0);
    if (!receptorPath || (cleanLigandPaths.length === 0 && cleanRecords.length === 0)) return;
    pushStatus("Opening Molstar docking view...");
    try {
      const { opened, errors } = await openStructureRecordDocuments(cleanRecords);
      if (errors.length > 0 && opened.length === 0 && cleanLigandPaths.length === 0) {
        pushStatus(summarizeErrors(errors), "error", errors);
        return;
      }
      const request: DockingDocumentRequest = {
        receptorPath,
        ligandPaths: [...cleanLigandPaths, ...opened.map((document) => document.path)],
      };
      if (request.ligandPaths.length === 0) return;
      const dockingDocument = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_docking_document", { request, preferences })
        : await openBrowserDevDockingDocument(request.receptorPath, request.ligandPaths, preferences);
      if (opened.length > 0) addDocuments(opened);
      addDocuments([dockingDocument]);
      rememberRecentStructures([...opened, dockingDocument]);
      setStructureDragActive(false);
      const message = `Opened docking view with ${request.ligandPaths.length} ligand${request.ligandPaths.length === 1 ? "" : "s"}`;
      if (errors.length > 0) {
        pushStatus(`${message}. ${summarizeErrors(errors)}`, "error", errors);
      } else {
        pushStatus(message);
      }
    } catch (error) {
      setStructureDragActive(false);
      pushErrorStatus(error, "Docking view failed");
    }
  }, [addDocuments, openStructureRecordDocuments, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

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

  const revealPath = useCallback(async (path: string, label = "file") => {
    try {
      if (isTauriRuntime()) {
        await invoke("reveal_path", { path });
      } else {
        await openPath(parentDirectory(path) ?? path);
      }
      pushStatus(`Revealed ${label} in Finder`);
    } catch (error) {
      pushErrorStatus(error, "Reveal in Finder failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const revealDocument = useCallback(async (document: ViewerDocument) => {
    await revealPath(document.path, "structure");
  }, [revealPath]);

  const revealActiveDocument = useCallback(async () => {
    if (activeTextDocument) {
      await revealPath(activeTextDocument.path, "file");
      return;
    }
    if (!activeDocument) {
      pushStatus("No active file to reveal", "error");
      return;
    }
    await revealDocument(activeDocument);
  }, [activeDocument, activeTextDocument, pushStatus, revealDocument, revealPath]);

  const copyPath = useCallback(async (path: string, label = "file") => {
    try {
      await navigator.clipboard.writeText(path);
      pushStatus(`Copied ${label} path`);
    } catch (error) {
      pushErrorStatus(error, "Copy path failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const copyDocumentPath = useCallback(async (document: ViewerDocument) => {
    await copyPath(document.path, "structure");
  }, [copyPath]);

  const copyActiveDocumentPath = useCallback(async () => {
    if (activeTextDocument) {
      await copyPath(activeTextDocument.path, "file");
      return;
    }
    if (!activeDocument) {
      pushStatus("No active file path to copy", "error");
      return;
    }
    await copyDocumentPath(activeDocument);
  }, [activeDocument, activeTextDocument, copyDocumentPath, copyPath, pushStatus]);

  const showDocumentMetadata = useCallback((document: ViewerDocument) => {
    pushStatus(document.title, "info", [
      `Path: ${document.path}`,
      `Renderer: ${document.renderer}`,
      `Format: ${document.extension.toUpperCase()}`,
      `Size: ${formatBytes(document.byteCount)}`,
    ]);
  }, [pushStatus]);

  const showTextFileMetadata = useCallback((document: TextFileDocument) => {
    const details = [
      `Path: ${document.path}`,
      `Format: ${document.extension ? document.extension.toUpperCase() : "TEXT"}`,
      `Language: ${document.language}`,
      `Size: ${formatBytes(document.byteCount)}`,
    ];
    if (document.truncated) details.push("Content preview was truncated");
    pushStatus(document.title, "info", details);
  }, [pushStatus]);

  const showActiveDocumentMetadata = useCallback(() => {
    if (activeTextDocument) {
      showTextFileMetadata(activeTextDocument);
      return;
    }
    if (!activeDocument) {
      pushStatus("No active file metadata to show", "error");
      return;
    }
    showDocumentMetadata(activeDocument);
  }, [activeDocument, activeTextDocument, pushStatus, showDocumentMetadata, showTextFileMetadata]);

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

  const openKetcher = useCallback(() => {
    openKetcherTab();
  }, [openKetcherTab]);

  const openKetcherWithStructures = useCallback((paths: string[], fragments: KetcherImportRequest["fragments"] = []) => {
    const cleanPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    const virtualFragments: KetcherImportRequest["fragments"] = [];
    const readablePaths = cleanPaths.filter((path) => {
      const virtualText = readBrowserDevVirtualTextDocument(path);
      if (virtualText === null) return true;
      virtualFragments.push({ title: basename(path), text: virtualText });
      return false;
    });
    const cleanFragments = [...(fragments?.filter((fragment) => fragment.text.trim()) ?? []), ...virtualFragments];
    if (readablePaths.length === 0 && cleanFragments.length === 0) return;
    if (readablePaths.length === 0 && cleanFragments.length === 1) {
      const [fragment] = cleanFragments;
      const draftMolfile = ketcherDraftMolfileFromImportText(fragment.text);
      if (draftMolfile) {
        openKetcherTab({ draftMolfile });
        setStructureDragActive(false);
        setKetcherDraftMolfile(draftMolfile);
        setKetcherImportRequest(null);
        pushStatus(`Opened ${fragment.title.trim() || "structure"} in Ketcher`);
        return;
      }
    }
    openKetcherTab();
    setStructureDragActive(false);
    setKetcherImportRequest({
      id: ++ketcherImportSequenceRef.current,
      paths: readablePaths,
      fragments: cleanFragments,
    });
    const count = readablePaths.length + cleanFragments.length;
    pushStatus(`Adding ${count} structure${count === 1 ? "" : "s"} to Ketcher`);
  }, [openKetcherTab, pushStatus]);

  const openKetcherWithFragment = useCallback((title: string, text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    const draftMolfile = ketcherDraftMolfileFromImportText(cleanText);
    if (draftMolfile) {
      openKetcherTab({ draftMolfile });
      setStructureDragActive(false);
      setKetcherDraftMolfile(draftMolfile);
      setKetcherImportRequest(null);
      pushStatus(`Opened ${title.trim() || "structure"} in Ketcher`);
      return;
    }
    openKetcherTab();
    setStructureDragActive(false);
    setKetcherImportRequest({
      id: ++ketcherImportSequenceRef.current,
      paths: [],
      fragments: [{ title: title.trim() || "structure", text }],
    });
    pushStatus(`Adding ${title.trim() || "structure"} to Ketcher`);
  }, [openKetcherTab, pushStatus]);

  const clearKetcherImportRequest = useCallback((id: number) => {
    setKetcherImportRequest((request) => (request?.id === id ? null : request));
  }, []);

  const openKetcherSketch = useCallback(async (request: KetcherSketchRequest) => {
    const rendererMode: ViewerPreferences["rendererMode"] = request.target === "grid"
      ? "grid2d"
      : request.target === "molstar"
      ? "molstar"
      : request.target === "xyzrender"
        ? "xyzrender-external"
        : "auto";
    const reloadOptions = request.target === "collection" ? undefined : {};
    const effectivePreferences = { ...preferences, rendererMode };
    pushStatus("Opening Ketcher sketch...");
    try {
      if (request.target === "collection" && request.collectionTargetPath) {
        if (isTauriRuntime()) {
          const document = await invoke<ViewerDocument>("append_to_molecule_collection", {
            request: {
              targetPath: request.collectionTargetPath,
              extension: request.extension,
              text: request.text,
            },
            preferences: effectivePreferences,
          });
          openDocumentsInActiveTab([document]);
          rememberRecentStructures([document]);
          pushStatus(`Added Ketcher sketch to ${basename(document.path)}`);
          return;
        }

        const sketchDocument = await openBrowserDevTextDocument(
          request.title,
          request.extension,
          request.text,
          effectivePreferences,
          reloadOptions,
        );
        await mergeMoleculeCollections(request.collectionTargetPath, [sketchDocument.path]);
        return;
      }
      if (request.target === "collection") {
        if (isTauriRuntime()) {
          const outputPath = await save({
            defaultPath: "ketcher-collection.sdf",
            filters: [{ name: "SDF collections", extensions: ["sdf", "sd"] }],
          });
          if (!outputPath) {
            pushStatus("New collection canceled");
            return;
          }
          const document = await invoke<ViewerDocument>("create_molecule_collection", {
            request: {
              outputPath,
              extension: request.extension,
              text: request.text,
            },
            preferences: effectivePreferences,
          });
          openDocumentsInActiveTab([document]);
          rememberRecentStructures([document]);
          pushStatus(`Created ${basename(document.path)}`);
          return;
        }

        const document = await openBrowserDevTextDocument(
          "ketcher-collection.sdf",
          request.extension,
          request.text,
          effectivePreferences,
          reloadOptions,
        );
        openDocumentsInActiveTab([document]);
        downloadTextFile("ketcher-collection.sdf", request.text);
        pushStatus("Created ketcher-collection.sdf");
        return;
      }

      const document = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_text_structure", {
            request: {
              title: request.title,
              extension: request.extension,
              text: request.text,
            },
            preferences: effectivePreferences,
            reloadOptions,
          })
        : await openBrowserDevTextDocument(
            request.title,
            request.extension,
            request.text,
            effectivePreferences,
            reloadOptions,
          );
      addDocuments([document]);
      rememberRecentStructures([document]);
      pushStatus(
        `Opened Ketcher sketch in ${request.target === "grid" ? "grid" : request.target === "molstar" ? "Molstar" : "xyzrender"}`,
      );
    } catch (error) {
      pushErrorStatus(error, "Open Ketcher sketch failed");
    }
  }, [addDocuments, mergeMoleculeCollections, openDocumentsInActiveTab, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  const postXyzrenderSheetItems = useCallback((documentId: string, payload: StructureDragPayload) => {
    const iframe = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).find(
      (item) => item.dataset.documentId === documentId,
    );
    if (!iframe?.contentWindow) return false;
    const iframeRect = iframe.getBoundingClientRect();
    const point = payload.point && Number.isFinite(payload.point.x) && Number.isFinite(payload.point.y)
      ? { x: payload.point.x - iframeRect.left, y: payload.point.y - iframeRect.top }
      : null;
    iframe.contentWindow.postMessage(
      {
        source: "burrete-host",
        body: {
          type: "addXyzrenderSheetItems",
          documentId,
          paths: payload.paths,
          records: payload.records,
          point,
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

  const notifyGridRecordsAppended = useCallback((targetDocumentId: string, result: GridAppendResult) => {
    const iframe = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).find(
      (item) => item.dataset.documentId === targetDocumentId,
    );
    iframe?.contentWindow?.postMessage({
      source: "burrete-grid-host",
      body: {
        type: "gridRecordsAppended",
        documentId: targetDocumentId,
        recordsAppended: result.recordsAppended,
        totalRows: result.totalRows,
      },
    }, "*");
  }, []);

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

  const openPoseReviewWorkspace = useCallback(async (
    receptorDocument: ViewerDocument,
    gridDocument: ViewerDocument,
    activePose: number,
  ) => {
    const dockingDocument = await openDockingDocument(receptorDocument.path, [gridDocument.path], { activePose });
    if (!dockingDocument) return;
    openPoseReviewTab({
      kind: "pose-review",
      receptorPath: receptorDocument.path,
      gridDocumentId: gridDocument.id,
      gridPath: gridDocument.path,
      dockingDocumentId: dockingDocument.id,
      dockingPath: dockingDocument.path,
    });
    notifyGridPoseReviewSelection(gridDocument.id, activePose);
    pushStatus("Opened pose-review workspace");
  }, [notifyGridPoseReviewSelection, openDockingDocument, openPoseReviewTab, pushStatus]);

  const openFepSetupWorkspace = useCallback((request: FepSetupRequest) => {
    openFepSetupTab({
      kind: "fep-setup",
      ...request,
    });
    pushStatus("Opened FEP setup workspace");
  }, [openFepSetupTab, pushStatus]);

  const appendDelimitedGridRecords = useCallback(
    async (targetDocument: ViewerDocument, path: string, smilesColumn: string) => {
      const result = await invoke<GridAppendResult>("grid_append_delimited_records", {
        request: {
          documentId: targetDocument.id,
          path,
          smilesColumn,
        },
      });
      notifyGridRecordsAppended(targetDocument.id, result);
      const message = `Appended ${result.recordsAppended} molecule${result.recordsAppended === 1 ? "" : "s"} to grid`;
      if (result.errors.length > 0) {
        pushStatus(`${message}. ${summarizeErrors(result.errors)}`, "error", result.errors);
      } else {
        pushStatus(message);
      }
    },
    [notifyGridRecordsAppended, pushStatus],
  );

  const showDelimitedGridColumnAppendMenu = useCallback(
    async (targetDocument: ViewerDocument, path: string) => {
      const choices = await invoke<GridDelimitedColumnChoice[]>("grid_delimited_columns", {
        request: { path },
      });
      if (choices.length === 0) {
        pushStatus("No structure columns were found in the delimited file", "error");
        return;
      }
      pushStatus("Choose a structure column to append to the grid");
      await showNativeContextMenu(
        choices.map((choice) => ({
          kind: "item" as const,
          id: `delimited-column-append-${choice.index}`,
          text: delimitedColumnChoiceLabel(choice),
          action: () => {
            void appendDelimitedGridRecords(targetDocument, path, String(choice.index))
              .catch((error) => pushErrorStatus(error, "Grid append failed"));
          },
        })),
      );
    },
    [appendDelimitedGridRecords, pushErrorStatus, pushStatus],
  );

  const appendGridRecords = useCallback((targetDocumentId: string, payload: StructureDragPayload) => {
    if (payload.paths.length === 0 && payload.records.length === 0) return false;
    const targetDocument = documents.find((document) => document.id === targetDocumentId);
    if (!targetDocument || targetDocument.renderer !== "grid2d") return false;
    if (!isTauriRuntime()) return false;
    void (async () => {
      try {
        const result = await invoke<GridAppendResult>("grid_append_records", {
          request: {
            documentId: targetDocument.id,
            paths: payload.paths,
            records: payload.records,
          },
        });
        notifyGridRecordsAppended(targetDocument.id, result);
        const message = `Appended ${result.recordsAppended} molecule${result.recordsAppended === 1 ? "" : "s"} to grid`;
        if (result.errors.length > 0) {
          pushStatus(`${message}. ${summarizeErrors(result.errors)}`, "error", result.errors);
        } else {
          pushStatus(message);
        }
      } catch (error) {
        if (payload.paths.length === 1 && payload.records.length === 0 && isDelimitedColumnAmbiguity(error)) {
          void showDelimitedGridColumnAppendMenu(targetDocument, payload.paths[0])
            .catch((menuError) => pushErrorStatus(menuError, "Structure column menu failed"));
          return;
        }
        pushErrorStatus(error, "Grid append failed");
      }
    })();
    return true;
  }, [documents, notifyGridRecordsAppended, pushErrorStatus, pushStatus, showDelimitedGridColumnAppendMenu]);

  useEffect(() => {
    const pending = pendingXyzrenderSheetDropRef.current;
    if (!pending || activeDocument?.id !== pending.documentId) return;
    if (postXyzrenderSheetItems(pending.documentId, pending.payload)) {
      pendingXyzrenderSheetDropRef.current = null;
    }
  }, [activeDocument?.id, postXyzrenderSheetItems]);

  useEffect(() => {
    if (!activeDocument || activeDocument.renderer !== "grid2d") return;
    const activePose = poseReviewSelections[activeDocument.id];
    if (!Number.isFinite(activePose)) return;
    notifyGridPoseReviewSelection(activeDocument.id, activePose);
  }, [activeDocument, notifyGridPoseReviewSelection, poseReviewSelections]);

  const chooseDropAction = useCallback((
    choices: DropActionChoice[],
    at: { x: number; y: number } | null | undefined,
    runChoice: (choice: DropActionChoice) => void,
  ) => {
    if (choices.length < 2) return false;
    void showNativeContextMenu(
      choices.map((choice, index) => ({
        kind: "item" as const,
        id: `drop-action-${index}-${choice.id}`,
        text: choice.confidence === "default" ? `${choice.label} (default)` : choice.label,
        action: () => runChoice(choice),
      })),
      at ?? undefined,
    ).catch((error) => {
      pushErrorStatus(error, "Drop action menu failed");
      runChoice(choices[0]);
    });
    return true;
  }, [pushErrorStatus]);

  const addDroppedProjectRoots = useCallback((paths: string[]) => {
    const cleanPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    if (cleanPaths.length === 0) return;
    for (const path of cleanPaths) addProjectRoot(path);
    setWorkspacePath(cleanPaths[0]);
    pushStatus("Project folder added");
  }, [addProjectRoot, pushStatus]);

  const currentFepSetupRequest = useMemo<FepSetupRequest | null>(() => {
    const location = activeTab?.location;
    if (!location) return null;
    if (location.kind === "fep-setup") {
      return {
        receptorPath: location.receptorPath,
        gridDocumentId: location.gridDocumentId,
        gridPath: location.gridPath,
        dockingDocumentId: location.dockingDocumentId,
        dockingPath: location.dockingPath,
        referencePose: location.referencePose,
      };
    }
    if (location.kind !== "pose-review") return null;
    const grid = documents.find((document) => document.id === location.gridDocumentId || document.path === location.gridPath);
    const docking = documents.find((document) => document.id === location.dockingDocumentId || document.path === location.dockingPath);
    if (!grid || !docking) return null;
    return {
      receptorPath: location.receptorPath,
      gridDocumentId: grid.id,
      gridPath: grid.path,
      dockingDocumentId: docking.id,
      dockingPath: docking.path,
      referencePose: poseReviewSelections[grid.id] ?? 0,
    };
  }, [activeTab?.location, documents, poseReviewSelections]);

  useOpenEvents(openPaths, pushErrorStatus);
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
  const openClipboard = useCallback(async () => {
    try {
      if (!navigator.clipboard?.readText) {
        pushStatus("Clipboard text is not available in this environment.", "error");
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!openClipboardText(text)) {
        pushStatus("Clipboard does not contain a supported molecular structure.", "error");
      }
    } catch (error) {
      pushErrorStatus(error, "Open from clipboard failed");
    }
  }, [openClipboardText, pushErrorStatus, pushStatus]);
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

  const clearCache = useCallback(async () => {
    try {
      await invoke("clear_preview_cache");
      pushStatus("Preview cache cleared");
    } catch (error) {
      pushErrorStatus(error, "Preview cache clear failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const resetQuickLook = useCallback(async () => {
    try {
      const report = await invoke<{ ok: boolean }>("reset_quick_look");
      pushStatus(report.ok ? "Quick Look reset completed" : "Quick Look reset reported issues", report.ok ? "info" : "error");
    } catch (error) {
      pushErrorStatus(error, "Quick Look reset failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const openLogs = useCallback(async () => {
    try {
      await invoke("open_logs_folder");
      pushStatus("Opened logs folder");
    } catch (error) {
      pushErrorStatus(error, "Open logs folder failed");
    }
  }, [pushErrorStatus, pushStatus]);

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
          documentId?: string;
          path?: string | null;
          receptorPath?: string | null;
          title?: string | null;
          extension?: string | null;
          textBase64?: string | null;
          orientationRef?: string | null;
          preset?: string | null;
          text?: string | null;
          query?: string | null;
          sort?: string | null;
          offset?: number | null;
          limit?: number | null;
          activePose?: number | null;
          sourcePath?: string | null;
          controls?: ViewerReloadOptions["xyzrenderControls"];
          contextDocument?: Parameters<typeof openBrowserDevMolstarContextDocument>[0];
          inputDataBase64?: string | null;
          inputExtension?: string | null;
          items?: Record<string, unknown>[] | null;
          fragments?: Array<{ title?: string | null; textBase64?: string | null }> | null;
          name?: string | null;
          mimeType?: string | null;
        };
      } | undefined;
      if (data?.source !== "burrete-viewer" && data?.source !== "burrete-grid") return;
      const body = data.body;
      if (!isKnownViewerMessageSource(event.source, body?.documentId)) return;
      if (data.source === "burrete-viewer" && body?.type === "dockingPoseChanged") {
        const dockingDocument = body.documentId
          ? documents.find((document) => document.id === body.documentId)
          : activeDocument;
        const sourcePath = typeof body.sourcePath === "string" && body.sourcePath.trim().length > 0
          ? body.sourcePath.trim()
          : dockingDocument?.dockingRequest?.ligandPaths[0];
        const gridDocument = sourcePath
          ? documents.find((document) => document.path === sourcePath && document.renderer === "grid2d")
          : null;
        const activePose = Math.max(0, Math.trunc(Number(body.activePose) || 0));
        if (gridDocument) {
          setPoseReviewSelections((previous) => ({ ...previous, [gridDocument.id]: activePose }));
          notifyGridPoseReviewSelection(gridDocument.id, activePose);
        }
        return;
      }
      if (
        data.source === "burrete-viewer" &&
        (body?.type === "ready" || (body?.type === "status" && body.message?.startsWith("[web] Rendered ")))
      ) {
        markPerformanceOnce("viewer:first-render");
      }
      if (data.source === "burrete-viewer" && body?.type === "exportText") {
        const text = typeof body.text === "string" ? body.text : "";
        const name = safeExportFileName(body.name ?? "molstar-export.cif");
        void (async () => {
          try {
            if (!isTauriRuntime()) {
              downloadTextFile(name, text);
              pushStatus(`Exported ${name}`);
              return;
            }
            const outputPath = await save({
              defaultPath: name,
              filters: exportDialogFilters(name, body.mimeType ?? ""),
            });
            if (!outputPath) return;
            const savedPath = await invoke<string>("save_text_as", { text, outputPath });
            pushStatus(`Exported ${basename(savedPath)}`);
          } catch (error) {
            pushErrorStatus(error, "Molstar export failed");
          }
        })();
        return;
      }
      if ((data.source === "burrete-viewer" || data.source === "burrete-grid") && body?.type === "renderXyzrenderSheetItem") {
        if (!body.requestId) return;
        const replySource = data.source === "burrete-grid" ? "burrete-grid-host" : "burrete-host";
        const reply = (bodyPayload: Record<string, unknown>) => {
          postMessageToViewerSource(event.source, {
            source: replySource,
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
        if (body?.type === "gridPerfMetric") {
          console.info("[Burrete grid perf]", JSON.stringify(body));
          writeGridPerfMetric(body);
          return;
        }
        if (body?.type === "copyText") {
          const text = typeof body.text === "string" ? body.text : "";
          void navigator.clipboard.writeText(text)
            .then(() => pushStatus("Copied grid text"))
            .catch((error) => pushErrorStatus(error, "Grid copy failed"));
          return;
        }
        if (body?.type === "exportText") {
          const text = typeof body.text === "string" ? body.text : "";
          const name = safeExportFileName(body.name ?? "grid-export.txt");
          void (async () => {
            try {
              if (!isTauriRuntime()) {
                downloadTextFile(name, text);
                pushStatus(`Exported ${name}`);
                return;
              }
              const outputPath = await save({
                defaultPath: name,
                filters: exportDialogFilters(name, body.mimeType ?? ""),
              });
              if (!outputPath) return;
              const savedPath = await invoke<string>("save_text_as", { text, outputPath });
              pushStatus(`Exported ${basename(savedPath)}`);
            } catch (error) {
              pushErrorStatus(error, "Grid export failed");
            }
          })();
          return;
        }
        if (body?.type === "saveGridAs") {
          const text = typeof body.text === "string" ? body.text : "";
          const name = safeExportFileName(body.name ?? "grid-save-as.csv");
          const reply = (bodyPayload: Record<string, unknown>) => {
            postMessageToViewerSource(event.source, {
              source: "burrete-grid-host",
              body: {
                documentId: body.documentId,
                ...bodyPayload,
              },
            });
          };
          void (async () => {
            try {
              if (!isTauriRuntime()) {
                downloadTextFile(name, text);
                pushStatus(`Saved ${name}`);
                reply({ type: "gridSavedAs", name });
                return;
              }
              const outputPath = await save({
                defaultPath: name,
                filters: exportDialogFilters(name, body.mimeType ?? ""),
              });
              if (!outputPath) return;
              const savedPath = await invoke<string>("save_text_as", { text, outputPath });
              const savedName = basename(savedPath);
              pushStatus(`Saved ${savedName}`);
              reply({ type: "gridSavedAs", name: savedName });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              reply({ type: "gridSaveAsError", error: message });
              pushErrorStatus(error, "Grid Save As failed");
            }
          })();
          return;
        }
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
        if (body?.type === "readStructureText") {
          if (!body.requestId || !body.documentId) return;
          const reply = (bodyPayload: Record<string, unknown>) => {
            postMessageToViewerSource(event.source, {
              source: "burrete-grid-host",
              body: {
                requestId: body.requestId,
                documentId: body.documentId,
                ...bodyPayload,
              },
            });
          };
          if (!isTauriRuntime()) {
            reply({
              type: "gridError",
              error: "Desktop file reading is unavailable outside the Tauri runtime.",
            });
            return;
          }
          void (async () => {
            try {
              const text = await invoke<string>("read_structure_text", {
                path: typeof body.path === "string" ? body.path : "",
              });
              reply({
                type: "structureText",
                text,
              });
            } catch (error) {
              reply({
                type: "gridError",
                error: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }
        if (body?.type === "renderXyzrenderCard") {
          if (!body.requestId || !body.documentId) return;
          const reply = (bodyPayload: Record<string, unknown>) => {
            postMessageToViewerSource(event.source, {
              source: "burrete-grid-host",
              body: {
                requestId: body.requestId,
                documentId: body.documentId,
                ...bodyPayload,
              },
            });
          };
          if (!isTauriRuntime()) {
            reply({
              type: "gridError",
              error: "Desktop xyzrender grid rendering is unavailable outside the Tauri runtime.",
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
                cacheHit?: boolean;
              }>("render_xyzrender_sheet_item", {
                request: {
                  path: body.path,
                  preset: body.preset ?? null,
                  controls: body.controls ?? null,
                  inputDataBase64: body.inputDataBase64 ?? null,
                  inputExtension: body.inputExtension ?? null,
                  cacheScope: "grid-card",
                },
              });
              reply({
                type: "xyzrenderCard",
                result: {
                  svg: result.svg,
                  preset: result.preset ?? null,
                  elapsedMs: result.elapsedMs ?? null,
                  log: result.log ?? "",
                  cacheHit: result.cacheHit ?? false,
                },
              });
            } catch (error) {
              reply({
                type: "gridError",
                error: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }
        if (body?.type === "renderXyzrenderCards") {
          if (!body.requestId || !body.documentId) return;
          const reply = (bodyPayload: Record<string, unknown>) => {
            postMessageToViewerSource(event.source, {
              source: "burrete-grid-host",
              body: {
                requestId: body.requestId,
                documentId: body.documentId,
                ...bodyPayload,
              },
            });
          };
          if (!isTauriRuntime()) {
            reply({
              type: "gridError",
              error: "Desktop xyzrender grid rendering is unavailable outside the Tauri runtime.",
            });
            return;
          }
          void (async () => {
            try {
              const items = Array.isArray(body.items) ? body.items : [];
              const result = await invoke<{
                items?: Array<{
                  id?: string;
                  svg?: string;
                  preset?: string;
                  elapsedMs?: number;
                  log?: string;
                  cacheHit?: boolean;
                  error?: string;
                }>;
              }>("render_xyzrender_sheet_items", {
                request: {
                  items: items.map((item: Record<string, unknown>) => ({
                    id: typeof item.id === "string" ? item.id : "",
                    path: typeof item.path === "string" ? item.path : "",
                    preset: item.preset ?? null,
                    controls: item.controls ?? null,
                    inputDataBase64: item.inputDataBase64 ?? null,
                    inputExtension: item.inputExtension ?? null,
                    cacheScope: "grid-card",
                  })),
                },
              });
              reply({
                type: "xyzrenderCard",
                result: {
                  items: result.items ?? [],
                },
              });
            } catch (error) {
              reply({
                type: "gridError",
                error: error instanceof Error ? error.message : String(error),
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
      if (body?.type === "openSdfMolstarDocument") {
        const title = typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : "selected-molecules.sdf";
        const textBase64 = typeof body.textBase64 === "string" ? body.textBase64.trim() : "";
        if (!textBase64) {
          pushErrorStatus("Select one or more molecules before opening Molstar.", "Molstar view failed");
          return;
        }
        const requestedReceptorPath = typeof body.receptorPath === "string"
          ? body.receptorPath.trim()
          : "";
        const receptorDocument = requestedReceptorPath
          ? documents.find((document) => (
            document.path === requestedReceptorPath &&
            isProteinLikeDockingSource(document.path)
          ))
          : null;
        if (requestedReceptorPath && !receptorDocument) {
          pushErrorStatus("Selected receptor is not available for Molstar.", "Molstar view failed");
          return;
        }
        try {
          const bytes = Uint8Array.from(atob(textBase64), (char) => char.charCodeAt(0));
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          if (!text.trim()) {
            pushErrorStatus("Selected molecules do not have SDF structure data for Molstar.", "Molstar view failed");
            return;
          }
          const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
          const document = isTauriRuntime()
            ? await invoke<ViewerDocument>("open_text_structure", {
                request: {
                  title,
                  extension: "sdf",
                  text,
                },
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
          if (receptorDocument && document.path) {
            pushStatus("Opening selected molecules in Molstar docking view...");
            void openDockingDocument(receptorDocument.path, [document.path]);
            return;
          }
          openDocumentsInActiveTab([document]);
          rememberRecentStructures([document]);
          pushStatus("Opened selected molecules in Molstar");
        } catch (error) {
          pushErrorStatus(error, "Molstar view failed");
        }
        return;
      }
      if (body?.type === "openSdfPoseDocument") {
        const requestedPath = typeof body.path === "string" ? body.path.trim() : "";
        const pathDocument = requestedPath.length > 0
          ? documents.find((document) => document.path === requestedPath) ?? null
          : null;
        const targetDocument = (body.documentId
          ? documents.find((document) => document.id === body.documentId)
          : null)
          ?? pathDocument
          ?? activeDocument;
        const targetPath = requestedPath.length > 0
          ? requestedPath
          : targetDocument?.path;
        if (targetPath) {
          const poseTargetDocument = targetDocument?.path === targetPath ? targetDocument : pathDocument;
          const activePose = Math.max(0, Math.trunc(Number(body.activePose) || 0));
          if (poseTargetDocument) {
            setPoseReviewSelections((previous) => ({ ...previous, [poseTargetDocument.id]: activePose }));
          }
          const requestedReceptorPath = typeof body.receptorPath === "string"
            ? body.receptorPath.trim()
            : "";
          const receptorDocument = requestedReceptorPath
            ? documents.find((document) => (
              document.path === requestedReceptorPath &&
              document.path !== targetPath &&
              isProteinLikeDockingSource(document.path)
            ))
            : documents.find((document) => (
              document.path !== targetPath && isProteinLikeDockingSource(document.path)
            ));
          if (requestedReceptorPath && !receptorDocument) {
            pushErrorStatus("Selected receptor is not available for SDF poses.", "SDF poses failed");
            return;
          }
          if (receptorDocument && poseTargetDocument) {
            pushStatus("Opening pose-review workspace...");
            void openPoseReviewWorkspace(receptorDocument, poseTargetDocument, activePose);
          } else if (receptorDocument) {
            pushStatus("Opening SDF poses in Molstar docking view...");
            void openDockingDocument(receptorDocument.path, [targetPath]);
          } else {
            pushStatus("Opening SDF poses in Molstar...");
            void openDocuments([targetPath], {}, { rendererMode: "molstar" }, { inActiveTab: true });
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
          void openDocuments([targetPath], undefined, { rendererMode: "auto" }, { inActiveTab: true });
        }
        return;
      }
      if (body?.type === "openMolstarContextDocument") {
        if (body.contextDocument && typeof body.contextDocument === "object") {
          pushStatus("Opening selected Molstar context...");
          void openBrowserDevMolstarContextDocument(body.contextDocument, preferences)
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
      if (body?.type === "openInKetcher") {
        const title = typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : "structure";
        const textBase64 = typeof body.textBase64 === "string" ? body.textBase64.trim() : "";
        if (textBase64) {
          try {
            const bytes = Uint8Array.from(atob(textBase64), (char) => char.charCodeAt(0));
            const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
            openKetcherWithFragment(title, text);
          } catch (error) {
            pushStatus(`Open in Ketcher failed: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
          return;
        }
        const targetDocument = (body.documentId
          ? documents.find((document) => document.id === body.documentId)
          : null) ?? activeDocument;
        const targetPath = typeof body.path === "string" && body.path.trim().length > 0
          ? body.path.trim()
          : targetDocument?.path;
        if (targetPath) {
          const virtualText = readBrowserDevVirtualTextDocument(targetPath);
          if (virtualText !== null) {
            openKetcherWithFragment(title, virtualText);
            return;
          }
          openKetcherWithStructures([targetPath]);
        }
        return;
      }
      if (body?.type === "openSdfKetcherDocument") {
        const rawFragments = Array.isArray(body.fragments) ? body.fragments : [];
        const fragments = rawFragments.flatMap((fragment) => {
          if (!fragment || typeof fragment !== "object") return [];
          const textBase64 = typeof fragment.textBase64 === "string" ? fragment.textBase64.trim() : "";
          if (!textBase64) return [];
          try {
            const bytes = Uint8Array.from(atob(textBase64), (char) => char.charCodeAt(0));
            const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
            if (!text.trim()) return [];
            const title = typeof fragment.title === "string" && fragment.title.trim()
              ? fragment.title.trim()
              : "ketcher-sketch.sdf";
            return [{ title, text }];
          } catch {
            return [];
          }
        });
        if (fragments.length > 0) {
          openKetcherWithStructures([], fragments);
        } else {
          pushStatus("Open in Ketcher failed: selected molecules do not have structure data.", "error");
        }
        return;
      }
      if (body?.type === "setRenderer") {
        const renderer = body.value;
        if (renderer === "auto" || renderer === "molstar" || renderer === "xyzrender-external") {
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
            void openDocuments([targetDocument.path], reloadOptions, { rendererMode: renderer }, { inActiveTab: true });
          }
        }
        return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [activeDocument, addDocuments, documents, notifyGridPoseReviewSelection, openDockingDocument, openDocuments, openDocumentsInActiveTab, openKetcherWithFragment, openKetcherWithStructures, openPoseReviewWorkspace, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, reloadActive, setPreference, writeGridPerfMetric]);

  useEffect(() => {
    const loadedPreferences = loadUpdatePreferences();
    if (!shouldCheckAutomatically(loadedPreferences)) return undefined;
    const timeout = window.setTimeout(() => {
      void checkForUpdates(true, loadedPreferences.channel);
    }, 1200);
    return () => window.clearTimeout(timeout);
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

  const startSidebarResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setSidebarDragging(true);
      const resizeTarget = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      let didCloseSidebar = false;
      let didStop = false;
      const stop = () => {
        if (didStop) return;
        didStop = true;
        setSidebarDragging(false);
        document.documentElement.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        try {
          if (resizeTarget.hasPointerCapture(pointerId)) {
            resizeTarget.releasePointerCapture(pointerId);
          }
        } catch {
          // The pointer may already be gone if the native window lost focus.
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        window.removeEventListener("blur", stop);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        resizeTarget.removeEventListener("lostpointercapture", stop);
      };
      const onVisibilityChange = () => {
        if (document.hidden) stop();
      };
      const onMove = (move: PointerEvent) => {
        if (move.buttons === 0) {
          stop();
          return;
        }
        const nextWidth = startWidth + move.clientX - startX;
        if (nextWidth < SIDEBAR_DRAG_CLOSE_WIDTH) {
          if (!didCloseSidebar) {
            didCloseSidebar = true;
            closeSidebar();
          }
          stop();
          return;
        }
        setSidebarWidth(nextWidth);
      };
      try {
        resizeTarget.setPointerCapture(pointerId);
      } catch {
        // Keep the window-level fallback listeners active if capture is unavailable.
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      window.addEventListener("blur", stop);
      document.addEventListener("visibilitychange", onVisibilityChange);
      resizeTarget.addEventListener("lostpointercapture", stop);
    },
    [closeSidebar, setSidebarWidth, sidebarWidth],
  );

  const startRightDockResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setRightDockDragging(true);
      const startX = event.clientX;
      const startWidth = rightDockWidth;
      let closedByDrag = false;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (move: PointerEvent) => {
        const nextWidth = startWidth + startX - move.clientX;
        if (nextWidth <= RIGHT_DOCK_CLOSE_THRESHOLD) {
          if (!closedByDrag) {
            closedByDrag = true;
            setDockOpen("right", false);
          }
          return;
        }
        if (closedByDrag) {
          closedByDrag = false;
          setDockOpen("right", true);
        }
        setDockSize("right", nextWidth);
      };
      const stop = () => {
        setRightDockDragging(false);
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
    [rightDockWidth, setDockOpen, setDockSize],
  );

  const startBottomDockResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setBottomDockDragging(true);
      const startY = event.clientY;
      const startHeight = bottomDockHeight;
      let closedByDrag = false;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      const onMove = (move: PointerEvent) => {
        const nextHeight = startHeight + startY - move.clientY;
        if (nextHeight <= BOTTOM_DOCK_CLOSE_THRESHOLD) {
          if (!closedByDrag) {
            closedByDrag = true;
            setDockOpen("bottom", false);
          }
          return;
        }
        if (closedByDrag) {
          closedByDrag = false;
          setDockOpen("bottom", true);
        }
        setDockSize("bottom", nextHeight);
      };
      const stop = () => {
        setBottomDockDragging(false);
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
    [bottomDockHeight, setDockOpen, setDockSize],
  );

  const actions = useMemo<ShellActions>(() => ({
    chooseFiles,
    openStructurePaths: async (paths: string[]) => {
      await openDocuments(paths);
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
    openSettings,
    openKetcher,
    openKetcherWithStructures,
    openFepSetupWorkspace,
    openKetcherSketch,
    saveKetcherDraft: setKetcherDraftMolfile,
    clearKetcherImportRequest,
    moveTab,
    chooseWorkspace,
    openWorkspaceFolder,
    openProjectFolder,
    toggleSidebar,
    toggleDock,
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
      closeGridRuntime(id);
      closeDocument(id);
    },
    closeTab: (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      if (tab?.location.kind === "file") {
        const location = tab.location;
        const document = documents.find((candidate) => (
          candidate.id === location.documentId ||
          candidate.path === location.path
        ));
        closeGridRuntime(document?.id ?? location.documentId);
      }
      closeTab(id);
    },
    closeActiveDocument: () => {
      closeGridRuntime(activeDocument?.id);
      closeActiveDocument();
      pushStatus("Closed active tab");
    },
    clearAllDocuments: () => {
      for (const document of documents) closeGridRuntime(document.id);
      closeAllDocuments();
      pushStatus("Closed all tabs");
    },
    openDockingDocument,
    openDockingStructureRecords,
    appendGridRecords,
    addXyzrenderSheetItems: addXyzrenderSheetItemsToDocument,
    mergeMoleculeCollections,
    saveMoleculeCollectionAs,
    revealActiveDocument,
    revealDocument,
    revealPath,
    copyActiveDocumentPath,
    copyDocumentPath,
    copyPath,
    showActiveDocumentMetadata,
    showDocumentMetadata,
    showTextFileMetadata,
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
    exportDiagnostics: async () => {
      try {
        if (!isTauriRuntime()) {
          pushStatus("Diagnostics export is available in the desktop app only.", "error");
          return;
        }
        const outputPath = await save({
          title: "Export Diagnostics Bundle",
          defaultPath: `Burrete-Diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.diagnostics`,
          filters: [{ name: "Burrete diagnostics", extensions: ["diagnostics"] }],
        });
        if (!outputPath) return;
        const exportedPath = await measureAsync("ipc:export-diagnostics", () => invoke<string>("export_diagnostics_bundle", {
          outputPath,
          performanceMarks: collectPerformanceMarks(),
          recentErrors: recentErrorsRef.current,
        }));
        pushStatus(`Exported diagnostics to ${basename(exportedPath)}`);
      } catch (error) {
        pushErrorStatus(error, "Diagnostics export failed");
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
  }), [activeDocument?.id, addDockDrop, addXyzrenderSheetItemsToDocument, appendGridRecords, canNavigateBack, canNavigateForward, checkForUpdates, chooseFiles, chooseWorkspace, clearCache, clearKetcherImportRequest, clearRecentStructures, closeActiveDocument, closeAllDocuments, closeDocument, closeDockTab, closeGridRuntime, closeTab, copyActiveDocumentPath, copyDocumentPath, copyPath, documents, exportActivePreviewAsPng, exportActivePreviewAsSvg, focusSidebarSearch, installUpdate, mergeMoleculeCollections, moveTab, navigateBack, navigateForward, openClipboard, openCommandPalette, openDockingDocument, openDockingStructureRecords, openDockPayload, openDockTab, openDocuments, openFepSetupWorkspace, openKetcher, openKetcherSketch, openKetcherWithStructures, openLogs, openMostRecentStructure, openNewTab, openPaths, openProjectFolder, openRecentStructure, openSettings, openStructureRecords, openWorkspaceFolder, pushErrorStatus, pushStatus, resetQuickLook, revealActiveDocument, revealDocument, revealPath, saveMoleculeCollectionAs, selectDocument, setActiveTab, setDockActiveTab, setDockDocument, setDockOpen, setDockSize, setDockTool, setExpandedProjectIds, setPreference, setSidebarQuery, setUpdatePreferences, showActiveDocumentMetadata, showDocumentMetadata, showTextFileMetadata, tabs, toggleDock, togglePinnedStructure, toggleProjectExpanded, toggleProjectsOpen, toggleSidebar, update.availableRelease]);

  const page = activeTab?.location.kind === "settings" ? "settings" : "viewer";

  const state: ShellViewState = {
    documents,
    textDocuments,
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
    sidebarQuery,
    status,
    dropActive,
    preferences,
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

function summarizeErrors(errors: string[]) {
  const [first = "Unknown error", ...rest] = errors.map(summarizeErrorText);
  return rest.length > 0
    ? `${first} (+${rest.length} more ${rest.length === 1 ? "issue" : "issues"})`
    : first;
}

function summarizeErrorText(message: string) {
  return (message || "Unknown error").trim().split(/\r?\n| Error:| at /)[0]?.trim() || "Unknown error";
}

function pathExtension(path: string) {
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const index = fileName.lastIndexOf(".");
  if (index <= 0 || index === fileName.length - 1) return "";
  return fileName.slice(index + 1).toLowerCase();
}

function ketcherDraftMolfileFromImportText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!normalized.trim()) return null;
  const records = normalized.split(/\n\$\$\$\$\s*(?:\n|$)/u).map((record) => record.trimEnd()).filter(Boolean);
  if (records.length === 1 && normalized !== records[0]) {
    const [record] = records;
    return record && looksLikeMolfile(record) ? record + "\n" : null;
  }
  return looksLikeMolfile(normalized) ? normalized + "\n" : null;
}

function looksLikeMolfile(text: string) {
  const lines = text.split("\n");
  return lines.length >= 4 && /^\s*\d+\s+\d+\b/u.test(lines[3] ?? "");
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

function safeExportFileName(name: string) {
  return (name || "export.txt")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/^\.+/g, "")
    .trim()
    .slice(0, 120) || "export.txt";
}

function exportDialogFilters(fileName: string, mimeType: string) {
  const extension = fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension) return undefined;
  const name = mimeType.includes("csv")
    ? "CSV"
    : (mimeType.includes("smiles") || extension === "smi" || extension === "smiles" ? "SMILES" : "Text");
  return [{ name, extensions: [extension] }];
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
