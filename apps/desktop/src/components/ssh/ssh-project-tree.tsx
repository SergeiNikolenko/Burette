import { SshProjectCard, useSshProjectMenu } from "./ssh-project-details";
import { useSshStatus } from "../../lib/ssh-connection-status";
import { SshDeleteFolderDialog } from "./ssh-delete-folder-dialog";
import { FolderExpandCollapseIcon } from "../sidebar/folder-expand-collapse-icon";
import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { MarqueeName } from "../marquee-name";
import { SidebarFolderIcon } from "../sidebar/sidebar-folder-icon";
import { FileKindIcon, fileKindForPath } from "../sidebar/file-kind-icon";
import { DotsHorizontal } from "../ui/app-icons";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "../ui/hover-card";
import { NativeDropdownMenu } from "../native-dropdown-menu";
import { saveSshProject, sshList, sshPreview, type SshConnection, type SshDirectory, type SshProject } from "../../lib/ssh-projects";
import type { StructureDragPayload } from "../../lib/structure-drag";
import { useSidebarStructureDrag } from "../sidebar/use-sidebar-structure-drag";
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
  const [selected, setSelected] = useState("");
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [deleting, setDeleting] = useState<{ path: string; fullPath: string } | null>(null);
  const [dropNotice, setDropNotice] = useState<{ path: string; message: string; error: boolean } | null>(null);
  const lock = useRef(false);
  const queued = useRef<Array<{ operation: Operation; refresh: boolean }>>([]);
  const dragSource = useRef<{ path: string; directory: boolean } | null>(null);
  const projectMenu = useSshProjectMenu(project, connection);
  const enabled = connection?.enabled !== false;
  const drag = useSidebarStructureDrag({
    actions,
    disabled: !enabled,
    getPayload: () => dragSource.current ? downloadDragged(dragSource.current) : null,
    state,
  });
  const health = useSshStatus(project.host);
  const status = !enabled ? "Disabled" : pending ? "Connecting…" : failure ? "Connection or file error" : (health ? health.available : !!lastSuccess) ? "Available" : "Connects when needed";
  async function run(operation: Operation, refresh = false) {
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
        setExpanded(previous => {
          if (!previous.has(operation.path)) return previous;
          return new Set([...previous, ...(value.expanded ?? [])]);
        });
      } else {
        await onOpen([await sshPreview(project, operation.path)]);
        setSelected(operation.path);
        saveSshProject({ ...project, openedAt: Date.now() });
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
      const paths: string[] = [];
      for (const file of files) paths.push(await sshPreview(project, file));
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
  function toggle(path: string) {
    const opening = !expanded.has(path);
    setExpanded(previous => { const next = new Set(previous); if (opening) next.add(path); else next.delete(path); return next; });
    if (opening) void run({ type: "list", path });
  }
  function children(path: string): ReactNode {
    if (!expanded.has(path)) return null;
    const cached = directories.get(path);
    const directory = cached?.value;
    return <div className={path === "." ? "project-children" : "project-folder-children"} role="group">
      {pending?.type === "list" && pending.path === path && <span className="ssh-tree-status" role="status">Loading…</span>}
      {failure?.operation.path === path && <div className="ssh-tree-error" role="alert">{failure.message}<button onClick={() => void run(failure.operation, true)}>Retry</button></div>}
      {directory?.entries.slice(0, limits[path] ?? 100).map(entry => {
        const child = path === "." ? entry.name : `${path}/${entry.name}`;
        const kind = fileKindForPath(entry.name);
        return entry.directory ? <div className="project-folder-node" key={child}>
          <div className="project-folder-row" role="treeitem" tabIndex={0} aria-expanded={expanded.has(child)} aria-label={entry.name} onMouseDown={event => startDrag(event, child, true)} onClickCapture={drag.onClickCapture} onClick={() => toggle(child)} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); toggle(child); } }}>
            <SidebarFolderIcon expanded={expanded.has(child)} /><MarqueeName className="project-folder-name">{entry.name}</MarqueeName>
            {pending?.type === "preview" && pending.path === child && <span className="ssh-activity" aria-label="Downloading" />}
            <span className="project-group-actions" onClick={event => event.stopPropagation()}>
              <button type="button" className="project-group-menu-button" aria-label={`${expanded.has(child) ? "Collapse" : "Expand"} ${entry.name}`} onClick={() => { if (expanded.has(child)) setExpanded(previous => new Set([...previous].filter(path => path !== child && !path.startsWith(`${child}/`)))); else toggle(child); }}><FolderExpandCollapseIcon collapse={expanded.has(child)} /></button>
              <NativeDropdownMenu items={[
                { kind: "item", id: "refresh", text: "Refresh folder", disabled: !!pending, action: () => { setExpanded(previous => new Set([...previous, child])); void run({ type: "list", path: child }, true); } },
                { kind: "item", id: "collapse", text: "Collapse folder", disabled: !expanded.has(child), action: () => setExpanded(previous => new Set([...previous].filter(path => path !== child && !path.startsWith(`${child}/`)))) },
                { kind: "item", id: "add", text: "Add as project", action: () => { try { saveSshProject({ id: crypto.randomUUID(), name: entry.name, host: project.host, root: `${directory!.root.replace(/\/$/, "")}/${child}` }); } catch (error) { setFailure({ operation: { type: "list", path }, message: String(error) }); } } },
                { kind: "item", id: "copy", text: "Copy path", action: () => { copyTextWithSelectionFallback(`${directory!.root.replace(/\/$/, "")}/${child}`); } },
                { kind: "separator" },
                { kind: "item", id: "delete", text: "Delete folder from server…", disabled: !!pending, action: () => setDeleting({ path: child, fullPath: `${directory!.root.replace(/\/$/, "")}/${child}` }) },
              ]} trigger={<button className="project-group-menu-button" aria-label={`Options for ${entry.name}`}><DotsHorizontal size={14} /></button>} />
            </span>
          </div>{dropStatus(child)}{children(child)}
        </div> : <div key={child}>
          <button className={`project${selected === child ? " active" : ""}`} role="treeitem" aria-selected={selected === child} data-sidebar-structure-path={`ssh://${project.host}/${project.root}/${child}`} disabled={pending?.type === "preview"} onMouseDown={event => startDrag(event, child, false)} onClickCapture={drag.onClickCapture} onClick={() => void run({ type: "preview", path: child })}>
            <span className="project-icon" data-file-kind={kind} aria-hidden="true"><FileKindIcon kind={kind} /></span><MarqueeName className="project-name">{entry.name}</MarqueeName>
            {pending?.path === child && <span className="ssh-activity" aria-label="Downloading" />}
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
  return <div className="project-group ssh-project-tree">
    <HoverCard openDelay={500}>
      <HoverCardTrigger asChild>
        <div className="project-group-row ssh-project-row" role="treeitem" tabIndex={0} aria-expanded={expanded.has(".")} aria-label={project.name} onClick={() => toggle(".")} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); toggle("."); } }}>
          <SidebarFolderIcon expanded={expanded.has(".")} badge={connection?.color ?? "cyan"} />
          <span className="project-group-copy"><span className="project-group-title">{project.name}</span></span>
          <span className="ssh-host-name">{connection?.name ?? project.host}</span>
          <span className={`ssh-connection-dot${enabled && (health ? health.available : !!lastSuccess) && !failure ? " available" : failure ? " failed" : ""}${pending ? " ssh-activity" : ""}`} aria-label={status} />
          <span className="project-group-actions" onClick={event => event.stopPropagation()}>
            <button type="button" className="project-group-menu-button" aria-label={`${expanded.has(".") ? "Collapse" : "Expand"} ${project.name}`} onClick={() => { if (expanded.has(".")) setExpanded(new Set()); else toggle("."); }}><FolderExpandCollapseIcon collapse={expanded.has(".")} /></button>
            <NativeDropdownMenu items={[
              { kind: "item", id: "refresh", text: "Refresh", disabled: !!pending, action: () => { setExpanded(new Set(["."])); void run({ type: "list", path: "." }, true); } },
              ...projectMenu.items,
            ]} trigger={<button className="project-group-menu-button" aria-label={`Options for ${project.name}`}><DotsHorizontal size={14} /></button>} />
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="ssh-project-card">
        <SshProjectCard project={project} connection={connection} status={status} available={enabled && !!(health ? health.available : !!lastSuccess) && !failure} />
      </HoverCardContent>
    </HoverCard>
    {projectMenu.dialog}
    {children(".")}
    {deleting && <SshDeleteFolderDialog project={project} path={deleting.path} fullPath={deleting.fullPath} onClose={() => setDeleting(null)} onDeleted={() => {
      const removed = deleting.path;
      setDirectories(previous => new Map([...previous].filter(([path]) => path !== removed && !path.startsWith(`${removed}/`)).map(([path, cached]) => [path, { ...cached, time: 0, value: { ...cached.value, entries: cached.value.entries.filter(entry => (path === "." ? entry.name : `${path}/${entry.name}`) !== removed) } }])));
      setExpanded(previous => new Set([...previous].filter(path => path !== removed && !path.startsWith(`${removed}/`))));
    }} />}

  </div>;
}
