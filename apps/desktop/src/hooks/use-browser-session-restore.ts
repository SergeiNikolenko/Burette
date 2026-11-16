import { useEffect, useState } from "react";
import type { FileOpenOptions } from "../components/types";
import { isBrowserSessionWorkspace } from "../lib/window-scope";
import { listBrowserImports } from "../lib/browser-import-storage";
import { initializeBrowserImportedFiles } from "../lib/web-demo-workspace";
import { useMoleculeStore } from "../stores/molecule-store";

type OpenPaths = (paths: string[], options?: FileOpenOptions) => unknown | Promise<unknown>;

/** Reopen only committed local imports. Persisted paths never confer server filesystem authority. */
export function useBrowserSessionRestore(openPaths: OpenPaths, onError: (error: unknown, prefix?: string) => void) {
  const [actions] = useState(() => ({ openPaths, onError }));
  useEffect(() => {
    if (!isBrowserSessionWorkspace()) return;
    const initial = useMoleculeStore.getState();
    if (initial.documents.length || initial.textDocuments.length) return;
    const candidates = initial.tabs.flatMap(tab => tab.location.kind === "file" || tab.location.kind === "text-file"
      ? [{ id: tab.id, location: tab.location, path: tab.location.path }] : []);
    if (!candidates.length) return;
    let current = true;
    const owns = (path: string) => current && candidates.some(candidate => candidate.path === path
      && useMoleculeStore.getState().tabs.some(tab => tab.id === candidate.id && tab.location === candidate.location));
    void (async () => {
      await initializeBrowserImportedFiles();
      const imports = new Set((await listBrowserImports()).map(record => record.path));
      if (!current) return;
      const paths = [...new Set(candidates.filter(candidate => owns(candidate.path)).map(candidate => candidate.path))];
      useMoleculeStore.getState().pruneMissingFileTabs(paths, paths.filter(path => imports.has(path)));
      const active = candidates.find(candidate => candidate.id === initial.activeTabId)?.path;
      const ordered = paths.filter(path => imports.has(path)).sort((a, b) => a === active ? -1 : b === active ? 1 : 0);
      for (const path of ordered) {
        if (!owns(path)) continue;
        await actions.openPaths([path], { preserveActiveTab: true, shouldApply: () => owns(path) });
      }
    })().catch(error => { if (current) actions.onError(error, "Restore browser files failed"); });
    return () => { current = false; };
    // A reload has one initial snapshot. Later user navigation must never restart restoration.
  }, [actions]);
}
