import { useState, type ReactNode } from "react";
import { cellFromParameters, type CellParameters } from "../../lib/molecular-workbench/crystal";
import type { CrystalEdit } from "../../lib/molecular-workbench/crystal-edit";
import { cellParametersOf, signedVolume, SCALE_VOLUME_LIMITS, SUPERCELL_LIMITS, type CoordinatePolicy } from "../../lib/molecular-workbench/crystal-operations";
import type { UnitCell } from "../../lib/molecular-workbench/types";
import { useSourceEditing } from "../../lib/source-editing/context";
import { writeCjson } from "../../lib/molecular-workbench/cjson-graph";
import { writeCrystalCif, writeExtendedXyz, type CrystalDocument } from "../../lib/molecular-workbench/crystal-io";
import { writePoscar } from "../../lib/molecular-workbench/poscar";
import { fileStem } from "../../lib/workbench/formats";
import { openGeneratedStructure } from "../../lib/workbench/open";
import { useCrystalDraft, type CrystalRevision } from "../../lib/workbench/use-crystal-draft";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { ArrowCurvedRight, ChevronDown, Grid, Undo } from "../ui/app-icons";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { CollapsibleSection } from "../ui/collapsible-section";
import { PanelEmptyState } from "../ui/panel-empty-state";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import { toast } from "../ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { PairDistributionSection } from "./pair-distribution-section";
import { PowderXrdSection } from "./powder-xrd-section";
import { CrystalSpaceGroupSection } from "./crystal-space-group-section";
import { IconAction } from "./geometry-fields";
import "./workbench-layout.css";
import "./crystal.css";

export const CRYSTAL_EDIT_LABELS: Record<CrystalEdit["kind"], string> = {
  "set-cell": "Cell change", wrap: "Wrap atoms", "standard-orientation": "Standard orientation", "scale-volume": "Volume scaling",
  supercell: "Supercell", niggli: "Niggli reduction", primitive: "Primitive cell", conventional: "Conventional cell",
  symmetrize: "Symmetrize", "asymmetric-unit": "Asymmetric unit", fill: "Fill unit cell",
};
const AXES = ["a", "b", "c"] as const;
const ANGLES = [["alpha", "α"], ["beta", "β"], ["gamma", "γ"]] as const;
// The current cell in each crystal format, atom order kept; Export never changes the source.
const EXPORTS = [
  ["CIF", "cif", (crystal: CrystalDocument, title: string) => writeCrystalCif(crystal, title)],
  ["POSCAR", "vasp", (crystal: CrystalDocument, title: string) => writePoscar({ title, atoms: crystal.atoms, cell: crystal.cell, selectiveDynamics: crystal.selectiveDynamics })],
  ["Extended XYZ", "xyz", (crystal: CrystalDocument, title: string) => writeExtendedXyz(crystal.atoms, crystal.cell, title)],
  ["CJSON", "cjson", (crystal: CrystalDocument, title: string) => `${JSON.stringify(writeCjson({ title, atoms: crystal.atoms, cell: crystal.cell }), null, 2)}\n`],
] as const;
const plural = (count: number, one: string) => `${count.toLocaleString("en-US")} ${one}${count === 1 ? "" : "s"}`;

type Field = { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step: number; digits: number; disabled?: boolean };
function NumberField({ label, value, onChange, min, max, step, digits, disabled }: Field) {
  return (
    <label className="workbench-field">
      <span>{label}</span>
      {/* The usual 4.75rem, narrower when three share a row of the 260 px dock. */}
      <ScrubNumberField aria-label={label} name={label} autoComplete="off" className="w-full max-w-[4.75rem]" value={value} min={min} max={max} step={step} largeStep={step * 10}
        formatValue={(next) => next.toFixed(digits)} disabled={disabled} onValueChange={onChange} onValueCommitted={onChange} />
    </label>
  );
}

/**
 * The unit cell of a CIF, extended XYZ or POSCAR document, edited as Avogadro's Crystal
 * menu does. Every edit is one Undo step of the document's own source.
 */
