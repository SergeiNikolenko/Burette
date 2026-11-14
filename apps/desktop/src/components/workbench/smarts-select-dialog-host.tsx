import { useState } from "react";
import { loadRDKitModule } from "../../lib/rdkit-module";
import { smartsMatchAtoms } from "../../lib/molecular-workbench/smarts-match";
import { closeWorkbenchDialog, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import { structureEditAvailable } from "../../lib/workbench/graph-draft";
import { selectSourceAtoms } from "../../lib/workbench/select-commands";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { useGraphDraft } from "./use-graph-draft";

/** Select by SMARTS, from the 3D context menu's Select section or the command palette. */
export function SmartsSelectDialogHost({ actions }: { actions: ShellActions }) {
  const request = useWorkbenchDialogRequest();
  const document = request?.kind === "smarts" ? request.document : null;
  return (
    <Dialog open={Boolean(document)} onOpenChange={(open) => { if (!open && document) closeWorkbenchDialog(); }}>
      {document ? <DialogContent aria-describedby={undefined} variant="form" size="narrow">
        <DialogHeader><DialogTitle>Select by SMARTS</DialogTitle></DialogHeader>
        {structureEditAvailable(document) ? <SmartsForm key={document.id} document={document} actions={actions} />
          : <p role="alert" className="text-sm text-destructive">SMARTS selection needs a MOL or SDF structure.</p>}
      </DialogContent> : null}
    </Dialog>
  );
}

function SmartsForm({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  // The draft is the scene the viewer shows, so its atom order is the scene's source order.
  const draft = useGraphDraft(document);
  const [pattern, setPattern] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const molfile = draft.history?.current.structure.molfile ?? null;
  const select = async () => {
    if (!molfile) return;
    setBusy(true); setError(null);
    try {
      const atoms = smartsMatchAtoms(await loadRDKitModule(), molfile, pattern);
      if (!atoms.length) { setError("No atoms match this pattern."); return; }
      await selectSourceAtoms(actions, document, atoms);
      closeWorkbenchDialog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(false); }
  };
  return (
    <form className="workbench-form" onSubmit={(event) => { event.preventDefault(); void select(); }}>
      <label className="workbench-field"><span>SMARTS</span>
        <Input variant="compact" value={pattern} placeholder="[OX2H]" aria-label="SMARTS" spellCheck={false} autoComplete="off" autoFocus
          onChange={(event) => { setPattern(event.target.value); setError(null); }} />
      </label>
      {error ?? draft.error ? <p role="alert" className="text-sm text-destructive">{error ?? draft.error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeWorkbenchDialog}>Cancel</Button>
        <Button type="submit" disabled={busy || !molfile || !pattern.trim()}>Select</Button>
      </DialogFooter>
    </form>
  );
}
