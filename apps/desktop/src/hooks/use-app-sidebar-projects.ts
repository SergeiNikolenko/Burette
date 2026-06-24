import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";

import { buildSidebarProjects, type SidebarProjectStructure } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import type { RecentStructure, ViewerDocument } from "../types";

const browserDevSampleFiles = [
  { title: "ketcher-2d-benzene.sdf", extension: "sdf", byteCount: 579 },
  { title: "ketcher-3d-core.sdf", extension: "sdf", byteCount: 409 },
  { title: "nad-2d.sdf", extension: "sdf", byteCount: 3813 },
] as const;

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
  pruneRecentStructures: (existingPaths: string[]) => void;
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
  const prunedPersistedPathsRef = useRef(false);

  const browserDevSampleRoot = useMemo(
    () => browserDevSampleProjectRoot(browserDevHasExplicitWorkspace),
    [browserDevHasExplicitWorkspace],
  );
  const sidebarProjectRoots = useMemo(() => {
    if (browserDevExplicitFolders.length > 0) return browserDevExplicitFolders;
    return browserDevSampleRoot && !projectRoots.includes(browserDevSampleRoot)
      ? [...projectRoots, browserDevSampleRoot]
      : projectRoots;
  }, [browserDevExplicitFolders, browserDevSampleRoot, projectRoots]);
  const sidebarProjectStructures = useMemo(() => {
    const samples = browserDevSampleProjectStructures(browserDevHasExplicitWorkspace);
    return samples.length > 0 ? [...projectStructures, ...samples] : projectStructures;
  }, [browserDevHasExplicitWorkspace, projectStructures]);
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
  if (!import.meta.env.DEV || isTauriRuntime() || browserDevHasExplicitWorkspace) return null;
  const repoRoot = String(import.meta.env.BURRETE_REPO_ROOT || "").trim().replace(/\/+$/u, "");
  return repoRoot ? `${repoRoot}/samples` : null;
}

function browserDevSampleProjectStructures(browserDevHasExplicitWorkspace: boolean): SidebarProjectStructure[] {
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
