import { useRef, useState, type ReactNode } from "react";
import { SidebarFolderIcon } from "../sidebar/sidebar-folder-icon";
import { FileKindIcon, fileKindForPath } from "../sidebar/file-kind-icon";
import { DotsHorizontal, SidebarGlobe } from "../ui/app-icons";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "../ui/hover-card";
import { NativeDropdownMenu } from "../native-dropdown-menu";
import { removeSshProject, saveSshProject, sshList, sshPreview, type SshConnection, type SshDirectory, type SshProject } from "../../lib/ssh-projects";

import { copyTextWithSelectionFallback } from "../../lib/clipboard";

type Operation = { type: "list" | "preview"; path: string };
export function RemoteProject({ project, connection, onOpen }: { project: SshProject; connection?: SshConnection; onOpen: (paths: string[]) => void | Promise<void> }) {
  const [expanded, setExpanded] = useState(new Set<string>());
  const [directories, setDirectories] = useState(new Map<string, { time: number; value: SshDirectory }>());
  const [pending, setPending] = useState<Operation | null>(null);
  const [failure, setFailure] = useState<{ operation: Operation; message: string } | null>(null);
  const [lastSuccess, setLastSuccess] = useState<number | null>(null);
  const [selected, setSelected] = useState("");
  const [limits, setLimits] = useState<Record<string, number>>({});
  const lock = useRef(false);
  const enabled = connection?.enabled !== false;
  const status = !enabled ? "Disabled" : pending ? "Connecting…" : failure ? "Connection or file error" : lastSuccess ? "Last request succeeded" : "Connects when needed";
  async function run(operation: Operation, refresh = false) {
    if (lock.current) return;
    if (!enabled) { setFailure({ operation, message: "Enable this connection in Settings → Connections." }); return; }
    const cached = directories.get(operation.path);
    if (operation.type === "list" && !refresh && cached && Date.now() - cached.time < 30000) { setFailure(null); return; }
    lock.current = true; setPending(operation); setFailure(null);
    try {
      if (operation.type === "list") {
        const value = await sshList(project.host, project.root, operation.path, true);
        const records = [value, ...(value.discovered ?? [])];
        setDirectories(previous => {
          const next = new Map(previous);
          for (const record of records) {
            const { discovered: _discovered, expanded: _expanded, ...listing } = record;
            next.delete(record.path);
            next.set(record.path, { time: Date.now(), value: listing });
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
      }
      setLastSuccess(Date.now());
    } catch (error) { setFailure({ operation, message: String(error) }); }
    finally { lock.current = false; setPending(null); }
  }
  function toggle(path: string) {
    const opening = !expanded.has(path);
    if (opening && lock.current && !directories.has(path)) return;
    setExpanded(previous => { const next = new Set(previous); if (opening) next.add(path); else next.delete(path); return next; });
    if (opening) void run({ type: "list", path });
  }
  function children(path: string): ReactNode {
    if (!expanded.has(path)) return null;
    const directory = directories.get(path)?.value;
    return <div className={path === "." ? "project-children" : "project-folder-children"} role="group">
      {pending?.type === "list" && pending.path === path && <span className="ssh-tree-status" role="status">Loading…</span>}
      {failure?.operation.path === path && <div className="ssh-tree-error" role="alert">{failure.message}<button onClick={() => void run(failure.operation, true)}>Retry</button></div>}
      {directory?.entries.slice(0, limits[path] ?? 100).map(entry => {
        const child = path === "." ? entry.name : `${path}/${entry.name}`;
        const kind = fileKindForPath(entry.name);
        return entry.directory ? <div className="project-folder-node" key={child}>
          <div className="project-folder-row" role="treeitem" tabIndex={0} aria-expanded={expanded.has(child)} aria-label={entry.name} onClick={() => toggle(child)} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); toggle(child); } }}>
            <SidebarFolderIcon expanded={expanded.has(child)} /><span className="project-folder-name">{entry.name}</span>
            <span className="project-group-actions" onClick={event => event.stopPropagation()}>
              <NativeDropdownMenu items={[
                { kind: "item", id: "refresh", text: "Refresh folder", disabled: !!pending, action: () => { setExpanded(previous => new Set([...previous, child])); void run({ type: "list", path: child }, true); } },
                { kind: "item", id: "collapse", text: "Collapse folder", disabled: !expanded.has(child), action: () => setExpanded(previous => new Set([...previous].filter(path => path !== child && !path.startsWith(`${child}/`)))) },
                { kind: "item", id: "add", text: "Add as project", action: () => { try { saveSshProject({ id: crypto.randomUUID(), name: entry.name, host: project.host, root: `${directory!.root.replace(/\/$/, "")}/${child}` }); } catch (error) { setFailure({ operation: { type: "list", path }, message: String(error) }); } } },
                { kind: "item", id: "copy", text: "Copy path", action: () => { copyTextWithSelectionFallback(`${directory!.root.replace(/\/$/, "")}/${child}`); } },
              ]} trigger={<button className="project-group-menu-button" aria-label={`Options for ${entry.name}`}><DotsHorizontal size={14} /></button>} />
            </span>
          </div>{children(child)}
        </div> : <div key={child}>
          <button className={`project${selected === child ? " active" : ""}`} role="treeitem" aria-selected={selected === child} data-sidebar-structure-path={`ssh://${project.host}/${project.root}/${child}`} disabled={pending?.type === "preview"} onClick={() => void run({ type: "preview", path: child })}>
            <span className="project-icon" data-file-kind={kind} aria-hidden="true"><FileKindIcon kind={kind} /></span><span className="project-name">{entry.name}</span>
            {pending?.path === child && <span className="ssh-activity" aria-label="Downloading" />}
          </button>
          {failure?.operation.path === child && <div className="ssh-tree-error" role="alert">{failure.message}<button onClick={() => void run(failure.operation, true)}>Retry</button></div>}
        </div>;
      })}
      {directory && directory.entries.length > (limits[path] ?? 100) && <button className="project-show-more" onClick={() => setLimits(previous => ({ ...previous, [path]: (previous[path] ?? 100) + 100 }))}>Show more ({directory.entries.length - (limits[path] ?? 100)})</button>}
      {directory && !directory.entries.length && <span className="ssh-tree-status">No chemical structures found</span>}
      {(directory?.partial || directory?.truncated) && <span className="ssh-tree-status">Search limit reached. Expand a folder to continue.</span>}
    </div>;
  }
  return <div className="project-group ssh-project-tree">
    <HoverCard openDelay={500}>
      <HoverCardTrigger asChild>
        <div className="project-group-row ssh-project-row" role="treeitem" tabIndex={0} aria-expanded={expanded.has(".")} aria-label={project.name} onClick={() => toggle(".")} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); toggle("."); } }}>
          <SidebarFolderIcon expanded={expanded.has(".")} badge={connection?.color ?? "cyan"} />
          <span className="project-group-copy"><span className="project-group-title">{project.name}</span></span>
          <span className="ssh-host-name">{connection?.name ?? project.host}</span>
          <span className={`ssh-connection-dot${enabled && lastSuccess && !failure ? " available" : failure ? " failed" : ""}${pending ? " ssh-activity" : ""}`} aria-label={status} />
          <span className="project-group-actions" onClick={event => event.stopPropagation()}>
            <NativeDropdownMenu items={[
              { kind: "item", id: "refresh", text: "Refresh", disabled: !!pending, action: () => { setDirectories(new Map()); setExpanded(new Set(["."])); void run({ type: "list", path: "." }, true); } },
              { kind: "item", id: "remove", text: "Remove from Burette", action: () => removeSshProject(project.id) },
            ]} trigger={<button className="project-group-menu-button" aria-label={`Options for ${project.name}`}><DotsHorizontal size={14} /></button>} />
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-80 grid gap-3 p-4">
        <div className="flex items-center gap-2"><SidebarFolderIcon expanded={false} badge={connection?.color ?? "cyan"} /><strong>{project.name}</strong></div>
        <div className="flex items-center gap-2"><SidebarGlobe size={16} />{connection?.name ?? project.host}</div>
        <div className="border-t border-border pt-3 text-muted-foreground">{status}</div>
        <div className="break-all text-muted-foreground">{project.root}</div>
      </HoverCardContent>
    </HoverCard>
    {children(".")}
  </div>;
}
