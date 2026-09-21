import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { sshDeleteFolder, type SshProject } from "../../lib/ssh-projects";

export function SshDeleteFolderDialog({ project, path, fullPath, onClose, onDeleted }: {
  project: SshProject; path: string; fullPath: string; onClose: () => void; onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = path.split("/").at(-1)!;
  async function remove() {
    setBusy(true); setError("");
    try { await sshDeleteFolder(project, path); onDeleted(); onClose(); }
    catch (e) { setError(`${String(e)}. Some contents may already have been removed. Refresh the folder before trying again.`); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="ssh-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Delete folder from server?</DialogTitle><DialogDescription>This permanently deletes the folder and everything inside it on {project.host}.</DialogDescription></DialogHeader>
      <p className="break-all text-sm">{fullPath}</p>
      <label className="grid gap-2 text-sm">Type “{name}” to confirm<Input autoFocus value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></label>
      {error && <p role="alert" className="ssh-dialog-error">{error}</p>}
      <div className="ssh-dialog-footer justify-end"><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="destructive" disabled={busy || !!error || confirmation !== name} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete folder"}</Button></div>
    </DialogContent>
  </Dialog>;
}
