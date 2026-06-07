import type { RecentStructure, ViewerDocument } from "../types";
import { isPersistentViewerDocument, isTemporaryDocumentPath, normalizeDocumentPath } from "./temporary-documents";

export type SidebarProjectItem = {
  key: string;
  path: string;
  title: string;
  relativePath: string;
  extension: string;
  renderer: string;
  byteCount: number;
  openedAt: number | null;
  source: "open" | "recent";
  documentId: string | null;
  isActive: boolean;
  isOpen: boolean;
  isPinned: boolean;
  matchText: string;
};

export type SidebarProject = {
  id: string;
  rootPath: string | null;
  title: string;
  subtitle: string | null;
  isExplicit: boolean;
  isPinned: boolean;
  isActive: boolean;
  items: SidebarProjectItem[];
  matchText: string;
};

type SidebarStructure = Pick<RecentStructure, "path" | "title" | "extension" | "renderer" | "byteCount" | "openedAt">;

export function buildSidebarProjects({
  documents,
  recentStructures,
  projectRoots,
  pinnedProjectRoots = [],
  projectNameOverrides = {},
  activeDocumentId,
  pinnedStructurePaths = [],
}: {
  documents: ViewerDocument[];
  recentStructures: RecentStructure[];
  projectRoots: string[];
  pinnedProjectRoots?: string[];
  projectNameOverrides?: Record<string, string>;
  activeDocumentId: string | null;
  pinnedStructurePaths?: string[];
}) {
  const normalizedRoots = dedupeRoots(projectRoots.filter((root) => !isTemporaryDocumentPath(root)));
  const pinnedRoots = new Set(
    pinnedProjectRoots
      .filter((root) => !isTemporaryDocumentPath(root))
      .map((root) => normalizePath(root)),
  );
  const pinnedPaths = new Set(
    pinnedStructurePaths
      .filter((path) => !isTemporaryDocumentPath(path))
      .map((path) => normalizePath(path)),
  );
  const projectDocuments = documents.filter(isPersistentViewerDocument);
  const openPaths = new Set(projectDocuments.map((document) => normalizePath(document.path)));
  const projects = new Map<string, SidebarProject>();

  for (const rootPath of normalizedRoots) {
    const projectId = `project:${rootPath}`;
    projects.set(projectId, createProject(projectId, rootPath, true, pinnedRoots, projectNameOverrides));
  }

  for (const document of projectDocuments) {
    addStructureToProjects(projects, normalizedRoots, pinnedPaths, {
      structure: document,
      activeDocumentId,
      source: "open",
    });
  }

  for (const structure of recentStructures.filter((structure) => !isTemporaryDocumentPath(structure.path))) {
    if (openPaths.has(normalizePath(structure.path))) continue;
    addStructureToProjects(projects, normalizedRoots, pinnedPaths, {
      structure,
      activeDocumentId,
      source: "recent",
    });
  }

  return Array.from(projects.values())
    .map((project) => ({
      ...project,
      isActive: project.items.some((item) => item.isActive),
      items: [...project.items].sort(compareProjectItems),
      matchText: `${project.title} ${project.subtitle ?? ""}`.trim().toLowerCase(),
    }))
    .sort(compareProjects);
}

export function filterSidebarProjects(projects: SidebarProject[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return projects;
  return projects
    .map((project) => {
      const items = project.items.filter((item) => item.matchText.includes(normalizedQuery));
      if (project.matchText.includes(normalizedQuery)) return project;
      if (items.length === 0) return null;
      return { ...project, items };
    })
    .filter((project): project is SidebarProject => project !== null);
}

export function normalizePath(path: string) {
  return normalizeDocumentPath(path);
}

export function parentDirectory(path: string) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : null;
}

export function basename(path: string) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function dedupeRoots(projectRoots: string[]) {
  return Array.from(
    new Set(projectRoots.map((root) => normalizePath(root)).filter(Boolean)),
  ).sort((left, right) => right.length - left.length);
}

function addStructureToProjects(
  projects: Map<string, SidebarProject>,
  projectRoots: string[],
  pinnedPaths: Set<string>,
  {
    structure,
    activeDocumentId,
    source,
  }: {
    structure: ViewerDocument | SidebarStructure;
    activeDocumentId: string | null;
    source: "open" | "recent";
  },
) {
  const normalizedPath = normalizePath(structure.path);
  const rootPath = resolveProjectRoot(normalizedPath, projectRoots) ?? parentDirectory(normalizedPath);
  const projectId = rootPath ? `project:${rootPath}` : "project:loose";
  const explicitRoot = rootPath ? projectRoots.includes(rootPath) : false;
  const project = projects.get(projectId) ?? createProject(projectId, rootPath, explicitRoot, new Set(), {});
  const relativePath = rootPath ? relativeToRoot(rootPath, normalizedPath) : basename(normalizedPath);
  const itemTitle = basename(normalizedPath) || structure.title;
  const item = {
    key: `${source}:${normalizedPath}`,
    path: normalizedPath,
    title: itemTitle,
    relativePath,
    extension: "extension" in structure ? structure.extension : "",
    renderer: structure.renderer,
    byteCount: structure.byteCount,
    openedAt: source === "recent" && "openedAt" in structure ? structure.openedAt : null,
    source,
    documentId: "id" in structure ? structure.id : null,
    isActive: "id" in structure && structure.id === activeDocumentId,
    isOpen: source === "open",
    isPinned: pinnedPaths.has(normalizedPath),
    matchText: `${project.title} ${relativePath} ${itemTitle}`.trim().toLowerCase(),
  } satisfies SidebarProjectItem;
  project.items.push(item);
  projects.set(projectId, project);
}

function createProject(
  id: string,
  rootPath: string | null,
  isExplicit: boolean,
  pinnedRoots: Set<string>,
  projectNameOverrides: Record<string, string>,
): SidebarProject {
  if (!rootPath) {
    return {
      id,
      rootPath: null,
      title: "Loose Files",
      subtitle: null,
      isExplicit,
      isPinned: false,
      isActive: false,
      items: [],
      matchText: "loose files",
    };
  }

  const title = projectNameOverrides[rootPath]?.trim() || basename(rootPath) || rootPath;
  return {
    id,
    rootPath,
    title,
    subtitle: parentDirectory(rootPath),
    isExplicit,
    isPinned: pinnedRoots.has(rootPath),
    isActive: false,
    items: [],
    matchText: "",
  };
}

function resolveProjectRoot(path: string, projectRoots: string[]) {
  return projectRoots.find((root) => path === root || path.startsWith(`${root}/`)) ?? null;
}

function relativeToRoot(rootPath: string, path: string) {
  if (path === rootPath) return basename(path);
  if (!path.startsWith(`${rootPath}/`)) return basename(path);
  return path.slice(rootPath.length + 1);
}

function compareProjectItems(left: SidebarProjectItem, right: SidebarProjectItem) {
  if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
  return left.relativePath.localeCompare(right.relativePath);
}

function compareProjects(left: SidebarProject, right: SidebarProject) {
  if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
  return left.title.localeCompare(right.title);
}
