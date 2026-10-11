import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import type { ViewerDocument } from "../types";
import { useMoleculeStore } from "../stores/molecule-store";

export function SceneNameDialog({ document, onClose }: { document: ViewerDocument | null; onClose: () => void }) {
  const [name, setName] = useState("");
  useEffect(() => setName(document?.title ?? ""), [document]);
  return <Dialog open={Boolean(document)} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent variant="form" size="compact">
      <form className="flex min-w-0 flex-col gap-4" onSubmit={event => {
        event.preventDefault();
        if (!document || !name.trim()) return;
        useMoleculeStore.setState(state => ({ documents: state.documents.map(current => current.id === document.id ? { ...current, title: name.trim() } : current) }));
        onClose();
      }}>
        <DialogHeader>
          <DialogTitle>Rename scene</DialogTitle>
          <DialogDescription className="sr-only">Name of this scene in the workspace.</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-2 text-xs"><span>Name</span>
          <Input variant="field" name="sceneName" autoComplete="off" aria-label="Scene name" value={name} maxLength={200} onChange={event => setName(event.target.value)} />
        </label>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!name.trim()}>Rename</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
