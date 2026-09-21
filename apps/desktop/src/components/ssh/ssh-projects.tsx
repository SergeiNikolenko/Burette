import { Switch } from "../ui/switch";
import { useState } from "react";
import { Folder, FolderPlus, SidebarGlobe, DotsHorizontal, Plus } from "../ui/app-icons";
import { Button } from "../ui/button";
import { NativeDropdownMenu } from "../native-dropdown-menu";
import { SshProjectDialog } from "./ssh-project-dialog";
import { removeSshProject, removeSshConnection, saveSshConnection, sshList, sshPreview, useSshProjects, useSshConnections, type SshConnection, type SshProject, type SshDirectory } from "../../lib/ssh-projects";

export function SshProjects({ onOpen, query = "" }: { onOpen: (paths: string[]) => void | Promise<void>; query?: string }) {
  const projects = useSshProjects();
  const connections = useSshConnections();
  return <>{projects.filter(p => `${p.name} ${p.host} ${p.root}`.toLowerCase().includes(query.toLowerCase())).map(project => <RemoteProject key={project.id} project={project} enabled={connections.find(c => c.host === project.host)?.enabled !== false} onOpen={onOpen} />)}</>;
}
function RemoteProject({ project, enabled, onOpen }: { project: SshProject; enabled: boolean; onOpen: (paths: string[]) => void | Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [directory, setDirectory] = useState<SshDirectory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedList, setFailedList] = useState(".");
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  async function load(path = ".") {
    setFailedList(path);
    if (!enabled) { setError("Connection is disabled. Enable it in Settings → Connections."); return; }
    setBusy(true); setError(""); setFailedPreview(null);
    try { setDirectory(await sshList(project.host, project.root, path)); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function preview(path: string) {
    if (!enabled) { setError("Connection is disabled. Enable it in Settings → Connections."); return; }
    setBusy(true); setError("");
    try { await onOpen([await sshPreview(project, path)]); }
    catch (e) { setError(String(e)); setFailedPreview(path); }
    finally { setBusy(false); }
  }
  return <div className="px-2 py-1" title={`${project.host}:${project.root}`}>
    <div className="flex items-center gap-1">
      <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); if (!expanded && !directory) void load(); }}>
        <SidebarGlobe size={15} /><span className="truncate">{project.name}</span>
      </button>
      <NativeDropdownMenu items={[
        { kind: "item", id: "refresh", text: "Refresh", action: () => { setExpanded(true); void load(directory?.path); } },
        { kind: "item", id: "remove", text: "Remove from Burette", action: () => removeSshProject(project.id) },
      ]} trigger={<button className="sidebar-section-menu-button opacity-100!" aria-label={`Options for ${project.name}`}><DotsHorizontal size={14} /></button>} />
    </div>
    {expanded && <div className="pl-3 text-sm">
      <div className="px-2 pb-1 text-xs text-muted-foreground">{project.host}{busy ? " · Loading…" : ""}</div>
      {error && <div role="alert" className="p-2 text-xs text-destructive break-words">{error}<button className="block underline" disabled={busy} onClick={() => { if (failedPreview) void preview(failedPreview); else void load(failedList); }}>Retry</button></div>}
      {directory && <>
        {directory.path !== "." && <button disabled={busy} className="px-2 py-1" onClick={() => void load(directory.path.split("/").slice(0, -1).join("/") || ".")}>Up one folder</button>}
        {directory.entries.map(entry => <button key={entry.name} disabled={busy} className="flex w-full items-center gap-2 truncate rounded-md px-2 py-1 text-left hover:bg-muted disabled:opacity-50" onClick={() => {
          const path = directory.path === "." ? entry.name : `${directory.path}/${entry.name}`;
          if (entry.directory) void load(path); else void preview(path);
        }}>{entry.directory && <Folder size={14} />}<span className="truncate">{entry.name}</span></button>)}
        {!directory.entries.length && <p className="p-2 text-muted-foreground">Empty folder</p>}
        {directory.truncated && <p className="p-2 text-xs">First 2,000 entries shown.</p>}
      </>}
    </div>}
  </div>;
}
export function SshConnections() {
  const [adding, setAdding] = useState(false);
  const [folderHost, setFolderHost] = useState<string | null>(null);
  const connections = useSshConnections();
  return <section className="grid gap-5">
    <div className="flex items-center justify-between"><h2>SSH connections from this Mac</h2><Button onClick={() => setAdding(true)}><Plus size={16} /> Add</Button></div>
    <div className="rounded-2xl border border-border divide-y divide-border">{connections.map(connection => <ConnectionRow key={connection.host} connection={connection} onAddFolder={() => setFolderHost(connection.host)} />)}{!connections.length && <p className="p-6 text-sm text-muted-foreground">Add a machine to browse remote structures.</p>}</div>
    <p className="text-sm text-muted-foreground">SSH sessions open on demand. Remote files are read-only; changes to a preview copy stay on this Mac.</p>
    {adding && <SshProjectDialog open onOpenChange={setAdding} connectionOnly />}
    {folderHost && <SshProjectDialog key={folderHost} open onOpenChange={() => setFolderHost(null)} initialHost={folderHost} />}
  </section>;
}
function ConnectionRow({ connection, onAddFolder }: { connection: SshConnection; onAddFolder: () => void }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true); setStatus("Connecting…");
    try { await sshList(connection.host, "~"); setStatus("Available · checked just now"); }
    catch (e) { setStatus(String(e)); }
    finally { setBusy(false); }
  }
  return <div className="flex items-start gap-3 p-4">
    <Switch className="mt-1" aria-label={`Enable ${connection.name}`} checked={connection.enabled} disabled={busy} onCheckedChange={enabled => { saveSshConnection({ ...connection, enabled }); setStatus(""); }} />
    <SidebarGlobe size={18} className="mt-1" />
    <div className="min-w-0 flex-1"><div>{connection.name}</div><p className="truncate text-sm text-muted-foreground">{connection.host}</p><p className="break-words text-xs text-muted-foreground" role="status">{!connection.enabled ? "Disabled" : status || "Connects when needed"}</p></div>
    <NativeDropdownMenu items={[
      { kind: "item", id: "check", text: "Check connection", disabled: busy || !connection.enabled, action: () => void check() },
      { kind: "item", id: "remove", text: "Remove connection and projects", disabled: busy, action: () => removeSshConnection(connection.host) },
    ]} trigger={<Button variant="ghost" size="icon" aria-label={`Options for ${connection.name}`}><DotsHorizontal size={16} /></Button>} />
    <Button variant="ghost" size="icon" disabled={!connection.enabled || busy} onClick={onAddFolder} aria-label={`Add folder from ${connection.name}`}><FolderPlus size={18} /></Button>
  </div>;
}
