import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Folder, FolderPlus, ChevronDown, ArrowLeft } from "../ui/app-icons";
import { NativeDropdownMenu } from "../native-dropdown-menu";
import { SidebarFolderIcon } from "../sidebar/sidebar-folder-icon";
import { saveSshProject, sshList, useSshConnections, type SshDirectory } from "../../lib/ssh-projects";
import { SshConnectionDialog } from "./ssh-connection-dialog";

export function SshProjectDialog({ open, onOpenChange, connectionOnly = false, initialHost = "", onLocal }: { open: boolean; onOpenChange: (open: boolean) => void; connectionOnly?: boolean; initialHost?: string; onLocal?: () => void | Promise<void> }) {
  const connections = useSshConnections();
  const [host, setHost] = useState(initialHost || connections.find(c => c.enabled)?.host || "");
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [path, setPath] = useState("~");
  const [listing, setListing] = useState<SshDirectory | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connection = connections.find(c => c.host === host);
  async function browse(root = path) {
    setBusy(true); setError(""); setListing(null);
    try { const result = await sshList(host, root); setListing(result); setPath(result.root); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  function create() {
    try { saveSshProject({ id: crypto.randomUUID(), host, root: folder, name: name.trim() || folder.split("/").pop() || host }); onOpenChange(false); }
    catch (e) { setError(String(e)); }
  }
  if (connectionOnly) return <SshConnectionDialog open={open} onOpenChange={onOpenChange} />;
  return <>
    <Dialog open={open && !adding} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
      <DialogContent className="ssh-dialog">
        <DialogHeader><DialogTitle>{browsing ? "Choose a folder" : "Create project"}</DialogTitle><DialogDescription className="sr-only">Choose a source folder for your project.</DialogDescription></DialogHeader>
        {browsing ? <>
          <form className="ssh-folder-location" onSubmit={e => { e.preventDefault(); void browse(); }}>
            <Button type="button" variant="ghost" size="icon" aria-label="Parent folder" disabled={busy || !listing || listing.root === "/"} onClick={() => void browse(listing!.root.split("/").slice(0, -1).join("/") || "/")}><ArrowLeft size={16} /></Button>
            <Input aria-label="Remote folder path" value={path} onChange={e => setPath(e.target.value)} disabled={busy} />
            <Button type="submit" variant="ghost" disabled={busy}>Go</Button>
          </form>
          <div className="ssh-folder-list" aria-label="Remote folders" aria-busy={busy}>
            {busy && <div className="ssh-folder-loading" role="status">Loading…</div>}
            {listing?.entries.filter(entry => entry.directory).map(entry => <button key={entry.name} disabled={busy} onClick={() => void browse(`${listing.root}/${entry.name}`)}><Folder size={16} />{entry.name}</button>)}
            {listing && !listing.entries.some(e => e.directory) && <p className="p-4 text-muted-foreground">No subfolders</p>}
            {listing?.truncated && <p className="p-4 text-muted-foreground">First 2,000 entries shown.</p>}
          </div>
          <div className="ssh-dialog-footer"><Button variant="ghost" disabled={busy} onClick={() => setBrowsing(false)}>Back</Button><Button className="ssh-primary" disabled={busy || !listing || path !== listing.root} onClick={() => { setFolder(listing!.root); setBrowsing(false); }}>Choose folder</Button></div>
        </> : <>
          <label className="ssh-project-name"><Folder size={19} /><Input autoFocus aria-label="Project name" placeholder="Project name" value={name} onChange={e => setName(e.target.value)} /></label>
          <div className="ssh-source-label">Source folders</div>
          <div className={`ssh-source-box${folder ? " has-folder" : ""}`}>
            <NativeDropdownMenu align="center" items={[
              ...(onLocal ? [{ kind: "item" as const, id: "local", text: "This computer", action: () => { onOpenChange(false); void onLocal(); } }, { kind: "separator" as const }] : []),
              ...connections.map(c => ({ kind: "item" as const, id: c.host, text: c.name, disabled: !c.enabled, action: () => { setHost(c.host); setFolder(""); setPath("~"); setListing(null); } })),
              { kind: "separator" }, { kind: "item", id: "add", text: "Add remote…", action: () => setAdding(true) },
            ]} trigger={<button className="ssh-source-picker">{folder ? "Folder on" : "Add a folder on"} <span>{connection?.name || host || "a remote computer"}</span><ChevronDown size={15} /></button>} />
            {folder ? <button className="ssh-chosen-folder" onClick={() => { setPath(folder); setBrowsing(true); void browse(folder); }}><SidebarFolderIcon expanded={false} badge={connection?.color} /><span>{folder.split("/").pop() || folder}</span></button> : <Button variant="secondary" className="rounded-full" onClick={() => { if (!host) { setAdding(true); return; } setBrowsing(true); void browse(); }}><FolderPlus size={17} /> Add</Button>}
          </div>
          <div className="ssh-dialog-footer justify-end"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button className="ssh-primary" disabled={!folder || !host} onClick={create}>Create project</Button></div>
        </>}
        {error && <p role="alert" className="ssh-dialog-error">{error}</p>}
      </DialogContent>
    </Dialog>
    {adding && <SshConnectionDialog open onOpenChange={setAdding} onAdded={value => { setHost(value); setFolder(""); setPath("~"); setListing(null); }} />}
  </>;
}
