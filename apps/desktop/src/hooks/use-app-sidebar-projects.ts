import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";

import { buildSidebarProjects, type SidebarProjectStructure } from "../lib/sidebar-projects";
import { scanBrowserDevFolders } from "../lib/browser-dev-startup";
import { isTauriRuntime } from "../lib/tauri";
import type { RecentStructure, TextFileDocument, ViewerDocument } from "../types";
import {
  isWebDemoWorkspace,
  subscribeWebDemoWorkspace,
  webDemoProjectRoot,
  webDemoProjectStructures,
} from "../lib/web-demo-workspace";

const browserDevSampleFiles = [
  { title: "ketcher-2d-benzene.sdf", extension: "sdf", byteCount: 579 },
  { title: "ketcher-3d-core.sdf", extension: "sdf", byteCount: 409 },
  { title: "nad-2d.sdf", extension: "sdf", byteCount: 3813 },
] as const;

const browserDevGeneratedProjectScanMs = 2500;
const projectScanRootBatchSize = 16;
const projectScanSessionEntryBudget = 20_000;
const browserDevStructureExtensions = new Set([
  "pdb", "ent", "pdbqt", "pqr", "xpdb",
  "cif", "mmcif", "mcif", "bcif", "mmtf",
  "ccp4", "mrc", "map", "mtz",
  "sdf", "sd", "smi", "smiles",
  "mol", "mol2", "xyz", "gro", "mae", "maegz", "cms", "dtr",
  "nc", "ncdf", "netcdf", "ncrst",
]);
const browserDevTextExtensions = new Set([
  "", "md", "markdown", "mdx", "txt", "log", "err", "sh", "bash", "zsh", "py", "rs",
  "js", "jsx", "ts", "tsx", "json", "npy", "npz", "pkl", "yaml", "yml", "toml", "html", "css",
]);
const browserDevImageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const browserDevTableExtensions = new Set(["csv", "tsv"]);

type SidebarProjectRootScan = {
  root: string;
  files: SidebarProjectStructure[];
  truncated: boolean;
  scannedEntries: number;
  scannedDirectories: number;
  error: string | null;
};