export function CrystalPanel({ document, actions }: { document: ViewerDocument | null; actions: ShellActions }) {
  const draft = useCrystalDraft(document, (name, text) => openGeneratedStructure(actions, name, "cif", text, undefined, { newDocument: true }));
  const sourceEditing = useSourceEditing();
  const [running, setRunning] = useState<CrystalEdit["kind"] | null>(null);
  // The cell fields restart from each revision; how the user edits them does not.
  const [cellMode, setCellMode] = useState<CellMode>("parameters");
  const [policy, setPolicy] = useState<CoordinatePolicy>("fractional");
  if (draft.reading) return null;
  if (!document || !draft.available) return <div className="dock-content dock-content-empty"><PanelEmptyState icon={<Grid />} title="No crystal selected" /></div>;
  const history = draft.history;
  const current = history?.current ?? null;
  const locked = draft.busy || !draft.editable;
  const apply = async (edit: CrystalEdit) => {
    setRunning(edit.kind);
    try { await draft.apply(edit); } finally { setRunning(null); }
  };
  const undoLabel = current?.edit ? `Undo ${CRYSTAL_EDIT_LABELS[current.edit].toLowerCase()}` : "Undo";
  const redoTarget = history?.redo[0]?.edit;
  const session = draft.session;
  return (
    <div className="dock-content crystal-panel">
      <div className="workbench-toolbar">
        <IconAction label={undoLabel} disabled={draft.busy || !history?.undo.length} onClick={() => void draft.undo()}><Undo aria-hidden /></IconAction>
        <IconAction label={redoTarget ? `Redo ${CRYSTAL_EDIT_LABELS[redoTarget].toLowerCase()}` : "Redo"} disabled={draft.busy || !history?.redo.length} onClick={() => void draft.redo()}><ArrowCurvedRight aria-hidden /></IconAction>
        {draft.busy && running ? (
          <>
            <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />{CRYSTAL_EDIT_LABELS[running]}</span>
            <Button type="button" variant="ghost" size="xs" onClick={draft.cancel}>Cancel</Button>
          </>
        ) : null}
        <span className="ml-auto" />
        {current ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" size="xs" variant="ghost" disabled={draft.busy}>Export<ChevronDown aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {EXPORTS.map(([label, extension, write]) => (
                <DropdownMenuItem key={extension} onSelect={() => {
                  const title = fileStem(document.title);
                  let text: string;
                  try { text = write(current.value, title); } catch (error) {
                    toast.add({ title: `Could not export ${label}`, description: error instanceof Error ? error.message : String(error), type: "error" });
                    return;
                  }
                  void actions.saveKetcherExportFile({ title: `${title}.${extension}`, extension, text });
                }}>{label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {session?.dirty ? (
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <span>
              <Button type="button" variant="secondary" size="xs" disabled={draft.busy || Boolean(session.saveDisabledReason) || session.saving}
                onClick={() => void sourceEditing?.save(document)}>{session.saveLabel ?? "Save"}</Button>
            </span>
          </TooltipTrigger>{session.saveDisabledReason ? <TooltipContent>{session.saveDisabledReason}</TooltipContent> : null}</Tooltip></TooltipProvider>
        ) : null}
      </div>
      {draft.error ? <p role="alert" className="workbench-error">{draft.error}</p> : null}
      {current && draft.format ? (
        <>
          <CellSection key={`cell:${current.id}`} revision={current} disabled={locked} readOnly={!draft.editable} apply={apply}
            mode={cellMode} setMode={setCellMode} policy={policy} setPolicy={setPolicy} />
          <TransformSection key={`transform:${current.id}`} revision={current} disabled={locked} readOnly={!draft.editable} apply={apply} />
          <CrystalSpaceGroupSection format={draft.format} revision={current} disabled={locked} apply={apply} />
          <AnalysisSection title="Powder diffraction">
            <PowderXrdSection title={document.title} atoms={current.value.atoms} cell={current.value.cell} revision={String(current.id)} actions={actions} />
          </AnalysisSection>
          <AnalysisSection title="Pair distribution">
            <PairDistributionSection title={document.title} atoms={current.value.atoms} cell={current.value.cell} revision={String(current.id)} actions={actions} />
          </AnalysisSection>
        </>
      ) : draft.error ? null : <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Reading crystal</span>}
    </div>
  );
}

/** Opens collapsed and computes only while open. */
function AnalysisSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <CollapsibleSection title={title} open={open} onOpenChange={setOpen}>{open ? children : null}</CollapsibleSection>;
}

type CellMode = "parameters" | "vectors";
// Fields dim only for a read-only source; while an edit runs only the buttons wait, so the
// fields keep their look instead of flashing at half opacity on every Apply, Undo and Redo.
type SectionProps = { revision: CrystalRevision; disabled: boolean; readOnly: boolean; apply: (edit: CrystalEdit) => Promise<void> };

function CellSection({ revision, disabled, readOnly, apply, mode, setMode, policy, setPolicy }: SectionProps & {
  mode: CellMode; setMode: (mode: CellMode) => void; policy: CoordinatePolicy; setPolicy: (policy: CoordinatePolicy) => void;
}) {
  const cell = revision.value.cell;
  const [parameters, setParameters] = useState<CellParameters>(() => cellParametersOf(cell));
  const [vectors, setVectors] = useState<UnitCell>(cell);
  let next: UnitCell | null = null, problem: string | null = null;
  try {
    next = mode === "vectors" ? vectors : cellFromParameters(parameters);
    if (!(Math.abs(signedVolume(next)) > 1e-6)) problem = "The cell vectors must span a volume.";
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  const original = cellParametersOf(cell);
  const changed = mode === "vectors" ? vectors.some((row, i) => row.some((value, j) => value !== cell[i][j]))
    : (Object.keys(original) as (keyof CellParameters)[]).some((key) => Math.abs(parameters[key] - original[key]) > 1e-9);
  return (
    <CollapsibleSection title="Cell" detail={`${Math.abs(signedVolume(cell)).toFixed(2)} Å³, ${plural(revision.value.atoms.length, "atom")}`}>
      <div className="workbench-form">
        <SegmentedControl aria-label="Cell as" className="self-start" value={mode} onValueChange={(value) => setMode(value as CellMode)}>
          <SegmentedControlItem value="parameters">Parameters</SegmentedControlItem>
          <SegmentedControlItem value="vectors">Vectors</SegmentedControlItem>
        </SegmentedControl>
        {mode === "parameters" ? (
          <div className="workbench-grid workbench-grid-3">
            {AXES.map((axis) => <NumberField key={axis} label={`${axis}, Å`} value={parameters[axis]} min={0.1} max={1e4} step={0.01} digits={4} disabled={readOnly}
              onChange={(value) => setParameters({ ...parameters, [axis]: value })} />)}
            {ANGLES.map(([angle, symbol]) => <NumberField key={angle} label={`${symbol}, °`} value={parameters[angle]} min={1} max={179} step={0.1} digits={3} disabled={readOnly}
              onChange={(value) => setParameters({ ...parameters, [angle]: value })} />)}
          </div>
        ) : (
          <div className="workbench-grid workbench-grid-3">
            {vectors.map((row, i) => row.map((value, j) => <NumberField key={`${i}${j}`} label={`${AXES[i]} ${"xyz"[j]}, Å`} value={value} min={-1e4} max={1e4} step={0.01} digits={4} disabled={readOnly}
              onChange={(entry) => setVectors(vectors.map((vector, r) => r === i ? vector.map((old, c) => c === j ? entry : old) : vector) as UnitCell)} />))}
          </div>
        )}
        <div className="workbench-row">
          <label className="workbench-field">
            <span>Keep</span>
            <SegmentedControl aria-label="Keep coordinates" value={policy} onValueChange={(value) => setPolicy(value as CoordinatePolicy)}>
              <SegmentedControlItem value="fractional">Fractional</SegmentedControlItem>
              <SegmentedControlItem value="cartesian">Cartesian</SegmentedControlItem>
            </SegmentedControl>
          </label>
          <Button type="button" size="xs" className="ml-auto" disabled={disabled || !changed || !next || Boolean(problem)}
            onClick={() => next && void apply({ kind: "set-cell", cell: next, policy })}>Apply</Button>
        </div>
        {changed && problem ? <p role="alert" className="workbench-error">{problem}</p> : null}
      </div>
    </CollapsibleSection>
  );
}

function TransformSection({ revision, disabled, readOnly, apply }: SectionProps) {
  const volume = Math.abs(signedVolume(revision.value.cell));
  const [target, setTarget] = useState(volume);
  const [repeats, setRepeats] = useState<[number, number, number]>([2, 2, 2]);
  const supercellAtoms = revision.value.atoms.length * repeats[0] * repeats[1] * repeats[2];
  const tooLarge = supercellAtoms > SUPERCELL_LIMITS.atoms;
  return (
    <CollapsibleSection title="Transform">
      <div className="workbench-form">
        <div className="workbench-row">
          <Button type="button" size="xs" variant="secondary" disabled={disabled} onClick={() => void apply({ kind: "wrap" })}>Wrap atoms</Button>
          <Button type="button" size="xs" variant="secondary" disabled={disabled} onClick={() => void apply({ kind: "standard-orientation" })}>Standard orientation</Button>
          <Button type="button" size="xs" variant="secondary" disabled={disabled} onClick={() => void apply({ kind: "niggli" })}>Niggli reduce</Button>
        </div>
        <div className="workbench-row">
          <NumberField label="Volume, Å³" value={target} min={volume * SCALE_VOLUME_LIMITS.factor.min} max={volume * SCALE_VOLUME_LIMITS.factor.max} step={1} digits={2} disabled={readOnly} onChange={setTarget} />
          <Button type="button" size="xs" variant="secondary" disabled={disabled || Math.abs(target - volume) < 1e-9} onClick={() => void apply({ kind: "scale-volume", volume: target })}>Scale</Button>
        </div>
        <div className="workbench-row">
          {AXES.map((axis, index) => <NumberField key={axis} label={`${axis} ×`} value={repeats[index]} min={1} max={SUPERCELL_LIMITS.repeat} step={1} digits={0} disabled={readOnly}
            onChange={(value) => setRepeats(repeats.map((old, i) => i === index ? Math.round(value) : old) as [number, number, number])} />)}
          <Button type="button" size="xs" variant="secondary" disabled={disabled || tooLarge || repeats.every((value) => value === 1)}
            onClick={() => void apply({ kind: "supercell", repeats })}>Build supercell</Button>
        </div>
        {tooLarge ? <p role="alert" className="workbench-error">{`A supercell is limited to ${SUPERCELL_LIMITS.atoms.toLocaleString("en-US")} atoms.`}</p> : null}
      </div>
    </CollapsibleSection>
  );
}
