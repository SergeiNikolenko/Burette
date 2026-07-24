import { useEffect, useRef } from "react";
import { browserDevRuntimeNeedsRefresh } from "../lib/browser-dev-documents";
import {
  browserDevDockingFromLocation,
  browserDevSceneModeFromLocation,
  browserDevFilesFromLocation,
} from "../lib/browser-dev-startup";
import { dockingRequestForDrop, isMolstarCoordinateTrajectorySource } from "../lib/docking-documents";
import { parentDirectory } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";
import type { MoleculeTab } from "../stores/molecule-store";
import type { DockingSceneMode, ViewerDocument } from "../types";
import { isWebDemoWorkspace, webDemoProjectRoot } from "../lib/web-demo-workspace";

type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenPaths = (paths: string[]) => unknown | Promise<unknown>;
type OpenDocuments = (paths: string[]) => unknown | Promise<unknown>;
type OpenDockingDocument = (
  receptorPath: string,
  ligandPaths: string[],
  options?: { activePose?: number | null; sceneMode?: DockingSceneMode | null },
) => void | Promise<ViewerDocument | null>;

type UseAppStartupEffectsOptions = {
  activeDocument: ViewerDocument | null | undefined;
  activeTabId: string | null | undefined;
  addProjectRoot: (path: string) => void;
  browserDevExplicitFolders: string[];
  closeAllDocuments: () => void;
  documents: ViewerDocument[];
  openDockingDocument: OpenDockingDocument;
  openDocuments: OpenDocuments;
  openPaths: OpenPaths;
  pushErrorStatus: PushErrorStatus;
  setActiveTab: (id: string) => void;
  setWorkspacePath: (path: string | null) => void;
  tabs: MoleculeTab[];
};

function browserDevTrajectoryDockingRequest(paths: string[]) {
  if (paths.length !== 2 || !paths.some(isMolstarCoordinateTrajectorySource)) return null;
  return dockingRequestForDrop(paths[0], paths.slice(1));
}

export function useAppStartupEffects({
  activeDocument,
  activeTabId,
  addProjectRoot,
  browserDevExplicitFolders,
  closeAllDocuments,
  documents,
  openDockingDocument,
  openDocuments,
  openPaths,
  pushErrorStatus,
  setActiveTab,
  setWorkspacePath,
  tabs,
}: UseAppStartupEffectsOptions) {
  const openedBrowserDevFilesRef = useRef<string | null>(null);
  const openedBrowserDevDockingRef = useRef<string | null>(null);
  const refreshedPersistedSessionRef = useRef(false);
  const openedPersistedTabsRef = useRef(false);
  const syncingBrowserDevFilesRef = useRef(false);

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
      const browserDevProjectRoots = isWebDemoWorkspace() && webDemoProjectRoot()
        ? [webDemoProjectRoot() as string]
        : browserDevExplicitFolders.length > 0
        ? browserDevExplicitFolders
        : uniqueParentDirectories(paths);
      const workspace = commonParentDirectory(browserDevProjectRoots);
      if (workspace) {
        setWorkspacePath(workspace);
      }
      for (const root of browserDevProjectRoots) {
        addProjectRoot(root);
      }
      closeAllDocuments();
      const trajectoryDockingRequest = browserDevTrajectoryDockingRequest(paths);
      if (trajectoryDockingRequest) {
        await openDockingDocument(trajectoryDockingRequest.receptorPath, trajectoryDockingRequest.ligandPaths);
      } else {
        await openPaths(paths);
      }
      syncingBrowserDevFilesRef.current = false;
    })().catch((error) => {
      if (!cancelled) pushErrorStatus(error, "Open dev files failed");
      syncingBrowserDevFilesRef.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [addProjectRoot, browserDevExplicitFolders, closeAllDocuments, documents, openDockingDocument, openPaths, pushErrorStatus, setWorkspacePath]);

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
    void Promise.resolve(openPaths(paths)).then(() => {
      if (restoreTabId) setActiveTab(restoreTabId);
    });
  }, [activeTabId, documents.length, openPaths, setActiveTab, tabs]);

  useEffect(() => {
    if (isTauriRuntime()) return;
    const request = browserDevDockingFromLocation();
    if (!request) return;
    const sceneMode = browserDevSceneModeFromLocation();
    const normalizedDocking = [sceneMode ?? "", request.receptorPath, ...request.ligandPaths].join("\n");
    if (openedBrowserDevDockingRef.current === normalizedDocking) return;
    openedBrowserDevDockingRef.current = normalizedDocking;
    const workspace = parentDirectory(request.receptorPath);
    if (workspace) {
      setWorkspacePath(workspace);
      addProjectRoot(workspace);
    }
    closeAllDocuments();
    void openDockingDocument(request.receptorPath, request.ligandPaths, { sceneMode });
  }, [addProjectRoot, closeAllDocuments, openDockingDocument, setWorkspacePath]);
}

function uniqueParentDirectories(paths: string[]) {
  return Array.from(new Set(paths.map((path) => parentDirectory(path)).filter((path): path is string => Boolean(path))));
}

function commonParentDirectory(paths: string[]) {
  if (paths.length === 0) return null;
  if (paths.length === 1) return paths[0];
  const [first, ...rest] = paths;
  let candidate = first;
  while (candidate && rest.some((path) => path !== candidate && !path.startsWith(`${candidate}/`))) {
    candidate = parentDirectory(candidate) ?? "";
  }
  return candidate || null;
}
