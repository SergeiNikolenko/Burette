import { RemoteProject } from "./ssh-project-tree";
import { Switch } from "../ui/switch";
import { useEffect, useState } from "react";
import { FolderPlus, SidebarGlobe, DotsHorizontal, Plus } from "../ui/app-icons";
import { Button } from "../ui/button";
import { NativeDropdownMenu } from "../native-dropdown-menu";
import { SshProjectDialog } from "./ssh-project-dialog";
import { removeSshConnection, saveSshConnection, sshList, useSshProjects, useSshConnections, type SshConnection } from "../../lib/ssh-projects";

export function SshProjects({ onOpen, query = "" }: { onOpen: (paths: string[]) => void | Promise<void>; query?: string }) {
  const projects = useSshProjects();
  const connections = useSshConnections();
  useEffect(() => { for (const connection of connections) if (!connection.color) saveSshConnection(connection); }, [connections]);
  return <>{projects.filter(p => `${p.name} ${p.host} ${p.root}`.toLowerCase().includes(query.toLowerCase())).map(project => <RemoteProject key={project.id} project={project} connection={connections.find(c => c.host === project.host)} onOpen={onOpen} />)}</>;
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
