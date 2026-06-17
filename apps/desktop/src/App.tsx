import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import previewFormatRegistry from "../../../config/preview-formats.json";
import { AppLayout } from "./components/app-layout";
import { formatBytes } from "./components/format";
import { showNativeContextMenu } from "./components/native-context-menu";
import type { AppSettingsSectionId, ChemicalEditorTarget, KetcherImportRequest, KetcherSketchRequest, KetcherSource3D, ShellActions, ShellViewState, StatusKind, StatusNotice, StructureViewerAction, ViewerLigandSelection } from "./components/types";
import { WindowTitle } from "./components/window-title";
import {
  useCloseCommandPalette,
  useCommandPaletteSearch,
  useIsCommandPaletteOpen,
  useOpenCommandPalette,
  useSetCommandPaletteSearch,
} from "./hooks/use-command-palette";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useAgentSession } from "./hooks/use-agent-session";
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
import { browserDevRuntimeNeedsRefresh, generateBrowserDev3DConformer, openBrowserDevDockingDocument, openBrowserDevDocuments, openBrowserDevMergedCollection, openBrowserDevMolstarContextDocument, openBrowserDevTextDocument, readBrowserDevCollectionText, readBrowserDevVirtualTextDocument, writeBrowserDevVirtualTextDocument } from "./lib/browser-dev-documents";
import { openBrowserDevTextFiles } from "./lib/browser-dev-text-files";
import { defaultBuildInfo, loadBuildInfo } from "./lib/build-info";
import { isMoleculeCollectionPath } from "./lib/collection-documents";
import { dockingRequestForDrop, isProteinLikeDockingSource } from "./lib/docking-documents";
import { canInspectConformerEnsemble, canUseConformerWorkflow } from "./lib/conformer-ensemble";
import type { DockArea, DockTabKind } from "./lib/dock";
import type { DropActionChoice } from "./lib/drop-actions";
import { collectPerformanceMarks, markPerformanceOnce, measureAsync } from "./lib/performance";
import { basename, buildSidebarProjects, parentDirectory, type SidebarProjectStructure } from "./lib/sidebar-projects";
import { parseStructureComposition } from "./lib/structure-composition";
import type { StructureDragPayload, StructureDragRecord } from "./lib/structure-drag";
import { readStructureText } from "./lib/structure-text";
import { isSpectrumExtension, spectrumDocumentFromText } from "./lib/spectrum";
import type { TextStructureSelection } from "./lib/text-structure-selection";
import { isTauriRuntime } from "./lib/tauri";
import { isTemporaryDocumentPath } from "./lib/temporary-documents";
import { calculateGridDescriptors as runGridDescriptorCalculation, type DescriptorSourcePayload, type GridDescriptorControls, type GridDescriptorJobStatus, type GridDescriptorResultRow, type GridDescriptorRunOptions } from "./lib/descriptors";
import type { ConformerJob, ConformerOperation, ConformerPreparedRun, ConformerRunRequest, ConformerRunResult, ConformerSettings, ConformerStatus, DockingDocumentRequest, DockingSceneMode, FepSetupRequest, OpenDocumentsMode, OpenDocumentsResult, OpenTextFilesResult, RecentStructure, TextFileDocument, ViewerDocument, ViewerPreferences, ViewerReloadOptions, XtbJob, XtbOperation, XtbRunRequest, XtbRunResult, XtbSettings, XtbStatus } from "./types";
import { checkForUpdates as requestUpdateCheck, clearDismissedUpdate, dismissUpdate, loadUpdatePreferences, markAutomaticCheck, releasePageUrl, saveUpdatePreferences, shouldCheckAutomatically, shouldPromptForUpdate } from "./update";
import type { UpdatePreferences, UpdateRelease, UpdateState } from "./update";

const CommandPalette = lazy(() => import("./components/command-palette").then((module) => ({
  default: module.CommandPalette,
})));

const filters = [
  {
    name: "Files",
    extensions: [...previewFormatRegistry.documentTypes.extensions, "ms", "magma", "mgf", "msp", "mzML", "mzXML", "md", "markdown", "mdx", "txt", "log", "out", "err", "sh", "bash", "zsh", "py", "rs", "js", "jsx", "ts", "tsx", "json", "yaml", "yml", "toml", "xml", "html", "css", "inpcrd", "rst7", "crd", "rst", "par", "prm", "rtf", "str", "key", "chk", "checkpoint", "state"],
  },
];

const GRID_DESCRIPTOR_JOB_EVENT = "burrete-grid-descriptor-job";
const NOT_RENDERABLE_RENDERER = "not-renderable";

function publishGridDescriptorJob(status: GridDescriptorJobStatus) {
  window.dispatchEvent(new CustomEvent<GridDescriptorJobStatus>(GRID_DESCRIPTOR_JOB_EVENT, { detail: status }));
}

const structureExtensions = new Set(previewFormatRegistry.formats
  .filter((format) => format.preview?.strategy !== "text")
  .flatMap((format) => format.extensions)
  .map((extension) => extension.toLowerCase()));
const browserDevSampleFiles = [
  { title: "ketcher-2d-benzene.sdf", extension: "sdf", byteCount: 579 },
  { title: "ketcher-3d-core.sdf", extension: "sdf", byteCount: 409 },
  { title: "nad-2d.sdf", extension: "sdf", byteCount: 3813 },
] as const;
const preferredTextExtensions = new Set([
  "md",
  "markdown",
  "mdx",
  "txt",
  "log",
  "out",
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
  "html",
  "css",
  "dms",
  "edr",
  "fasta",
  "par",
  "prm",
  "rtf",
  "str",
  "xvg",
  "key",
  "chk",
  "checkpoint",
]);
const structureAndTextExtensions = new Set([
  "abi",
  "cms",
  "com",
  "config",
  "coor",
  "csv",
  "crdbox",
  "cub",
  "cube",
  "data",
  "dcd",
  "dump",
  "fdf",
  "fhiaims",
  "gms",
  "graphml",
  "gsd",
  "h5md",
  "in",
  "inp",
  "inpcrd",
  "itp",
  "lammpstrj",
  "lammps",
  "lmp",
  "mae",
  "maegz",
  "mdcrd",
  "namdbin",
  "nc",
  "ncdf",
  "ncrst",
  "nctraj",
  "netcdf",
  "nw",
  "parm",
  "parm7",
  "prmtop",
  "psf",
  "psi4",
  "qcin",
  "crd",
  "restrt",
  "rst",
  "rst7",
  "state",
  "top",
  "tpr",
  "tng",
  "trc",
  "trr",
  "trz",
  "tsv",
  "txyz",
  "xtc",
  "vasp",
  "xml",
]);

const GRID_PERF_REPORT_PATH = "/private/tmp/burrete-grid-real-app-perf.jsonl";
const DIRECT_CHEMISTRY_JOB_ATOM_LIMIT = 300;
const DIRECT_CHEMISTRY_JOB_READ_LIMIT = 4 * 1024 * 1024;
const SIDEBAR_DRAG_CLOSE_WIDTH = 180;
const RIGHT_DOCK_CLOSE_THRESHOLD = 180;
const BOTTOM_DOCK_CLOSE_THRESHOLD = 120;

type MolstarContextDocument = Parameters<typeof openBrowserDevMolstarContextDocument>[0];
type MolstarContextEntry = NonNullable<MolstarContextDocument["entries"]>[number];
type ConformerGenerationResult = {
  title: string;
  extension: "sdf";
  text: string;
  method: string;
  conformerCount?: number;
};
type ConformerGenerationMode = "single" | "ensemble";
type MolstarStylePreference = ViewerPreferences["molstarStyle"];
type PendingMolstarReplaceResolver = (ok: boolean) => void;
type XtbRunJobOptions = {
  title?: string;
  inputLabel?: string;
  openPrimary?: boolean;
  openOptimizedPoseInCurrentView?: boolean;
  poseSourceDocument?: ViewerDocument | null;
};

function molstarContextEntryExtension(format: string | undefined) {
  const value = String(format || "pdb").toLowerCase();
  if (value === "cif" || value === "mmcif" || value === "mcif") return "cif";
  if (value === "sd") return "sdf";
  return value || "pdb";
}

function structureExtensionFromPath(path: string | null | undefined) {
  const name = basename(String(path || ""));
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : "pdb";
}

const browserDevChemicalEditorTargets: ChemicalEditorTarget[] = [
  {
    id: "browser-dev-maestro",
    name: "Maestro",
    bundleId: "com.schrodinger.maestro",
    appPath: "/Applications/SchrodingerSuites2026-1/Maestro.app",
    iconUrl: "/__burette/app-icon/maestro.png",
    rank: 10,
    supportedExtensions: ["pdb", "cif", "sdf", "mol2", "mae"],
    matchReason: "Browser dev preview target",
  },
  {
    id: "browser-dev-chimerax",
    name: "ChimeraX",
    bundleId: "edu.ucsf.rbvi.ChimeraX",
    appPath: "/Applications/ChimeraX-1.10.app",
    iconUrl: "/__burette/app-icon/chimerax.png",
    rank: 20,
    supportedExtensions: ["pdb", "cif", "mol2", "sdf"],
    matchReason: "Browser dev preview target",
  },
  {
    id: "browser-dev-pymol",
    name: "PyMOL",
    bundleId: "org.pymol.PyMOL",
    appPath: "/Applications/PyMOL.app",
    iconUrl: "/__burette/app-icon/pymol.png",
    rank: 30,
    supportedExtensions: ["pdb", "cif", "mol2"],
    matchReason: "Browser dev preview target",
  },
  {
    id: "browser-dev-avogadro",
    name: "Avogadro2",
    bundleId: "org.openchemistry.Avogadro2",
    appPath: "/Applications/Avogadro2.app",
    iconUrl: "/__burette/app-icon/avogadro2.png",
    rank: 40,
    supportedExtensions: ["pdb", "cif", "sdf", "mol", "mol2", "xyz"],
    matchReason: "Browser dev preview target",
  },
  {
    id: "browser-dev-datawarrior",
    name: "DataWarrior",
    bundleId: "com.actelion.research.datawarrior",
    appPath: "/Applications/DataWarrior.app",
    iconUrl: "/__burette/app-icon/datawarrior.png",
    rank: 50,
    supportedExtensions: ["sdf", "mol", "smi", "csv"],
    matchReason: "Browser dev preview target",
  },
  {
    id: "browser-dev-vesta",
    name: "VESTA",
    bundleId: "jp.riken.VESTA",
    appPath: "/Applications/VESTA.app",
    iconUrl: "/__burette/app-icon/vesta.png",
    rank: 60,
    supportedExtensions: ["cif", "pdb", "xyz"],
    matchReason: "Browser dev preview target",
  },
];

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
  if (params.has("devFolder")) {
    const folder = params.get("devFolder") ?? "";
    const response = await fetch(`/__burette/dev-files?root=${encodeURIComponent(folder)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load dev folder: ${response.status}`);
    const payload = await response.json() as { files?: string[] };
    return Array.isArray(payload.files) ? payload.files : [];
  }
  return [];
}

function splitDevFiles(rawFiles: string) {
  return rawFiles.split("\n").map((path) => path.trim()).filter(Boolean);
}

function browserDevHasExplicitFiles() {
  if (typeof window === "undefined" || isTauriRuntime()) return false;
  return new URLSearchParams(window.location.search).has("devFiles");
}

