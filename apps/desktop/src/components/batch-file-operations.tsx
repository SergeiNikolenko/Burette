import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../lib/tauri";
import { useMoleculeStore } from "../stores/molecule-store";
import { useShellStore } from "../stores/shell-store";
import { TrashFilesDialog } from "./file-operation-dialogs";
import type { ShellActions, ShellViewState } from "./types";
import { menuItem } from "./workspace-menu-items";

export function useBatchFileOperations(actions: ShellActions, state: ShellViewState) {
  const [paths, setPaths] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const running = useRef(false);
  // Trashing starts without confirmation; the dialog only reports a failure and offers a retry.
  const trash = async (paths: string[]) => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(""); setCompleted([]);
    const affected = useMoleculeStore.getState().tabs.filter(tab => 'path' in tab.location && paths.includes(tab.location.path));
    const moved: string[] = [];
    try {
      await actions.closeTabs(affected.map(tab => tab.id));
      if (useMoleculeStore.getState().tabs.some(tab => affected.some(other => other.id === tab.id))) return;
      for (const path of paths) {
        await invoke("operate_sidebar_file", { request: { operation: "trash", path } });
        moved.push(path);
        const store = useMoleculeStore.getState();
        store.pruneRecentStructures(store.recentStructures.filter(recent => recent.path === path), []);
        if (useShellStore.getState().pinnedStructurePaths.includes(path)) actions.togglePinnedStructure(path);
      }
      setPaths([]);
    } catch (error) {
      console.error("Move files to Trash failed", error);
      setError("Could not move these files to Trash. Try again.");
      setCompleted(moved);
      setPaths(paths.filter(path => !moved.includes(path)));
    } finally {
      running.current = false;
      setBusy(false);
      window.dispatchEvent(new Event("burette-folder-contents-changed"));
    }
  };
  const hasDirtyFile = (files: string[]) => state.documents.some(document =>
    files.includes(document.path) && state.dirtyGridDocuments.has(document.id));
  const exportFiles = async (files: string[]) => {
    if (hasDirtyFile(files)) throw new Error("Save changes to the selected collections before exporting file copies.");
    const destination = await open({ directory: true, multiple: false, title: "Export Selected Files" });
    if (typeof destination !== "string") return;
    let copied = 0;
    try {
      for (const path of files) {
        await invoke("operate_sidebar_file", { request: { operation: "saveCopy", path, destination: destination + '/' + path.split('/').pop() } });
        copied++;
      }
    } catch (error) {
      console.error("Copy selected files failed", error);
      throw new Error(`${copied} of ${files.length} files copied. Choose another folder or try again.`);
    }
  };
  const items = (files: string[]) => !isTauriRuntime() || files.length < 2 || files.length > 200 ? [] : [
    { ...menuItem("save-file-copy", "Selected Files…", () => exportFiles(files)), disabled: hasDirtyFile(files) },
    menuItem("trash-file", "Move to Trash", () => trash(files)),
  ];
  const dialog = <TrashFilesDialog paths={paths} completed={completed.length} error={error} busy={busy}
    onDismiss={() => { if (!running.current) setPaths([]); }} onRetry={() => void trash(paths)} />;
  return { items, dialog };
}
