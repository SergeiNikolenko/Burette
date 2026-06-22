import { useEffect, useRef } from "react";
import { browserDevRuntimeNeedsRefresh } from "../lib/browser-dev-documents";
import {
  browserDevDockingFromLocation,
  browserDevFilesFromLocation,
  browserDevHasExplicitFiles,
} from "../lib/browser-dev-startup";
import { parentDirectory } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";
import type { MoleculeTab } from "../stores/molecule-store";
import type { ViewerDocument } from "../types";

type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenPaths = (paths: string[]) => unknown | Promise<unknown>;
type OpenDocuments = (paths: string[]) => unknown | Promise<unknown>;
type OpenDockingDocument = (
  receptorPath: string,
  ligandPaths: string[],
) => void | Promise<ViewerDocument | null>;

type UseAppStartupEffectsOptions = {
  activeDocument: ViewerDocument | null | undefined;
  activeTabId: string | null | undefined;
  addProjectRoot: (path: string) => void;
  browserDevExplicitFolder: string | null;
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

export function useAppStartupEffects({
  activeDocument,
  activeTabId,
  addProjectRoot,
  browserDevExplicitFolder,
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
      const workspace = browserDevExplicitFolder ?? (paths[0] ? parentDirectory(paths[0]) : null);
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
  }, [addProjectRoot, browserDevExplicitFolder, closeAllDocuments, documents, openPaths, pushErrorStatus, setWorkspacePath]);

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
  }, [addProjectRoot, closeAllDocuments, openDockingDocument, setWorkspacePath]);
}
