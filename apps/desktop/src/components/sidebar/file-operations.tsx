import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../../lib/tauri";
import { basename } from "../../lib/sidebar-projects";
import { MOVE_INTO_FOLDER_EVENT, type MoveIntoFolderRequest } from "../../lib/move-into-folder";
import { useMoleculeStore } from "../../stores/molecule-store";
import { useShellStore } from "../../stores/shell-store";
import type { MenuItemSpec } from "../menu-types";
import type { ShellActions, ShellViewState } from "../types";
import { FileOperationDialog, type FileOperationRequest as Request } from "../file-operation-dialogs";

type FileMenus = (path: string, kind?: "file" | "folder" | "project") => MenuItemSpec[];
const FileOperationsContext = createContext<FileMenus>(() => []);

export function useSidebarFileMenus() { return useContext(FileOperationsContext); }

export function SidebarFileOperations({ state, actions, children }: {
  state: ShellViewState; actions: ShellActions; children: ReactNode;
}) {
  const [request, setRequest] = useState<Request | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = async (next: Request) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    // A moved path may be a file or a folder; nothing lives below a file path.
    const moving = next.operation === "moveInto";
    const folder = moving || next.operation === "renameFolder" || next.operation === "trashFolder";
    const affects = (path: string) => path === next.path || (folder && path.startsWith(next.path + '/'));
    const changesSource = folder || next.operation === "rename" || next.operation === "trash";
    const wasOpen = useMoleculeStore.getState().tabs.filter(tab =>
      (tab.location.kind === "file" || tab.location.kind === "text-file") && affects(tab.location.path));
    const pinnedPaths = useShellStore.getState().pinnedStructurePaths.filter(affects);
    let committed = false;
    try {
      if (changesSource && wasOpen.length) {
        await actions.closeTabs(wasOpen.map(tab => tab.id));
        if (useMoleculeStore.getState().tabs.some(tab => wasOpen.some(open => open.id === tab.id))) {
          setRequest(null);
          return false;
        }
      }
      const output = await invoke<string | null>("operate_sidebar_file", { request: next });
      committed = true;
      if (changesSource) {
        const store = useMoleculeStore.getState();
        const stale = store.recentStructures.filter(recent => affects(recent.path));
        store.pruneRecentStructures(stale, []);
        for (const path of pinnedPaths) {
          actions.togglePinnedStructure(path);
          if (output) actions.togglePinnedStructure(output + path.slice(next.path.length));
        }
        if (folder) {
          const shell = useShellStore.getState();
          const roots = shell.projectRoots.filter(affects);
          for (const root of roots) {
            const wasPinned = shell.pinnedProjectRoots.includes(root);
            const label = shell.projectNameOverrides[root];
            shell.removeProjectRoot(root);
            if (output) {
              const replacement = output + root.slice(next.path.length);
              shell.addProjectRoot(replacement);
              if (wasPinned) shell.togglePinnedProjectRoot(replacement);
              if (label) shell.renameProjectRoot(replacement, label);
            }
          }
        }
      }
      if (output && !folder && next.operation !== "createFolder" && next.operation !== "saveCopy") {
        await actions.openPaths([output]);
      }
      if (output && moving && wasOpen.length) {
        await actions.openPaths(wasOpen.flatMap(tab => "path" in tab.location ? [output + tab.location.path.slice(next.path.length)] : []));
      }
      window.dispatchEvent(new Event("burette-folder-contents-changed"));
      setRequest(null);
      return true;
    } catch (cause) {
      // Trash and Duplicate run without a dialog, so a failure opens one to report it.
      setRequest(next);
      console.error("File operation failed", cause);
      setError("Could not complete this file operation. Try again.");
      if (!committed && changesSource && wasOpen.length) await actions.openPaths(wasOpen.flatMap(tab => "path" in tab.location ? [tab.location.path] : []));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    const move = async (event: Event) => {
      const { directory, paths } = (event as CustomEvent<MoveIntoFolderRequest>).detail;
      for (const path of paths) {
        if (!await runRef.current({ operation: "moveInto", path, destination: directory })) break;
      }
    };
    window.addEventListener(MOVE_INTO_FOLDER_EVENT, move);
    return () => window.removeEventListener(MOVE_INTO_FOLDER_EVENT, move);
  }, []);

  const choose = (next: Request) => {
    if (running.current) return;
    setError("");
    setName("name" in next ? next.name : "");
    setRequest(next);
  };
  const menus: FileMenus = (path, kind = "file") => {
    if (!isTauriRuntime()) return [];
    if (kind !== "file") return [
      ...(kind === "folder" ? [{ kind: "item" as const, id: "rename-folder", text: "Rename…", action: () => choose({ operation: "renameFolder", path, name: basename(path) }) }] : []),
      { kind: "item", id: "new-folder", text: "Folder…", action: () => choose({ operation: "createFolder", path, name: "Untitled Folder" }) },
      ...(kind === "folder" ? [{ kind: "item" as const, id: "trash-folder", text: "Move to Trash", variant: "destructive" as const, action: () => { void run({ operation: "trashFolder", path }); } }] : []),
    ];
    const document = state.documents.find(document => document.path === path);
    const dirty = Boolean(document && state.dirtyGridDocuments.has(document.id));
    return [
      { kind: "item", id: "rename-file", text: "Rename…", action: () => choose({ operation: "rename", path, name: basename(path) }) },
      { kind: "item", id: "duplicate-file", text: "Duplicate", disabled: dirty,
        action: () => { void run({ operation: "duplicate", path }); } },
      { kind: "item", id: "save-file-copy", text: "Save File Copy As…", disabled: dirty, action: async () => {
        try {
          const destination = await save({ title: "Save File Copy", defaultPath: path });
          if (destination) await run({ operation: "saveCopy", path, destination });
        } catch (cause) {
          choose({ operation: "saveCopy", path, destination: "" });
          console.error("Save file dialog failed", cause);
          setError("Could not choose a destination. Try again.");
        }
      } },
      { kind: "separator" },
      // Like Finder, Move to Trash needs no confirmation: the item stays recoverable in Trash.
      { kind: "item", id: "trash-file", text: "Move to Trash", variant: "destructive", action: () => { void run({ operation: "trash", path }); } },
    ];
  };
  const dismiss = () => { if (!running.current) setRequest(null); };
  return <FileOperationsContext.Provider value={menus}>
    {children}
    <FileOperationDialog request={request} name={name} onNameChange={setName} error={error} busy={busy} onDismiss={dismiss}
      onRun={next => {
        if (next.operation === "saveCopy" && !next.destination) {
          const item = menus(next.path).find(item => item.kind === "item" && item.id === "save-file-copy");
          if (item?.kind === "item") void item.action?.();
        } else void run(next);
      }} />
  </FileOperationsContext.Provider>;
}
