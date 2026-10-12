import { useSshFileBatch } from "./use-ssh-file-batch";
import { Button } from "../ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSshProjectMenu } from "./ssh-project-details";
import { useSshStatus } from "../../lib/ssh-connection-status";
import { SshDeleteFolderDialog } from "./ssh-delete-folder-dialog";
import { FolderExpandCollapseIcon } from "../sidebar/folder-expand-collapse-icon";
import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { MarqueeName } from "../marquee-name";
import { SidebarFolderIcon } from "../sidebar/sidebar-folder-icon";
import { FileKindIcon, fileKindForPath } from "../sidebar/file-kind-icon";
import { DotsHorizontal } from "../ui/app-icons";
import { NativeDropdownMenu } from "../native-dropdown-menu";
import { showNativeContextMenu } from "../native-context-menu";
import type { MenuItemSpec } from "../menu-types";
import { saveSshProject, sshList, sshPreview, type SshConnection, type SshDirectory, type SshProject } from "../../lib/ssh-projects";
import type { StructureDragPayload } from "../../lib/structure-drag";
import { useSidebarStructureDrag } from "../sidebar/use-sidebar-structure-drag";
import { sshProjectHoverCard, useSidebarHoverCard } from "../sidebar/sidebar-hover-card";
import type { ShellActions, ShellViewState } from "../types";

import { copyTextWithSelectionFallback } from "../../lib/clipboard";

// Every download takes its own slot in the 256-entry SSH preview cache.
const MAX_DROPPED_REMOTE_FILES = 64;