type UseAppSidebarProjectsArgs = {
  activeDocumentId: string | null;
  browserDevExplicitFolders: string[];
  browserDevHasExplicitWorkspace: boolean;
  documents: ViewerDocument[];
  textDocuments: TextFileDocument[];
  expandedProjectIds: string[];
  hiddenProjectRoots: string[];
  pinnedProjectRoots: string[];
  pinnedStructurePaths: string[];
  projectNameOverrides: Record<string, string>;
  projectRoots: string[];
  pruneRecentStructures: (
    checkedDocuments: Array<Pick<RecentStructure, "path" | "openedAt">>,
    existingPaths: string[],
  ) => void;
  pruneSidebarPaths: (existingPaths: string[]) => void;
  pushErrorStatus: (error: unknown, prefix?: string, details?: string[]) => void;
  pushStatus: (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
  recentStructures: RecentStructure[];
  sidebarQuery: string;
};

export function useAppSidebarProjects({
  activeDocumentId,
  browserDevExplicitFolders,
  browserDevHasExplicitWorkspace,
  documents,
  textDocuments,
  expandedProjectIds,
  hiddenProjectRoots,
  pinnedProjectRoots,
  pinnedStructurePaths,
  projectNameOverrides,
  projectRoots,
  pruneRecentStructures,
  pruneSidebarPaths,
  pushErrorStatus,
  pushStatus,
  recentStructures,
  sidebarQuery,
}: UseAppSidebarProjectsArgs) {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [projectStructures, setProjectStructures] = useState<SidebarProjectStructure[]>([]);
  const [webDemoRevision, setWebDemoRevision] = useState(0);
  const prunedPersistedPathsRef = useRef(false);
  const lastGeneratedFilesSignatureRef = useRef<string>("");
  const completeProjectScanCacheRef = useRef(new Map<string, SidebarProjectRootScan>());
  const partialProjectScanResultsRef = useRef(new Map<string, SidebarProjectRootScan>());
  const projectScanInFlightRef = useRef(new Map<string, symbol>());
  const projectScanQueueRef = useRef<Promise<void>>(Promise.resolve());
  const projectScanEligibleRootsRef = useRef(new Set<string>());
  const previousProjectScanEligibleRootsRef = useRef(new Set<string>());
  const projectScanSessionKeyRef = useRef("");
  const projectScanSessionEntriesRef = useRef(0);
  const deferredProjectScanRootsRef = useRef(new Set<string>());
  const projectScanBudgetReportedRef = useRef(false);
  const activeProjectRootsRef = useRef(new Set(projectRoots));
  activeProjectRootsRef.current = new Set(projectRoots);

  useEffect(() => {
    if (!isWebDemoWorkspace()) return undefined;
    return subscribeWebDemoWorkspace(() => setWebDemoRevision((revision) => revision + 1));
  }, []);

  const browserDevSampleRoot = useMemo(
    () => browserDevSampleProjectRoot(browserDevHasExplicitWorkspace),
    [browserDevHasExplicitWorkspace],
  );
  const browserDevGeneratedRoot = useMemo(browserDevGeneratedProjectRoot, []);
  const sidebarProjectRoots = useMemo(() => {
    let roots = projectRoots;
    if (browserDevExplicitFolders.length > 0) {
      roots = browserDevExplicitFolders;
    } else if (browserDevSampleRoot && !projectRoots.includes(browserDevSampleRoot)) {
      roots = [...projectRoots, browserDevSampleRoot];
    }
    return appendSidebarProjectRoot(roots, browserDevGeneratedRoot);
  }, [browserDevExplicitFolders, browserDevGeneratedRoot, browserDevSampleRoot, projectRoots]);
  const sidebarProjectStructures = useMemo(() => {
    const samples = browserDevSampleProjectStructures(browserDevHasExplicitWorkspace);
    return samples.length > 0 ? [...projectStructures, ...samples] : projectStructures;
  }, [browserDevHasExplicitWorkspace, projectStructures, webDemoRevision]);
  const sidebarRecentStructures = browserDevExplicitFolders.length > 0 ? [] : recentStructures;
  const projectRootsToScan = useMemo(() => {
    if (sidebarQuery.trim()) return projectRoots;
    return projectRoots.filter((root) => expandedProjectIds.includes(`project:${root}`));
  }, [expandedProjectIds, projectRoots, sidebarQuery]);
  projectScanEligibleRootsRef.current = new Set(projectRootsToScan);

  const sidebarProjects = useMemo(() => buildSidebarProjects({
    documents,
    textDocuments,
    recentStructures: sidebarRecentStructures,
    projectRoots: sidebarProjectRoots,
    projectStructures: sidebarProjectStructures,
    pinnedProjectRoots,
    projectNameOverrides,
    activeDocumentId,
    hiddenProjectRoots,
    pinnedStructurePaths,
  }), [activeDocumentId, documents, hiddenProjectRoots, pinnedProjectRoots, pinnedStructurePaths, projectNameOverrides, sidebarProjectRoots, sidebarProjectStructures, sidebarRecentStructures, textDocuments]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      const roots = Array.from(new Set([
        ...(browserDevGeneratedRoot ? [browserDevGeneratedRoot] : []),
        ...browserDevExplicitFolders,
      ]));
      if (roots.length === 0) {
        lastGeneratedFilesSignatureRef.current = "";
        setProjectStructures([]);
        return undefined;
      }
      let cancelled = false;
      let reportedError = false;
      let reportedTruncation = false;
      lastGeneratedFilesSignatureRef.current = "";
      const applyFiles = (files: string[]) => {
        const signature = files.join("\n");
        if (cancelled || signature === lastGeneratedFilesSignatureRef.current) return;
        lastGeneratedFilesSignatureRef.current = signature;
        setProjectStructures(files.map(browserDevProjectStructureForPath));
      };
      const refresh = async () => {
        try {
          const scan = await scanBrowserDevFolders(roots);
          applyFiles(scan.files.sort((left, right) => left.localeCompare(right)));
          if (scan.truncated && !reportedTruncation) {
            reportedTruncation = true;
            pushStatus(
              `Browser project scanning stopped after ${scan.scannedEntries.toLocaleString()} entries in `
              + `${scan.scannedDirectories.toLocaleString()} folders to keep Burette responsive. `
              + "Open a smaller subfolder as a separate project to inspect additional files.",
            );
          }
        } catch (error) {
          if (cancelled) return;
          applyFiles([]);
          if (!reportedError) {
            reportedError = true;
            pushErrorStatus(error, "Browser project scan failed");
          }
        }
      };
      void refresh();
      const interval = browserDevGeneratedRoot
        ? window.setInterval(() => void refresh(), browserDevGeneratedProjectScanMs)
        : null;
      return () => {
        cancelled = true;
        if (interval !== null) window.clearInterval(interval);
      };
    }
    if (projectRoots.length === 0) {
      completeProjectScanCacheRef.current.clear();
      partialProjectScanResultsRef.current.clear();
      projectScanInFlightRef.current.clear();
      previousProjectScanEligibleRootsRef.current.clear();
      deferredProjectScanRootsRef.current.clear();
      projectScanSessionKeyRef.current = "";
      projectScanSessionEntriesRef.current = 0;
      projectScanBudgetReportedRef.current = false;
      setProjectStructures([]);
      return undefined;
    }
    const activeRoots = activeProjectRootsRef.current;
    for (const root of completeProjectScanCacheRef.current.keys()) {
      if (!activeRoots.has(root)) completeProjectScanCacheRef.current.delete(root);
    }
    for (const root of partialProjectScanResultsRef.current.keys()) {
      if (!activeRoots.has(root)) partialProjectScanResultsRef.current.delete(root);
    }
    for (const root of projectScanInFlightRef.current.keys()) {
      if (!activeRoots.has(root)) projectScanInFlightRef.current.delete(root);
    }

    const eligibleRoots = projectScanEligibleRootsRef.current;
    for (const root of eligibleRoots) {
      const partialResult = partialProjectScanResultsRef.current.get(root);
      if (
        !previousProjectScanEligibleRootsRef.current.has(root)
        && partialResult?.error
      ) {
        // A collapse→expand retries a transient error. Truncated inventories
        // stay cached because this API has no cursor: repeating the same scan
        // would only rediscover the same prefix and waste another full budget.
        partialProjectScanResultsRef.current.delete(root);
      }
    }
    previousProjectScanEligibleRootsRef.current = new Set(eligibleRoots);
    const sessionKey = [...eligibleRoots].sort().join("\u0000");
    if (sessionKey !== projectScanSessionKeyRef.current) {
      projectScanSessionKeyRef.current = sessionKey;
      projectScanSessionEntriesRef.current = 0;
      deferredProjectScanRootsRef.current.clear();
      projectScanBudgetReportedRef.current = false;
    }

    const visibleFiles = projectRoots.flatMap((root) => (
      completeProjectScanCacheRef.current.get(root)
      ?? partialProjectScanResultsRef.current.get(root)
    )?.files ?? []);
    setProjectStructures(visibleFiles);

    const rootsToScan = projectRootsToScan.filter((root) => (
      !completeProjectScanCacheRef.current.has(root)
      && !partialProjectScanResultsRef.current.has(root)
      && !projectScanInFlightRef.current.has(root)
      && !deferredProjectScanRootsRef.current.has(root)
    ));
    for (let start = 0; start < rootsToScan.length; start += projectScanRootBatchSize) {
      const requestRoots = rootsToScan.slice(start, start + projectScanRootBatchSize);
      const requestToken = Symbol("project-scan");
      for (const root of requestRoots) projectScanInFlightRef.current.set(root, requestToken);
      const runRequest = async () => {
        const activeRequestRoots = requestRoots.filter((root) => {
          if (projectScanInFlightRef.current.get(root) !== requestToken) return false;
          if (
            !activeProjectRootsRef.current.has(root)
            || !projectScanEligibleRootsRef.current.has(root)
          ) {
            projectScanInFlightRef.current.delete(root);
            return false;
          }
          if (projectScanSessionEntriesRef.current >= projectScanSessionEntryBudget) {
            projectScanInFlightRef.current.delete(root);
            deferredProjectScanRootsRef.current.add(root);
            return false;
          }
          return true;
        });
        if (activeRequestRoots.length === 0) {
          if (
            deferredProjectScanRootsRef.current.size > 0
            && !projectScanBudgetReportedRef.current
          ) {
            projectScanBudgetReportedRef.current = true;
            pushStatus(
              "Project scanning paused after 20,000 entries to keep Burette responsive. Open a smaller subfolder as a separate project to inspect additional files.",
            );
          }
          return;
        }
        try {
          const remainingEntryBudget =
            projectScanSessionEntryBudget - projectScanSessionEntriesRef.current;
          const results = await invoke<SidebarProjectRootScan[]>(
            "list_project_structure_files",
            { paths: activeRequestRoots, maxEntries: remainingEntryBudget },
          );
          const resultsByRoot = new Map(results.map((result) => [result.root, result]));
          const partialMessages: string[] = [];
          projectScanSessionEntriesRef.current += results.reduce(
            (total, result) => total + Math.max(0, result.scannedEntries),
            0,
          );
          for (const root of activeRequestRoots) {
            if (projectScanInFlightRef.current.get(root) !== requestToken) continue;
            projectScanInFlightRef.current.delete(root);
            if (!activeProjectRootsRef.current.has(root)) continue;
            const result = resultsByRoot.get(root);
            if (!result) {
              pushErrorStatus(new Error(`No scan result was returned for ${root}`), "Project file scan failed");
              continue;
            }
            if (!result.truncated && !result.error) {
              completeProjectScanCacheRef.current.set(root, result);
              partialProjectScanResultsRef.current.delete(root);
            } else {
              partialProjectScanResultsRef.current.set(root, result);
              completeProjectScanCacheRef.current.delete(root);
            }
            if (result.error) {
              pushErrorStatus(new Error(result.error), `Project scan failed for ${projectRootTitle(root)}`);
            }
            if (result.truncated) {
              partialMessages.push(
                `Showing the first ${result.files.length.toLocaleString()} files from ${projectRootTitle(root)}; `
                + `the scan stopped after ${result.scannedEntries.toLocaleString()} entries in `
                + `${result.scannedDirectories.toLocaleString()} folders to keep Burette responsive. `
                + "Open a smaller subfolder as a separate project to inspect additional files.",
              );
            }
          }
          const currentRoots = activeProjectRootsRef.current;
          const nextFiles = Array.from(currentRoots).flatMap((root) => (
            completeProjectScanCacheRef.current.get(root)
            ?? partialProjectScanResultsRef.current.get(root)
          )?.files ?? []);
          setProjectStructures(nextFiles);
          for (const message of partialMessages) pushStatus(message);
        } catch (error) {
          let relevant = false;
          for (const root of activeRequestRoots) {
            if (projectScanInFlightRef.current.get(root) !== requestToken) continue;
            projectScanInFlightRef.current.delete(root);
            relevant ||= activeProjectRootsRef.current.has(root);
          }
          if (relevant) pushErrorStatus(error, "Project file scan failed");
        }
      };
      projectScanQueueRef.current = projectScanQueueRef.current
        .then(runRequest, runRequest)
        .catch(() => undefined);
    }
    return undefined;
  }, [browserDevExplicitFolders, browserDevGeneratedRoot, projectRoots, projectRootsToScan, pushErrorStatus, pushStatus]);

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
        const checkedDocuments = recentStructures.map(({ path, openedAt }) => ({ path, openedAt }));
        const checkedPaths = new Set(checkedDocuments.map((document) => document.path));
        pruneRecentStructures(
          checkedDocuments,
          existingPaths.filter((path) => checkedPaths.has(path)),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pinnedProjectRoots, pinnedStructurePaths, projectRoots, pruneRecentStructures, pruneSidebarPaths, recentStructures]);

  const activeProject = useMemo(
    () => sidebarProjects.find((project) => project.isActive) ?? null,
    [sidebarProjects],
  );

  return {
    activeProject,
    setWorkspacePath: setWorkspacePath as Dispatch<SetStateAction<string | null>>,
    sidebarProjects,
    workspacePath,
  };
}

