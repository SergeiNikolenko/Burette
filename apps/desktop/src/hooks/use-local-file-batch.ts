import { useEffect, useRef, useState } from "react";
import { openFileBatch, isBatchSceneOpen } from "./file-open-batch";
import { useMoleculeStore } from "../stores/molecule-store";
import { readFolderContents } from "../components/folder-open-dialog";
import { fileCapabilities } from "../components/workspace-menu-items";
import { toast } from "../components/ui/toast";
import { togetherDockingRequest } from "../lib/docking-documents";
import type { ShellActions, ShellViewState } from "../components/types";

type Progress = Awaited<ReturnType<typeof openFileBatch>>;
type WatchOptions = { path: string; recursive: boolean; baseline: string[] };
type Watch = WatchOptions & { documentId: string; seen: Set<string>; attempts: Map<string, number>; count: number; controller: AbortController };

export function useLocalFileBatch(state: ShellViewState, actions: ShellActions) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [watching, setWatching] = useState<string[]>([]);
  const current = useRef({ state, actions });
  current.current = { state, actions };
  const watches = useRef(new Map<string, Watch>());
  const active = useRef(new Set<AbortController>());
  const mounted = useRef(true);
  const stopWatching = (path: string) => {
    watches.current.get(path)?.controller.abort();
    watches.current.delete(path);
    if (mounted.current) setWatching([...watches.current.keys()]);
  };
  const open = async (paths: string[], mode: "scene" | "tabs", watch?: WatchOptions, target?: Watch) => {
    const controller = target?.controller ?? new AbortController();
    active.current.add(controller);
    try {
      // Fresh protein + ligand collections are docking runs. Watched folders
      // retain incremental scene imports so later files can join the scene.
      const unique = [...new Set(paths)];
      const docking = mode === "scene" && !target && !watch && unique.length > 1
        ? togetherDockingRequest(unique) : null;
      if (docking && !docking.sceneMode) {
        if (unique.length > 200) throw new Error("Choose up to 200 files at a time.");
        const progress = { total: unique.length, completed: 0, opened: 0, failures: [], cancelled: false };
        if (mounted.current) setProgress(progress);
        const document = await current.current.actions.openDockingDocument(docking.receptorPath, docking.ligandPaths, {
          shouldApply: () => !controller.signal.aborted && mounted.current,
        });
        if (controller.signal.aborted) return { ...progress, cancelled: true };
        if (!document) throw new Error("Could not open the docking run.");
        return { ...progress, completed: unique.length, opened: unique.length, documentId: document.id };
      }
      const result = await openFileBatch(paths, { actions: current.current.actions, mode,
        targetDocumentId: target?.documentId, signal: controller.signal,
        onProgress: value => { if (mounted.current) setProgress(value); },
      });
      if (mounted.current && result.failures.length && !target) toast.add({ title: `${result.failures.length} file${result.failures.length === 1 ? "" : "s"} could not be opened`, type: "error" });
      if (mounted.current && !controller.signal.aborted && watch && result.documentId && !result.cancelled && isBatchSceneOpen(result.documentId)) {
        stopWatching(watch.path);
        watches.current.set(watch.path, { ...watch, documentId: result.documentId, seen: new Set(watch.baseline), attempts: new Map(), count: result.opened, controller: new AbortController() });
        setWatching([...watches.current.keys()]);
        toast.add({ title: "Watching for new structures", actionProps: { children: "Stop", onClick: () => stopWatching(watch.path) } });
      }
      return result;
    } finally {
      active.current.delete(controller);
      if (mounted.current && active.current.size === 0) setProgress(null);
    }
  };
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    mounted.current = true;
    const stopClosed = () => {
      for (const [path, watch] of watches.current) if (!isBatchSceneOpen(watch.documentId)) stopWatching(path);
    };
    const unsubscribe = useMoleculeStore.subscribe(stopClosed);
    let checking = false;
    const timer = window.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        stopClosed();
        for (const [path, watch] of watches.current) {
          if (watch.controller.signal.aborted) continue;
          try {
            const contents = await readFolderContents(path, watch.recursive, current.current.state);
            if (watch.controller.signal.aborted || !isBatchSceneOpen(watch.documentId)) continue;
            const fresh = contents.files.filter(file => fileCapabilities(file).scene && !watch.seen.has(file));
            if (contents.truncated || watch.count + fresh.length > 200) throw new Error("watch-limit");
            if (!fresh.length) continue;
            fresh.forEach(file => watch.seen.add(file));
            const result = await openRef.current(fresh, "scene", undefined, watch);
            watch.count += result.opened;
            if (result.cancelled) stopWatching(path);
            // Writers can expose a file before it is complete. Retry boundedly
            // without duplicating successful imports or flooding notifications.
            for (const failure of result.failures) {
              const attempts = (watch.attempts.get(failure.path) ?? 0) + 1;
              watch.attempts.set(failure.path, attempts);
              if (attempts >= 3) throw new Error("watch-file-unreadable");
              watch.seen.delete(failure.path);
            }
          } catch {
            if (watch.controller.signal.aborted || !mounted.current) continue;
            stopWatching(path);
            toast.add({ title: "Watching stopped. Reopen the folder to retry.", type: "error" });
          }
        }
      } finally { checking = false; }
    }, 2500);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      unsubscribe();
      for (const controller of active.current) controller.abort();
      for (const watch of watches.current.values()) watch.controller.abort();
      watches.current.clear();
    };
  }, []);
  const openFolder = async (path: string) => {
    const contents = await readFolderContents(path, true, current.current.state);
    if (contents.truncated) throw new Error("Open a smaller folder to include every file.");
    const paths = contents.files.filter(file => fileCapabilities(file).scene);
    if (!paths.length) throw new Error("No supported structures in this folder.");
    return open(paths, "scene");
  };
  return { open, openFolder, progress, watching, stopWatching,
    cancel: () => { for (const controller of active.current) controller.abort(); },
  };
}
