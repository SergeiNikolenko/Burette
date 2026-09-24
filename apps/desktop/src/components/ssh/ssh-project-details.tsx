import { useState } from "react";
import { Pin, PinFilled, SidebarGlobe, SidebarFolder } from "../ui/app-icons";
import { SidebarFolderIcon } from "../sidebar/sidebar-folder-icon";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import type { MenuItemSpec } from "../menu-types";
import { removeSshProject, saveSshConnection, saveSshProject, useSshProjects, type SshConnection, type SshProject } from "../../lib/ssh-projects";

export function SshProjectCard({ project, connection, status, available }: { project: SshProject; connection?: SshConnection; status: string; available: boolean }) {
  const Icon = project.pinned ? PinFilled : Pin;
  return <>
    <div className="ssh-card-title"><SidebarFolderIcon expanded={false} badge={connection?.color ?? "cyan"} /><span>{project.name}</span><button aria-label={project.pinned ? "Unpin project" : "Pin project"} onClick={() => saveSshProject({ ...project, pinned: !project.pinned })}><Icon size={16} /></button></div>
    <div className="ssh-card-line"><SidebarGlobe size={18} className={`project-folder-badge-${connection?.color ?? "cyan"}`} /><span>{connection?.name ?? project.host}</span></div>
    <div className="ssh-card-line ssh-card-status"><span className={`ssh-connection-dot${available ? " available" : ""}`} /><span>{status}</span></div>
    <div className="ssh-card-line"><SidebarFolder size={17} /><span className="break-all">{project.root}</span></div>
  </>;
}

export function useSshProjectMenu(project: SshProject, connection: SshConnection | undefined) {
  const projects = useSshProjects();
  const [editing, setEditing] = useState<"edit" | "section" | null>(null);
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const start = (mode: "edit" | "section") => { setName(mode === "edit" ? project.name : ""); setRoot(project.root); setError(""); setEditing(mode); };
  const items: MenuItemSpec[] = [
    { kind: "item", id: "pin", icon: "Pin", text: project.pinned ? "Unpin" : "Pin", action: () => saveSshProject({ ...project, pinned: !project.pinned }) },
    { kind: "item", id: "edit", icon: "SettingsCog", text: "Edit…", action: () => start("edit") },
    { kind: "separator" },
    { kind: "submenu", id: "section", icon: "SidebarFolder", text: "Section", items: [
      { kind: "checkbox", id: "none", text: "Projects", checked: !project.section, action: () => saveSshProject({ ...project, section: undefined }) },
      ...[...new Set(projects.map(p => p.section).filter((s): s is string => !!s))].map(section => ({ kind: "checkbox" as const, id: section, text: section, checked: project.section === section, action: () => saveSshProject({ ...project, section }) })),
      { kind: "separator" }, { kind: "item", id: "new-section", text: "New section…", action: () => start("section") },
    ] },
    { kind: "submenu", id: "color", icon: "SidebarGlobe", text: "Connection color", items: (["cyan", "blue", "purple"] as const).map(color => ({ kind: "checkbox", id: color, text: color[0].toUpperCase() + color.slice(1), checked: connection?.color === color, action: () => saveSshConnection({ ...connection, host: project.host, name: connection?.name ?? project.host, enabled: connection?.enabled ?? true, color }) })) },
    { kind: "separator" },
    { kind: "item", id: "remove", text: "Remove project", action: () => removeSshProject(project.id) },
  ];
  const dialog = editing && <Dialog open onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent className="ssh-dialog">
    <DialogHeader><DialogTitle>{editing === "edit" ? "Edit project" : "New section"}</DialogTitle><DialogDescription className="sr-only">Organize your remote project.</DialogDescription></DialogHeader>
    <label className="grid gap-2 text-sm">{editing === "edit" ? "Project name" : "Section name"}<Input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={160} /></label>
    {editing === "edit" && <label className="grid gap-2 text-sm">Folder on {connection?.name ?? project.host}<Input value={root} onChange={e => setRoot(e.target.value)} /></label>}
    {error && <p role="alert" className="ssh-dialog-error">{error}</p>}
    <div className="ssh-dialog-footer justify-end"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!name.trim() || !root.trim()} onClick={() => { try { saveSshProject(editing === "edit" ? { ...project, name: name.trim(), root: root.trim() } : { ...project, section: name.trim() }); setEditing(null); } catch (e) { setError(String(e)); } }}>Save</Button></div>
  </DialogContent></Dialog>;
  return { items, dialog };
}
