import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { ConstraintToggle } from "./constraint-toggle";
import { formatInternalCoordinate, internalCoordinateUnit, type InternalCoordinateKind } from "../../lib/geometry-editing";

export function IconAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <TooltipProvider><Tooltip><TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>
    </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip></TooltipProvider>
  );
}

const STEP: Record<InternalCoordinateKind, number> = { bond: 0.01, angle: 1, dihedral: 1 };

export function InternalCoordinateInput({ kind, value, reference, label, disabled, locked, onToggleLock, onPreview, onCancel, onCommit }: {
  locked: boolean;
  onToggleLock: () => void;
  kind: InternalCoordinateKind;
  value: number;
  reference: string;
  label: string;
  disabled: boolean;
  onPreview: (value: number) => void;
  onCancel: () => void;
  onCommit: (value: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async (next: number) => {
    // Transient coordinates follow the gesture; only its final value enters Undo.
    if (next === value) { onCancel(); return; }
    if (!await onCommit(next)) setDraft(value);
  };
  const step = STEP[kind];
  return (
      <div className="geometry-value"
        onClick={(event) => event.stopPropagation()}>
        <span className="geometry-ref">{reference}</span>
        <ConstraintToggle label={`Keep ${label.toLowerCase()} fixed`} active={locked} disabled={disabled} onToggle={onToggleLock} />
        <ScrubNumberField disabled={disabled} aria-label={`${label}, ${internalCoordinateUnit(kind)}`}
          className="w-full" value={draft} onValueChange={(next) => { setDraft(next); onPreview(next); }} onValueCommitted={(next) => void commit(next)}
          step={step} smallStep={step / 10} largeStep={step * 10}
          min={kind === "bond" ? 0.0001 : kind === "angle" ? 0 : -180}
          max={kind === "bond" ? undefined : 180}
          formatValue={(next) => formatInternalCoordinate(kind, next)} />
      </div>
  );
}

/** A value whose drag previews and whose release applies; a rejected value springs back. */
export function ValueField({ label, value, step, disabled, format, onPreview, onCancel, onCommit }: {
  label: string; value: number; step: number; disabled: boolean; format: (value: number) => string;
  onPreview: (value: number) => void; onCancel: () => void; onCommit: (value: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async (next: number) => {
    if (next === value) { onCancel(); return; }
    if (!await onCommit(next)) setDraft(value);
  };
  return (
    <ScrubNumberField disabled={disabled} aria-label={label} className="w-full" value={draft}
      onValueChange={(next) => { setDraft(next); onPreview(next); }} onValueCommitted={(next) => void commit(next)}
      step={step} smallStep={step / 10} largeStep={step * 10} formatValue={format} />
  );
}
