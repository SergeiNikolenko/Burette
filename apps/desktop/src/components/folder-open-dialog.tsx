import type { useWorkspaceFileActions } from "../hooks/use-workspace-file-actions";
import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/tauri";
import type { ShellActions, ShellViewState } from "./types";
import { fileCapabilities } from "./workspace-menu-items";
import { useAppShellPortalContainer } from "./ui/portal-container";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { CloseIcon } from "./close-icon";

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
  const container = useAppShellPortalContainer();
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
    setContents(null); setError("");
    void readFolderContents(path, recursive, state).then(result => {
      if (current) { setContents(result); setSelected(new Set(result.files.length <= 200 ? result.files : [])); }
    }).catch(error => { if (current) setError(String(error)); });
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
    if (busy || !paths.length || paths.length > 200 || !validMode) return;
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
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const toggleFile = (file: string, checked: boolean) => setSelected(current => {
    const next = new Set(current);
    if (checked) next.add(file); else next.delete(file);
    return next;
  });
  return <Dialog.Root open={path !== null} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal container={container}><Dialog.Overlay className="radix-dialog-overlay" />
      <Dialog.Content className="radix-dialog calculated-column-dialog" aria-describedby="folder-open-body">
        <div className="radix-dialog-header">
          <Dialog.Title>Open Folder</Dialog.Title>
          <Dialog.Close asChild>
            <button type="button" className="radix-dialog-close" aria-label="Close open folder" disabled={busy}>
              <CloseIcon size={14} />
            </button>
          </Dialog.Close>
        </div>
        <div id="folder-open-body" className="radix-dialog-body">
          <p className="radix-dialog-subline">{path}</p>
          <label className="radix-dialog-check-row">
            <input type="checkbox" checked={recursive} disabled={busy} onChange={event => setRecursive(event.target.checked)} />
            <span>Include subfolders</span>
          </label>
          {contents?.truncated ? <p className="calculated-column-note" role="status">Showing the first 2,000 entries. Open a smaller folder to see the rest.</p> : null}
          <div className="radix-dialog-scroll-list folder-open-file-list" role="group" aria-label="Files to open">
            {contents?.files.map(file => <label key={file} className="radix-dialog-check-row">
              <input type="checkbox" checked={selected.has(file)} disabled={busy} onChange={event => toggleFile(file, event.target.checked)} />
              <span>{file.slice((path?.length ?? 0) + 1)}</span>
            </label>)}
            {contents && !contents.files.length ? <p className="calculated-column-empty">No files in this folder.</p> : null}
          </div>
          <label className="calculated-column-field"><span>Open</span>
            <NativeSelect size="sm" value={mode} disabled={busy} onChange={event => setMode(event.target.value)}>
              <NativeSelectOption value="tabs">In Tabs</NativeSelectOption>
              <NativeSelectOption value="right">In Right Panel</NativeSelectOption>
              {isTauriRuntime() ? <NativeSelectOption value="window">In New Window</NativeSelectOption> : null}
              <NativeSelectOption value="together" disabled={!compatible}>Together</NativeSelectOption>
              <NativeSelectOption value="aligned" disabled={!canAlign}>Aligned</NativeSelectOption>
              <NativeSelectOption value="poses" disabled={!poses}>As Poses</NativeSelectOption>
              {targets.map(target => <NativeSelectOption key={target.id} value={`scene:${target.id}`}>Add to {target.title}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          {paths.length > 200 ? <p className="calculated-column-problem" role="alert">Select at most 200 files.</p> : null}
          {error ? <p className="calculated-column-problem" role="alert">{error}</p> : null}
        </div>
        <div className="radix-dialog-footer calculate-properties-footer">
          <span className="calculate-properties-count">
            {contents ? `${selected.size} of ${contents.files.length} files selected` : "Reading folder…"}
          </span>
          <div className="calculate-properties-actions">
            <button type="button" className="dock-action" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="dock-action calculate-properties-run" disabled={busy || !contents || !paths.length || paths.length > 200 || !validMode} onClick={() => void submit()}>Open {paths.length || ''}</button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
