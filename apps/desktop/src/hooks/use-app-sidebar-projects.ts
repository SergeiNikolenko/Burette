import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";

import { buildSidebarProjects, type SidebarProjectStructure } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import type { RecentStructure, ViewerDocument } from "../types";
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
const browserDevStructureExtensions = new Set([
  "pdb", "ent", "pdbqt", "pqr", "xpdb",
  "cif", "mmcif", "mcif", "bcif", "mmtf",
  "sdf", "sd", "smi", "smiles", "csv", "tsv",
  "mol", "mol2", "xyz", "gro", "mae", "maegz", "cms", "dtr",
  "nc", "ncdf", "netcdf", "ncrst",
]);

type UseAppSidebarProjectsArgs = {
  activeDocumentId: string | null;
  browserDevExplicitFolders: string[];
  browserDevHasExplicitWorkspace: boolean;
  documents: ViewerDocument[];
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
  recentStructures: RecentStructure[];
};

export function useAppSidebarProjects({
  activeDocumentId,
  browserDevExplicitFolders,
  browserDevHasExplicitWorkspace,
  documents,
  hiddenProjectRoots,
  pinnedProjectRoots,
  pinnedStructurePaths,
  projectNameOverrides,
  projectRoots,
  pruneRecentStructures,
  pruneSidebarPaths,
  pushErrorStatus,
  recentStructures,
}: UseAppSidebarProjectsArgs) {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [projectStructures, setProjectStructures] = useState<SidebarProjectStructure[]>([]);
  const [webDemoRevision, setWebDemoRevision] = useState(0);
  const prunedPersistedPathsRef = useRef(false);
  const lastGeneratedFilesSignatureRef = useRef<string>("");

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

  const sidebarProjects = useMemo(() => buildSidebarProjects({
    documents,
    recentStructures: sidebarRecentStructures,
    projectRoots: sidebarProjectRoots,
    projectStructures: sidebarProjectStructures,
    pinnedProjectRoots,
    projectNameOverrides,
    activeDocumentId,
    hiddenProjectRoots,
    pinnedStructurePaths,
  }), [activeDocumentId, documents, hiddenProjectRoots, pinnedProjectRoots, pinnedStructurePaths, projectNameOverrides, sidebarProjectRoots, sidebarProjectStructures, sidebarRecentStructures]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      if (!browserDevGeneratedRoot) {
        lastGeneratedFilesSignatureRef.current = "";
        setProjectStructures([]);
        return undefined;
      }
      let cancelled = false;
      let reportedError = false;
      lastGeneratedFilesSignatureRef.current = "";
      const applyFiles = (files: string[]) => {
        const signature = files.join("\n");
        if (cancelled || signature === lastGeneratedFilesSignatureRef.current) return;
        lastGeneratedFilesSignatureRef.current = signature;
        setProjectStructures(files.map(browserDevProjectStructureForPath));
      };
      const refresh = async () => {
        try {
          const response = await fetch(`/__burette/dev-files?root=${encodeURIComponent(browserDevGeneratedRoot)}`, { cache: "no-store" });
          if (!response.ok) throw new Error(`Generated project scan failed with HTTP ${response.status}`);
          const payload = await response.json() as { files?: string[] };
          applyFiles(Array.isArray(payload.files) ? payload.files : []);
        } catch (error) {
          if (cancelled) return;
          applyFiles([]);
          if (!reportedError) {
            reportedError = true;
            pushErrorStatus(error, "Generated project scan failed");
          }
        }
      };
      void refresh();
      const interval = window.setInterval(() => void refresh(), browserDevGeneratedProjectScanMs);
      return () => {
        cancelled = true;
        window.clearInterval(interval);
      };
    }
    if (projectRoots.length === 0) {
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
  }, [browserDevGeneratedRoot, projectRoots, pushErrorStatus]);

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
  const repoRoot = String(import.meta.env.BURRETE_REPO_ROOT || "").trim().replace(/\/+$/u, "");
  return repoRoot ? `${repoRoot}/samples` : null;
}

function browserDevGeneratedProjectRoot() {
  if (!import.meta.env.DEV || isTauriRuntime()) return null;
  const root = String(import.meta.env.BURRETE_BROWSER_DEV_GENERATED_FILES_ROOT || "").trim().replace(/\/+$/u, "");
  return root || null;
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
  return {
    path,
    title,
    extension,
    renderer: browserDevStructureExtensions.has(extension) ? "molstar" : "not-renderable",
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
