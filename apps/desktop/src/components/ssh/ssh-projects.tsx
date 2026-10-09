import type { ProjectOrganization, ProjectSort } from "../sidebar/project-organization";
import { RemoteProject } from "./ssh-project-tree";
import { useEffect, useRef, useState } from "react";
import { SshConnectionsList } from "./ssh-connections-list";
import { SshProjectDialog } from "./ssh-project-dialog";
import { removeSshConnection, saveSshConnection, sshList, useSshProjects, useSshConnections } from "../../lib/ssh-projects";
import type { ShellActions, ShellViewState } from "../types";

export function SshProjects({ actions, state, query = "", organization = "project", sort = "manual", section }: { actions: ShellActions; state: ShellViewState; query?: string; organization?: ProjectOrganization; sort?: ProjectSort; section?: "pinned" | "recent" }) {
  const projects = useSshProjects();
  const connections = useSshConnections();
  const checked = useRef(new Set<string>());
  useEffect(() => { for (const connection of connections) if (!connection.color) saveSshConnection(connection); }, [connections]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const host of new Set(projects.filter(p => !section || !!p.pinned === (section === "pinned")).map(p => p.host))) {
        if (cancelled) return;
        if (checked.current.has(host) || connections.find(c => c.host === host)?.enabled === false) continue;
        checked.current.add(host);
        try { await sshList(host, "~"); } catch { /* The shared connection status exposes the failure. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [projects, connections, section]);
  const visible = projects.filter(p => (!section || !!p.pinned === (section === "pinned")) && `${p.name} ${p.host} ${p.root}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "recent" ? (b.openedAt ?? 0) - (a.openedAt ?? 0) : sort === "priority" ? Number(!!b.pinned) - Number(!!a.pinned) : 0);
  const groups = new Map<string, typeof projects>();
  for (const project of visible) {
    const group = organization === "connection" ? connections.find(c => c.host === project.host)?.name ?? project.host : organization === "flat" ? "" : project.pinned && !section ? "Pinned projects" : project.section ?? "";
    groups.set(group, [...(groups.get(group) ?? []), project]);
  }
  return <>{[...groups].sort(([a], [b]) => Number(b === "Pinned projects") - Number(a === "Pinned projects")).map(([name, items]) => <div key={name} className="ssh-project-section" role="group" aria-label={name || "Remote projects"}>
    {name && <div className="ssh-project-section-title">{name}</div>}
    {items.map(project => <RemoteProject key={`${project.id}:${project.host}:${project.root}`} project={project} connection={connections.find(c => c.host === project.host)} onOpen={actions.openPaths} actions={actions} state={state} />)}
  </div>)}</>;
}
export function SshConnections() {
  const [adding, setAdding] = useState(false);
  const [folderHost, setFolderHost] = useState<string | null>(null);
  const connections = useSshConnections();
  return <>
    <SshConnectionsList connections={connections} onAdd={() => setAdding(true)}
      onEnabledChange={(connection, enabled) => saveSshConnection({ ...connection, enabled })}
      onCheck={host => sshList(host, "~")} onRemove={removeSshConnection} onAddFolder={setFolderHost} />
    {adding && <SshProjectDialog open onOpenChange={setAdding} connectionOnly />}
    {folderHost && <SshProjectDialog key={folderHost} open onOpenChange={() => setFolderHost(null)} initialHost={folderHost} />}
  </>;
}