async function expandBrowserDevStructureBundles(paths: string[]) {
  if (isTauriRuntime()) return paths;
  const expanded: string[] = [];
  const seen = new Set<string>();
  const addPath = (path: string) => {
    const extension = pathExtension(path);
    if (
      !extension ||
      (!structureExtensions.has(extension) &&
        !isXtbOptimizationTrajectoryLogPath(path) &&
        !structureAndTextExtensions.has(extension) &&
        !preferredTextExtensions.has(extension))
    ) {
      return;
    }
    if (!seen.has(path)) {
      seen.add(path);
      expanded.push(path);
    }
  };
  for (const path of paths) {
    addPath(path);
    try {
      const response = await fetch(`/__burette/file-bundle?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      if (!response.ok) continue;
      const bundle = await response.json() as {
        kind?: string;
        primaryPath?: string;
        attachments?: Array<{ path?: string }>;
      };
      if (bundle.kind === "single") continue;
      if (bundle.primaryPath) addPath(bundle.primaryPath);
      for (const attachment of bundle.attachments ?? []) {
        if (attachment.path) addPath(attachment.path);
      }
    } catch {
      // Browser-dev companion discovery is opportunistic; opening the requested file still works.
    }
  }
  return expanded;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
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

function queueKetcherImportRequest(request: KetcherImportRequest) {
  const targetWindow = window as Window & { __buretteKetcherImportRequest?: KetcherImportRequest | null };
  targetWindow.__buretteKetcherImportRequest = request;
  window.dispatchEvent(new CustomEvent("burette:ketcher-import", { detail: request }));
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
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [rightDockDragging, setRightDockDragging] = useState(false);
  const [bottomDockDragging, setBottomDockDragging] = useState(false);
  const toggleDockTab = useCallback((area: DockArea, kind: DockTabKind) => {
    const open = area === "right" ? rightDockOpen : bottomDockOpen;
    const activeKind = area === "right" ? rightDockActiveTab : bottomDockActiveTab;
    if (open && activeKind === kind) {
      setDockOpen(area, false);
      return;
    }
    openDockTab(area, kind);
  }, [bottomDockActiveTab, bottomDockOpen, openDockTab, rightDockActiveTab, rightDockOpen, setDockOpen]);

  const closeGridRuntime = useCallback((documentId: string | null | undefined) => {
    if (!documentId || !isTauriRuntime()) return;
    void invoke("grid_close_runtime", { documentId }).catch(() => {});
  }, []);
  const [structureDragActive, setStructureDragActive] = useState(false);
  const [ketcherImportRequest, setKetcherImportRequest] = useState<KetcherImportRequest | null>(null);
  const [ketcherDraftMolfile, setKetcherDraftMolfile] = useState("");
  const [descriptorSource, setDescriptorSource] = useState<DescriptorSourcePayload | null>(null);
  const [dirtyGridDocuments, setDirtyGridDocuments] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<StatusNotice | null>(null);
  const [buildInfo, setBuildInfo] = useState(defaultBuildInfo);
  const [buildInfoLoaded, setBuildInfoLoaded] = useState(false);
  const [poseReviewSelections, setPoseReviewSelections] = useState<Record<string, number>>({});
  const [conformerStatus, setConformerStatus] = useState<ConformerStatus | null>(null);
  const [conformerSettings, setConformerSettingsState] = useState<ConformerSettings>(() => readConformerSettings());
  const [conformerJobs, setConformerJobs] = useState<ConformerJob[]>([]);
  const [viewerLigandSelections, setViewerLigandSelections] = useState<Record<string, ViewerLigandSelection | null>>({});
  const [xtbStatus, setXtbStatus] = useState<XtbStatus | null>(null);
  const [xtbSettings, setXtbSettingsState] = useState<XtbSettings>(() => readXtbSettings());
  const [xtbJobs, setXtbJobs] = useState<XtbJob[]>([]);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [projectStructures, setProjectStructures] = useState<SidebarProjectStructure[]>([]);
  const [update, setUpdate] = useState<UpdateState>(() => ({
    preferences: loadUpdatePreferences(),
    isChecking: false,
    isInstalling: false,
    statusText: "No update check has run yet.",
    availableRelease: null,
  }));
  const openedBrowserDevFilesRef = useRef<string | null>(null);
  const openedBrowserDevDockingRef = useRef<string | null>(null);
  const prunedPersistedPathsRef = useRef(false);
  const refreshedPersistedSessionRef = useRef(false);
  const openedPersistedTabsRef = useRef(false);
  const syncingBrowserDevFilesRef = useRef(false);
  const pendingViewerReloadOptionsRef = useRef<ViewerReloadOptions | null>(null);
  const pendingViewerReloadDocumentIdRef = useRef<string | null>(null);
  const pendingMolstarReplaceRef = useRef<Map<string, PendingMolstarReplaceResolver>>(new Map());
  const pendingXyzrenderSheetDropRef = useRef<{ documentId: string; payload: StructureDragPayload } | null>(null);
  const xyzrenderOrientationRefRef = useRef<string | null>(null);
  const skipNextPreferenceRefreshRef = useRef(false);
  const statusSequenceRef = useRef(0);
  const recentErrorsRef = useRef<Array<{ message: string; details: string[]; timestampMs: number }>>([]);
  const gridPerfMetricsRef = useRef<string[]>([]);
  const cancelledConformerJobIdsRef = useRef(new Set<string>());
  const cancelledXtbJobIdsRef = useRef(new Set<string>());
  const ketcherImportSequenceRef = useRef(0);
  const commandPaletteOpen = useIsCommandPaletteOpen();
  const commandPaletteQuery = useCommandPaletteSearch();
  const openCommandPalette = useOpenCommandPalette();
  const closeCommandPalette = useCloseCommandPalette();
  const setCommandPaletteQuery = useSetCommandPaletteSearch();

  useEffect(() => {
    window.__BURRETE_BOOT_OVERLAY__?.markMounted();
    const frame = window.requestAnimationFrame(() => {
      markPerformanceOnce("app:shell-visible");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadBuildInfo().then((info) => {
      if (cancelled) return;
      setBuildInfo(info);
      setBuildInfoLoaded(true);
      if (info.isDevBuild) {
        setUpdate((previous) => ({
          ...previous,
          isChecking: false,
          availableRelease: null,
          statusText: "Updates are disabled for dev builds.",
        }));
      }
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

  const setConformerSettings = useCallback((settings: ConformerSettings) => {
    const normalized = normalizeConformerSettings(settings);
    setConformerSettingsState(normalized);
    saveConformerSettings(normalized);
  }, []);

  const checkConformerStatus = useCallback(async () => {
    try {
      const status = await requestConformerStatus();
      setConformerStatus(status);
      pushStatus(conformerStatusLine(status));
    } catch (error) {
      pushErrorStatus(error, "CREST/PRISM status failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const setXtbSettings = useCallback((settings: XtbSettings) => {
    const normalized = normalizeXtbSettings(settings);
    setXtbSettingsState(normalized);
    saveXtbSettings(normalized);
  }, []);

  const checkXtbStatus = useCallback(async () => {
    try {
      const status = await requestXtbStatus();
      setXtbStatus(status);
      pushStatus(status.installed ? `xTB ready: ${status.version ?? status.executablePath ?? "installed"}` : status.installHint, status.installed ? "success" : "error");
    } catch (error) {
      pushErrorStatus(error, "xTB status failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const installXtb = useCallback(async () => {
    try {
      pushStatus("Installing xTB...");
      const status = await installXtbRequest();
      setXtbStatus(status);
      pushStatus(status.installed ? `xTB installed: ${status.version ?? status.executablePath ?? "ready"}` : status.installHint, status.installed ? "success" : "error");
    } catch (error) {
      pushErrorStatus(error, "xTB install failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const openXtbOptimizedPoseInCurrentView = useCallback(async (
    sourceDocument: ViewerDocument | null | undefined,
    sourcePath: string | null | undefined,
    result: XtbRunResult,
  ) => {
    const sourceTitle = sourceDocument?.title ?? (sourcePath ? basename(sourcePath) : "structure");
    const trajectoryArtifact = result.artifacts.find((artifact) => artifact.title === "xtbopt.log");
    if (trajectoryArtifact) {
      const trajectoryText = await readStructureText(trajectoryArtifact.path);
      const trajectoryFrames = countXyzFrames(trajectoryText);
      if (trajectoryFrames > 1) {
        const title = `${sourceTitle} xTB optimization.xyz`;
        const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
        const reloadOptions = { trajectoryAutoPlayOnce: true, molstarStyle: preferences.molstarStyle };
        const document = isTauriRuntime()
          ? await invoke<ViewerDocument>("open_text_structure", {
              request: {
                title,
                extension: "xyz",
                text: trajectoryText.endsWith("\n") ? trajectoryText : `${trajectoryText}\n`,
              },
              preferences: molstarPreferences,
              reloadOptions,
            })
          : await openBrowserDevTextDocument(
              title,
              "xyz",
              trajectoryText.endsWith("\n") ? trajectoryText : `${trajectoryText}\n`,
              molstarPreferences,
              reloadOptions,
            );
        const documentWithSource = sourcePath ? { ...document, sourcePath } : document;
        openDocumentsInActiveTab([documentWithSource]);
        rememberRecentStructures([documentWithSource]);
        pushStatus("Opened xTB optimization trajectory in the current Mol* view", "success");
        return;
      }
    }
    if (!sourcePath || !result.primaryOpenPath) return;
    const [sourceText, optimizedText] = await Promise.all([
      readStructureText(sourcePath),
      readStructureText(result.primaryOpenPath),
    ]);
    const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
    const document = await openBrowserDevMolstarContextDocument({
      label: `${sourceTitle} xTB optimized`,
      entries: [
        {
          role: "receptor",
          label: `${sourceTitle} input`,
          format: structureExtensionFromPath(sourcePath),
          data: sourceText,
        },
        {
          role: "ligand",
          label: "xTB optimized pose",
          format: structureExtensionFromPath(result.primaryOpenPath),
          data: optimizedText,
        },
      ],
      context: { scope: "xtb-optimization" },
    }, molstarPreferences);
    openDocumentsInActiveTab([document]);
    rememberRecentStructures([document]);
    pushStatus("Opened xTB optimized pose in the current Mol* view", "success");
  }, [openDocumentsInActiveTab, preferences, pushStatus, rememberRecentStructures]);

  const runXtbJob = useCallback(async (
    request: XtbRunRequest,
    options: XtbRunJobOptions = {},
  ) => {
    const title = options.title ?? xtbOperationLabel(request.operation);
    const inputLabel = options.inputLabel ?? request.label ?? request.inputPath ?? "Ketcher sketch";
    const guardMessage = await directChemistryJobGuardMessage("xTB", request.inputText ?? null, request.inputExtension ?? structureExtensionFromPath(request.inputPath ?? request.sourcePath), request.inputPath ?? request.sourcePath ?? null);
    if (guardMessage) {
      pushStatus(guardMessage, "error");
      return;
    }
    const jobId = `xtb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const pendingJob: XtbJob = {
      id: jobId,
      title,
      operation: request.operation,
      status: "running",
      inputLabel,
      startedAt,
      completedAt: null,
      result: null,
      error: null,
    };
    setXtbJobs((previous) => [pendingJob, ...previous].slice(0, 20));
    try {
      const saveRunFiles = request.saveRunFiles ?? xtbSettings.saveRunFiles;
      const result = await runXtbRequest({
        method: xtbSettings.method,
        optLevel: xtbSettings.optLevel,
        charge: xtbSettings.charge,
        uhf: xtbSettings.uhf,
        threads: xtbSettings.threads,
        accuracy: xtbSettings.accuracy,
        electronicTemperature: xtbSettings.electronicTemperature,
        solvationModel: xtbSettings.solvationModel,
        solvent: xtbSettings.solvent === "none" ? null : xtbSettings.solvent,
        properties: xtbSettings.properties,
        mdTemperature: xtbSettings.mdTemperature,
        mdTimePs: xtbSettings.mdTimePs,
        mdStepFs: xtbSettings.mdStepFs,
        mdSnapshots: xtbSettings.mdSnapshots,
        timeoutSeconds: request.operation === "md" || request.operation === "metadyn"
          ? Math.max(xtbSettings.timeoutSeconds, 600)
          : xtbSettings.timeoutSeconds,
        saveRunFiles,
        ...request,
        jobId,
      });
      const cancelled = cancelledXtbJobIdsRef.current.has(jobId) || /cancelled/iu.test(result.error ?? "");
      const recovered = !result.ok && Boolean(result.primaryOpenPath);
      const jobStatus: XtbJob["status"] = cancelled ? "cancelled" : result.ok ? "success" : recovered ? "recovered" : "failed";
      setXtbJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: jobStatus,
        completedAt: Date.now(),
        result,
        error: result.error ?? null,
      } : job));
      if (cancelled) {
        pushStatus(`xTB cancelled: ${title}`);
        return;
      }
      void requestXtbStatus().then(setXtbStatus).catch(() => {});
      const textArtifacts = [result.reportPath, result.logPath].filter(Boolean);
      if (textArtifacts.length > 0) {
        void openTextDocuments(textArtifacts, { background: true });
      }
      const sourcePath = request.sourcePath ?? request.inputPath ?? null;
      if ((result.ok || recovered) && options.openOptimizedPoseInCurrentView && request.operation === "optimize") {
        await openXtbOptimizedPoseInCurrentView(options.poseSourceDocument, sourcePath, result);
      }
      if (options.openPrimary !== false && result.primaryOpenPath) {
        void openPaths([result.primaryOpenPath]);
      }
      if (!options.openOptimizedPoseInCurrentView && result.ok && request.operation === "optimize" && sourcePath && result.primaryOpenPath) {
        openDockTab("bottom", "compare");
        setDockActiveTab("bottom", "compare");
        setDockOpen("bottom", true);
        addDockDrop({
          area: "bottom",
          tabKind: "compare",
          payload: { paths: [sourcePath, result.primaryOpenPath], records: [] },
        });
      }
      if (result.ok) {
        pushStatus(`xTB finished: ${title}`, "success");
      } else if (recovered) {
        pushStatus(`xTB produced partial results: ${title}`, "info", result.error ? [result.error] : []);
      } else {
        pushStatus(`xTB failed: ${result.error ?? title}`, "error", result.error ? [result.error] : []);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = cancelledXtbJobIdsRef.current.has(jobId);
      setXtbJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: cancelled ? "cancelled" : "failed",
        completedAt: Date.now(),
        error: cancelled ? "xTB job cancelled." : message,
      } : job));
      if (cancelled) {
        pushStatus(`xTB cancelled: ${title}`);
        return;
      }
      pushErrorStatus(error, `xTB ${request.operation} failed`);
    }
  }, [addDockDrop, openDockTab, openXtbOptimizedPoseInCurrentView, pushErrorStatus, pushStatus, setDockActiveTab, setDockOpen, xtbSettings]);

  const cancelXtbJob = useCallback(async (jobId: string) => {
    cancelledXtbJobIdsRef.current.add(jobId);
    setXtbJobs((previous) => previous.map((job) => job.id === jobId && job.status === "running" ? {
      ...job,
      status: "cancelled",
      completedAt: Date.now(),
      error: "xTB job cancelled.",
    } : job));
    try {
      await cancelXtbRequest(jobId);
      pushStatus("xTB job cancelled");
    } catch (error) {
      pushErrorStatus(error, "Cancel xTB job failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const requestMolstarXtbContextDocument = useCallback(async (document: ViewerDocument): Promise<MolstarContextDocument | null> => {
    if (document.renderer !== "molstar") return null;
    const iframe = activeViewerIframeForDocument(document.id);
    if (!iframe?.contentWindow) return null;
    const actionId = `xtb-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const finish = (contextDocument: MolstarContextDocument | null) => {
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(contextDocument);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data;
        const body = data?.body;
        if (data?.source !== "burrete-agent-viewer" || body?.type !== "agent-action-result" || body.id !== actionId) return;
        if (!isKnownViewerMessageSource(event.source, document.id)) return;
        const contextDocument = body.result?.result?.contextDocument;
        finish(contextDocument && typeof contextDocument === "object" ? contextDocument : null);
      };
      const timeout = window.setTimeout(() => finish(null), 500);
      window.addEventListener("message", onMessage);
      iframe.contentWindow?.postMessage({
        source: "burrete-agent-host",
        body: {
          type: "agent-action",
          id: actionId,
          action: { type: "get_xtb_context" },
        },
      }, "*");
    });
  }, []);

  const runXtbActiveOperation = useCallback(async (operation: XtbOperation) => {
    if (!activeDocument) {
      pushStatus("Open a structure before running xTB.", "error");
      return;
    }
    const contextDocument = await requestMolstarXtbContextDocument(activeDocument);
    const contextInputRequest = xtbInputRequestForMolstarContextDocument(contextDocument, activeDocument.sourcePath ?? activeDocument.path);
    const inputRequest = contextInputRequest ?? xtbInputRequestForDocument(activeDocument);
    if (!inputRequest) {
      pushStatus("This generated structure cannot be used for xTB because its source text is unavailable.", "error");
      return;
    }
    const secondaryPaths = operation === "dock"
      ? dockDroppedStructures.flatMap((item) => item.payload.paths).filter((path) => path !== activeDocument.path).slice(0, 1)
      : [];
    if (operation === "dock" && secondaryPaths.length === 0) {
      pushStatus("Drop a ligand or second structure into a dock before running xTB docking.", "error");
      return;
    }
    const openOptimizedPoseInCurrentView = operation === "optimize";
    await runXtbJob({
      operation,
      ...inputRequest,
      secondaryPaths,
    }, {
      title: xtbOperationLabel(operation),
      inputLabel: inputRequest.label ?? activeDocument.title,
      openPrimary: operation !== "properties" && !openOptimizedPoseInCurrentView,
      openOptimizedPoseInCurrentView,
      poseSourceDocument: openOptimizedPoseInCurrentView ? activeDocument : null,
    });
  }, [activeDocument, dockDroppedStructures, pushStatus, requestMolstarXtbContextDocument, runXtbJob]);

  const runXtbKetcherSketch = useCallback(async (request: KetcherSketchRequest) => {
    await runXtbJob({
      operation: "optimize",
      inputText: request.text,
      inputExtension: request.extension,
      label: request.title,
    }, {
      title: "xTB Optimize Ketcher Sketch",
      inputLabel: request.title,
    });
  }, [runXtbJob]);

  const runXtbGridScoring = useCallback(async (document: ViewerDocument | null = activeDocument) => {
    if (!document) {
      pushStatus("Open a grid or structure before running xTB scoring.", "error");
      return;
    }
    const inputRequest = xtbInputRequestForDocument(document);
    if (!inputRequest) {
      pushStatus("This generated structure cannot be used for xTB because its source text is unavailable.", "error");
      return;
    }
    await runXtbJob({
      operation: document.renderer === "grid2d" ? "grid-properties" : "properties",
      ...inputRequest,
    }, {
      title: document.renderer === "grid2d" ? "xTB Grid Properties" : "xTB Properties",
      inputLabel: document.title,
      openPrimary: false,
    });
  }, [activeDocument, pushStatus, runXtbJob]);

  const runXtbPoseRefinement = useCallback(async (request: FepSetupRequest) => {
    await runXtbJob({
      operation: "pose-refine",
      inputPath: request.gridPath,
      secondaryPaths: [request.receptorPath, request.dockingPath],
      label: `pose-${request.referencePose + 1}`,
    }, {
      title: `xTB Refine Pose ${request.referencePose + 1}`,
      inputLabel: basename(request.gridPath),
    });
  }, [runXtbJob]);

  const runXtbFepPreflight = useCallback(async (request: FepSetupRequest) => {
    await runXtbJob({
      operation: "fep-preflight",
      inputPath: request.gridPath,
      secondaryPaths: [request.receptorPath, request.dockingPath],
      label: "fep-preflight",
    }, {
      title: "xTB FEP Preflight",
      inputLabel: basename(request.gridPath),
      openPrimary: false,
    });
  }, [runXtbJob]);

  const runConformerJob = useCallback(async (request: ConformerRunRequest) => {
    const title = conformerOperationLabel(request.operation);
    const jobId = `conformer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullRequest: ConformerRunRequest = {
      ...request,
      jobId,
      method: conformerSettings.method,
      solvent: conformerSettings.solvent === "none" ? null : conformerSettings.solvent,
      charge: conformerSettings.charge,
      uhf: conformerSettings.uhf,
      threads: conformerSettings.threads,
      timeoutSeconds: request.operation === "prism-prune" ? conformerSettings.prismTimeoutSeconds : conformerSettings.timeoutSeconds,
      energyWindowKcalMol: conformerSettings.energyWindowKcalMol,
      rmsdThresholdAngstrom: conformerSettings.rmsdThresholdAngstrom,
      samplingMode: conformerSettings.samplingMode,
      prismEnergySort: conformerSettings.prismEnergySort,
      prismRotamerPruning: conformerSettings.prismRotamerPruning,
    };
    let preparedRun: ConformerPreparedRun;
    try {
      preparedRun = await prepareConformerRequest(fullRequest);
    } catch (error) {
      pushErrorStatus(error, `${title} setup failed`);
      return;
    }
    const pendingJob: ConformerJob = {
      id: jobId,
      title,
      operation: request.operation,
      inputTitle: request.title,
      status: "running",
      startedAt: Date.now(),
      workDir: preparedRun.workDir,
      logPath: preparedRun.logPath,
      result: null,
      error: null,
    };
    setConformerJobs((previous) => [pendingJob, ...previous].slice(0, 20));
    try {
      const result = await runConformerRequest({ ...fullRequest, workDir: preparedRun.workDir });
      const cancelled = cancelledConformerJobIdsRef.current.has(jobId) || /cancelled/iu.test(result.errorSummary ?? "");
      setConformerJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: cancelled ? "cancelled" : result.ok ? (result.exitCode === 0 ? "success" : "recovered") : "failed",
        completedAt: Date.now(),
        workDir: result.workDir,
        logPath: result.logPath,
        result,
        error: result.errorSummary ?? (result.ok ? null : `Exited with code ${result.exitCode}`),
      } : job));
      if (cancelled) {
        pushStatus(`${title} cancelled: ${request.title}`);
        return;
      }
      if (result.reportPath) {
        void openTextDocuments([result.reportPath], { background: true });
      }
      if (result.ok && result.primaryOpenPath) {
        void openPaths([result.primaryOpenPath]);
      }
      void requestConformerStatus().then(setConformerStatus).catch(() => {});
      pushStatus(`${title} ${result.ok ? "finished" : "failed"}: ${request.title}`, result.ok ? "success" : "error", [
        ...(result.errorSummary ? [result.errorSummary] : []),
        `Exit code: ${result.exitCode}`,
        `Run folder: ${result.workDir}`,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = cancelledConformerJobIdsRef.current.has(jobId);
      setConformerJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: cancelled ? "cancelled" : "failed",
        completedAt: Date.now(),
        error: cancelled ? "Conformer job cancelled." : message,
      } : job));
      if (cancelled) {
        pushStatus(`${title} cancelled: ${request.title}`);
        return;
      }
      pushErrorStatus(error, `${title} failed`);
    }
  }, [conformerSettings, pushErrorStatus, pushStatus]);

  const cancelConformerJob = useCallback(async (jobId: string) => {
    cancelledConformerJobIdsRef.current.add(jobId);
    setConformerJobs((previous) => previous.map((job) => job.id === jobId && job.status === "running" ? {
      ...job,
      status: "cancelled",
      completedAt: Date.now(),
      error: "Conformer job cancelled.",
    } : job));
    try {
      await cancelConformerRequest(jobId);
      pushStatus("Conformer job cancelled");
    } catch (error) {
      pushErrorStatus(error, "Cancel conformer job failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const runConformerOperation = useCallback(async (
    operation: ConformerOperation,
    document: ViewerDocument | null | undefined = activeDocument,
    selection: StructureViewerAction | null = null,
  ) => {
    if (!document) {
      pushStatus("Open a small molecule or conformer ensemble before running CREST/PRISM.", "error");
      return;
    }
    let selectedInput: SelectedConformerInput | null = null;
    if (selection && operation === "crest-generate") {
      try {
        selectedInput = await selectedPdbLigandConformerInput(document, selection);
      } catch (error) {
        pushErrorStatus(error, "Selected object extraction failed");
        return;
      }
    }
    if (!selectedInput && operation === "crest-generate") {
      const contextDocument = await requestMolstarXtbContextDocument(document);
      selectedInput = conformerInputForMolstarContextDocument(contextDocument);
    }
    if (selection && operation === "crest-generate" && !selectedInput) {
      pushStatus("Selected object could not be extracted for CREST.", "error");
      return;
    }
    if (!selectedInput && !canUseConformerWorkflow(document.extension)) {
      pushStatus("CREST/PRISM needs a small-molecule file or a selected object.", "error");
      return;
    }
    if (operation === "prism-prune" && !canInspectConformerEnsemble(document.extension)) {
      pushStatus("PRISM pruning expects an ensemble file such as XYZ or SDF.", "error");
      return;
    }
    const virtualText = !isTauriRuntime() ? readBrowserDevVirtualTextDocument(document.path) : null;
    const inputText = selectedInput?.text ?? virtualText;
    const guardMessage = await directChemistryJobGuardMessage(
      operation === "crest-generate" ? "CREST" : "PRISM",
      inputText,
      selectedInput?.extension ?? document.extension,
      inputText ? null : document.sourcePath ?? document.path,
    );
    if (guardMessage) {
      pushStatus(guardMessage, "error");
      return;
    }
    const inputBytes = inputText === null ? null : new TextEncoder().encode(inputText);
    await runConformerJob({
      operation,
      path: document.sourcePath ?? document.path,
      title: selectedInput?.title ?? document.title,
      extension: selectedInput?.extension ?? document.extension,
      inputDataBase64: inputBytes ? arrayBufferToBase64(inputBytes.buffer) : null,
      outputDirectory: conformerOutputDirectory(document),
    });
  }, [activeDocument, pushErrorStatus, pushStatus, requestMolstarXtbContextDocument, runConformerJob]);

  useEffect(() => {
    let cancelled = false;
    void requestXtbStatus()
      .then((status) => {
        if (!cancelled) setXtbStatus(status);
      })
      .catch(() => {});
    void requestConformerStatus()
      .then((status) => {
        if (!cancelled) setConformerStatus(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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

  const browserDevSampleRoot = useMemo(() => browserDevSampleProjectRoot(), []);
  const sidebarProjectRoots = useMemo(() => (
    browserDevSampleRoot && !projectRoots.includes(browserDevSampleRoot)
      ? [...projectRoots, browserDevSampleRoot]
      : projectRoots
  ), [browserDevSampleRoot, projectRoots]);
  const sidebarProjectStructures = useMemo(() => {
    const samples = browserDevSampleProjectStructures();
    return samples.length > 0 ? [...projectStructures, ...samples] : projectStructures;
  }, [projectStructures]);

  const allSidebarProjects = useMemo(() => buildSidebarProjects({
    documents,
    recentStructures,
    projectRoots: sidebarProjectRoots,
    projectStructures: sidebarProjectStructures,
    pinnedProjectRoots,
    projectNameOverrides,
    activeDocumentId: activeDocument?.id ?? null,
    hiddenProjectRoots,
    pinnedStructurePaths,
  }), [activeDocument?.id, documents, hiddenProjectRoots, pinnedProjectRoots, pinnedStructurePaths, projectNameOverrides, recentStructures, sidebarProjectRoots, sidebarProjectStructures]);

  useEffect(() => {
    if (!isTauriRuntime() || projectRoots.length === 0) {
      setProjectStructures([]);
      return undefined;
    }
    let cancelled = false;
    void invoke<SidebarProjectStructure[]>("list_project_structure_files", { paths: projectRoots })
      .then((files) => {
        if (!cancelled) setProjectStructures(files);
      })
      .catch((error) => {
        if (cancelled) return;
        setProjectStructures([]);
        pushErrorStatus(error, "Project file scan failed");
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoots, pushErrorStatus]);

  useEffect(() => {
    if (prunedPersistedPathsRef.current || !isTauriRuntime()) return;
    const paths = Array.from(new Set([
      ...projectRoots,
      ...pinnedProjectRoots,
      ...pinnedStructurePaths,
      ...recentStructures.map((structure) => structure.path),
    ].filter(Boolean)));
    if (paths.length === 0) return;
    prunedPersistedPathsRef.current = true;
    let cancelled = false;
    void invoke<string[]>("existing_paths", { paths })
      .then((existingPaths) => {
        if (cancelled) return;
        pruneSidebarPaths(existingPaths);
        pruneRecentStructures(existingPaths);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pinnedProjectRoots, pinnedStructurePaths, projectRoots, pruneRecentStructures, pruneSidebarPaths, recentStructures]);

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
      options: { replace?: boolean; inActiveTab?: boolean; mode?: OpenDocumentsMode } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return;
      const graphmlPaths = cleanPaths.filter(isFepGraphmlPath);
      const structurePaths = cleanPaths.filter((path) => !isFepGraphmlPath(path));
      if (graphmlPaths.length > 0) {
        try {
          for (const path of graphmlPaths) {
            const graphmlText = await readStructureText(path);
            openFepNetworkTab({ kind: "fep-network", title: basename(path), graphmlText });
          }
          pushStatus(`Opened ${graphmlPaths.length} FEP network${graphmlPaths.length === 1 ? "" : "s"}`);
        } catch (error) {
          if (structurePaths.length === 0) {
            pushErrorStatus(error, "Open failed");
            return;
          }
          pushErrorStatus(error, "FEP network open failed");
        }
      }
      if (structurePaths.length === 0) return;
      const effectivePreferences = preferencesOverride ? { ...preferences, ...preferencesOverride } : preferences;
      pushStatus("Opening structures...");
      try {
        const result = isTauriRuntime()
          ? await invoke<OpenDocumentsResult>("open_documents", { paths: structurePaths, preferences: effectivePreferences, reloadOptions, mode: options.mode })
          : await openBrowserDevDocuments(structurePaths, effectivePreferences, reloadOptions);
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
    [addDocuments, openDocumentsInActiveTab, openFepNetworkTab, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setActiveDocument, setDocuments, showDelimitedGridColumnOpenMenu],
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

  const openSpectrumDocuments = useCallback(
    async (
      paths: string[],
      options: { inActiveTab?: boolean; background?: boolean } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return null;
      pushStatus("Opening spectra...");
      try {
        const result = isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", { paths: cleanPaths })
          : await openBrowserDevTextFiles(cleanPaths);
        const documents = result.documents.map(spectrumDocumentFromText);
        if (options.background) addBackgroundDocuments(documents);
        else if (options.inActiveTab) openDocumentsInActiveTab(documents);
        else addDocuments(documents);
        if (!options.background && !options.inActiveTab && documents[0]) {
          setActiveDocument(documents[0].id);
          setDockDocument("right", documents[0].id);
          setDockActiveTab("right", "inspector");
          setDockOpen("right", true);
          setDockDocument("bottom", documents[0].id);
          openDockTab("bottom", "spectrum");
        }
        rememberRecentStructures(documents);
        const openedText = "Opened " + documents.length + " spectrum" + (documents.length === 1 ? "" : "s");
        if (result.errors.length > 0) {
          pushStatus(`${openedText}. ${summarizeErrors(result.errors)}`, "error", result.errors);
        } else {
          pushStatus(openedText);
        }
        return { documents, errors: result.errors };
      } catch (error) {
        pushErrorStatus(error, "Open spectrum failed");
        return null;
      }
    },
    [addBackgroundDocuments, addDocuments, openDockTab, openDocumentsInActiveTab, pushErrorStatus, pushStatus, rememberRecentStructures, setActiveDocument, setDockActiveTab, setDockDocument, setDockOpen],
  );

  const openPaths = useCallback(async (paths: string[]) => {
    const cleanPaths = await expandBrowserDevStructureBundles(Array.from(new Set(paths.filter(Boolean))));
    if (!cleanPaths.length) return;

    const structurePaths: string[] = [];
    const spectrumPaths: string[] = [];
    const textPaths: string[] = [];
    const structureAndTextPaths: string[] = [];
    let preferredStructureDocumentId: string | null = null;

    for (const path of cleanPaths) {
      const extension = pathExtension(path);
      if (isSpectrumExtension(extension)) {
        spectrumPaths.push(path);
      } else if (
        preferredTextExtensions.has(extension)
        || (extension.length > 0 && !structureExtensions.has(extension) && !structureAndTextExtensions.has(extension))
      ) {
        textPaths.push(path);
      } else if (structureAndTextExtensions.has(extension)) {
        structureAndTextPaths.push(path);
      } else if (structureExtensions.has(extension)) {
        structurePaths.push(path);
      } else {
        textPaths.push(path);
      }
    }

    if (spectrumPaths.length > 0) {
      const result = await openSpectrumDocuments(spectrumPaths);
      preferredStructureDocumentId = result?.documents[0]?.id ?? preferredStructureDocumentId;
    }

    if (structurePaths.length > 0) {
      const result = await openDocuments(structurePaths);
      preferredStructureDocumentId = result?.documents[0]?.id ?? preferredStructureDocumentId;
    }

    const openedStructureAndTextPaths = new Set<string>();
    if (structureAndTextPaths.length > 0) {
      const result = await openDocuments(structureAndTextPaths);
      const openedDocuments = result?.documents ?? [];
      for (const document of openedDocuments) {
        if (document.renderer === NOT_RENDERABLE_RENDERER) {
          closeDocument(document.id);
        } else {
          openedStructureAndTextPaths.add(document.path);
          preferredStructureDocumentId = preferredStructureDocumentId ?? document.id;
        }
      }
    }

    if (textPaths.length > 0) {
      await openTextDocuments(textPaths);
    }

    const backgroundTextPaths = structureAndTextPaths.filter((path) => openedStructureAndTextPaths.has(path));
    if (backgroundTextPaths.length > 0) {
      await openTextDocuments(backgroundTextPaths, { background: true });
    }

    const fallbackTextPaths = structureAndTextPaths.filter((path) => !openedStructureAndTextPaths.has(path));
    if (fallbackTextPaths.length > 0) {
      await openTextDocuments(fallbackTextPaths);
    }
    if (preferredStructureDocumentId) {
      setActiveDocument(preferredStructureDocumentId);
    }
  }, [closeDocument, openDocuments, openSpectrumDocuments, openTextDocuments, setActiveDocument]);

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
      if (workspace && !browserDevHasExplicitFiles()) {
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
      await openPaths([structure.path]);
    },
    [openPaths],
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
      let dockOpenPaths = cleanPaths;
      if (input.area === "right" && cleanPaths.length > 0) {
        const rightDockTextPaths = cleanPaths.filter((path) => {
          const extension = pathExtension(path);
          return !isSpectrumExtension(extension) && !structureExtensions.has(extension) && !structureAndTextExtensions.has(extension);
        });
        dockOpenPaths = cleanPaths.filter((path) => !rightDockTextPaths.includes(path));
        if (rightDockTextPaths.length > 0) {
          const textResult = isTauriRuntime()
            ? await invoke<OpenTextFilesResult>("open_text_files", { paths: rightDockTextPaths })
            : await openBrowserDevTextFiles(rightDockTextPaths);
          if (textResult.documents.length > 0) {
            addBackgroundTextDocuments(textResult.documents);
            setDockDocument(input.area, textResult.documents[0].id);
            addDockDrop(input);
          }
          const openedText = `Opened ${textResult.documents.length} text file${textResult.documents.length === 1 ? "" : "s"} in right dock`;
          if (textResult.errors.length > 0) {
            pushStatus(textResult.documents.length > 0 ? `${openedText}. ${summarizeErrors(textResult.errors)}` : summarizeErrors(textResult.errors), "error", textResult.errors);
            return;
          }
          pushStatus(openedText);
          if (dockOpenPaths.length === 0 && cleanRecords.length === 0) return;
        }
      }

      const structurePaths: string[] = [];
      const spectrumPaths: string[] = [];
      const textPaths: string[] = [];
      const structureAndTextPaths: string[] = [];
      for (const path of dockOpenPaths) {
        const extension = pathExtension(path);
        if (isSpectrumExtension(extension)) {
          spectrumPaths.push(path);
        } else if (structureAndTextExtensions.has(extension)) {
          structureAndTextPaths.push(path);
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
      const spectrumTextResult = spectrumPaths.length > 0
        ? isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", { paths: spectrumPaths })
          : await openBrowserDevTextFiles(spectrumPaths)
        : { documents: [], errors: [] };
      const spectrumDocuments = spectrumTextResult.documents.map(spectrumDocumentFromText);
      const structureAndTextResults: OpenDocumentsResult[] = [];
      for (const path of structureAndTextPaths) {
        try {
          const result = isTauriRuntime()
            ? await invoke<OpenDocumentsResult>("open_documents", { paths: [path], preferences, reloadOptions: undefined })
            : await openBrowserDevDocuments([path], preferences, undefined);
          const documents = result.documents.filter((document) => document.renderer !== NOT_RENDERABLE_RENDERER);
          if (documents.length > 0 || result.errors.length > 0) {
            structureAndTextResults.push({ documents, errors: result.errors });
          }
        } catch {}
      }
      const textOpenPaths = [...textPaths, ...structureAndTextPaths];
      const textResult = textOpenPaths.length > 0
        ? isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", { paths: textOpenPaths })
          : await openBrowserDevTextFiles(textOpenPaths)
        : { documents: [], errors: [] };
      const recordResult = cleanRecords.length > 0
        ? await openStructureRecordDocuments(cleanRecords)
        : { opened: [], errors: [] };
      const openedStructures = [
        ...spectrumDocuments,
        ...structurePathResult.documents,
        ...structureAndTextResults.flatMap((result) => result.documents),
        ...recordResult.opened,
      ];
      const openedTextDocuments = textResult.documents;
      const errors = [
        ...spectrumTextResult.errors,
        ...structurePathResult.errors,
        ...structureAndTextResults.flatMap((result) => result.errors),
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
    options: { activePose?: number | null; sceneMode?: DockingSceneMode | null } = {},
  ) => {
    const existingDockingRequest = documents.find((document) => document.path === targetPath || document.id === targetPath)?.dockingRequest;
    const request = dockingRequestForDrop(targetPath, droppedPaths, existingDockingRequest);
    if (!request) return null;
    if (request.ligandPaths.length === 0) return null;
    request.activePose = options.activePose ?? null;
    request.sceneMode = options.sceneMode ?? null;
    request.poseMode = options.sceneMode === "structureAll" ? "all" : "single";
    pushStatus("Opening Molstar docking view...");
    try {
      const document = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_docking_document", { request, preferences })
        : await openBrowserDevDockingDocument(request.receptorPath, request.ligandPaths, preferences, options);
      addDocuments([document]);
      rememberRecentStructures([document]);
      if (request.sceneMode && rightDockOpen && rightDockActiveTab === "descriptors") {
        setDockOpen("right", false);
      }
      setStructureDragActive(false);
      pushStatus(`Opened docking view with ${request.ligandPaths.length} ligand${request.ligandPaths.length === 1 ? "" : "s"}`);
      return document;
    } catch (error) {
      setStructureDragActive(false);
      pushErrorStatus(error, "Docking view failed");
      return null;
    }
  }, [addDocuments, documents, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, rightDockActiveTab, rightDockOpen, setDockOpen]);

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
      const message = "Opened docking view";
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

  const listChemicalEditorTargets = useCallback(async (path: string): Promise<ChemicalEditorTarget[]> => {
    if (!isTauriRuntime()) {
      const extension = path.split(".").pop()?.toLowerCase() ?? "";
      return browserDevChemicalEditorTargets.filter((target) => target.supportedExtensions.includes(extension));
    }
    try {
      return await invoke<ChemicalEditorTarget[]>("list_chemical_editor_targets", { path });
    } catch (error) {
      pushErrorStatus(error, "Chemical editor discovery failed");
      return [];
    }
  }, [pushErrorStatus]);

  const openPathInChemicalEditor = useCallback(async (path: string, targetId: string, targetName: string) => {
    try {
      if (!isTauriRuntime()) {
        await openPath(path);
        pushStatus(`Opened ${basename(path)}`);
        return;
      }
      await invoke("open_in_chemical_editor", { path, targetId });
      pushStatus(`Opened ${basename(path)} in ${targetName}`);
    } catch (error) {
      pushErrorStatus(error, `Open in ${targetName} failed`);
    }
  }, [pushErrorStatus, pushStatus]);

  const openPathWithDefaultApp = useCallback(async (path: string) => {
    try {
      await openPath(path);
      pushStatus(`Opened ${basename(path)}`);
    } catch (error) {
      pushErrorStatus(error, "Open with default app failed");
    }
  }, [pushErrorStatus, pushStatus]);

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
      await writeClipboardText(path);
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

  const selectTextStructure = useCallback((textDocument: TextFileDocument, selection: TextStructureSelection) => {
    const targetDocument = documents.find((document) => document.path === textDocument.path) ??
      (activeDocument?.path === textDocument.path ? activeDocument : null);
    if (!targetDocument || targetDocument.renderer !== "molstar") return;
    const iframe = activeViewerIframeForDocument(targetDocument.id);
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({
      source: "burrete-agent-host",
      body: {
        type: "agent-action",
        id: `text-selection-${Date.now()}`,
        action: {
          type: "select_residues",
          label: selection.label,
          selector: selection.selector,
          granularity: selection.granularity,
          mode: "replace",
        },
      },
    }, "*");
  }, [activeDocument, documents]);

  const runStructureViewerAction = useCallback((document: ViewerDocument, action: StructureViewerAction) => {
    if (document.renderer !== "molstar") {
      pushStatus(`${action.label} needs a Mol* viewer`, "error");
      return;
    }
    const iframe = activeViewerIframeForDocument(document.id);
    if (!iframe?.contentWindow) {
      pushStatus(`Open ${document.title} in the main viewer first`, "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burrete-agent-host",
      body: {
        type: "agent-action",
        id: `structure-action-${Date.now()}`,
        action,
      },
    }, "*");
    if (!("notify" in action) || action.notify !== false) {
      pushStatus(action.label);
    }
  }, [pushStatus]);

  const generate3DConformer = useCallback(async (document: ViewerDocument, mode: ConformerGenerationMode = "single", molstarStyle?: MolstarStylePreference | null) => {
    if (!["sdf", "sd", "mol", "smi", "smiles"].includes(document.extension.trim().toLowerCase())) {
      pushStatus("3D conformer generation supports SDF, MOL, and SMILES structures.", "error");
      return;
    }
    pushStatus(`Generating ${conformerGenerationTaskLabel(mode)} with ${preferences.conformerEngine.toUpperCase()}...`);
    try {
      const text = readBrowserDevVirtualTextDocument(document.path) ?? await readStructureText(document.path);
      const request = {
        title: document.title,
        extension: document.extension,
        text,
        ...conformerGenerationPreferences(preferences),
        mode,
        source3d: null,
      };
      const conformer = isTauriRuntime()
        ? await invoke<ConformerGenerationResult>("generate_3d_conformer", { request })
        : await generateBrowserDev3DConformer(request);
      const poseSetText = generated3DPoseSetText(text, document.extension, conformer.text, mode);
      const poseSetTitle = generated3DPoseSetTitle(document.title, poseSetText);
      const effectiveMolstarStyle = molstarStyle ?? preferences.molstarStyle;
      const molstarPreferences = { ...preferences, rendererMode: "molstar" as const, molstarStyle: effectiveMolstarStyle };
      const generatedDocument = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_text_structure", {
            request: { title: poseSetTitle, extension: conformer.extension, text: poseSetText },
            preferences: molstarPreferences,
            reloadOptions: {},
          })
        : await openBrowserDevTextDocument(
            poseSetTitle,
            conformer.extension,
            poseSetText,
            molstarPreferences,
            {},
          );
      const replacedInPlace = await replaceMolstarStructureInPlace(
        document,
        generatedDocument,
        { ...conformer, title: poseSetTitle, text: poseSetText },
        pendingMolstarReplaceRef.current,
        effectiveMolstarStyle,
      );
      if (replacedInPlace) {
        if (!isTauriRuntime()) writeBrowserDevVirtualTextDocument(generatedDocument.path, poseSetText);
        openDocumentsInActiveTab([generatedDocument], {
          backLocation: { kind: "file", documentId: document.id, path: document.path },
        });
        rememberRecentStructures([generatedDocument]);
        pushStatus(generated3DStatus(conformer, "added it as a new Molstar pose"));
        return;
      }
      if (document.renderer === "molstar") {
        pushStatus(
          "3D conformer was generated, but the current Molstar viewer did not apply it in place. Reload the viewer tab once and try again.",
          "error",
        );
        return;
      }
      openDocumentsInActiveTab([generatedDocument]);
      rememberRecentStructures([generatedDocument]);
      pushStatus(generated3DStatus(conformer, "opened it in Molstar"));
    } catch (error) {
      pushErrorStatus(error, "3D conformer generation failed");
    }
  }, [documents, openDocumentsInActiveTab, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setActiveDocument, setDocuments]);

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
    if (!sidebarOpen) toggleSidebar();
    openSettingsTab();
  }, [openSettingsTab, sidebarOpen, toggleSidebar]);

  const openSettingsSection = useCallback((section: AppSettingsSectionId) => {
    if (!sidebarOpen) toggleSidebar();
    openSettingsSectionTab(section as Parameters<typeof openSettingsSectionTab>[0]);
  }, [openSettingsSectionTab, sidebarOpen, toggleSidebar]);

  const backToApp = useCallback(() => {
    activateLastNonSettingsTab();
  }, [activateLastNonSettingsTab]);

  const openKetcher = useCallback(() => {
    openKetcherTab();
  }, [openKetcherTab]);

  const nextKetcherImportRequestId = useCallback(() => {
    const nextId = Math.max(ketcherImportSequenceRef.current + 1, Date.now());
    ketcherImportSequenceRef.current = nextId;
    return nextId;
  }, []);

  const openKetcherWithStructures = useCallback((paths: string[], fragments: KetcherImportRequest["fragments"] = []) => {
    const cleanPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    const virtualFragments: KetcherImportRequest["fragments"] = [];
    const readablePaths = cleanPaths.filter((path) => {
      const virtualText = readBrowserDevVirtualTextDocument(path);
      if (virtualText === null) return true;
      virtualFragments.push({
        title: basename(path),
        text: virtualText,
        source3d: ketcherSource3DFromText(basename(path), virtualText, pathExtension(path)),
      });
      return false;
    });
    const cleanFragments = [...(fragments?.filter((fragment) => fragment.text.trim()) ?? []), ...virtualFragments];
    if (readablePaths.length === 0 && cleanFragments.length === 0) return;
    const hasGridEditSource = cleanFragments.some((fragment) => fragment.source?.kind === "grid-row");
    if (!hasGridEditSource && readablePaths.length === 0 && cleanFragments.length === 1 && !cleanFragments[0]?.source3d) {
      const [fragment] = cleanFragments;
      const draftMolfile = ketcherDraftMolfileFromImportText(fragment.text);
      if (draftMolfile) {
        openKetcherTab({ kind: "ketcher", draftMolfile });
        setStructureDragActive(false);
        setKetcherDraftMolfile(draftMolfile);
        setKetcherImportRequest(null);
        pushStatus(`Opened ${fragment.title.trim() || "structure"} in Ketcher`);
        return;
      }
    }
    const request: KetcherImportRequest = {
      id: nextKetcherImportRequestId(),
      paths: readablePaths,
      fragments: cleanFragments,
    };
    queueKetcherImportRequest(request);
    setKetcherImportRequest(request);
    openKetcherTab({ kind: "ketcher", importRequestId: request.id, importRequest: request });
    setStructureDragActive(false);
    const count = readablePaths.length + cleanFragments.length;
    pushStatus(`Adding ${count} structure${count === 1 ? "" : "s"} to Ketcher`);
  }, [nextKetcherImportRequestId, openKetcherTab, pushStatus]);

  const openKetcherExportRaw = useCallback((request: {
    title: string;
    extension: string;
    text: string;
  }) => {
    const title = safeExportFileName(request.title);
    const extension = request.extension.trim().toLowerCase().replace(/^\./u, "") || pathExtension(title) || "txt";
    const text = request.text;
    const id = stableTextDocumentId(`ketcher-export:${title}:${text}`);
    const document: TextFileDocument = {
      id,
      path: `burrete-ketcher-export://${id}/${title}`,
      title,
      extension,
      language: extension,
      byteCount: new TextEncoder().encode(text).byteLength,
      content: text,
      truncated: false,
      modifiedAt: Date.now(),
    };
    addTextDocuments([document]);
    pushStatus(`Opened ${title}`);
  }, [addTextDocuments, pushStatus]);

  const saveKetcherExportFile = useCallback(async (request: {
    title: string;
    extension: string;
    text: string;
  }) => {
    const title = safeExportFileName(request.title);
    if (!isTauriRuntime()) {
      downloadTextFile(title, request.text);
      pushStatus(`Saved ${title}`);
      return;
    }
    try {
      const outputPath = await save({
        defaultPath: title,
        filters: exportDialogFilters(title, "text/plain"),
      });
      if (!outputPath) return;
      const savedPath = await invoke<string>("save_text_as", { text: request.text, outputPath });
      pushStatus(`Saved ${basename(savedPath)}`);
    } catch (error) {
      pushErrorStatus(error, "Save Ketcher export failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const openKetcherWithFragment = useCallback((title: string, text: string, source?: NonNullable<NonNullable<KetcherImportRequest["fragments"]>[number]["source"]>, extensionOverride?: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    const cleanTitle = title.trim() || "structure";
    const source3d = ketcherSource3DFromText(cleanTitle, cleanText, source?.extension ?? extensionOverride ?? pathExtension(cleanTitle));
    const draftMolfile = source ? "" : ketcherDraftMolfileFromImportText(cleanText);
    if (!source && draftMolfile && !source3d) {
      openKetcherTab({ kind: "ketcher", draftMolfile });
      setStructureDragActive(false);
      setKetcherDraftMolfile(draftMolfile);
      setKetcherImportRequest(null);
      pushStatus(`Opened ${cleanTitle} in Ketcher`);
      return;
    }
    const request: KetcherImportRequest = {
      id: nextKetcherImportRequestId(),
      paths: [],
      fragments: [{
        title: cleanTitle,
        text,
        source3d,
        source: source
          ? {
              ...source,
              title: source.title.trim() || cleanTitle,
              extension: source.extension.trim().replace(/^\./u, "") || "sdf",
            }
          : undefined,
      }],
    };
    queueKetcherImportRequest(request);
    setKetcherImportRequest(request);
    openKetcherTab({ kind: "ketcher", importRequestId: request.id, importRequest: request });
    setStructureDragActive(false);
    pushStatus(`Adding ${cleanTitle} to Ketcher`);
  }, [nextKetcherImportRequestId, openKetcherTab, pushStatus]);

  const applyKetcherToGridRow = useCallback((request: {
    documentId: string;
    rowIndex: number;
    title: string;
    extension: string;
    text: string;
  }) => {
    const ketcherTabId = tabs.find((tab) => tab.location.kind === "ketcher")?.id ?? null;
    const iframe = document.querySelector<HTMLIFrameElement>(`.viewer-iframe[data-document-id="${CSS.escape(request.documentId)}"]`);
    if (!iframe?.contentWindow) {
      pushStatus("Grid edit target is not open.", "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burrete-grid-host",
      body: {
        type: "gridApplyKetcherRow",
        documentId: request.documentId,
        rowIndex: request.rowIndex,
        title: request.title,
        extension: request.extension,
        text: request.text,
      },
    }, "*");
    if (ketcherTabId) {
      window.setTimeout(() => {
        setActiveDocument(request.documentId);
        closeTab(ketcherTabId);
      }, 0);
    }
    pushStatus("Applied Ketcher edit to grid");
  }, [closeTab, pushStatus, setActiveDocument, tabs]);

  const clearKetcherImportRequest = useCallback((id: number) => {
    setKetcherImportRequest((request) => (request?.id === id ? null : request));
  }, []);

  const openDescriptorSource = useCallback((source: DescriptorSourcePayload) => {
    setDescriptorSource(source);
    openDockTab("right", "descriptors");
    pushStatus(`Opened descriptors for ${source.sourceLabel}`);
  }, [openDockTab, pushStatus]);

  const clearDescriptorSource = useCallback(() => {
    setDescriptorSource(null);
  }, []);

  const applyGridDescriptorControls = useCallback((documentId: string, controls: GridDescriptorControls) => {
    const iframe = document.querySelector<HTMLIFrameElement>(`.viewer-iframe[data-document-id="${CSS.escape(documentId)}"]`);
    if (!iframe?.contentWindow) {
      pushStatus("Grid descriptor target is not open.", "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burrete-grid-host",
      body: {
        type: "gridDescriptorControls",
        documentId,
        filters: controls.filters,
        descriptorSort: controls.descriptorSort,
      },
    }, "*");
    pushStatus("Applied descriptor controls to grid");
  }, [pushStatus]);

  const applyGridDescriptorResults = useCallback((documentId: string, rows: GridDescriptorResultRow[]) => {
    const iframe = document.querySelector<HTMLIFrameElement>(`.viewer-iframe[data-document-id="${CSS.escape(documentId)}"]`);
    if (!iframe?.contentWindow) {
      pushStatus("Grid descriptor target is not open.", "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burrete-grid-host",
      body: {
        type: "gridDescriptorResults",
        documentId,
        rows,
      },
    }, "*");
    pushStatus(`Applied descriptors to ${rows.length.toLocaleString()} grid row${rows.length === 1 ? "" : "s"}`);
  }, [pushStatus]);

  const calculateGridDescriptors = useCallback((documentId: string, options: GridDescriptorRunOptions = {}) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid descriptor target is not open.", "error");
      return;
    }
    const rowIndexes = Array.isArray(options.rowIndexes)
      ? Array.from(new Set(options.rowIndexes
        .map((index) => Math.trunc(Number(index)))
        .filter((index) => Number.isFinite(index) && index >= 0)))
        .sort((left, right) => left - right)
      : [];
    const targetCount = rowIndexes.length;
    openDockTab("right", "descriptors");
    publishGridDescriptorJob({
      documentId,
      status: "running",
      running: true,
      totalRows: targetCount,
      processedRows: 0,
      calculatedRows: 0,
      failedRows: 0,
      message: targetCount
        ? `Starting descriptor calculation for ${targetCount.toLocaleString()} selected molecule${targetCount === 1 ? "" : "s"}...`
        : "Starting descriptor calculation for all molecules...",
      startedAtMs: Date.now(),
      finishedAtMs: null,
      summary: null,
    });
    pushStatus(targetCount
      ? `Calculating descriptors for ${targetCount.toLocaleString()} selected molecule${targetCount === 1 ? "" : "s"}`
      : "Calculating descriptors for all molecules");
    void runGridDescriptorCalculation(documentId, targetDocument.path, targetCount ? { rowIndexes } : {})
      .then((status) => {
        publishGridDescriptorJob(status);
        if (status.rows?.length) applyGridDescriptorResults(documentId, status.rows);
        if (!status.running) {
          pushStatus(status.message || "Descriptor calculation finished", status.status === "failed" ? "error" : "success");
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        publishGridDescriptorJob({
          documentId,
          status: "failed",
          running: false,
          totalRows: targetCount,
          processedRows: 0,
          calculatedRows: 0,
          failedRows: 0,
          message,
          startedAtMs: Date.now(),
          finishedAtMs: Date.now(),
          summary: null,
        });
        pushStatus(`Descriptor calculation failed: ${message}`, "error");
      });
  }, [applyGridDescriptorResults, documents, openDockTab, pushStatus]);

  const confirmDiscardDirtyGridDocument = useCallback((documentId: string | null | undefined) => {
    if (!documentId || !dirtyGridDocuments.has(documentId)) return true;
    return window.confirm("This grid has unsaved changes. Save or Save As before closing to keep edits. Close without saving?");
  }, [dirtyGridDocuments]);

  const confirmDiscardDirtyGridDocuments = useCallback((documentIds: string[]) => {
    const dirtyCount = documentIds.filter((documentId) => dirtyGridDocuments.has(documentId)).length;
    if (dirtyCount === 0) return true;
    return window.confirm(`${dirtyCount} grid document${dirtyCount === 1 ? " has" : "s have"} unsaved changes. Save or Save As before closing to keep edits. Close without saving?`);
  }, [dirtyGridDocuments]);

  const openKetcherSketch = useCallback(async (request: KetcherSketchRequest) => {
    const rendererMode: ViewerPreferences["rendererMode"] = request.target === "grid"
      ? "grid2d"
      : request.target === "molstar" || request.target === "generate3d"
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

      if (request.target === "generate3d") {
        pushStatus("Generating 3D conformer...");
        const conformerRequest = {
          title: request.title,
          extension: request.extension,
          text: request.text,
          ...conformerGenerationPreferences(preferences),
          source3d: request.source3d ?? null,
        };
        const conformer = isTauriRuntime()
          ? await invoke<ConformerGenerationResult>("generate_3d_conformer", { request: conformerRequest })
          : await generateBrowserDev3DConformer(conformerRequest);
        const document = isTauriRuntime()
          ? await invoke<ViewerDocument>("open_text_structure", {
              request: {
                title: conformer.title,
                extension: conformer.extension,
                text: conformer.text,
              },
              preferences: effectivePreferences,
              reloadOptions,
            })
          : await openBrowserDevTextDocument(
              conformer.title,
              conformer.extension,
              conformer.text,
              effectivePreferences,
              reloadOptions,
        );
        openDocumentsInActiveTab([document]);
        rememberRecentStructures([document]);
        pushStatus(generated3DStatus(conformer, "opened it in Molstar"));
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
      throw error;
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

  const openFepNetworkPreview = useCallback((request?: { title?: string; graphmlText?: string }) => {
    openFepNetworkTab({ kind: "fep-network", ...request });
    pushStatus("Opened FEP network preview");
  }, [openFepNetworkTab, pushStatus]);

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
  useAgentSession({ activeDocument, documents, openTextDocuments, openPaths, pushErrorStatus, setDockDocument });
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
    await openDocuments([targetDocument.path], reloadOptions, undefined, { inActiveTab: true });
  }, [activeDocument, documents, openDocuments]);
  const reloadXyzrenderDocument = useCallback(async (document: ViewerDocument, reloadOptions: ViewerReloadOptions) => {
    const effectiveReloadOptions = {
      ...reloadOptions,
      xyzrenderOrientationRef: reloadOptions.xyzrenderOrientationRef ?? xyzrenderOrientationRefRef.current,
    };
    const iframe = activeViewerIframeForDocument(document.id);
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        source: "burrete-host",
        body: {
          type: "setXyzrenderControls",
          documentId: document.id,
          preset: effectiveReloadOptions.xyzrenderPreset ?? null,
          controls: effectiveReloadOptions.xyzrenderControls ?? null,
        },
      }, "*");
      return;
    }
    pendingViewerReloadDocumentIdRef.current = document.id;
    pendingViewerReloadOptionsRef.current = effectiveReloadOptions;
    await openDocuments([document.path], effectiveReloadOptions, undefined, { inActiveTab: true });
    pendingViewerReloadOptionsRef.current = null;
    pendingViewerReloadDocumentIdRef.current = null;
  }, [openDocuments]);
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
          allowSameVersion: release.replacesCurrentBuild,
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
    if (!buildInfoLoaded) {
      if (!automatic) pushStatus("Update checks are not ready yet.");
      return;
    }
    if (buildInfo.isDevBuild) {
      setUpdate((previous) => ({
        ...previous,
        isChecking: false,
        availableRelease: null,
        statusText: "Updates are disabled for dev builds.",
      }));
      if (!automatic) pushStatus("Updates are disabled for dev builds.");
      return;
    }
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
  }, [buildInfo.isDevBuild, buildInfoLoaded, promptForUpdate, pushErrorStatus, pushStatus, update.preferences.channel]);

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

  const openNewWindow = useCallback(async () => {
    if (!isTauriRuntime()) {
      pushStatus("New windows are available in the desktop app only.", "error");
      return;
    }
    try {
      await invoke<string>("open_new_workspace_window");
      pushStatus("Opened new window");
    } catch (error) {
      pushErrorStatus(error, "Open new window failed");
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
          mode?: string;
          molstarStyle?: string | null;
          documentId?: string;
          path?: string | null;
          receptorPath?: string | null;
          title?: string | null;
          extension?: string | null;
          textBase64?: string | null;
          controlLabel?: string | null;
          orientationRef?: string | null;
          preset?: string | null;
          text?: string | null;
          base64?: string | null;
          query?: string | null;
          sort?: string | null;
          offset?: number | null;
          limit?: number | null;
          activePose?: number | null;
          poseMode?: string | null;
          sourcePath?: string | null;
          controls?: ViewerReloadOptions["xyzrenderControls"];
          renderer?: string | null;
          presetOptions?: Array<{ value?: string | null; label?: string | null }> | null;
          contextDocument?: Parameters<typeof openBrowserDevMolstarContextDocument>[0];
          inputDataBase64?: string | null;
          inputExtension?: string | null;
          fragments?: Array<{ title?: string | null; textBase64?: string | null }> | null;
          molecules?: Array<{ title?: string | null; extension?: string | null; textBase64?: string | null }> | null;
          items?: Record<string, unknown>[] | null;
          name?: string | null;
          mimeType?: string | null;
          requestToken?: string | null;
          dirty?: boolean | null;
          dirtyReason?: string | null;
          gridEdit?: boolean | null;
          rowIndex?: number | null;
          rowIndexes?: number[] | null;
          descriptorFilters?: Array<{ id?: string | null; min?: number | null; max?: number | null }> | null;
          descriptorSort?: { id?: string | null; direction?: string | null } | null;
          selection?: {
            label?: string | null;
            value?: string | null;
            selector?: Record<string, string | number | Array<string | number>> | null;
            atoms?: number | null;
          } | null;
          id?: string | null;
          result?: {
            ok?: boolean;
            command?: string;
            result?: {
              counts?: {
                atoms?: number;
                residues?: number;
              };
            };
            error?: {
              message?: string;
              details?: unknown;
            };
          } | null;
        };
      } | undefined;
      if (data?.source !== "burrete-viewer" && data?.source !== "burrete-grid" && data?.source !== "burrete-agent-viewer") return;
      const body = data.body;
      if (!isKnownViewerMessageSource(event.source, body?.documentId)) return;
      if (body?.type === "molstarStructureReplaced") {
        const requestId = typeof body.requestId === "string" ? body.requestId : "";
        const resolve = pendingMolstarReplaceRef.current.get(requestId);
        if (resolve) {
          pendingMolstarReplaceRef.current.delete(requestId);
          resolve(true);
        }
        return;
      }
      if (data.source === "burrete-agent-viewer" && body?.type === "agent-action-result") {
        if (typeof body.id === "string" && body.id.startsWith("text-selection-")) return;
        const result = body.result;
        if (result?.ok) {
          return;
        } else {
          const actionDetails = result?.error?.details ? JSON.stringify(result.error.details).slice(0, 1600) : null;
          pushStatus("Structure action did not match the structure", "error", [
            result?.error?.message ?? "No matching atoms were reported by the viewer",
            actionDetails,
          ].filter((detail): detail is string => Boolean(detail)));
        }
        return;
      }
      if ((data.source === "burrete-viewer" || data.source === "burrete-grid") && body?.type === "openCommandPalette") {
        openCommandPalette();
        return;
      }
      if ((data.source === "burrete-viewer" || data.source === "burrete-grid") && body?.type === "toggleSidebar") {
        toggleSidebar();
        return;
      }
      if (data.source === "burrete-viewer" && body?.type === "selectionChanged") {
        const documentId = typeof body.documentId === "string" ? body.documentId : "";
        if (!documentId) return;
        const selection = body.selection;
        setViewerLigandSelections((previous) => ({
          ...previous,
          [documentId]: selection?.selector ? {
            documentId,
            label: String(selection.label || "Selected ligand"),
            value: String(selection.value || ""),
            selector: selection.selector,
            atoms: Math.max(0, Math.trunc(Number(selection.atoms) || 0)),
          } : null,
        }));
        return;
      }
      if (data.source === "burrete-viewer" && body?.type === "rendererChanged") {
        const targetDocument = (body.documentId
          ? documents.find((document) => document.id === body.documentId)
          : null) ?? activeDocument;
        const renderer = body.renderer === "xyzrender-external" ? "xyzrender-external" : body.renderer === "molstar" ? "molstar" : null;
        if (targetDocument && renderer) {
          addDocuments([{
            ...targetDocument,
            renderer,
            xyzrenderControls: body.controls ?? targetDocument.xyzrenderControls ?? null,
            xyzrenderPreset: body.preset ?? targetDocument.xyzrenderPreset ?? null,
            xyzrenderPresetOptions: body.presetOptions
              ?.filter((option): option is { value: string; label: string } => Boolean(option?.value && option?.label))
              ?? targetDocument.xyzrenderPresetOptions
            ?? null,
          }]);
        }
        return;
      }
      if (data.source === "burrete-viewer" && (body?.type === "requestData" || body?.type === "requestRuntimeFile")) {
        if (!body.requestToken) return;
        const document = body.documentId
          ? documents.find((item) => item.id === body.documentId)
          : activeDocument;
        const reply = (payload: Record<string, unknown>) => {
          postMessageToViewerSource(event.source, {
            source: "burrete-native-host",
            body: {
              type: body.type === "requestData" ? "nativeData" : "nativeRuntimeFile",
              documentId: body.documentId,
              payload,
            },
          });
        };
        void (async () => {
          try {
            if (!document) throw new Error("No matching viewer document.");
            const fileName = body.type === "requestData"
              ? "preview-data.bin"
              : normalizeViewerRuntimeRelativePath(body.path || "");
            if (!fileName) throw new Error("Invalid runtime file path.");
            const base64 = await invoke<string>("read_viewer_runtime_file_base64", {
              runtimePath: document.runtimePath,
              relativePath: fileName,
            });
            reply({ requestToken: body.requestToken, base64 });
          } catch (error) {
            reply({ requestToken: body.requestToken, error: error instanceof Error ? error.message : String(error) });
          }
        })();
        return;
      }
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
        const poseMode = body.poseMode === "all" ? "all" : "single";
        if (dockingDocument?.dockingRequest && dockingDocument.dockingRequest.poseMode !== poseMode) {
          addBackgroundDocuments([{
            ...dockingDocument,
            dockingRequest: {
              ...dockingDocument.dockingRequest,
              poseMode,
            },
          }]);
        }
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
      if (data.source === "burrete-viewer" && body?.type === "exportData") {
        const base64 = typeof body.base64 === "string" ? body.base64 : "";
        const name = safeExportFileName(body.name ?? "molstar-export.bin");
        const mimeType = typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream";
        void (async () => {
          try {
            if (!isTauriRuntime()) {
              downloadBase64File(name, base64, mimeType);
              pushStatus(`Exported ${name}`);
              return;
            }
            const outputPath = await save({
              defaultPath: name,
              filters: exportDialogFilters(name, mimeType),
            });
            if (!outputPath) return;
            const savedPath = await invoke<string>("write_base64_file", {
              request: { outputPath, contentsBase64: base64 },
            });
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
        if (body?.type === "openInKetcher") {
          const title = typeof body.title === "string" && body.title.trim()
            ? body.title.trim()
            : "structure";
          const textBase64 = typeof body.textBase64 === "string" ? body.textBase64.trim() : "";
          if (textBase64) {
            try {
              const bytes = Uint8Array.from(atob(textBase64), (char) => char.charCodeAt(0));
              const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
              const rowIndex = Number(body.rowIndex);
              const extension = typeof body.extension === "string" && body.extension.trim()
                ? body.extension.trim().replace(/^\./u, "")
                : "sdf";
              openKetcherWithFragment(title, text, body.gridEdit === true && body.documentId && Number.isFinite(rowIndex)
                ? {
                    kind: "grid-row",
                    documentId: body.documentId,
                    rowIndex,
                    title,
                    extension,
                  }
                : undefined, extension);
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
            openKetcherWithStructures([targetPath]);
          }
          return;
        }
        if (body?.type === "calculateGridDescriptors") {
          const documentId = typeof body.documentId === "string" && body.documentId.trim()
            ? body.documentId.trim()
            : activeDocument?.id;
          if (!documentId) {
            pushStatus("Grid descriptor target is not open.", "error");
            return;
          }
          const rowIndexes = Array.isArray(body.rowIndexes)
            ? body.rowIndexes.map((index: unknown) => Number(index)).filter(Number.isFinite)
            : [];
          calculateGridDescriptors(documentId, rowIndexes.length ? { rowIndexes } : {});
          return;
        }
        if (body?.type === "gridPerfMetric") {
          console.info("[Burrete grid perf]", JSON.stringify(body));
          writeGridPerfMetric(body);
          return;
        }
        if (body?.type === "copyText") {
          const text = typeof body.text === "string" ? body.text : "";
          void writeClipboardText(text)
            .then(() => pushStatus("Copied grid text"))
            .catch((error) => pushErrorStatus(error, "Grid copy failed"));
          return;
        }
        if (body?.type === "gridDirtyChanged") {
          const documentId = typeof body.documentId === "string" ? body.documentId : "";
          if (documentId) {
            setDirtyGridDocuments((previous) => {
              const next = new Set(previous);
              if (body.dirty === true) next.add(documentId);
              else next.delete(documentId);
              return next;
            });
          }
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
        if (body?.type === "exportGridMolecule") {
          const text = typeof body.text === "string" ? body.text : "";
          const name = safeExportFileName(body.name ?? "molecule.sdf");
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
                pushStatus(`Exported ${name}`);
                reply({ type: "gridMoleculeExported", name });
                return;
              }
              const outputPath = await save({
                defaultPath: name,
                filters: exportDialogFilters(name, body.mimeType ?? ""),
              });
              if (!outputPath) return;
              const savedPath = await invoke<string>("save_text_as", { text, outputPath });
              const savedName = basename(savedPath);
              pushStatus(`Exported ${savedName}`);
              reply({ type: "gridMoleculeExported", name: savedName });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              reply({ type: "gridMoleculeExportError", error: message });
              pushErrorStatus(error, "Molecule export failed");
            }
          })();
          return;
        }
        if (body?.type === "saveGrid") {
          const text = typeof body.text === "string" ? body.text : "";
          const targetDocument = body.documentId
            ? documents.find((document) => document.id === body.documentId)
            : null;
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
              if (!targetDocument?.path || targetDocument.virtual) {
                throw new Error("This grid document cannot be overwritten. Use Save As instead.");
              }
              if (!isTauriRuntime()) {
                const name = safeExportFileName(body.name ?? basename(targetDocument.path));
                downloadTextFile(name, text);
                pushStatus(`Saved ${name}`);
                reply({ type: "gridSaved", name });
                return;
              }
              const savedPath = await invoke<string>("save_text_as", {
                text,
                outputPath: targetDocument.path,
              });
              const savedName = basename(savedPath);
              setDirtyGridDocuments((previous) => {
                const next = new Set(previous);
                if (body.documentId) next.delete(body.documentId);
                return next;
              });
              pushStatus(`Saved ${savedName}`);
              reply({ type: "gridSaved", name: savedName });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              reply({ type: "gridSaveError", error: message });
              pushErrorStatus(error, "Grid Save failed");
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
                setDirtyGridDocuments((previous) => {
                  const next = new Set(previous);
                  if (body.documentId) next.delete(body.documentId);
                  return next;
                });
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
              setDirtyGridDocuments((previous) => {
                const next = new Set(previous);
                if (body.documentId) next.delete(body.documentId);
                return next;
              });
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
                  descriptorFilters: Array.isArray(body.descriptorFilters) ? body.descriptorFilters : [],
                  descriptorSort: body.descriptorSort && typeof body.descriptorSort === "object" ? body.descriptorSort : null,
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
          xyzrenderPreset: body.preset ?? pendingViewerReloadOptionsRef.current?.xyzrenderPreset ?? null,
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
        const controlLabel = typeof body.controlLabel === "string" && body.controlLabel.trim()
          ? body.controlLabel.trim()
          : "Molecule";
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
            pushErrorStatus("Selected molecules do not have structure data for Molstar.", "Molstar view failed");
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
                reloadOptions: { sdfPoseControlLabel: controlLabel },
              })
            : await openBrowserDevTextDocument(
                title,
                "sdf",
                text,
                molstarPreferences,
                { sdfPoseControlLabel: controlLabel },
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
          void openDocuments([targetPath], undefined, { rendererMode: "grid2d" }, { inActiveTab: true });
        }
        return;
      }
      if (body?.type === "generate3dGridSelection") {
        const molecules = Array.isArray(body.molecules) ? body.molecules : [];
        const title = typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : "selected-3d-molecules.sdf";
        const reply = (type: "gridGenerate3DStarted" | "gridGenerate3DFinished" | "gridGenerate3DError", payload: Record<string, unknown> = {}) => {
          postMessageToViewerSource(event.source, {
            source: "burrete-grid-host",
            body: { type, ...payload },
          });
        };
        if (!molecules.length) {
          reply("gridGenerate3DError", { error: "Select one or more molecules before generating 3D." });
          pushStatus("Select one or more molecules before generating 3D.", "error");
          return;
        }
        reply("gridGenerate3DStarted");
        void (async () => {
          const generatedTexts: string[] = [];
          const errors: string[] = [];
          for (const molecule of molecules) {
            const item = molecule && typeof molecule === "object" ? molecule as Record<string, unknown> : {};
            const itemTitle = typeof item.title === "string" && item.title.trim() ? item.title.trim() : "molecule.smi";
            const extension = typeof item.extension === "string" && item.extension.trim() ? item.extension.trim() : pathExtension(itemTitle);
            const textBase64 = typeof item.textBase64 === "string" ? item.textBase64.trim() : "";
            if (!textBase64) {
              errors.push(`${itemTitle}: empty structure text`);
              continue;
            }
            try {
              const bytes = Uint8Array.from(atob(textBase64), (char) => char.charCodeAt(0));
              const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
              const request = {
                title: itemTitle,
                extension,
                text,
                ...conformerGenerationPreferences(preferences),
                mode: "single" as const,
                source3d: null,
              };
              const conformer = isTauriRuntime()
                ? await invoke<ConformerGenerationResult>("generate_3d_conformer", { request })
                : await generateBrowserDev3DConformer(request);
              generatedTexts.push(generated3DPoseSetText(text, extension, conformer.text, "single").trimEnd());
            } catch (error) {
              errors.push(`${itemTitle}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          if (!generatedTexts.length) {
            throw new Error(errors.length ? errors.join("; ") : "3D generation did not return any structures.");
          }
          const text = `${generatedTexts.join("\n")}\n`;
          const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
          const generatedDocument = isTauriRuntime()
            ? await invoke<ViewerDocument>("open_text_structure", {
                request: { title, extension: "sdf", text },
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
          openDocumentsInActiveTab([generatedDocument]);
          rememberRecentStructures([generatedDocument]);
          const suffix = errors.length ? ` ${errors.length} failed.` : "";
          pushStatus(`Generated 3D for ${generatedTexts.length} molecule${generatedTexts.length === 1 ? "" : "s"} and opened it in Molstar.${suffix}`);
        })()
          .catch((error) => {
            reply("gridGenerate3DError", { error: error instanceof Error ? error.message : String(error) });
            pushErrorStatus(error, "Grid 3D generation failed");
          })
          .finally(() => reply("gridGenerate3DFinished"));
        return;
      }
      if (body?.type === "generate3dConformer") {
        const requestDocumentId = typeof body.documentId === "string" && body.documentId.trim().length > 0
          ? body.documentId.trim()
          : null;
        const requestPath = typeof body.path === "string" && body.path.trim().length > 0
          ? body.path.trim()
          : null;
        const mode: ConformerGenerationMode = body.mode === "ensemble" ? "ensemble" : "single";
        const molstarStyle = normalizeMolstarStylePreference(body.molstarStyle);
        const targetDocument = requestDocumentId
          ? documents.find((document) => document.id === requestDocumentId)
            ?? (requestPath ? documents.find((document) => document.path === requestPath) : undefined)
          : (requestPath ? documents.find((document) => document.path === requestPath) : undefined) ?? activeDocument;
        const notifyGeneratorState = (type: "generate3dConformerStarted" | "generate3dConformerFinished") => {
          postMessageToViewerSource(event.source, {
            source: "burrete-host",
            body: {
              type,
              documentId: targetDocument?.id ?? requestDocumentId ?? "",
              mode,
            },
          });
        };
        if (targetDocument) {
          notifyGeneratorState("generate3dConformerStarted");
          void generate3DConformer(targetDocument, mode, molstarStyle)
            .finally(() => notifyGeneratorState("generate3dConformerFinished"));
        } else {
          notifyGeneratorState("generate3dConformerFinished");
          pushStatus("The Generate 3D request came from a tab that is no longer open.", "error");
        }
        return;
      }
      if (body?.type === "openMolstarContextDocument") {
        if (body.contextDocument && typeof body.contextDocument === "object") {
          pushStatus("Opening selected Molstar context...");
          const contextDocument = body.contextDocument;
          const requestedMolstarStyle = normalizeMolstarStylePreference(body.molstarStyle);
          const molstarPreferences = {
            ...preferences,
            rendererMode: "molstar" as const,
            molstarStyle: requestedMolstarStyle ?? preferences.molstarStyle,
          };
          const openContextDocument = async () => {
            if (!isTauriRuntime()) return openBrowserDevMolstarContextDocument(contextDocument, molstarPreferences);
            const entries = (contextDocument.entries ?? []).filter((entry): entry is MolstarContextEntry & { data: string } => (
              typeof entry?.data === "string" && entry.data.length > 0
            ));
            if (entries.length !== 1) {
              throw new Error("Native Molstar context view supports one inline structure at a time.");
            }
            const entry = entries[0];
            const extension = molstarContextEntryExtension(entry.format);
            const label = contextDocument.label?.trim() || entry.label?.trim() || "Molstar context";
            return invoke<ViewerDocument>("open_text_structure", {
              request: {
                title: `${label}.${extension}`,
                extension,
                text: entry.data,
              },
              preferences: molstarPreferences,
              reloadOptions: {},
            });
          };
          void openContextDocument()
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
            const rowIndex = Number(body.rowIndex);
            const extension = typeof body.extension === "string" && body.extension.trim()
              ? body.extension.trim().replace(/^\./u, "")
              : "sdf";
            openKetcherWithFragment(title, text, body.gridEdit === true && body.documentId && Number.isFinite(rowIndex)
              ? {
                  kind: "grid-row",
                  documentId: body.documentId,
                  rowIndex,
                  title,
                  extension,
                }
              : undefined, extension);
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
            return [{
              title,
              text,
              source3d: ketcherSource3DFromText(title, text, pathExtension(title)),
            }];
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
            : renderer === "molstar"
              ? {}
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
  }, [activeDocument, addBackgroundDocuments, addDocuments, calculateGridDescriptors, documents, generate3DConformer, notifyGridPoseReviewSelection, openCommandPalette, openDockingDocument, openDocuments, openDocumentsInActiveTab, openKetcherWithFragment, openKetcherWithStructures, openPoseReviewWorkspace, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, reloadActive, setPreference, toggleSidebar, writeGridPerfMetric]);

  useEffect(() => {
    if (!buildInfoLoaded || buildInfo.isDevBuild) return undefined;
    const loadedPreferences = loadUpdatePreferences();
    if (!shouldCheckAutomatically(loadedPreferences)) return undefined;
    const timeout = window.setTimeout(() => {
      void checkForUpdates(true, loadedPreferences.channel);
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [buildInfo.isDevBuild, buildInfoLoaded, checkForUpdates]);

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
      const resizeTarget = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = rightDockWidth;
      let closedByDrag = false;
      let didStop = false;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (move: PointerEvent) => {
        if (move.buttons === 0) {
          stop();
          return;
        }
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
        if (didStop) return;
        didStop = true;
        setRightDockDragging(false);
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
    [rightDockWidth, setDockOpen, setDockSize],
  );

  const startBottomDockResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setBottomDockDragging(true);
      const resizeTarget = event.currentTarget;
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startHeight = bottomDockHeight;
      let closedByDrag = false;
      let didStop = false;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      const onMove = (move: PointerEvent) => {
        if (move.buttons === 0) {
          stop();
          return;
        }
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
        if (didStop) return;
        didStop = true;
        setBottomDockDragging(false);
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
    [bottomDockHeight, setDockOpen, setDockSize],
  );

  const actions = useMemo<ShellActions>(() => ({
    chooseFiles,
    openStructurePaths: async (paths: string[], options?: { mode?: OpenDocumentsMode }) => {
      await openDocuments(paths, undefined, undefined, options);
    },
    openTextPaths: async (paths: string[]) => {
      await openTextDocuments(paths);
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
    openNewWindow,
    openSettings,
    openSettingsSection,
    backToApp,
    openKetcher,
    openKetcherWithStructures,
    openKetcherExportRaw,
    saveKetcherExportFile,
    openFepNetworkPreview,
    applyKetcherToGridRow,
    openFepSetupWorkspace,
    openKetcherSketch,
    openDescriptorSource,
    clearDescriptorSource,
    applyGridDescriptorControls,
    applyGridDescriptorResults,
    calculateGridDescriptors,
    checkConformerStatus,
    runConformerOperation,
    cancelConformerJob,
    clearConformerJobs: () => {
      setConformerJobs([]);
      pushStatus("Job history cleared");
    },
    setConformerSettings,
    checkXtbStatus,
    installXtb,
    runXtbActiveOperation,
    runXtbJob,
    cancelXtbJob,
    runXtbKetcherSketch,
    runXtbGridScoring,
    runXtbPoseRefinement,
    runXtbFepPreflight,
    clearXtbJobs: () => {
      setXtbJobs([]);
      pushStatus("xTB job history cleared");
    },
    setXtbSettings,
    saveKetcherDraft: setKetcherDraftMolfile,
    clearKetcherImportRequest,
    moveTab,
    chooseWorkspace,
    openWorkspaceFolder,
    openProjectFolder,
    togglePinnedProjectRoot: (root: string) => {
      togglePinnedProjectRoot(root);
      pushStatus("Project pin updated");
    },
    renameProjectRoot: (root: string, name: string) => {
      renameProjectRoot(root, name);
      pushStatus(name.trim() ? "Project renamed" : "Project name reset");
    },
    removeProjectRoot: (root: string) => {
      removeProjectRoot(root);
      pushStatus("Project removed");
    },
    toggleSidebar,
    toggleDock,
    toggleDockTab,
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
      if (!confirmDiscardDirtyGridDocument(id)) return;
      closeGridRuntime(id);
      setDirtyGridDocuments((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      closeDocument(id);
    },
    closeTab: (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      const documentIds: string[] = [];
      if (tab?.location.kind === "file") {
        const location = tab.location;
        const document = documents.find((candidate) => (
          candidate.id === location.documentId ||
          candidate.path === location.path
        ));
        const targetDocumentId = document?.id ?? location.documentId ?? null;
        if (targetDocumentId) documentIds.push(targetDocumentId);
        if (!confirmDiscardDirtyGridDocuments(documentIds)) return;
        closeGridRuntime(targetDocumentId);
      }
      if (documentIds.length > 0) {
        setDirtyGridDocuments((previous) => {
          const next = new Set(previous);
          for (const documentId of documentIds) next.delete(documentId);
          return next;
        });
      }
      closeTab(id);
    },
    closeActiveDocument: () => {
      if (!confirmDiscardDirtyGridDocument(activeDocument?.id)) return;
      closeGridRuntime(activeDocument?.id);
      setDirtyGridDocuments((previous) => {
        const next = new Set(previous);
        if (activeDocument?.id) next.delete(activeDocument.id);
        return next;
      });
      closeActiveDocument();
      pushStatus("Closed active tab");
    },
    clearAllDocuments: () => {
      if (!confirmDiscardDirtyGridDocuments(documents.map((document) => document.id))) return;
      for (const document of documents) closeGridRuntime(document.id);
      setDirtyGridDocuments(new Set());
      closeAllDocuments();
      pushStatus("Closed all tabs");
    },
    openDockingDocument,
    openDockingStructureRecords,
    appendGridRecords,
    addXyzrenderSheetItems: addXyzrenderSheetItemsToDocument,
    mergeMoleculeCollections,
    saveMoleculeCollectionAs,
    listChemicalEditorTargets,
    openPathInChemicalEditor,
    openPathWithDefaultApp,
    revealActiveDocument,
    revealDocument,
    revealPath,
    copyActiveDocumentPath,
    copyDocumentPath,
    copyPath,
    showActiveDocumentMetadata,
    showDocumentMetadata,
    showTextFileMetadata,
    generate3DConformer,
    runStructureViewerAction,
    reloadXyzrenderDocument,
    selectTextStructure,
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
  }), [activeDocument, addDockDrop, addXyzrenderSheetItemsToDocument, appendGridRecords, applyGridDescriptorControls, applyGridDescriptorResults, applyKetcherToGridRow, backToApp, calculateGridDescriptors, canNavigateBack, canNavigateForward, checkForUpdates, chooseFiles, chooseWorkspace, clearCache, clearDescriptorSource, clearKetcherImportRequest, clearRecentStructures, closeActiveDocument, closeAllDocuments, closeDocument, closeDockTab, closeGridRuntime, closeTab, confirmDiscardDirtyGridDocument, confirmDiscardDirtyGridDocuments, copyActiveDocumentPath, copyDocumentPath, copyPath, documents, exportActivePreviewAsPng, exportActivePreviewAsSvg, focusSidebarSearch, generate3DConformer, installUpdate, listChemicalEditorTargets, mergeMoleculeCollections, moveTab, navigateBack, navigateForward, openClipboard, openCommandPalette, openDescriptorSource, openDockingDocument, openDockingStructureRecords, openDockPayload, openDockTab, openDocuments, openFepNetworkPreview, openFepSetupWorkspace, openKetcher, openKetcherExportRaw, openKetcherSketch, openKetcherWithStructures, openLogs, openMostRecentStructure, openNewTab, openNewWindow, openPathInChemicalEditor, openPathWithDefaultApp, openPaths, openProjectFolder, openRecentStructure, openSettings, openSettingsSection, openStructureRecords, openTextDocuments, openWorkspaceFolder, pushErrorStatus, pushStatus, reloadXyzrenderDocument, removeProjectRoot, renameProjectRoot, resetQuickLook, revealActiveDocument, revealDocument, revealPath, runStructureViewerAction, saveKetcherExportFile, saveMoleculeCollectionAs, selectDocument, selectTextStructure, setActiveTab, setDockActiveTab, setDockDocument, setDockOpen, setDockSize, setDockTool, setExpandedProjectIds, setPreference, setSidebarQuery, setUpdatePreferences, showActiveDocumentMetadata, showDocumentMetadata, showTextFileMetadata, tabs, toggleDock, toggleDockTab, togglePinnedProjectRoot, togglePinnedStructure, toggleProjectExpanded, toggleProjectsOpen, toggleSidebar, update.availableRelease]);

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
    descriptorSource,
    sidebarQuery,
    status,
    dropActive,
    preferences,
    conformerStatus,
    conformerSettings,
    conformerJobs,
    viewerLigandSelection: activeDocument ? viewerLigandSelections[activeDocument.id] ?? null : null,
    xtbStatus,
    xtbSettings,
    xtbJobs,
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

function activeViewerIframeForDocument(documentId: string) {
  const escapedId = CSS.escape(documentId);
  return document.querySelector<HTMLIFrameElement>(
    `.page-surface[data-active="true"] .viewer-iframe[data-document-id="${escapedId}"]`,
  ) ?? document.querySelector<HTMLIFrameElement>(
    `.viewer-iframe[data-document-id="${escapedId}"]`,
  );
}

function replaceMolstarStructureInPlace(
  sourceDocument: ViewerDocument,
  generatedDocument: ViewerDocument,
  conformer: ConformerGenerationResult,
  pendingReplacements: Map<string, PendingMolstarReplaceResolver>,
  molstarStyle: MolstarStylePreference,
) {
  if (sourceDocument.renderer !== "molstar") return Promise.resolve(false);
  const iframe = activeViewerIframeForDocument(sourceDocument.id);
  if (!iframe?.contentWindow) return Promise.resolve(false);
  const requestId = `molstar-replace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => {
      pendingReplacements.delete(requestId);
      resolve(false);
    }, 8000);
    pendingReplacements.set(requestId, (ok) => {
      window.clearTimeout(timeout);
      resolve(ok);
    });
    try {
      iframe.contentWindow?.postMessage({
        source: "burrete-host",
        body: {
          type: "replaceMolstarStructure",
          requestId,
          documentId: sourceDocument.id,
          title: conformer.title,
          extension: conformer.extension,
          path: generatedDocument.path,
          byteCount: new TextEncoder().encode(conformer.text).byteLength,
          textBase64: textToBase64(conformer.text),
          method: conformer.method,
          molstarStyle,
        },
      }, "*");
    } catch {
      window.clearTimeout(timeout);
      pendingReplacements.delete(requestId);
      resolve(false);
    }
  });
}

function generated3DPoseSetTitle(title: string, text: string) {
  const poseCount = sdfRecordBlocks(text).length;
  if (poseCount <= 1) return title;
  return title;
}

function generated3DPoseSetText(sourceText: string, sourceExtension: string, generatedText: string, mode: ConformerGenerationMode = "single") {
  const generatedRecords = sdfRecordBlocks(generatedText);
  const sourceRecords = sourcePoseRecordBlocks(sourceText, sourceExtension);
  const alignedGeneratedRecords = alignGeneratedPoseRecordsToSource(generatedRecords, sourceRecords[0]);
  const records = mode === "ensemble" ? alignedGeneratedRecords : [...alignedGeneratedRecords, ...sourceRecords];
  return records.length > 0 ? `${records.join("\n")}\n` : generatedText;
}

function normalizeMolstarStylePreference(value: unknown): MolstarStylePreference | null {
  return value === "illustrative" || value === "default" ? value : null;
}

function sourcePoseRecordBlocks(text: string, extension: string) {
  const normalizedExtension = extension.trim().toLowerCase().replace(/^\./u, "");
  if (normalizedExtension === "sdf" || normalizedExtension === "sd") return sdfRecordBlocks(text);
  if (normalizedExtension === "mol") {
    const value = text.trimEnd();
    return value ? [`${value}\n$$$$`] : [];
  }
  return [];
}

function sdfRecordBlocks(text: string) {
  return text
    .split("$$$$")
    .map((record) => record.trimEnd())
    .filter((record) => record.trim().length > 0)
    .map((record) => `${record}\n$$$$`);
}

type MolBlockAtomCoordinates = {
  atomCount: number;
  atomStart: number;
  centroid: [number, number, number];
  coordinates: Array<[number, number, number]>;
  lines: string[];
};

function alignGeneratedPoseRecordsToSource(records: string[], sourceRecord: string | undefined) {
  const source = sourceRecord ? readMolBlockAtomCoordinates(sourceRecord) : null;
  if (!source) return records;
  return records.map((record) => alignMolBlockCentroid(record, source));
}

function alignMolBlockCentroid(record: string, source: MolBlockAtomCoordinates) {
  const target = readMolBlockAtomCoordinates(record);
  if (!target || target.atomCount !== source.atomCount) return record;
  const delta: [number, number, number] = [
    source.centroid[0] - target.centroid[0],
    source.centroid[1] - target.centroid[1],
    source.centroid[2] - target.centroid[2],
  ];
  const lines = [...target.lines];
  for (let offset = 0; offset < target.atomCount; offset += 1) {
    const lineIndex = target.atomStart + offset;
    const line = lines[lineIndex] ?? "";
    const [x, y, z] = target.coordinates[offset] ?? [0, 0, 0];
    lines[lineIndex] = `${formatMolCoordinate(x + delta[0])}${formatMolCoordinate(y + delta[1])}${formatMolCoordinate(z + delta[2])}${line.slice(30)}`;
  }
  return lines.join("\n");
}

function readMolBlockAtomCoordinates(record: string): MolBlockAtomCoordinates | null {
  const lines = record.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const countsIndex = lines.findIndex((line) => /^\s*\d+\s+\d+\s/u.test(line));
  if (countsIndex < 0) return null;
  const atomCount = Number(lines[countsIndex]?.slice(0, 3));
  if (!Number.isFinite(atomCount) || atomCount <= 0) return null;
  const atomStart = countsIndex + 1;
  const coordinates: Array<[number, number, number]> = [];
  for (let index = atomStart; index < atomStart + atomCount; index += 1) {
    const line = lines[index] ?? "";
    const x = Number(line.slice(0, 10));
    const y = Number(line.slice(10, 20));
    const z = Number(line.slice(20, 30));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    coordinates.push([x, y, z]);
  }
  if (coordinates.length !== atomCount) return null;
  const centroid = coordinates.reduce<[number, number, number]>(
    (sum, [x, y, z]) => [sum[0] + x, sum[1] + y, sum[2] + z],
    [0, 0, 0],
  ).map((value) => value / atomCount) as [number, number, number];
  return { atomCount, atomStart, centroid, coordinates, lines };
}

function formatMolCoordinate(value: number) {
  const text = value.toFixed(4);
  return text.length <= 10 ? text.padStart(10) : text.slice(0, 10);
}

function textToBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function generated3DStatus(conformer: ConformerGenerationResult, action: string) {
  const depth = conformerZDepth(conformer.text);
  const count = Number(conformer.conformerCount || 0);
  const subject = count > 1 ? `${count} 3D conformers` : "3D conformer";
  const depthLabel = depth === null
    ? ""
      : depth <= 0.05
        ? ` (z-depth ${depth.toFixed(2)} A, planar)`
        : ` (z-depth ${depth.toFixed(2)} A)`;
  return `Generated ${subject} with ${conformer.method}${depthLabel} and ${action}`;
}

function conformerGenerationPreferences(preferences: ViewerPreferences) {
  return {
    engine: preferences.conformerEngine,
    candidateCount: preferences.conformerCandidateCount,
    rmsdCutoff: preferences.conformerRmsdCutoff,
  };
}

function conformerGenerationTaskLabel(mode: ConformerGenerationMode) {
  return mode === "ensemble" ? "3D conformer set" : "3D conformer";
}

function conformerZDepth(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const countsIndex = lines.findIndex((line) => /^\s*\d+\s+\d+\s/u.test(line));
  if (countsIndex < 0) return null;
  const atomCount = Number(lines[countsIndex]?.slice(0, 3));
  if (!Number.isFinite(atomCount) || atomCount <= 0) return null;
  const zValues: number[] = [];
  for (let index = countsIndex + 1; index < countsIndex + 1 + atomCount; index += 1) {
    const z = Number(lines[index]?.slice(20, 30));
    if (Number.isFinite(z)) zValues.push(z);
  }
  if (zValues.length === 0) return null;
  return Math.max(...zValues) - Math.min(...zValues);
}

function normalizeViewerRuntimeRelativePath(path: string) {
  const normalized = String(path || "").replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
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

function isFepGraphmlPath(path: string) {
  return /\.graphml$/iu.test(path);
}

function conformerOutputDirectory(document: ViewerDocument) {
  const sourcePath = document.sourcePath?.trim() || (!document.virtual ? document.path : "");
  if (!sourcePath || /^[a-z][a-z0-9+.-]*:/iu.test(sourcePath)) return null;
  return parentDirectory(sourcePath);
}

function countXyzFrames(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let index = 0;
  let frames = 0;
  while (index < lines.length && frames < 100000) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    const atomCount = Number.parseInt(lines[index]?.trim().split(/\s+/u)[0] ?? "", 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) break;
    if (index + atomCount + 1 >= lines.length) break;
    const atomLines = lines.slice(index + 2, index + 2 + atomCount);
    if (atomLines.length !== atomCount || atomLines.some((line) => !line.trim())) break;
    frames += 1;
    index += atomCount + 2;
  }
  return frames;
}

function isXtbOptimizationTrajectoryLogPath(path: string) {
  return (path.split(/[\\/]/).filter(Boolean).pop() ?? "").toLowerCase() === "xtbopt.log";
}

const DEFAULT_CONFORMER_SETTINGS: ConformerSettings = {
  method: "gfn2",
  solvent: "none",
  charge: 0,
  uhf: 0,
  threads: 4,
  timeoutSeconds: 3600,
  energyWindowKcalMol: 6,
  rmsdThresholdAngstrom: 0.125,
  samplingMode: "auto",
  prismTimeoutSeconds: 300,
  prismEnergySort: true,
  prismRotamerPruning: false,
};

const CONFORMER_SETTINGS_STORAGE_KEY = "burrete.conformer.settings";

function readConformerSettings(): ConformerSettings {
  try {
    const text = window.localStorage.getItem(CONFORMER_SETTINGS_STORAGE_KEY);
    return normalizeConformerSettings(text ? JSON.parse(text) : null);
  } catch (_) {
    return DEFAULT_CONFORMER_SETTINGS;
  }
}

function saveConformerSettings(settings: ConformerSettings) {
  try {
    window.localStorage.setItem(CONFORMER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (_) {}
}

function normalizeConformerSettings(value: unknown): ConformerSettings {
  const source = value && typeof value === "object" ? value as Partial<ConformerSettings> : {};
  const methods = new Set<ConformerSettings["method"]>(["gfn2", "gfn1", "gfn0", "gfnff"]);
  const solvents = new Set<ConformerSettings["solvent"]>(["none", "water", "methanol", "acetonitrile", "dmso", "chloroform"]);
  const samplingModes = new Set<ConformerSettings["samplingMode"]>(["auto", "normal", "quick", "squick", "mquick"]);
  return {
    method: source.method && methods.has(source.method) ? source.method : DEFAULT_CONFORMER_SETTINGS.method,
    solvent: source.solvent && solvents.has(source.solvent) ? source.solvent : DEFAULT_CONFORMER_SETTINGS.solvent,
    charge: clampInteger(source.charge, -8, 8, DEFAULT_CONFORMER_SETTINGS.charge),
    uhf: clampInteger(source.uhf, 0, 12, DEFAULT_CONFORMER_SETTINGS.uhf),
    threads: clampInteger(source.threads, 1, 16, DEFAULT_CONFORMER_SETTINGS.threads),
    timeoutSeconds: clampInteger(source.timeoutSeconds, 30, 86_400, DEFAULT_CONFORMER_SETTINGS.timeoutSeconds),
    energyWindowKcalMol: clampNumber(source.energyWindowKcalMol, 1, 60, DEFAULT_CONFORMER_SETTINGS.energyWindowKcalMol),
    rmsdThresholdAngstrom: clampNumber(source.rmsdThresholdAngstrom, 0.01, 2, DEFAULT_CONFORMER_SETTINGS.rmsdThresholdAngstrom),
    samplingMode: source.samplingMode && samplingModes.has(source.samplingMode) ? source.samplingMode : DEFAULT_CONFORMER_SETTINGS.samplingMode,
    prismTimeoutSeconds: clampInteger(source.prismTimeoutSeconds, 5, 86_400, DEFAULT_CONFORMER_SETTINGS.prismTimeoutSeconds),
    prismEnergySort: source.prismEnergySort !== false,
    prismRotamerPruning: source.prismRotamerPruning === true,
  };
}

function conformerOperationLabel(operation: ConformerOperation) {
  return operation === "prism-prune" ? "PRISM Prune" : "CREST Generate";
}

function conformerStatusLine(status: ConformerStatus) {
  const crest = status.crest.installed ? "CREST ready" : "CREST missing";
  const prism = status.prism.installed ? "PRISM ready" : "PRISM missing";
  return `${crest}; ${prism}`;
}

const DEFAULT_XTB_SETTINGS: XtbSettings = {
  method: "gfn2",
  optLevel: "normal",
  solvationModel: "none",
  solvent: "none",
  charge: 0,
  uhf: 0,
  threads: 0,
  accuracy: 1,
  electronicTemperature: 300,
  properties: {
    dipole: true,
    wbo: true,
    population: false,
    molden: false,
    alpha: false,
    fod: false,
    esp: false,
    fukui: false,
  },
  mdTemperature: 298,
  mdTimePs: 2,
  mdStepFs: 1,
  mdSnapshots: 100,
  timeoutSeconds: 180,
  saveRunFiles: true,
};

const XTB_SETTINGS_STORAGE_KEY = "burrete.xtb.settings";
const XTB_METHODS = new Set<XtbSettings["method"]>(["gfn2", "gfn1", "gfn0", "gfnff"]);
const XTB_OPT_LEVELS = new Set<XtbSettings["optLevel"]>(["loose", "normal", "tight", "verytight"]);
const XTB_SOLVATION_MODELS = new Set<XtbSettings["solvationModel"]>(["none", "alpb", "gbsa", "cosmo", "cpcmx"]);

function readXtbSettings(): XtbSettings {
  try {
    const text = window.localStorage.getItem(XTB_SETTINGS_STORAGE_KEY);
    return migrateLegacyXtbMdDefaults(normalizeXtbSettings(text ? JSON.parse(text) : null));
  } catch (_) {
    return DEFAULT_XTB_SETTINGS;
  }
}

function saveXtbSettings(settings: XtbSettings) {
  try {
    window.localStorage.setItem(XTB_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (_) {}
}

function normalizeXtbSettings(value: unknown): XtbSettings {
  const source = value && typeof value === "object" ? value as Partial<XtbSettings> : {};
  const method = XTB_METHODS.has(source.method as XtbSettings["method"]) ? source.method as XtbSettings["method"] : DEFAULT_XTB_SETTINGS.method;
  const optLevel = XTB_OPT_LEVELS.has(source.optLevel as XtbSettings["optLevel"]) ? source.optLevel as XtbSettings["optLevel"] : DEFAULT_XTB_SETTINGS.optLevel;
  const solvationModel = XTB_SOLVATION_MODELS.has(source.solvationModel as XtbSettings["solvationModel"]) ? source.solvationModel as XtbSettings["solvationModel"] : DEFAULT_XTB_SETTINGS.solvationModel;
  const solvent = typeof source.solvent === "string" && source.solvent.trim() ? source.solvent.trim().toLowerCase() : DEFAULT_XTB_SETTINGS.solvent;
  const properties = source.properties && typeof source.properties === "object" ? source.properties : {};
  return {
    method,
    optLevel,
    solvationModel,
    solvent,
    charge: clampInteger(source.charge, -5, 5, DEFAULT_XTB_SETTINGS.charge),
    uhf: clampInteger(source.uhf, 0, 10, DEFAULT_XTB_SETTINGS.uhf),
    threads: clampInteger(source.threads, 0, 32, DEFAULT_XTB_SETTINGS.threads),
    accuracy: clampNumber(source.accuracy, 0.05, 10, DEFAULT_XTB_SETTINGS.accuracy),
    electronicTemperature: clampInteger(source.electronicTemperature, 50, 5000, DEFAULT_XTB_SETTINGS.electronicTemperature),
    properties: {
      dipole: booleanSetting((properties as Partial<XtbSettings["properties"]>).dipole, DEFAULT_XTB_SETTINGS.properties.dipole),
      wbo: booleanSetting((properties as Partial<XtbSettings["properties"]>).wbo, DEFAULT_XTB_SETTINGS.properties.wbo),
      population: booleanSetting((properties as Partial<XtbSettings["properties"]>).population, DEFAULT_XTB_SETTINGS.properties.population),
      molden: booleanSetting((properties as Partial<XtbSettings["properties"]>).molden, DEFAULT_XTB_SETTINGS.properties.molden),
      alpha: booleanSetting((properties as Partial<XtbSettings["properties"]>).alpha, DEFAULT_XTB_SETTINGS.properties.alpha),
      fod: booleanSetting((properties as Partial<XtbSettings["properties"]>).fod, DEFAULT_XTB_SETTINGS.properties.fod),
      esp: booleanSetting((properties as Partial<XtbSettings["properties"]>).esp, DEFAULT_XTB_SETTINGS.properties.esp),
      fukui: booleanSetting((properties as Partial<XtbSettings["properties"]>).fukui, DEFAULT_XTB_SETTINGS.properties.fukui),
    },
    mdTemperature: clampInteger(source.mdTemperature, 50, 2000, DEFAULT_XTB_SETTINGS.mdTemperature),
    mdTimePs: clampNumber(source.mdTimePs, 0.05, 100, DEFAULT_XTB_SETTINGS.mdTimePs),
    mdStepFs: clampNumber(source.mdStepFs, 0.1, 10, DEFAULT_XTB_SETTINGS.mdStepFs),
    mdSnapshots: clampInteger(source.mdSnapshots, 1, 1000, DEFAULT_XTB_SETTINGS.mdSnapshots),
    timeoutSeconds: clampInteger(source.timeoutSeconds, 30, 1200, DEFAULT_XTB_SETTINGS.timeoutSeconds),
    saveRunFiles: booleanSetting(source.saveRunFiles, DEFAULT_XTB_SETTINGS.saveRunFiles),
  };
}

function migrateLegacyXtbMdDefaults(settings: XtbSettings): XtbSettings {
  if (settings.mdTimePs === 0.2 && settings.mdSnapshots === 10) {
    return {
      ...settings,
      mdTimePs: DEFAULT_XTB_SETTINGS.mdTimePs,
      mdSnapshots: DEFAULT_XTB_SETTINGS.mdSnapshots,
    };
  }
  return settings;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function booleanSetting(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function xtbInputRequestForDocument(document: ViewerDocument): Pick<XtbRunRequest, "inputPath" | "inputText" | "inputExtension" | "sourcePath" | "label"> | null {
  if (document.virtual && !isTauriRuntime()) {
    const text = readBrowserDevVirtualTextDocument(document.path);
    if (text === null) return null;
    return {
      inputText: text,
      inputExtension: document.extension || structureExtensionFromPath(document.path),
      sourcePath: document.sourcePath ?? null,
      label: document.title,
    };
  }
  return {
    inputPath: document.path,
    sourcePath: document.sourcePath ?? null,
    label: document.title,
  };
}

function xtbInputRequestForMolstarContextDocument(
  contextDocument: MolstarContextDocument | null | undefined,
  sourcePath: string | null | undefined,
): Pick<XtbRunRequest, "inputText" | "inputExtension" | "sourcePath" | "label"> | null {
  const entry = (contextDocument?.entries ?? []).find((candidate): candidate is MolstarContextEntry & { data: string } => (
    typeof candidate?.data === "string" && candidate.data.trim().length > 0
  ));
  if (!entry) return null;
  return {
    inputText: entry.data,
    inputExtension: molstarContextEntryExtension(entry.format),
    sourcePath: sourcePath ?? null,
    label: contextDocument?.label?.trim() || entry.label?.trim() || "Molstar selection",
  };
}

function xtbOperationLabel(operation: XtbOperation) {
  switch (operation) {
    case "optimize":
      return "xTB Optimize";
    case "properties":
      return "xTB Properties";
    case "grid-properties":
      return "xTB Grid Properties";
    case "fep-preflight":
      return "xTB FEP Preflight";
    case "pose-refine":
      return "xTB Pose Refine";
    case "cube":
      return "xTB Density Cube";
    case "hessian":
      return "xTB Hessian";
    case "optimized-hessian":
      return "xTB Optimized Hessian";
    case "vip":
      return "xTB Ionization Potential";
    case "vea":
      return "xTB Electron Affinity";
    case "vipea":
      return "xTB IP/EA";
    case "vfukui":
      return "xTB Fukui";
    case "vomega":
      return "xTB Electrophilicity";
    case "md":
      return "xTB MD";
    case "metadyn":
      return "xTB Metadynamics";
    case "dock":
      return "xTB Dock";
  }
}

async function directChemistryJobGuardMessage(
  engine: "xTB" | "CREST" | "PRISM",
  inlineText: string | null | undefined,
  extension: string | null | undefined,
  path: string | null | undefined,
) {
  const atomCount = await directChemistryJobAtomCount(inlineText, extension, path);
  if (atomCount === null || atomCount <= DIRECT_CHEMISTRY_JOB_ATOM_LIMIT) return null;
  return `${engine} is disabled for full structures above ${DIRECT_CHEMISTRY_JOB_ATOM_LIMIT} atoms (${atomCount} atoms detected). Select an object or open a small-molecule file first.`;
}

async function directChemistryJobAtomCount(
  inlineText: string | null | undefined,
  extension: string | null | undefined,
  path: string | null | undefined,
) {
  const text = typeof inlineText === "string" && inlineText.trim()
    ? inlineText
    : path ? await readStructureText(path, { maxBytes: DIRECT_CHEMISTRY_JOB_READ_LIMIT }).catch(() => "") : "";
  if (!text.trim()) return null;
  return estimateStructureAtomCount(text, extension ?? structureExtensionFromPath(path));
}

function estimateStructureAtomCount(text: string, extension: string | null | undefined) {
  const normalizedExtension = String(extension || "").replace(/^\./u, "").toLowerCase();
  const summary = parseStructureComposition(text, normalizedExtension);
  const summaryCounts = summary ? [
    ...summary.rows,
    ...summary.componentRows,
    ...summary.polymerRows,
    ...summary.ligandRows,
    ...summary.solventRows,
  ].flatMap((row) => atomCountsFromLabelValue(row.label, row.value)) : [];
  const summaryMax = Math.max(0, ...summaryCounts);
  return summaryMax > 0 ? summaryMax : fallbackStructureAtomCount(text, normalizedExtension);
}

function atomCountsFromLabelValue(label: string, value: string) {
  const counts: number[] = [];
  const labelValue = `${label} ${value}`;
  for (const match of labelValue.matchAll(/([\d,]+)\s+atoms?\b/giu)) {
    const count = Number.parseInt(match[1].replaceAll(",", ""), 10);
    if (Number.isFinite(count) && count > 0) counts.push(count);
  }
  if (/^atoms$/iu.test(label.trim())) {
    const count = Number.parseInt(value.replaceAll(",", "").trim(), 10);
    if (Number.isFinite(count) && count > 0) counts.push(count);
  }
  return counts;
}

function fallbackStructureAtomCount(text: string, extension: string) {
  if (["pdb", "pdbqt", "ent"].includes(extension)) {
    const count = text.split(/\r?\n/u).filter((line) => line.startsWith("ATOM") || line.startsWith("HETATM")).length;
    return count > 0 ? count : null;
  }
  if (["xyz", "trj", "log"].includes(extension)) {
    const count = Number.parseInt(text.trimStart().split(/\s+/u)[0] ?? "", 10);
    return Number.isFinite(count) && count > 0 ? count : null;
  }
  return null;
}

async function requestXtbStatus(): Promise<XtbStatus> {
  if (isTauriRuntime()) return invoke<XtbStatus>("xtb_status");
  return browserDevXtbJson<XtbStatus>("/__burette/xtb-status");
}

async function requestConformerStatus(): Promise<ConformerStatus> {
  if (isTauriRuntime()) return invoke<ConformerStatus>("conformer_status");
  return browserDevConformerJson<ConformerStatus>("/__burette/conformer-status");
}

async function prepareConformerRequest(request: ConformerRunRequest): Promise<ConformerPreparedRun> {
  if (isTauriRuntime()) return invoke<ConformerPreparedRun>("prepare_conformer_job", { request });
  return browserDevConformerJson<ConformerPreparedRun>("/__burette/prepare-conformer-job", request);
}

async function runConformerRequest(request: ConformerRunRequest): Promise<ConformerRunResult> {
  if (isTauriRuntime()) return invoke<ConformerRunResult>("run_conformer_job", { request });
  return browserDevConformerJson<ConformerRunResult>("/__burette/run-conformer-job", request);
}

async function cancelConformerRequest(jobId: string): Promise<void> {
  if (isTauriRuntime()) return invoke<void>("cancel_conformer_job", { jobId });
  await browserDevConformerJson<{ ok: boolean }>("/__burette/cancel-conformer-job", { jobId });
}

async function installXtbRequest(): Promise<XtbStatus> {
  if (isTauriRuntime()) return invoke<XtbStatus>("install_xtb");
  return browserDevXtbJson<XtbStatus>("/__burette/install-xtb", {
    method: "POST",
  });
}

async function runXtbRequest(request: XtbRunRequest): Promise<XtbRunResult> {
  if (isTauriRuntime()) return invoke<XtbRunResult>("run_xtb_job", { request });
  return browserDevXtbJson<XtbRunResult>("/__burette/run-xtb-job", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

async function cancelXtbRequest(jobId: string): Promise<void> {
  if (isTauriRuntime()) return invoke<void>("cancel_xtb_job", { jobId });
  await browserDevXtbJson<{ ok: boolean }>("/__burette/cancel-xtb-job", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
}

async function browserDevXtbJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as { error?: unknown } | T | null;
  if (!response.ok) {
    const message = payload && typeof (payload as { error?: unknown }).error === "string"
      ? String((payload as { error: string }).error)
      : `xTB browser-dev request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

async function browserDevConformerJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { error?: unknown } | T | null;
  if (!response.ok) {
    const message = payload && typeof (payload as { error?: unknown }).error === "string"
      ? String((payload as { error: string }).error)
      : `CREST/PRISM browser-dev request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

type SelectedConformerInput = {
  title: string;
  extension: string;
  text: string;
};

async function selectedPdbLigandConformerInput(
  document: ViewerDocument,
  action: StructureViewerAction,
): Promise<SelectedConformerInput | null> {
  if (action.type !== "focus_ligand") return null;
  const extension = document.extension.toLowerCase();
  if (extension !== "pdb" && extension !== "pdbqt" && extension !== "ent") return null;
  const comp = selectorText(action.selector, "label_comp_id") ?? selectorText(action.selector, "auth_comp_id");
  const chain = selectorText(action.selector, "auth_asym_id") ?? selectorText(action.selector, "label_asym_id");
  const seq = selectorText(action.selector, "auth_seq_id") ?? selectorText(action.selector, "label_seq_id");
  const icode = selectorText(action.selector, "pdbx_PDB_ins_code");
  if (!comp || !chain || !seq) return null;
  const sourceText = await readStructureText(document.sourcePath ?? document.path);
  const records = sourceText.split(/\r?\n/u).filter((line) => pdbAtomLineMatchesLigand(line, comp, chain, seq, icode));
  if (records.length === 0) return null;
  const ligandCode = comp.toUpperCase();
  const title = [ligandCode, chain, seq].filter(Boolean).join(" ");
  const selectorSummary = [ligandCode, chain, seq + (icode ?? "")].filter(Boolean).join(" ");
  const text = [
    `${ligandCode} PDB ligand selection`,
    `REMARK PDB ligand selection from ${document.title}`,
    `REMARK Selected ${selectorSummary}`,
    ...records,
    "END",
    "",
  ].join("\n");
  return { title, extension: "pdb", text };
}

function conformerInputForMolstarContextDocument(
  contextDocument: MolstarContextDocument | null | undefined,
): SelectedConformerInput | null {
  const entry = (contextDocument?.entries ?? []).find((candidate): candidate is MolstarContextEntry & { data: string } => (
    typeof candidate?.data === "string" && candidate.data.trim().length > 0
  ));
  if (!entry) return null;
  return {
    title: contextDocument?.label?.trim() || entry.label?.trim() || "Molstar selection",
    extension: molstarContextEntryExtension(entry.format),
    text: entry.data,
  };
}

function pdbAtomLineMatchesLigand(line: string, comp: string, chain: string, seq: string, icode: string | null) {
  const record = line.slice(0, 6).trim();
  if (record !== "ATOM" && record !== "HETATM") return false;
  const lineComp = line.slice(17, 20).trim().toUpperCase();
  const lineChain = line.slice(21, 22).trim() || "-";
  const lineSeq = line.slice(22, 26).trim();
  const lineIcode = line.slice(26, 27).trim();
  return lineComp === comp.toUpperCase()
    && lineChain === chain
    && lineSeq === seq
    && (icode ? lineIcode === icode : true);
}

function selectorText(
  selector: Record<string, string | number | Array<string | number>>,
  key: string,
) {
  const value = selector[key];
  if (Array.isArray(value) || value === undefined || value === null) return null;
  return String(value);
}

function pathExtension(path: string) {
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  if (fileName.toLowerCase().endsWith(".mae.gz")) return "maegz";
  const index = fileName.lastIndexOf(".");
  if (index <= 0 || index === fileName.length - 1) return "";
  return fileName.slice(index + 1).toLowerCase();
}

function ketcherSource3DFromText(title: string, text: string, extension: string): KetcherSource3D | undefined {
  const cleanText = text.trim();
  if (!cleanText) return undefined;
  const cleanExtension = extension.trim().replace(/^\./u, "").toLowerCase();
  if (!["sdf", "sd", "mol"].includes(cleanExtension)) return undefined;
  return {
    title: title.trim() || "structure",
    extension: cleanExtension,
    text: cleanText,
  };
}

function browserDevSampleProjectRoot() {
  if (!import.meta.env.DEV || isTauriRuntime() || browserDevHasExplicitFiles()) return null;
  const repoRoot = String(import.meta.env.BURRETE_REPO_ROOT || "").trim().replace(/\/+$/u, "");
  return repoRoot ? `${repoRoot}/samples` : null;
}

function browserDevSampleProjectStructures(): SidebarProjectStructure[] {
  const sampleRoot = browserDevSampleProjectRoot();
  if (!sampleRoot) return [];
  return browserDevSampleFiles.map((file) => ({
    path: `${sampleRoot}/${file.title}`,
    title: file.title,
    extension: file.extension,
    renderer: "molstar",
    byteCount: file.byteCount,
    openedAt: null,
  }));
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

async function writeClipboardText(text: string) {
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (error) {
    if (!copyTextWithSelectionFallback(text)) throw error;
    return;
  }
  if (!copyTextWithSelectionFallback(text)) throw new Error("Clipboard write is unavailable.");
}

function copyTextWithSelectionFallback(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
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

function downloadBase64File(fileName: string, base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
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

function stableTextDocumentId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `text-${(hash >>> 0).toString(36)}`;
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
