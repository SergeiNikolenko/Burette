import { useEffect, useMemo, useRef, useState } from "react";
import { generateQuantumInput, type InputConstraint, type QuantumEngine } from "../../lib/molecular-workbench/input-export";
import type { MolecularAtom } from "../../lib/molecular-workbench/types";
import { readUnitCell } from "../../lib/molecular-workbench/crystal";
import { safeExportFileName } from "../../lib/file-export";
import { fileStem } from "../../lib/workbench/formats";
import type { ShellActions } from "../types";
import type { ViewerDocument } from "../../types";
import { Button } from "../ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { useWorkbenchSource } from "./use-workbench-source";

type Task = "energy" | "optimize" | "frequencies";
const ENGINES: [QuantumEngine, string][] = [["orca", "ORCA"], ["gaussian", "Gaussian"], ["psi4", "Psi4"], ["cp2k", "CP2K"]];
const DEFAULTS: Record<QuantumEngine, { method: string; basis: string }> = {
  orca: { method: "B3LYP", basis: "def2-SVP" },
  gaussian: { method: "B3LYP", basis: "6-31G(d)" },
  psi4: { method: "b3lyp", basis: "def2-svp" },
  cp2k: { method: "PBE", basis: "DZVP-MOLOPT-SR-GTH" },
};
const NO_CONSTRAINTS: InputConstraint[] = [];
const CONSTRAINT_LABELS: Record<InputConstraint["kind"], string> = { freeze: "Frozen atom", distance: "Distance", angle: "Angle", dihedral: "Dihedral" };

