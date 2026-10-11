import { Checkbox } from "./ui/checkbox";
import type { useWorkspaceFileActions } from "../hooks/use-workspace-file-actions";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/tauri";
import type { ShellActions, ShellViewState } from "./types";
import { fileCapabilities } from "./workspace-menu-items";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

type FolderContents = { files: string[]; folders: string[]; truncated: boolean };
export async function readFolderContents(path: string, recursive: boolean, state: ShellViewState): Promise<FolderContents> {
  if (isTauriRuntime()) return invoke("read_folder_contents", { path, recursive });
  const prefix = path + '/';
  const paths = Array.from(new Set(state.sidebarProjects.flatMap(project => project.items.map(item => item.path))));
  const files = paths.filter(file => file.startsWith(prefix) && (recursive || !file.slice(prefix.length).includes('/')));
  return { files, folders: [], truncated: false };
}
export function FolderOpenDialog({ path, state, actions, onClose, initialMode, workflows }: {
  initialMode: string; workflows: ReturnType<typeof useWorkspaceFileActions>;
  path: string | null; state: ShellViewState; actions: ShellActions; onClose: () => void;
}) {
  const [recursive, setRecursive] = useState(false);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState("tabs");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRecursive(false); setMode(initialMode); }, [path, initialMode]);
  useEffect(() => {
    if (!path) return;
    let current = true;
    setContents(null); setSelected(new Set()); setError("");
    void readFolderContents(path, recursive, state).then(result => {
      if (current) { setContents(result); setSelected(new Set(result.files.length <= 200 ? result.files : [])); }
    }).catch(error => { if (current) { console.error("[Folder open]", error); setError("Could not read this folder. Try reopening it."); } });
    return () => { current = false; };
  }, [path, recursive]);
  const paths = Array.from(selected);
  const compatible = paths.length > 1 && paths.every(path => fileCapabilities(path).scene);
  const targets = workflows.sceneTargets(paths);
  const canAlign = compatible && paths.every(path => fileCapabilities(path).protein);
  const poses = compatible && paths.every(path => fileCapabilities(path).poses);
  const validMode = mode.startsWith("scene:") ? targets.some(target => mode === `scene:${target.id}`)
    : mode === "aligned" ? canAlign : mode === "poses" ? poses : mode !== "together" || compatible;
  const submit = async () => {
    if (busy || !contents || !paths.length || paths.length > 200 || !validMode) return;
    setBusy(true); setError("");
    try {
      if (mode.startsWith("scene:")) {
        const target = targets.find(target => mode === `scene:${target.id}`);
        if (!target) throw new Error("Select a compatible open scene.");
        await workflows.addToScene(paths, target);
      } else if (mode === "aligned") await workflows.openAligned(paths);
      else if (mode === "window") await actions.openNewWindow(paths);
      else if (mode === "right") await actions.openDockPayload({ area: "right", tabKind: "files", payload: {
        paths, records: [], items: paths.map(path => ({ kind: "file", path, title: path.split('/').pop() || path })),
      } });
      else if (mode === "poses") await workflows.openPoses(paths);
      else if (mode === "together") await actions.openDockingDocument(paths[0], paths.slice(1), {
        sceneMode: "structureAll",
      });
      else await actions.openPaths(paths);
      onClose();
    } catch (error) { console.error("[Folder open]", error); setError("Could not open the selected files. Try again."); }
    finally { setBusy(false); }
  };
  const toggleFile = (file: string, checked: boolean) => setSelected(current => {
    const next = new Set(current);
    if (checked) next.add(file); else next.delete(file);
    return next;
  });
  const selectedAll = Boolean(contents?.files.length) && selected.size === contents?.files.length;
  return <Dialog open={path !== null} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent variant="form" size="compact" showCloseButton={!busy}>
      <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <DialogHeader>
          <DialogTitle>Open folder</DialogTitle>
          <DialogDescription className="sr-only">Choose files and how to open them.</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={recursive} disabled={busy} onCheckedChange={checked => setRecursive(checked === true)} />
          Include subfolders
        </label>
        {contents?.truncated && <p className="text-xs text-(--color-text-secondary)" role="status">Showing the first 2,000 entries. Open a smaller folder to see the rest.</p>}
        <div className="max-h-60 overflow-y-auto overscroll-contain rounded-2xl border border-(--color-border) px-5 py-4" role="group" aria-label="Files to open" title={path ?? undefined}>
          {contents ? <>
            {contents.files.length > 0 && contents.files.length <= 200 && <label className="mb-2 flex items-center gap-2 text-sm">
              <Checkbox checked={selectedAll ? true : selected.size ? "indeterminate" : false} disabled={busy}
                onCheckedChange={checked => setSelected(new Set(checked === true ? contents.files : []))} />
              Select all
            </label>}
            {contents.files.map(file => <label key={file} className="flex min-w-0 items-center gap-2 py-1 text-sm [content-visibility:auto] [contain-intrinsic-size:auto_28px]">
              <Checkbox checked={selected.has(file)} disabled={busy} onCheckedChange={checked => toggleFile(file, checked === true)} />
              <span className="min-w-0 break-words">{file.slice((path?.length ?? 0) + 1)}</span>
            </label>)}
            {!contents.files.length && <p className="py-3 text-center text-sm text-(--color-text-secondary)">No files in this folder.</p>}
          </> : !error ? <Spinner aria-label="Reading folder" className="mx-auto" /> : null}
        </div>
        <label className="flex flex-col gap-2 text-sm"><span>Open</span>
          <NativeSelect className="w-full" value={mode} disabled={busy || !contents} onChange={event => setMode(event.target.value)}>
            <NativeSelectOption value="tabs">In Tabs</NativeSelectOption>
            <NativeSelectOption value="right">In Right Panel</NativeSelectOption>
            {isTauriRuntime() ? <NativeSelectOption value="window">In New Window</NativeSelectOption> : null}
            <NativeSelectOption value="together" disabled={!compatible}>Together</NativeSelectOption>
            <NativeSelectOption value="aligned" disabled={!canAlign}>Aligned</NativeSelectOption>
            <NativeSelectOption value="poses" disabled={!poses}>As Poses</NativeSelectOption>
            {targets.map(target => <NativeSelectOption key={target.id} value={`scene:${target.id}`}>Add to {target.title}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        {paths.length > 200 && <p className="text-sm text-(--color-text-danger)" role="alert">Select at most 200 files.</p>}
        {error && <p className="text-sm text-(--color-text-danger)" role="alert">{error}</p>}
        <DialogFooter className="gap-2">
          {contents && <span className="mr-auto text-xs text-(--color-text-secondary)" role="status">{selected.size} of {contents.files.length} selected</span>}
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !contents || !paths.length || paths.length > 200 || !validMode}>
            {busy ? <><Spinner className="size-4" aria-hidden />Opening…</> : `Open${paths.length ? ` ${paths.length}` : ""}`}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