type Operation = { type: "list" | "preview"; path: string };
export function RemoteProject({ project, connection, onOpen, actions, state }: { project: SshProject; connection?: SshConnection; onOpen: (paths: string[]) => void | Promise<void>; actions: ShellActions; state: ShellViewState }) {
  const [expanded, setExpanded] = useState(new Set<string>());
  const [directories, setDirectories] = useState(new Map<string, { time: number; value: SshDirectory }>());
  const [pending, setPending] = useState<Operation | null>(null);
  const [failure, setFailure] = useState<{ operation: Operation; message: string } | null>(null);
  const [lastSuccess, setLastSuccess] = useState<number | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [previewing, setPreviewing] = useState(new Set<string>());
  const selectionAnchor = useRef<string | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [deleting, setDeleting] = useState<{ path: string; fullPath: string } | null>(null);
  const [dropNotice, setDropNotice] = useState<{ path: string; message: string; error: boolean } | null>(null);
  const lock = useRef(false);
  const queued = useRef<Array<{ operation: Operation; refresh: boolean }>>([]);
  const dragSource = useRef<{ path: string; directory: boolean } | null>(null);
  const projectMenu = useSshProjectMenu(project, connection);
  const enabled = connection?.enabled !== false;
  const batch = useSshFileBatch(project, actions, enabled);
  const drag = useSidebarStructureDrag({
    actions,
    disabled: !enabled,
    getPayload: () => dragSource.current ? downloadDragged(dragSource.current) : null,
    state,
  });
  const health = useSshStatus(project.host);
  const status = !enabled ? "Disabled" : pending ? "Connecting…" : failure ? "Connection or file error" : (health ? health.available : !!lastSuccess) ? "Available" : "Connects when needed";
  const hoverCard = useSidebarHoverCard(sshProjectHoverCard({ project, status, available: enabled && !!(health ? health.available : !!lastSuccess) && !failure, failed: !!failure }));
  async function run(operation: Operation, refresh = false) {
    if (operation.type === "preview") {
      if (!enabled) return;
      setPreviewing(previous => new Set([...previous, operation.path]));
      try {
        await onOpen([await sshPreview(project, operation.path)]);
        saveSshProject({ ...project, openedAt: Date.now() });
        setLastSuccess(Date.now());
      } catch (error) { setFailure({ operation, message: String(error) }); }
      finally { setPreviewing(previous => new Set([...previous].filter(path => path !== operation.path))); }
      return;
    }
    if (lock.current) {
      const existing = queued.current.find(item => item.operation.type === operation.type && item.operation.path === operation.path);
      if (existing) existing.refresh ||= refresh;
      else queued.current.push({ operation, refresh });
      return;
    }
    lock.current = true;
    try {
      if (!enabled) { setFailure({ operation, message: "Enable this connection in Settings → Connections." }); return; }
      const cached = directories.get(operation.path);
      if (operation.type === "list" && !refresh && cached && Date.now() - cached.time < 30000) { setFailure(null); return; }
      setPending(operation); setFailure(null);
      if (operation.type === "list") {
        const value = await sshList(project.host, project.root, operation.path, true);
        const records = [value, ...(value.discovered ?? [])];
        setDirectories(previous => {
          const next = new Map(previous);
          for (const record of records) {
            const { discovered: _discovered, expanded: _expanded, ...listing } = record;
            next.delete(record.path);
            // A subfolder cut short by the shared scan budget is stale, so opening it searches it again.
            next.set(record.path, { time: record === value || !record.truncated ? Date.now() : 0, value: listing });
          }
          while (next.size > 128) {
            const candidates = [...next.keys()].filter(path => path !== "." && path !== operation.path && !operation.path.startsWith(`${path}/`));
            const evicted = candidates.find(path => !expanded.has(path)) ?? candidates[0];
            if (!evicted) break;
            next.delete(evicted);
            setExpanded(current => new Set([...current].filter(path => path !== evicted && !path.startsWith(`${evicted}/`))));
          }
          return next;
        });
        // Discovery warms listings; only an explicit click expands a folder.
        // A late scan must not reopen folders the user has just collapsed.
      }
      setLastSuccess(Date.now());
    } catch (error) { setFailure({ operation, message: String(error) }); }
    finally { release(); }
  }
  function release() {
    lock.current = false; setPending(null);
    const next = queued.current.shift();
    if (next) void run(next.operation, next.refresh);
  }
  // A dropped folder brings the structures discovery finds in it, like expanding it would.
  async function downloadDragged({ path, directory }: { path: string; directory: boolean }): Promise<StructureDragPayload | null> {
    if (lock.current) return null;
    lock.current = true;
    setPending({ type: "preview", path }); setDropNotice(null);
    try {
      let files = [path];
      if (directory) {
        const listing = await sshList(project.host, project.root, path, true);
        files = [listing, ...(listing.discovered ?? [])].flatMap(record => record.entries
          .filter(entry => !entry.directory)
          .map(entry => record.path === "." ? entry.name : `${record.path}/${entry.name}`));
        if (!files.length) throw new Error("No chemical structures found in this folder");
        if (files.length > MAX_DROPPED_REMOTE_FILES) {
          setDropNotice({ path, message: `Added the first ${MAX_DROPPED_REMOTE_FILES} of ${files.length} structures`, error: false });
          files = files.slice(0, MAX_DROPPED_REMOTE_FILES);
        }
      }
      if (!directory && selected.has(path)) files = [...selected];
      if (files.length > MAX_DROPPED_REMOTE_FILES) throw new Error(`Drag up to ${MAX_DROPPED_REMOTE_FILES} files at a time.`);
      const paths = await Promise.all(files.map(file => sshPreview(project, file)));
      setLastSuccess(Date.now());
      return {
        paths,
        records: [],
        items: files.map((file, index) => ({ kind: "file" as const, title: file.split("/").pop() ?? file, detail: file, path: paths[index] })),
      };
    } catch (error) {
      setDropNotice({ path, message: String(error), error: true });
      return null;
    } finally { release(); }
  }
  function startDrag(event: ReactMouseEvent<HTMLElement>, path: string, directory: boolean) {
    dragSource.current = { path, directory };
    drag.onMouseDown(event);
  }
  function dropStatus(path: string) {
    if (dropNotice?.path !== path) return null;
    return dropNotice.error
      ? <div className="ssh-tree-error" role="alert">{dropNotice.message}</div>
      : <span className="ssh-tree-status" role="status">{dropNotice.message}</span>;
  }
  // A secondary click opens the same menu as the row's options button, like local folders.
  function showMenu(items: MenuItemSpec[]) {
    return (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void showNativeContextMenu(items, { x: event.clientX, y: event.clientY });
    };
  }
  function toggle(path: string) {
    const opening = !expanded.has(path);
    setExpanded(previous => { const next = new Set(previous); if (opening) next.add(path); else next.delete(path); return next; });
    if (opening) void run({ type: "list", path });
  }
  function folderOpenItems(path: string): MenuItemSpec[] {
    return [
      { kind: "item", id: "open-folder-scene", text: "Open all in one scene", disabled: !enabled, action: () => void batch.open([], "scene", path) },
      { kind: "item", id: "open-folder-tabs", text: "Open all in separate tabs", disabled: !enabled, action: () => void batch.open([], "tabs", path) },
      { kind: "checkbox", id: "watch-folder-scene", text: "Watch folder in one scene", checked: batch.watching === path, disabled: !enabled, action: () => batch.watching === path ? batch.stop() : void batch.open([], "scene", path, true) },
      { kind: "separator" },
    ];
  }
  function fileItems(path: string): MenuItemSpec[] {
    const paths = selected.has(path) ? [...selected] : [path];
    return [
      { kind: "item", id: "open-selected-scene", text: "Open selected in one scene", disabled: !enabled, action: () => void batch.open(paths, "scene") },
      { kind: "item", id: "open-selected-tabs", text: "Open selected in separate tabs", disabled: !enabled, action: () => void batch.open(paths, "tabs") },
    ];
  }
  function visibleFiles(path = "."): string[] {
    if (!expanded.has(path)) return [];
    return (directories.get(path)?.value.entries.slice(0, limits[path] ?? 100) ?? []).flatMap(entry => {
      const child = path === "." ? entry.name : `${path}/${entry.name}`;
      return entry.directory ? visibleFiles(child) : [child];
    });
  }
  function selectFile(path: string, event: ReactMouseEvent<HTMLElement>) {
    if (event.shiftKey) {
      const visible = visibleFiles();
      const from = visible.indexOf(selectionAnchor.current ?? path), to = visible.indexOf(path);
      const range = from < 0 || to < 0 ? [path] : visible.slice(Math.min(from, to), Math.max(from, to) + 1);
      selectionAnchor.current ??= path;
      setSelected(previous => new Set([...(event.metaKey || event.ctrlKey ? previous : []), ...range]));
    } else if (event.metaKey || event.ctrlKey) {
      selectionAnchor.current = path;
      setSelected(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; });
    } else {
      selectionAnchor.current = path;
      setSelected(new Set([path]));
      void run({ type: "preview", path });
    }
  }
  function children(path: string): ReactNode {
    if (!expanded.has(path)) return null;
    const cached = directories.get(path);
    const directory = cached?.value;
    return <div className={path === "." ? "project-children" : "project-folder-children"} role="group">
      {pending?.type === "list" && pending.path === path && <span className="ssh-tree-status inline-flex items-center"><Spinner aria-label="Loading folder" /></span>}
      {failure?.operation.path === path && <div className="ssh-tree-error" role="alert">{failure.message}<button onClick={() => void run(failure.operation, true)}>Retry</button></div>}
      {directory?.entries.slice(0, limits[path] ?? 100).map(entry => {
        const child = path === "." ? entry.name : `${path}/${entry.name}`;
        const kind = fileKindForPath(entry.name);
        const folderItems: MenuItemSpec[] = [
          ...folderOpenItems(child),
          { kind: "item", id: "refresh", text: "Refresh folder", disabled: !!pending, action: () => { setExpanded(previous => new Set([...previous, child])); void run({ type: "list", path: child }, true); } },
          { kind: "item", id: "collapse", text: "Collapse folder", disabled: !expanded.has(child), action: () => setExpanded(previous => new Set([...previous].filter(path => path !== child && !path.startsWith(`${child}/`)))) },
          { kind: "item", id: "add", text: "Add as project", action: () => { try { saveSshProject({ id: crypto.randomUUID(), name: entry.name, host: project.host, root: `${directory!.root.replace(/\/$/, "")}/${child}` }); } catch (error) { setFailure({ operation: { type: "list", path }, message: String(error) }); } } },
          { kind: "item", id: "copy", text: "Copy path", action: () => { copyTextWithSelectionFallback(`${directory!.root.replace(/\/$/, "")}/${child}`); } },
          { kind: "separator" },
          { kind: "item", id: "delete", text: "Delete folder from server…", variant: "destructive", disabled: !!pending, action: () => setDeleting({ path: child, fullPath: `${directory!.root.replace(/\/$/, "")}/${child}` }) },
        ];
        return entry.directory ? <div className="project-folder-node" key={child}>
          <div className="project-folder-row" role="treeitem" tabIndex={0} aria-expanded={expanded.has(child)} aria-label={entry.name} onContextMenu={showMenu(folderItems)} onMouseDown={event => startDrag(event, child, true)} onClickCapture={drag.onClickCapture} onClick={() => toggle(child)} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); toggle(child); } }}>
            <SidebarFolderIcon expanded={expanded.has(child)} /><MarqueeName className="project-folder-name">{entry.name}</MarqueeName>
            {pending?.type === "preview" && pending.path === child && <span className="ssh-activity" aria-label="Downloading" />}
            <span className="project-group-actions" onClick={event => event.stopPropagation()}>
              <button type="button" className="project-group-menu-button" aria-label={`${expanded.has(child) ? "Collapse" : "Expand"} ${entry.name}`} onClick={() => { if (expanded.has(child)) setExpanded(previous => new Set([...previous].filter(path => path !== child && !path.startsWith(`${child}/`)))); else toggle(child); }}><FolderExpandCollapseIcon collapse={expanded.has(child)} /></button>
              <NativeDropdownMenu items={folderItems} trigger={<button className="project-group-menu-button" aria-label={`Options for ${entry.name}`}><DotsHorizontal size={14} /></button>} />
            </span>
          </div>{dropStatus(child)}{children(child)}
        </div> : <div key={child}>
          <button className={`project${selected.has(child) ? " active" : ""}`} role="treeitem" aria-selected={selected.has(child)} data-sidebar-structure-path={`ssh://${project.host}/${project.root}/${child}`} disabled={!enabled} onContextMenu={showMenu(fileItems(child))} onMouseDown={event => startDrag(event, child, false)} onClickCapture={drag.onClickCapture} onClick={event => selectFile(child, event)}>
            <span className="project-icon" data-file-kind={kind} aria-hidden="true"><FileKindIcon kind={kind} /></span><MarqueeName className="project-name">{entry.name}</MarqueeName>
            {previewing.has(child) && <span className="ssh-activity" aria-label="Downloading" />}
          </button>
          {failure?.operation.path === child && <div className="ssh-tree-error" role="alert">{failure.message}<button onClick={() => void run(failure.operation, true)}>Retry</button></div>}
          {dropStatus(child)}
        </div>;
      })}
      {directory && directory.entries.length > (limits[path] ?? 100) && <button className="project-show-more" onClick={() => setLimits(previous => ({ ...previous, [path]: (previous[path] ?? 100) + 100 }))}>Show more ({directory.entries.length - (limits[path] ?? 100)})</button>}
      {directory && !directory.entries.length && !directory.truncated && <span className="ssh-tree-status">No chemical structures found</span>}
      {directory?.truncated && (cached?.time
        ? <span className="ssh-tree-status">Only the first 2,000 items in this folder were checked.</span>
        : <div className="ssh-tree-status">Search stopped before the end of this folder.<button onClick={() => void run({ type: "list", path }, true)}>Search this folder</button></div>)}
      {directory?.partial && !directory.truncated && <span className="ssh-tree-status">Some folders weren't fully searched. Open one to search it.</span>}
    </div>;
  }
  const projectItems: MenuItemSpec[] = [
    ...folderOpenItems("."),
    { kind: "item", id: "refresh", text: "Refresh", disabled: !!pending, action: () => { setExpanded(new Set(["."])); void run({ type: "list", path: "." }, true); } },
    ...projectMenu.items,
  ];
  return <div className="project-group ssh-project-tree">
    <div className="project-group-row ssh-project-row" {...hoverCard} role="treeitem" tabIndex={0} aria-expanded={expanded.has(".")} aria-label={project.name} onContextMenu={showMenu(projectItems)} onClick={() => toggle(".")} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); toggle("."); } }}>
      <SidebarFolderIcon expanded={expanded.has(".")} badge={connection?.color ?? "cyan"} />
      <span className="project-group-copy"><span className="project-group-title">{project.name}</span></span>
      <span className="ssh-host-name">{connection?.name ?? project.host}</span>
      <span className={`ssh-connection-dot${enabled && (health ? health.available : !!lastSuccess) && !failure ? " available" : failure ? " failed" : ""}${pending ? " ssh-activity" : ""}`} aria-label={status} />
      <span className="project-group-actions" onClick={event => event.stopPropagation()}>
        <button type="button" className="project-group-menu-button" aria-label={`${expanded.has(".") ? "Collapse" : "Expand"} ${project.name}`} onClick={() => { if (expanded.has(".")) setExpanded(new Set()); else toggle("."); }}><FolderExpandCollapseIcon collapse={expanded.has(".")} /></button>
        <NativeDropdownMenu items={projectItems} trigger={<button className="project-group-menu-button" aria-label={`Options for ${project.name}`}><DotsHorizontal size={14} /></button>} />
      </span>
    </div>
    {projectMenu.dialog}
    {selected.size > 1 && <div className="ssh-tree-status flex items-center gap-2" aria-label="Selected remote files">
      <span>{selected.size} selected</span><Button size="xs" variant="ghost" onClick={() => void batch.open([...selected], "scene")}>Open together</Button>
    </div>}
    {(batch.progress || batch.busy || batch.watching || batch.error) && <div className="ssh-tree-status" aria-live="polite">
      {batch.busy ? <span>{batch.progress ? `${batch.progress.completed} / ${batch.progress.total} files` : "Reading folder…"}</span> : batch.watching ? <span>Watching {batch.watching === "." ? project.name : batch.watching}</span> : batch.progress ? <span>{batch.progress.opened} opened{batch.progress.cancelled ? " · Cancelled" : ""}</span> : null}
      {(batch.busy || batch.watching) && <Button size="xs" variant="ghost" onClick={batch.stop}>{batch.watching ? "Stop watching" : "Cancel"}</Button>}
      {batch.error && <div role="alert">{batch.error}</div>}
      {!!batch.progress?.failures.length && <details><summary>{batch.progress.failures.length} files could not open</summary>{batch.progress.failures.map(failure => <div key={failure.path}>{failure.path}: {failure.message}</div>)}</details>}
    </div>}
    {children(".")}
    {deleting && <SshDeleteFolderDialog project={project} path={deleting.path} fullPath={deleting.fullPath} onClose={() => setDeleting(null)} onDeleted={() => {
      const removed = deleting.path;
      setDirectories(previous => new Map([...previous].filter(([path]) => path !== removed && !path.startsWith(`${removed}/`)).map(([path, cached]) => [path, { ...cached, time: 0, value: { ...cached.value, entries: cached.value.entries.filter(entry => (path === "." ? entry.name : `${path}/${entry.name}`) !== removed) } }])));
      setExpanded(previous => new Set([...previous].filter(path => path !== removed && !path.startsWith(`${removed}/`))));
    }} />}

  </div>;
}
