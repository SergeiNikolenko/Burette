import { useState } from "react";
import { Button } from "../../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";

/** Asks for the pH whose protonation states replace the structure's hydrogens; one Undo step. */
export function AdjustPhDialog({ open, onOpenChange, onApply }: { open: boolean; onOpenChange: (open: boolean) => void; onApply: (pH: number) => void }) {
  const [value, setValue] = useState("7.4");
  const pH = value.trim() ? Number(value) : Number.NaN, valid = Number.isFinite(pH) && pH >= 0 && pH <= 14;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    {open ? <DialogContent aria-describedby={undefined} variant="form" size="narrow">
      <DialogHeader><DialogTitle>Adjust hydrogens for pH</DialogTitle></DialogHeader>
      <form className="workbench-form" onSubmit={event => { event.preventDefault(); if (valid) { onOpenChange(false); onApply(pH); } }}>
        <label className="workbench-field"><span>pH</span>
          <Input variant="compact" type="number" min={0} max={14} step="any" value={value} aria-label="pH" aria-invalid={!valid}
            autoFocus onChange={event => setValue(event.target.value)} />
        </label>
        {!valid ? <p role="alert" className="text-sm text-destructive">Choose a pH from 0 to 14.</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={!valid}>Apply</Button>
        </DialogFooter>
      </form>
    </DialogContent> : null}
  </Dialog>;
}
