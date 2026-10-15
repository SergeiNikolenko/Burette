import { useEffect, useRef, useState } from "react";
import type { ShellActions } from "../types";
import { isBatchSceneOpen, openFileBatch, type FileBatchProgress } from "../../hooks/file-open-batch";
import { sshList, sshPreview, type SshProject } from "../../lib/ssh-projects";
import { useMoleculeStore } from "../../stores/molecule-store";
import { isMolstarSceneImportSource } from "../../lib/docking-documents";

async function folderFiles(project: SshProject, path: string) {
  const listing = await sshList(project.host, project.root, path, true);
  if (listing.truncated || listing.partial || listing.discovered?.some(record => record.truncated)) {
    throw new Error("This folder is too large to open completely. Choose a smaller subfolder.");
  }
  return new Map([listing, ...(listing.discovered ?? [])].flatMap(record => record.entries
    .filter(entry => !entry.directory)
    .map(entry => [record.path === "." ? entry.name : `${record.path}/${entry.name}`, entry.size] as const)));
}

export function useSshFileBatch(project: SshProject, actions: ShellActions, enabled: boolean) {
  const [progress, setProgress] = useState<FileBatchProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [watching, setWatching] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const watchCleanup = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    watchCleanup.current?.(); watchCleanup.current = null;
    active.current?.abort();
    active.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setWatching(null);
    setBusy(false);
  };
  useEffect(() => {
    if (!enabled) stop();
    return () => { active.current?.abort(); watchCleanup.current?.(); if (timer.current) clearTimeout(timer.current); };
  }, [enabled]);

  async function open(paths: string[], mode: "scene" | "tabs", folder?: string, watch = false) {
    stop();
    const controller = new AbortController();
    active.current = controller;
    const stopCurrent = () => { if (active.current === controller) stop(); };
    setBusy(true); setError(""); setProgress(null);
    const run = (files: string[], documentId?: string) => openFileBatch(files, {
      actions, mode, targetDocumentId: documentId, signal: controller.signal,
      resolvePath: file => sshPreview(project, file),
      onProgress: value => { if (!controller.signal.aborted) setProgress(value); },
    });
    try {
      const discovered = folder === undefined ? new Map(paths.map(path => [path, 0])) : await folderFiles(project, folder);
      controller.signal.throwIfAborted();
      if (!discovered.size) throw new Error("No structures found in this folder.");
      const result = await run([...discovered.keys()]);
      if (controller.signal.aborted) return;
      setBusy(false);
      if (!watch || folder === undefined || !result.documentId || result.cancelled) return;
      const documentId = result.documentId;
      const failed = new Set(result.failures.map(failure => failure.path));
      const seen = new Set([...discovered.keys()].filter(path => !failed.has(path)));
      let previous = discovered;
      setWatching(folder);
      watchCleanup.current = useMoleculeStore.subscribe(() => { if (!isBatchSceneOpen(documentId)) stopCurrent(); });
      const poll = async () => {
        if (controller.signal.aborted || !isBatchSceneOpen(documentId)) { stopCurrent(); return; }
        try {
          const next = await folderFiles(project, folder);
          if (controller.signal.aborted || !isBatchSceneOpen(documentId)) { stopCurrent(); return; }
          // Wait for a new file's size to settle for a full poll before import.
          const incoming = [...next].filter(([path, size]) => !seen.has(path)
            && isMolstarSceneImportSource(path) && previous.get(path) === size).map(([path]) => path);
          previous = next;
          if (seen.size + incoming.length > 200) throw new Error("This scene has reached 200 files. Start another scene to watch more files.");
          if (incoming.length) {
            setBusy(true);
            const added = await run(incoming, documentId);
            if (added.cancelled) { stopCurrent(); return; }
            const failures = new Set(added.failures.map(failure => failure.path));
            incoming.filter(path => !failures.has(path)).forEach(path => seen.add(path));
            setBusy(false);
          }
          setError("");
        } catch (failure) {
          if (!controller.signal.aborted) setError(String(failure));
          stopCurrent(); return;
        }
        if (!controller.signal.aborted) timer.current = setTimeout(() => void poll(), 5000);
      };
      timer.current = setTimeout(() => void poll(), 5000);
    } catch (failure) {
      if (!controller.signal.aborted) setError(String(failure));
    } finally {
      if (active.current === controller) setBusy(false);
    }
  }
  return { progress, busy, error, watching, stop, open };
}
