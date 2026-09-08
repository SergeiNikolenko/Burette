import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import type { ViewerDocument } from "../types";
import { useMoleculeStore } from "../stores/molecule-store";
import { useAppShellPortalContainer } from "./ui/portal-container";

export function SceneNameDialog({ document, onClose }: { document: ViewerDocument | null; onClose: () => void }) {
  const container = useAppShellPortalContainer();
  const [name, setName] = useState("");
  useEffect(() => setName(document?.title ?? ""), [document]);
  return <Dialog.Root open={Boolean(document)} onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal container={container}>
    <Dialog.Overlay className="radix-dialog-overlay" /><Dialog.Content className="radix-dialog calculated-column-dialog">
      <form onSubmit={event => {
        event.preventDefault();
        if (!document || !name.trim()) return;
        useMoleculeStore.setState(state => ({ documents: state.documents.map(current => current.id === document.id ? { ...current, title: name.trim() } : current) }));
        onClose();
      }}><div className="radix-dialog-header"><Dialog.Title>Rename Scene</Dialog.Title></div>
        <div className="radix-dialog-body"><Dialog.Description>Name of this scene in the workspace.</Dialog.Description>
          <label className="calculated-column-field"><span>Name</span><input aria-label="Scene name" value={name} maxLength={200} onChange={event => setName(event.target.value)} /></label>
        </div><div className="radix-dialog-footer calculate-properties-footer"><button type="button" className="dock-action" onClick={onClose}>Cancel</button>
          <button className="dock-action" type="submit" disabled={!name.trim()}>Rename</button></div>
      </form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
