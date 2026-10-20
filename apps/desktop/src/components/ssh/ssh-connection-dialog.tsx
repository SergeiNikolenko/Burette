import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Spinner } from "../ui/spinner";
import { SidebarGlobe, Plus } from "../ui/app-icons";
import { saveSshConnection, sshHosts, sshList, useSshConnections } from "../../lib/ssh-projects";

export function SshConnectionDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; onAdded?: (host: string) => void }) {
  const connections = useSshConnections();
  const [hosts, setHosts] = useState<{ alias: string }[]>([]);
  const [host, setHost] = useState("");
  const [name, setName] = useState("");
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError("");
    void sshHosts().then(items => { if (!cancelled) setHosts(items.filter((item, i) => items.findIndex(other => other.alias.toLowerCase() === item.alias.toLowerCase()) === i)); }).catch(() => { if (!cancelled) setError("Couldn’t load connections. Add a hostname manually."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);
  const availableHosts = hosts.filter(item => !connections.some(c => c.host.toLowerCase() === item.alias.toLowerCase()));
  async function add() {
    const hostname = host.trim();
    if (!hostname || busy) return;
    setBusy(true); setError("");
    try {
      await sshList(hostname, "~");
      saveSshConnection({ host: hostname, name: name.trim() || hostname, enabled: true });
      onAdded?.(hostname); onOpenChange(false);
    } catch { setError("Couldn’t connect. Check the hostname and your SSH access."); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent size="compact" className="ssh-dialog">
      <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void add(); }}>
        <DialogHeader><DialogTitle>Add SSH connection</DialogTitle><DialogDescription className="sr-only">Connect to a machine using your SSH configuration.</DialogDescription></DialogHeader>
        {manual ? <div className="ssh-form-fields">
          <label><span>Display name</span><Input name="displayName" autoComplete="off" value={name} onChange={e => setName(e.target.value)} disabled={busy} autoFocus /></label>
          <label><span>Hostname</span><Input name="hostname" autoComplete="off" autoCapitalize="none" spellCheck={false} required placeholder="host.com or user@host.com" value={host} onChange={e => setHost(e.target.value)} disabled={busy} /></label>
        </div> : (loading || availableHosts.length > 0 || !error) && <RadioGroup className="ssh-host-list" orientation="vertical" aria-label="SSH machines" aria-busy={loading} value={host} onValueChange={setHost} disabled={busy}>
          {availableHosts.map(item => <RadioGroupItem block value={item.alias} key={item.alias}>
            <SidebarGlobe size={18} aria-hidden /><span className="min-w-0 wrap-anywhere">{item.alias}</span>
          </RadioGroupItem>)}
          {loading ? <Spinner aria-label="Loading connections" className="m-4" /> : !error && !availableHosts.length && <p className="p-4 text-sm">No connections to add</p>}
        </RadioGroup>}

        {error && <p role="alert" className="ssh-dialog-error">{error}</p>}
        <DialogFooter className="justify-between">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { setManual(!manual); setHost(""); setError(""); }}><Plus size={16} aria-hidden />{manual ? "Choose from SSH config" : "Add manually"}</Button>
          <Button type="submit" disabled={!host.trim() || busy}>{busy ? "Connecting…" : manual ? "Save" : "Add"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
