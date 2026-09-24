import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarGlobe, Plus, Check } from "../ui/app-icons";
import { saveSshConnection, sshHosts, sshList, useSshConnections } from "../../lib/ssh-projects";

export function SshConnectionDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; onAdded?: (host: string) => void }) {
  const connections = useSshConnections();
  const [hosts, setHosts] = useState<{ alias: string }[]>([]);
  const [host, setHost] = useState("");
  const [name, setName] = useState("");
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void sshHosts().then(items => { if (!cancelled) setHosts(items.filter((item, i) => items.findIndex(other => other.alias.toLowerCase() === item.alias.toLowerCase()) === i)); }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [open]);
  async function add() {
    setBusy(true); setError("");
    try {
      await sshList(host, "~");
      saveSshConnection({ host, name: name.trim() || host, enabled: true });
      onAdded?.(host); onOpenChange(false);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="ssh-dialog">
      <DialogHeader><DialogTitle>Add SSH connection</DialogTitle><DialogDescription className="sr-only">Connect to a machine using your SSH configuration.</DialogDescription></DialogHeader>
      {manual ? <div className="ssh-form-fields">
        <label>Display name<Input value={name} onChange={e => setName(e.target.value)} disabled={busy} autoFocus /></label>
        <label>Hostname<Input placeholder="host.com or user@host.com" value={host} onChange={e => setHost(e.target.value)} disabled={busy} /></label>
        <p className="text-xs text-muted-foreground">Uses your existing SSH keys and configuration.</p>
      </div> : <div className="ssh-host-list" role="radiogroup" aria-label="SSH machines">
        {hosts.filter(item => !connections.some(c => c.host.toLowerCase() === item.alias.toLowerCase())).map(item => <button type="button" role="radio" aria-checked={host === item.alias} key={item.alias} disabled={busy} onClick={() => setHost(item.alias)}>
          <SidebarGlobe size={18} /><span>{item.alias}</span><span className="ssh-host-check">{host === item.alias && <Check size={13} />}</span>
        </button>)}
        {!hosts.length && <p className="p-4 text-muted-foreground">No SSH hosts found. Add a connection manually.</p>}
      </div>}
      {error && <p role="alert" className="ssh-dialog-error">{error}</p>}
      <div className="ssh-dialog-footer">
        <Button variant="ghost" disabled={busy} onClick={() => { setManual(!manual); setHost(""); setError(""); }}><Plus size={16} />{manual ? "Choose from SSH config" : "Add manually"}</Button>
        <Button className="ssh-primary" disabled={!host.trim() || busy} onClick={() => void add()}>{busy ? "Connecting…" : manual ? "Save" : "Add"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
