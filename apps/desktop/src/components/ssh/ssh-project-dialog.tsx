import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Folder, SidebarGlobe } from "../ui/app-icons";
import { saveSshProject, saveSshConnection, sshList, type SshDirectory } from "../../lib/ssh-projects";
import { isTauriRuntime } from "../../lib/tauri";

export function SshProjectDialog({ open, onOpenChange, connectionOnly = false, initialHost = "" }: { open: boolean; onOpenChange: (open: boolean) => void; connectionOnly?: boolean; initialHost?: string }) {
  const [hosts, setHosts] = useState<{ alias: string }[]>([]);
  const [host, setHost] = useState(initialHost);
  const [root, setRoot] = useState("~");
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState<SshDirectory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !isTauriRuntime()) return;
    let cancelled = false;
    void invoke<{ alias: string }[]>("ssh_hosts").then(value => { if (!cancelled) setHosts(value); }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [open]);
  async function browse(path = root) {
    setBusy(true); setError(""); setDirectory(null);
    try {
      const result = await sshList(host, path);
      setRoot(result.root); setDirectory(result);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  function add() {
    if (!directory) return;
    try {
    if (connectionOnly) saveSshConnection({ host, name: name.trim() || host, enabled: true });
    else saveSshProject({ id: crypto.randomUUID(), host, root: directory.root, name: name.trim() || directory.root.split("/").pop() || host });
    onOpenChange(false);
    } catch (e) { setError(String(e)); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>{connectionOnly ? "Add SSH connection" : "Add SSH project"}</DialogTitle><DialogDescription>{connectionOnly ? "Choose a machine from your SSH configuration or enter it manually." : "Choose a machine and a folder containing your structures."}</DialogDescription></DialogHeader>
      <label className="grid gap-2 text-sm">SSH host
        <Input list="burette-ssh-hosts" placeholder="Alias or user@hostname" value={host} disabled={busy} onChange={e => { setHost(e.target.value); setDirectory(null); }} />
        <datalist id="burette-ssh-hosts">{hosts.map(h => <option key={h.alias} value={h.alias} />)}</datalist>
      </label>
      {hosts.length > 0 && !host && <div className="max-h-40 overflow-auto rounded-xl border border-border">{hosts.map(h => <button key={h.alias} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted" onClick={() => setHost(h.alias)}><SidebarGlobe size={16} />{h.alias}</button>)}</div>}
      {!connectionOnly && <label className="grid gap-2 text-sm">Remote folder<Input value={root} disabled={busy} onChange={e => { setRoot(e.target.value); setDirectory(null); }} /></label>}
      <Button variant="outline" disabled={!host.trim() || busy} onClick={() => void browse()}>{busy ? "Connecting…" : connectionOnly ? "Test connection" : "Browse folder"}</Button>
      {directory && !connectionOnly && <div className="max-h-44 overflow-auto rounded-xl border border-border" aria-label="Remote folders">
        <div className="px-4 py-2 text-xs text-muted-foreground">{directory.root}</div>
        {directory.entries.filter(e => e.directory).map(entry => <button key={entry.name} disabled={busy} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted" onClick={() => void browse(`${directory.root}/${entry.name}`)}><Folder size={16} />{entry.name}</button>)}
        {directory.truncated && <p className="p-3 text-xs">Showing the first 2,000 entries. Enter a subfolder path to browse further.</p>}
      </div>}
      <label className="grid gap-2 text-sm">{connectionOnly ? "Connection name" : "Project name"}<Input placeholder={connectionOnly ? "Use host name" : "Use folder name"} value={name} onChange={e => setName(e.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">{error}</p>}
      <p className="text-xs text-muted-foreground">Uses your SSH configuration and keys. The host must already be trusted. Python 3 is required on the server.</p>
      <div className="flex justify-end"><Button disabled={!directory || busy} onClick={add}>{connectionOnly ? "Add connection" : "Add project"}</Button></div>
    </DialogContent>
  </Dialog>;
}
