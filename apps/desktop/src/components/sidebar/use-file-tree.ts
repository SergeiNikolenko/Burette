import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceEntry } from "../../types";
import * as tauri from "../../lib/tauri";
import { isTauriRuntime } from "../../lib/runtime";
import { useAppStore } from "../../store";
import { flattenTree, type FlatFileTreeItem } from "./flatten-tree";

export function useFileTree(rootPath: string | null) {
  const preloadedRootEntries = useAppStore((state) =>
    rootPath ? state.directoryCache.get(rootPath) : undefined,
  );
  const [cache, setCache] = useState<Map<string, WorkspaceEntry[]>>(new Map());
  const cacheRef = useRef(cache);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path: string, force = false) => {
    if (!isTauriRuntime()) return;
    if (!force && cacheRef.current.has(path)) return;
    setLoading((previous) => new Set(previous).add(path));
    try {
      const entries = await tauri.readDirectory(path);
      setCache((previous) => {
        const next = new Map(previous);
        next.set(path, entries);
        cacheRef.current = next;
        return next;
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading((previous) => {
        const next = new Set(previous);
        next.delete(path);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const emptyCache = new Map<string, WorkspaceEntry[]>();
    cacheRef.current = emptyCache;
    setCache(emptyCache);
    setExpanded(rootPath ? new Set([rootPath]) : new Set());
    setError(null);
    if (rootPath && preloadedRootEntries) {
      const restoredCache = new Map([[rootPath, preloadedRootEntries]]);
      cacheRef.current = restoredCache;
      setCache(restoredCache);
      return;
    }
    if (rootPath) void loadDirectory(rootPath, true);
  }, [loadDirectory, preloadedRootEntries, rootPath]);

  const toggleDirectory = useCallback((path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    void loadDirectory(path);
  }, [loadDirectory]);

  const refreshDirectory = useCallback((path: string) => {
    return loadDirectory(path, true);
  }, [loadDirectory]);

  useEffect(() => {
    if (!rootPath) return;
    const refreshLoadedDirectories = () => {
      const directories = new Set([rootPath, ...cacheRef.current.keys()]);
      for (const directory of directories) void loadDirectory(directory, true);
    };
    window.addEventListener("burrete:workspace-files-changed", refreshLoadedDirectories);
    return () => window.removeEventListener("burrete:workspace-files-changed", refreshLoadedDirectories);
  }, [loadDirectory, rootPath]);

  const invalidatePath = useCallback((path: string) => {
    setCache((previous) => {
      const next = new Map(previous);
      next.delete(path);
      cacheRef.current = next;
      return next;
    });
  }, []);

  const items = useMemo(
    () => (rootPath ? flattenTree(rootPath, cache, expanded) : []),
    [cache, expanded, rootPath],
  );
  const hasRootEntry = rootPath ? cache.has(rootPath) : false;

  return {
    error,
    items,
    hasRootEntry,
    loading,
    expanded,
    toggleDirectory,
    refreshDirectory,
    invalidatePath,
  };
}

export type { FlatFileTreeItem };
