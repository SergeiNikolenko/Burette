import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../../lib/tauri";
import { basename } from "../../lib/sidebar-projects";
import { useMoleculeStore } from "../../stores/molecule-store";
import { useShellStore } from "../../stores/shell-store";
import type { MenuItemSpec } from "../menu-types";
import type { ShellActions, ShellViewState } from "../types";
import { useAppShellPortalContainer } from "../ui/portal-container";
import { CloseIcon } from "../close-icon";

type Request =
  | { operation: "rename" | "renameFolder" | "createFolder"; path: string; name: string }
  | { operation: "duplicate" | "trash" | "trashFolder"; path: string }
  | { operation: "saveCopy"; path: string; destination: string };
type FileMenus = (path: string, kind?: "file" | "folder" | "project") => MenuItemSpec[];
const FileOperationsContext = createContext<FileMenus>(() => []);
const labels = { rename: "Rename File", duplicate: "Duplicate File", trash: "Move to Trash", saveCopy: "Save File Copy", renameFolder: "Rename Folder", createFolder: "New Folder", trashFolder: "Move Folder to Trash" };

export function useSidebarFileMenus() { return useContext(FileOperationsContext); }

export function SidebarFileOperations({ state, actions, children }: {
  state: ShellViewState; actions: ShellActions; children: ReactNode;
}) {
  const portalContainer = useAppShellPortalContainer();
  const [request, setRequest] = useState<Request | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = async (next: Request) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setRequest(next);
    const folder = next.operation === "renameFolder" || next.operation === "trashFolder";
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
          return;
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
      window.dispatchEvent(new Event("burette-folder-contents-changed"));
      setRequest(null);
    } catch (cause) {
      setError(String(cause));
      if (!committed && changesSource && wasOpen.length) await actions.openPaths(wasOpen.flatMap(tab => "path" in tab.location ? [tab.location.path] : []));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const choose = (next: Request) => {
    setError("");
    setName("name" in next ? next.name : "");
    setRequest(next);
  };
  const menus: FileMenus = (path, kind = "file") => {
    if (!isTauriRuntime()) return [];
    if (kind !== "file") return [
      ...(kind === "folder" ? [{ kind: "item" as const, id: "rename-folder", text: "Rename…", action: () => choose({ operation: "renameFolder", path, name: basename(path) }) }] : []),
      { kind: "item", id: "new-folder", text: "Folder…", action: () => choose({ operation: "createFolder", path, name: "Untitled Folder" }) },
      ...(kind === "folder" ? [{ kind: "item" as const, id: "trash-folder", text: "Move to Trash…", action: () => choose({ operation: "trashFolder", path }) }] : []),
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
          setError(String(cause));
        }
      } },
      { kind: "separator" },
      { kind: "item", id: "trash-file", text: "Move to Trash…", action: () => choose({ operation: "trash", path }) },
    ];
  };
  const needsName = request !== null && "name" in request;
  const invalidName = needsName && (!name.trim() || name !== name.trim() || /[/\\\0:]/.test(name) || name === "." || name === "..");

  const dismiss = () => { if (!busy) { setRequest(null); } };
  return <FileOperationsContext.Provider value={menus}>
    {children}
    <Dialog.Root open={request !== null} onOpenChange={open => { if (!open) dismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog file-operation-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
          <form onSubmit={event => {
            event.preventDefault();
            if (request && !invalidName && !busy) void run(needsName ? { ...request, name } as Request : request);
          }}>
            <div className="radix-dialog-header"><Dialog.Title>{request ? labels[request.operation] : "File"}</Dialog.Title>
              <Dialog.Close asChild><button type="button" className="radix-dialog-close" aria-label="Close file operation" disabled={busy}><CloseIcon size={14} /></button></Dialog.Close></div>
            <div className="radix-dialog-body">
              <Dialog.Description className="radix-dialog-subline">{(request?.operation === "trash" || request?.operation === "trashFolder")
                ? `“${basename(request.path)}” can be restored from Trash.`
                : request?.path}</Dialog.Description>
              {needsName ? <label className="calculated-column-field"><span>Name</span><input aria-label="File or folder name"
                value={name} onChange={event => setName(event.target.value)} onFocus={event => event.target.select()} disabled={busy} /></label> : null}
              {invalidName ? <p role="alert">Enter a name without path separators.</p> : null}
              {error ? <p role="alert">{error}</p> : null}
            </div>
            <div className="radix-dialog-actions">
              <button type="button" className="dock-action" disabled={busy} onClick={dismiss}>Cancel</button>
              {request ? <button type="submit" className="dock-action calculate-properties-run" disabled={busy || Boolean(invalidName)}>
                {busy ? "Working…" : request ? labels[request.operation] : "Apply"}
              </button> : null}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </FileOperationsContext.Provider>;
}
