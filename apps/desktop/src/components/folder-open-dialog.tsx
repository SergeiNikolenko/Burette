import type { useWorkspaceFileActions } from "../hooks/use-workspace-file-actions";
import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/tauri";
import type { ShellActions, ShellViewState } from "./types";
import { fileCapabilities } from "./workspace-menu-items";
import { useAppShellPortalContainer } from "./ui/portal-container";

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
  const validMode = mode.startsWith("scene:") ? targets.some(target => mode === `scene:${target.id}`)
    : mode === "aligned" ? canAlign : mode === "poses" ? compatible && paths.every(path => fileCapabilities(path).poses) : mode !== "together" || compatible;
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
  return <Dialog.Root open={path !== null} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal container={container}><Dialog.Overlay className="radix-dialog-overlay" />
      <Dialog.Content className="radix-dialog calculated-column-dialog">
        <div className="radix-dialog-header"><Dialog.Title>Open Folder</Dialog.Title></div>
        <div className="radix-dialog-body">
          <Dialog.Description>{path}</Dialog.Description>
          <label><input type="checkbox" checked={recursive} disabled={busy} onChange={event => setRecursive(event.target.checked)} /> Include subfolders</label>
          <p>{contents ? `${selected.size} of ${contents.files.length} files selected` : "Reading folder…"}</p>
          {contents?.truncated ? <p role="status">Showing the first 2,000 entries. Open a smaller folder to see the rest.</p> : null}
          <div className="folder-open-file-list" style={{ maxHeight: 240, overflowY: "auto" }}>
            {contents?.files.map(file => <label key={file} style={{ display: "block" }}><input type="checkbox" checked={selected.has(file)} disabled={busy}
              onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(file); else next.delete(file); return next; })} /> {file.slice((path?.length ?? 0) + 1)}</label>)}
          </div>
          <label className="calculated-column-field"><span>Open</span><select value={mode} disabled={busy} onChange={event => setMode(event.target.value)}>
            <option value="tabs">In Tabs</option><option value="right">In Right Panel</option>
            {isTauriRuntime() ? <option value="window">In New Window</option> : null}
            <option value="together" disabled={!compatible}>Together</option><option value="aligned" disabled={!canAlign}>Aligned</option><option value="poses" disabled={!compatible || !paths.every(path => fileCapabilities(path).poses)}>As Poses</option>
            {targets.map(target => <option key={target.id} value={`scene:${target.id}`}>Add to {target.title}</option>)}
          </select></label>
          {paths.length > 200 ? <p role="alert">Select at most 200 files.</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
        <div className="radix-dialog-footer calculate-properties-footer"><button className="dock-action" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="dock-action calculate-properties-run" disabled={busy || !contents || !paths.length || paths.length > 200 || !validMode} onClick={() => void submit()}>Open {paths.length || ''}</button></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
