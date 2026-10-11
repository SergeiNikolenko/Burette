import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import type { ViewerDocument } from "../types";
import { useMoleculeStore, type MoleculeTab } from "../stores/molecule-store";

export function SceneNameDialog({ document, onClose }: { document: ViewerDocument | null; onClose: () => void }) {
  return <NameDialog open={Boolean(document)} initialName={document?.title ?? ""} title="Rename scene" label="Scene name" onClose={onClose}
    onSave={name => {
      if (document) useMoleculeStore.setState(state => ({ documents: state.documents.map(current => current.id === document.id ? { ...current, title: name } : current) }));
    }} />;
}

export function TabNameDialog({ tab, defaultName, onClose }: { tab: MoleculeTab | null; defaultName: string; onClose: () => void }) {
  return <NameDialog open={Boolean(tab)} initialName={tab?.title ?? defaultName} title="Rename tab" label="Tab name" onClose={onClose}
    onSave={name => { if (tab) useMoleculeStore.getState().renameTab(tab.id, name); }} />;
}

function NameDialog({ open, initialName, title, label, onClose, onSave }: {
  open: boolean; initialName: string; title: string; label: string; onClose: () => void; onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => setName(initialName), [initialName, open]);
  return <Dialog open={open} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent variant="form" size="compact">
      <form className="flex min-w-0 flex-col gap-4" onSubmit={event => {
        event.preventDefault();
        if (!open || !name.trim()) return;
        onSave(name.trim());
        onClose();
      }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{label}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-2 text-xs"><span>Name</span>
          <Input variant="field" name="name" autoComplete="off" aria-label={label} value={name} maxLength={200} onChange={event => setName(event.target.value)} />
        </label>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!name.trim()}>Rename</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
