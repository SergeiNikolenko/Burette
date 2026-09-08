import { useState } from "react";
import { Dialog } from "radix-ui";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../lib/tauri";
import { useMoleculeStore } from "../stores/molecule-store";
import { useShellStore } from "../stores/shell-store";
import { useAppShellPortalContainer } from "./ui/portal-container";
import type { ShellActions, ShellViewState } from "./types";
import { menuItem } from "./workspace-menu-items";

export function useBatchFileOperations(actions: ShellActions, state: ShellViewState) {
  const container = useAppShellPortalContainer();
  const [paths, setPaths] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const trash = async () => {
    setBusy(true); setError("");
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
      setError(String(error));
      setCompleted(moved);
      setPaths(paths.filter(path => !moved.includes(path)));
    } finally {
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
    } catch (error) { throw new Error(`${copied} of ${files.length} files copied. ${String(error)}`); }
  };
  const items = (files: string[]) => !isTauriRuntime() || files.length < 2 || files.length > 200 ? [] : [
    { ...menuItem("save-file-copy", "Selected Files…", () => exportFiles(files)), disabled: hasDirtyFile(files) },
    menuItem("trash-file", "Move to Trash…", () => { setPaths(files); setCompleted([]); setError(""); }),
  ];
  const dialog = <Dialog.Root open={paths.length > 0} onOpenChange={open => { if (!open && !busy) setPaths([]); }}>
    <Dialog.Portal container={container}><Dialog.Overlay className="radix-dialog-overlay" /><Dialog.Content className="radix-dialog file-operation-dialog">
      <div className="radix-dialog-header"><Dialog.Title>Move {paths.length} Files to Trash</Dialog.Title></div>
      <div className="radix-dialog-body"><Dialog.Description>You can restore these files in Finder.</Dialog.Description>
        <ul style={{ maxHeight: 220, overflowY: "auto" }}>{paths.map(path => <li key={path}>{path.split('/').pop()}</li>)}</ul>
        {completed.length ? <p>{completed.length} files moved.</p> : null}{error ? <p role="alert">{error}</p> : null}
      </div>
      <div className="radix-dialog-actions"><button className="dock-action" disabled={busy} onClick={() => setPaths([])}>Cancel</button>
        <button className="dock-action" disabled={busy} onClick={() => void trash()}>{busy ? "Moving…" : "Move to Trash"}</button></div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
  return { items, dialog };
}