function browserDevSampleProjectRoot(browserDevHasExplicitWorkspace: boolean) {
  if (isWebDemoWorkspace()) return webDemoProjectRoot();
  if (!import.meta.env.DEV || isTauriRuntime() || browserDevHasExplicitWorkspace) return null;
  const repoRoot = String(import.meta.env.BURETTE_REPO_ROOT || "").trim().replace(/\/+$/u, "");
  return repoRoot ? `${repoRoot}/samples` : null;
}

function browserDevGeneratedProjectRoot() {
  if (!import.meta.env.DEV || isTauriRuntime()) return null;
  const root = String(import.meta.env.BURETTE_BROWSER_DEV_GENERATED_FILES_ROOT || "").trim().replace(/\/+$/u, "");
  return root || null;
}

function projectRootTitle(root: string) {
  return root.replace(/\\/gu, "/").split("/").filter(Boolean).pop() || root;
}

function appendSidebarProjectRoot(roots: string[], root: string | null) {
  if (!root || roots.includes(root)) return roots;
  return [...roots, root];
}

function browserDevSampleProjectStructures(browserDevHasExplicitWorkspace: boolean): SidebarProjectStructure[] {
  if (isWebDemoWorkspace()) return webDemoProjectStructures();
  const sampleRoot = browserDevSampleProjectRoot(browserDevHasExplicitWorkspace);
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

function browserDevProjectStructureForPath(path: string): SidebarProjectStructure {
  const title = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
  const extension = browserDevProjectExtension(path);
  let renderer: SidebarProjectStructure["renderer"] = "not-renderable";
  if (browserDevImageExtensions.has(extension)) renderer = "image";
  else if (browserDevTableExtensions.has(extension)) renderer = "grid2d";
  else if (browserDevTextExtensions.has(extension)) renderer = "text";
  else if (browserDevStructureExtensions.has(extension)) renderer = "molstar";
  return {
    path,
    title,
    extension,
    renderer,
    byteCount: 0,
    openedAt: null,
  };
}

function browserDevProjectExtension(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mae.gz")) return "maegz";
  const index = lower.lastIndexOf(".");
  return index >= 0 ? lower.slice(index + 1) : "";
}
