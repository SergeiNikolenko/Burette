import type { ProjectOrganization, ProjectSort } from "../sidebar/project-organization";
import { RemoteProject } from "./ssh-project-tree";
import { Switch } from "../ui/switch";
import { useEffect, useRef, useState } from "react";
import { FolderPlus, SidebarGlobe, DotsHorizontal, Plus } from "../ui/app-icons";
import { Button } from "../ui/button";
import { NativeDropdownMenu } from "../native-dropdown-menu";
import { SshProjectDialog } from "./ssh-project-dialog";
import { removeSshConnection, saveSshConnection, sshList, useSshProjects, useSshConnections, type SshConnection } from "../../lib/ssh-projects";

export function SshProjects({ onOpen, query = "", organization = "project", sort = "manual" }: { onOpen: (paths: string[]) => void | Promise<void>; query?: string; organization?: ProjectOrganization; sort?: ProjectSort }) {
  const projects = useSshProjects();
  const connections = useSshConnections();
  const checked = useRef(new Set<string>());
  useEffect(() => { for (const connection of connections) if (!connection.color) saveSshConnection(connection); }, [connections]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const host of new Set(projects.map(p => p.host))) {
        if (cancelled) return;
        if (checked.current.has(host) || connections.find(c => c.host === host)?.enabled === false) continue;
        checked.current.add(host);
        try { await sshList(host, "~"); } catch { /* The shared connection status exposes the failure. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [projects, connections]);
  const visible = projects.filter(p => `${p.name} ${p.host} ${p.root}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "recent" ? (b.openedAt ?? 0) - (a.openedAt ?? 0) : sort === "priority" ? Number(!!b.pinned) - Number(!!a.pinned) : 0);
  const groups = new Map<string, typeof projects>();
  for (const project of visible) {
    const group = organization === "connection" ? connections.find(c => c.host === project.host)?.name ?? project.host : organization === "flat" ? "" : project.pinned ? "Pinned projects" : project.section ?? "";
    groups.set(group, [...(groups.get(group) ?? []), project]);
  }
  return <>{[...groups].sort(([a], [b]) => Number(b === "Pinned projects") - Number(a === "Pinned projects")).map(([name, items]) => <div key={name} className="ssh-project-section" role="group" aria-label={name || "Remote projects"}>
    {name && <div className="ssh-project-section-title">{name}</div>}
    {items.map(project => <RemoteProject key={`${project.id}:${project.host}:${project.root}`} project={project} connection={connections.find(c => c.host === project.host)} onOpen={onOpen} />)}
  </div>)}</>;
}
export function SshConnections() {
  const [adding, setAdding] = useState(false);
  const [folderHost, setFolderHost] = useState<string | null>(null);
  const connections = useSshConnections();
  return <section className="grid gap-5">
    <div className="flex items-center justify-between"><h2>SSH connections from this Mac</h2><Button onClick={() => setAdding(true)}><Plus size={16} /> Add</Button></div>
    <div className="rounded-2xl border border-border divide-y divide-border">{connections.map(connection => <ConnectionRow key={connection.host} connection={connection} onAddFolder={() => setFolderHost(connection.host)} />)}{!connections.length && <p className="p-6 text-sm text-muted-foreground">Add a machine to browse remote structures.</p>}</div>
    <p className="text-sm text-muted-foreground">SSH sessions open on demand. Changes to a preview copy stay on this Mac. Deleting a remote folder requires confirmation.</p>
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