export function InputExportDialogBody({ document, actions, atoms: editedAtoms, constraints: requestedConstraints = NO_CONSTRAINTS }: {
  document: ViewerDocument;
  actions: ShellActions;
  atoms?: MolecularAtom[];
  constraints?: InputConstraint[];
}) {
  // The Geometry tab hands over its edited atoms; the source still supplies the cell.
  const source = useWorkbenchSource(document);
  const atoms = editedAtoms ?? source.source?.atoms ?? null;
  const cellRead = useMemo(() => {
    try { return { cell: source.source?.cell ?? readUnitCell(source.source?.graphText ?? ""), error: null }; }
    catch { return { cell: null, error: "The source cell is invalid. Turn off Periodic cell from file to export an isolated structure." }; }
  }, [source.source]);
  const cell = cellRead.cell;
  const [engine, setEngine] = useState<QuantumEngine>("orca");
  const [task, setTask] = useState<Task>(requestedConstraints.length ? "optimize" : "energy");
  const [method, setMethod] = useState(DEFAULTS.orca.method);
  const [basis, setBasis] = useState(DEFAULTS.orca.basis);
  const [charge, setCharge] = useState(0);
  const [multiplicity, setMultiplicity] = useState(1);
  const [useConstraints, setUseConstraints] = useState(requestedConstraints.length > 0);
  const [useCell, setUseCell] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const awaitingCell = engine === "cp2k" && useCell && (source.loading || Boolean(source.error) || Boolean(cellRead.error));

  const constraints = useConstraints && task === "optimize" ? requestedConstraints : NO_CONSTRAINTS;
  const generated = useMemo(() => {
    if (!atoms || awaitingCell) return null;
    try {
      return { result: generateQuantumInput(atoms, { engine, task, method: method.trim(), basis: basis.trim(), charge, multiplicity, constraints, cell: engine === "cp2k" && useCell && cell ? cell : undefined }), error: null };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [atoms, engine, task, method, basis, charge, multiplicity, constraints, useCell, cell, awaitingCell]);
  const currentOutput = useRef(generated?.result);
  currentOutput.current = generated?.result;
  useEffect(() => { setCopied(false); setExportError(null); }, [generated]);
  useEffect(() => { currentOutput.current = generated?.result; return () => { currentOutput.current = null; }; }, [generated]);

  const fileName = generated?.result ? safeExportFileName(`${fileStem(document.title)}.${generated.result.extension}`) : "";
  const constraintSummary = requestedConstraints.reduce<Record<string, number>>((counts, constraint) => ({ ...counts, [constraint.kind]: (counts[constraint.kind] ?? 0) + 1 }), {});
  return (
    <>
      <DialogHeader>
        <DialogTitle>Export input file</DialogTitle>
        <DialogDescription className="truncate" title={document.title}>{document.title}</DialogDescription>
      </DialogHeader>
      <div className="workbench-form">
        <div className="workbench-row">
          <SegmentedControl aria-label="Program" value={engine} onValueChange={(value) => {
            const next = value as QuantumEngine;
            setEngine(next);
            setMethod(DEFAULTS[next].method);
            setBasis(DEFAULTS[next].basis);
          }}>
            {ENGINES.map(([value, label]) => <SegmentedControlItem key={value} value={value}>{label}</SegmentedControlItem>)}
          </SegmentedControl>
        </div>
        <div className="workbench-grid">
          <label className="workbench-field">
            <span>Calculation</span>
            <NativeSelect size="sm" aria-label="Calculation" value={task} onChange={(event) => setTask(event.target.value as Task)}>
              <NativeSelectOption value="energy">Single-point energy</NativeSelectOption>
              <NativeSelectOption value="optimize">Geometry optimization</NativeSelectOption>
              <NativeSelectOption value="frequencies">Frequencies</NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="workbench-field">
            <span>Method</span>
            <Input variant="compact" value={method} spellCheck={false} autoComplete="off" onChange={(event) => setMethod(event.target.value)} />
          </label>
          <label className="workbench-field">
            <span>Basis set</span>
            <Input variant="compact" value={basis} spellCheck={false} autoComplete="off" onChange={(event) => setBasis(event.target.value)} />
          </label>
          <label className="workbench-field">
            <span>Charge, e</span>
            <ScrubNumberField aria-label="Charge, e" value={charge} min={-100} max={100} step={1} formatValue={(value) => String(Math.round(value))}
              onValueChange={(value) => setCharge(Math.round(value))} onValueCommitted={(value) => setCharge(Math.round(value))} />
          </label>
          <label className="workbench-field">
            <span>Multiplicity</span>
            <ScrubNumberField aria-label="Spin multiplicity" value={multiplicity} min={1} max={101} step={1} formatValue={(value) => String(Math.round(value))}
              onValueChange={(value) => setMultiplicity(Math.round(value))} onValueCommitted={(value) => setMultiplicity(Math.round(value))} />
          </label>
        </div>
        {requestedConstraints.length ? (
          <label className="workbench-switch" title={task === "optimize" ? undefined : "Constraints apply to geometry optimizations"}>
            <Switch checked={useConstraints && task === "optimize"} disabled={task !== "optimize"} onCheckedChange={setUseConstraints} />
            <span>Constraints: {Object.entries(constraintSummary).map(([kind, count]) => `${count} ${CONSTRAINT_LABELS[kind as InputConstraint["kind"]].toLowerCase()}${count === 1 ? "" : "s"}`).join(", ")}</span>
          </label>
        ) : null}
        {engine === "cp2k" && (cell || source.loading || source.error || cellRead.error) ? (
          <label className="workbench-switch">
            <Switch checked={useCell} onCheckedChange={setUseCell} />
            <span>Periodic cell from file</span>
          </label>
        ) : null}
        {generated?.result ? (
          <Textarea readOnly className="workbench-code" aria-label={`${fileName} contents`} value={generated.result.text} rows={12} wrap="off" spellCheck={false} />
        ) : null}
      </div>
      {(!atoms || awaitingCell) && source.loading ? <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Reading structure</span> : null}
      {source.error ?? (engine === "cp2k" && useCell ? cellRead.error : null) ?? generated?.error ?? exportError ? <p role="alert" className="workbench-error">{source.error ?? (engine === "cp2k" && useCell ? cellRead.error : null) ?? generated?.error ?? exportError}</p> : null}
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={!generated?.result} onClick={() => {
          if (!generated?.result) return;
          setCopied(false);
          setExportError(null);
          if (!navigator.clipboard) { setExportError("Could not copy. Select the input text and copy it manually."); return; }
          const output = generated.result;
          void navigator.clipboard.writeText(output.text).then(() => { if (currentOutput.current === output) setCopied(true); })
            .catch(() => { if (currentOutput.current === output) setExportError("Could not copy. Select the input text and copy it manually."); });
        }}>{copied ? "Copied" : "Copy"}</Button>
        <Button type="button" title={fileName || undefined} disabled={!generated?.result || saving} onClick={() => {
          if (!generated?.result) return;
          setExportError(null);
          setSaving(true);
          void actions.saveKetcherExportFile({ title: fileName, extension: generated.result.extension, text: generated.result.text })
            .then((outcome) => { if (outcome.status === "failed") setExportError("Could not save the input file. Try saving again."); })
            .catch(() => setExportError("Could not save the input file. Try saving again."))
            .finally(() => setSaving(false));
        }}>{saving ? <><Spinner aria-hidden className="size-3" />Saving</> : "Save"}</Button>
      </DialogFooter>
    </>
  );
}
