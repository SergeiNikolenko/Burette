import { useEffect, useId, useMemo, useRef, useState } from "react";
import { generateQuantumInput, QUANTUM_INPUT_DEFAULTS as DEFAULTS, QUANTUM_INPUT_FEATURES as FEATURES, SOLVENTS, ZMATRIX_ENGINES,
  type CoordinateStyle, type Dispersion, type InputConstraint, type QuantumEngine, type QuantumTask, type ScfConvergence, type Solvent, type SolventModel } from "../../lib/molecular-workbench/input-export";
import type { MolecularAtom } from "../../lib/molecular-workbench/types";
import type { ZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";
import { useStructureSourceText } from "../../lib/source-editing/use-structure-source-text";
import { isPdbDocument, readMolecularStructure, readPdbAtoms } from "../../lib/workbench/structure";
import { useAvogadroGenerators } from "../../lib/extensions/avogadro-input-generators";
import type { MolecularBond } from "../../lib/molecular-workbench/types";
import { readUnitCell } from "../../lib/molecular-workbench/crystal";
import { safeExportFileName } from "../../lib/file-export";
import { fileStem } from "../../lib/workbench/formats";
import type { ShellActions } from "../types";
import type { ViewerDocument } from "../../types";
import { Button } from "../ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { useWorkbenchSource } from "./use-workbench-source";
import { PluginInputForm } from "./plugin-input-form";

const ENGINES: [QuantumEngine, string][] = [["orca", "ORCA"], ["gaussian", "Gaussian"], ["psi4", "Psi4"], ["cp2k", "CP2K"]];
const TASKS: Record<QuantumTask, string> = { energy: "Single-point energy", optimize: "Geometry optimization", frequencies: "Frequencies",
  "optimize-frequencies": "Optimization and frequencies", "transition-state": "Transition state" };
const OPTIMIZING: QuantumTask[] = ["optimize", "optimize-frequencies"];
const SOLVENT_MODELS: Record<SolventModel, string> = { cpcm: "CPCM", smd: "SMD" };
const DISPERSIONS: Record<Dispersion, string> = { d3bj: "D3(BJ)", d4: "D4" };
const SCF: Record<ScfConvergence, string> = { tight: "Tight", "very-tight": "Very tight" };
const CORES = [2, 4, 8, 16, 32, 64];
const MEMORY_GB = [2, 4, 8, 16, 32, 64, 128];
// Suggestions only: any single keyword the program reads can still be typed.
const SUGGESTIONS: Record<QuantumEngine, { methods: string[]; bases: string[] }> = {
  orca: { methods: ["B3LYP", "PBE0", "PBE", "TPSS", "r2SCAN", "M06-2X", "wB97X-V", "CAM-B3LYP", "HF", "MP2", "RI-MP2", "DLPNO-CCSD(T)"],
    bases: ["def2-SVP", "def2-TZVP", "def2-TZVPP", "def2-QZVPP", "ma-def2-TZVP", "6-31G(d)", "6-311+G(d,p)", "cc-pVDZ", "cc-pVTZ", "aug-cc-pVTZ"] },
  gaussian: { methods: ["B3LYP", "PBE1PBE", "PBEPBE", "M062X", "wB97XD", "CAM-B3LYP", "HF", "MP2", "CCSD(T)"],
    bases: ["6-31G(d)", "6-31+G(d,p)", "6-311+G(d,p)", "6-311++G(2d,2p)", "def2SVP", "def2TZVP", "cc-pVDZ", "cc-pVTZ", "aug-cc-pVTZ"] },
  psi4: { methods: ["b3lyp", "pbe0", "pbe", "wb97x-v", "m06-2x", "hf", "mp2", "ccsd", "ccsd(t)"],
    bases: ["def2-svp", "def2-tzvp", "def2-tzvpp", "6-31g*", "6-311+g**", "cc-pvdz", "cc-pvtz", "aug-cc-pvtz"] },
  cp2k: { methods: ["PBE", "BLYP"], bases: ["DZVP-MOLOPT-SR-GTH", "DZVP-MOLOPT-GTH", "TZVP-MOLOPT-GTH", "TZV2P-MOLOPT-GTH"] },
};
const NO_CONSTRAINTS: InputConstraint[] = [];
const CONSTRAINT_LABELS: Record<InputConstraint["kind"], string> = { freeze: "Frozen atom", distance: "Distance", angle: "Angle", dihedral: "Dihedral" };

export function InputExportDialogBody({ document, actions, atoms: editedAtoms, constraints: requestedConstraints = NO_CONSTRAINTS, definition }: {
  document: ViewerDocument;
  actions: ShellActions;
  atoms?: MolecularAtom[];
  constraints?: InputConstraint[];
  /** The Z-matrix panel's definition, written as is in the Z-matrix style. */
  definition?: ZmatrixDocument;
}) {
  // The Geometry tab hands over its edited atoms; the source still supplies the cell.
  const source = useWorkbenchSource(document);
  const pdbText = useStructureSourceText(isPdbDocument(document) && !editedAtoms ? document : null);
  const pdb = useMemo(() => {
    if (pdbText.text === null) return { atoms: null, error: pdbText.error };
    try { return { atoms: readPdbAtoms(pdbText.text), error: null }; }
    catch (error) { return { atoms: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [pdbText.text, pdbText.error]);
  const atoms = editedAtoms ?? source.source?.atoms ?? pdb.atoms;
  const readingPdb = isPdbDocument(document) && !editedAtoms && pdbText.text === null && !pdbText.error;
  const sourceError = source.error ?? pdb.error;
  const cellRead = useMemo(() => {
    try { return { cell: source.source?.cell ?? readUnitCell(source.source?.graphText ?? ""), error: null }; }
    catch { return { cell: null, error: "The source cell is invalid. Turn off Periodic cell from file to export an isolated structure." }; }
  }, [source.source]);
  const cell = cellRead.cell;
  const [engine, setEngine] = useState<QuantumEngine>("orca");
  const [task, setTask] = useState<QuantumTask>(requestedConstraints.length ? "optimize" : "energy");
  const [method, setMethod] = useState(DEFAULTS.orca.method);
  const [basis, setBasis] = useState(DEFAULTS.orca.basis);
  const [charge, setCharge] = useState(0);
  const [multiplicity, setMultiplicity] = useState(1);
  const [useConstraints, setUseConstraints] = useState(requestedConstraints.length > 0);
  const [useCell, setUseCell] = useState(true);
  const [coordinates, setCoordinates] = useState<CoordinateStyle>(definition ? "zmatrix" : "cartesian");
  const [solventModel, setSolventModel] = useState<SolventModel | "">("");
  const [solvent, setSolvent] = useState<Solvent>("water");
  const [dispersion, setDispersion] = useState<Dispersion | "">("");
  const [scf, setScf] = useState<ScfConvergence | "">("");
  const [cores, setCores] = useState(0);
  const [memoryGb, setMemoryGb] = useState(0);
  const [title, setTitle] = useState("");
  const [checkpoint, setCheckpoint] = useState(false);
  const listId = useId();
  const features = FEATURES[engine];
  const solvents = (Object.keys(SOLVENTS) as Solvent[]).filter(id => engine in SOLVENTS[id]);
  const solvation = solventModel && features.solvation.includes(solventModel) ? { model: solventModel, solvent: solvents.includes(solvent) ? solvent : "water" as const } : undefined;
  const effectiveDispersion = dispersion && features.dispersion.includes(dispersion) ? dispersion : undefined;
  const zmatrixEngine = ZMATRIX_ENGINES.includes(engine);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const awaitingCell = engine === "cp2k" && useCell && (source.loading || Boolean(source.error) || Boolean(cellRead.error));
  const generators = useAvogadroGenerators();
  const [pluginId, setPluginId] = useState<string | null>(null);
  const plugin = generators.find(entry => entry.id === pluginId);
  // Plugins get the molecule as CJSON with its bonds; edited atoms keep the source's when they are the same atoms.
  const [bonds, setBonds] = useState<{ source: unknown; bonds: MolecularBond[] } | null>(null);
  useEffect(() => {
    const current = source.source;
    if (!plugin || !current || bonds?.source === current) return;
    const controller = new AbortController();
    readMolecularStructure(current, controller.signal).then(structure => setBonds({ source: current, bonds: structure.bonds }), () => setBonds({ source: current, bonds: [] }));
    return () => controller.abort();
  }, [plugin, source.source, bonds]);
  const pluginMolecule = useMemo(() => !atoms ? null : {
    atoms, cell: plugin?.generator.periodic ? cell : null,
    bonds: bonds && bonds.source === source.source && source.source?.atoms.length === atoms.length ? bonds.bonds : [],
  }, [atoms, cell, plugin, bonds, source.source]);

  const constraints = useConstraints && OPTIMIZING.includes(task) ? requestedConstraints : NO_CONSTRAINTS;
  const checkpointName = engine === "gaussian" && checkpoint ? `${fileStem(document.title).replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 60) || "burette"}.chk` : undefined;
  const generated = useMemo(() => {
    if (!atoms || awaitingCell) return null;
    try {
      return { result: generateQuantumInput(atoms, { engine, task, method: method.trim(), basis: basis.trim(), charge, multiplicity, constraints, cell: engine === "cp2k" && useCell && cell ? cell : undefined,
        coordinates: zmatrixEngine ? coordinates : "cartesian", definition, solvation, dispersion: effectiveDispersion, scf: scf || undefined,
        cores: features.resources && cores ? cores : undefined, memory: features.resources && memoryGb ? memoryGb * 1024 : undefined,
        title: title.trim() ? title.trim() : undefined, checkpoint: checkpointName }), error: null };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [atoms, engine, task, method, basis, charge, multiplicity, constraints, useCell, cell, awaitingCell, coordinates, zmatrixEngine, definition,
    solvation?.model, solvation?.solvent, effectiveDispersion, scf, features, cores, memoryGb, title, checkpointName]);
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
          <SegmentedControl aria-label="Program" value={plugin ? "" : engine} onValueChange={(value) => {
            const next = value as QuantumEngine;
            setPluginId(null);
            setEngine(next);
            if (!FEATURES[next].tasks.includes(task)) setTask(OPTIMIZING.includes(task) ? "optimize" : "energy");
            setMethod(DEFAULTS[next].method);
            setBasis(DEFAULTS[next].basis);
          }}>
            {ENGINES.map(([value, label]) => <SegmentedControlItem key={value} value={value}>{label}</SegmentedControlItem>)}
          </SegmentedControl>
          {generators.length ? (
            <NativeSelect size="sm" aria-label="More programs" value={plugin?.id ?? ""} onChange={(event) => setPluginId(event.target.value || null)}>
              <NativeSelectOption value="" disabled={!plugin}>More</NativeSelectOption>
              {[...new Set(generators.map(entry => entry.plugin.name))].map(name => (
                <NativeSelectOptGroup key={name} label={name}>
                  {generators.filter(entry => entry.plugin.name === name).map(entry => <NativeSelectOption key={entry.id} value={entry.id}>{entry.generator.programName}</NativeSelectOption>)}
                </NativeSelectOptGroup>
              ))}
            </NativeSelect>
          ) : null}
        </div>
      </div>
      {plugin ? <PluginInputForm key={plugin.id} entry={plugin} document={document} molecule={pluginMolecule} actions={actions} /> : <>
      <div className="workbench-form">
        <div className="workbench-grid">
          <label className="workbench-field">
            <span>Calculation</span>
            <NativeSelect size="sm" aria-label="Calculation" value={task} onChange={(event) => setTask(event.target.value as QuantumTask)}>
              {features.tasks.map(value => <NativeSelectOption key={value} value={value}>{TASKS[value]}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="workbench-field">
            <span>Method</span>
            <Input variant="compact" value={method} list={`${listId}-methods`} spellCheck={false} autoComplete="off" onChange={(event) => setMethod(event.target.value)} />
            <datalist id={`${listId}-methods`}>{SUGGESTIONS[engine].methods.map(value => <option key={value} value={value} />)}</datalist>
          </label>
          <label className="workbench-field">
            <span>Basis set</span>
            <Input variant="compact" value={basis} list={`${listId}-bases`} spellCheck={false} autoComplete="off" onChange={(event) => setBasis(event.target.value)} />
            <datalist id={`${listId}-bases`}>{SUGGESTIONS[engine].bases.map(value => <option key={value} value={value} />)}</datalist>
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
          {zmatrixEngine ? (
            <label className="workbench-field">
              <span>Coordinates</span>
              <NativeSelect size="sm" aria-label="Coordinates" value={coordinates} onChange={(event) => setCoordinates(event.target.value as CoordinateStyle)}>
                <NativeSelectOption value="cartesian">Cartesian</NativeSelectOption>
                <NativeSelectOption value="zmatrix">Z-matrix</NativeSelectOption>
              </NativeSelect>
            </label>
          ) : null}
          {features.solvation.length ? <>
            <label className="workbench-field">
              <span>Solvation</span>
              <NativeSelect size="sm" aria-label="Solvation" value={solvation?.model ?? ""} onChange={(event) => setSolventModel(event.target.value as SolventModel | "")}>
                <NativeSelectOption value="">Gas phase</NativeSelectOption>
                {features.solvation.map(value => <NativeSelectOption key={value} value={value}>{SOLVENT_MODELS[value]}</NativeSelectOption>)}
              </NativeSelect>
            </label>
            {solvation ? (
              <label className="workbench-field">
                <span>Solvent</span>
                <NativeSelect size="sm" aria-label="Solvent" value={solvation.solvent} onChange={(event) => setSolvent(event.target.value as Solvent)}>
                  {solvents.map(value => <NativeSelectOption key={value} value={value}>{SOLVENTS[value].label}</NativeSelectOption>)}
                </NativeSelect>
              </label>
            ) : null}
          </> : null}
          <label className="workbench-field">
            <span>Dispersion</span>
            <NativeSelect size="sm" aria-label="Dispersion" value={effectiveDispersion ?? ""} onChange={(event) => setDispersion(event.target.value as Dispersion | "")}>
              <NativeSelectOption value="">None</NativeSelectOption>
              {features.dispersion.map(value => <NativeSelectOption key={value} value={value}>{DISPERSIONS[value]}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="workbench-field">
            <span>SCF convergence</span>
            <NativeSelect size="sm" aria-label="SCF convergence" value={scf} onChange={(event) => setScf(event.target.value as ScfConvergence | "")}>
              <NativeSelectOption value="">Default</NativeSelectOption>
              {(Object.keys(SCF) as ScfConvergence[]).map(value => <NativeSelectOption key={value} value={value}>{SCF[value]}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          {features.resources ? <>
            <label className="workbench-field">
              <span>Cores</span>
              <NativeSelect size="sm" aria-label="Cores" value={String(cores)} onChange={(event) => setCores(Number(event.target.value))}>
                <NativeSelectOption value="0">Default</NativeSelectOption>
                {CORES.map(value => <NativeSelectOption key={value} value={String(value)}>{value}</NativeSelectOption>)}
              </NativeSelect>
            </label>
            <label className="workbench-field">
              <span>Memory</span>
              <NativeSelect size="sm" aria-label="Memory" value={String(memoryGb)} onChange={(event) => setMemoryGb(Number(event.target.value))}>
                <NativeSelectOption value="0">Default</NativeSelectOption>
                {MEMORY_GB.map(value => <NativeSelectOption key={value} value={String(value)}>{value} GB</NativeSelectOption>)}
              </NativeSelect>
            </label>
          </> : null}
          <label className="workbench-field">
            <span>Title</span>
            <Input variant="compact" value={title} maxLength={80} placeholder={engine === "gaussian" ? "Burette calculation" : undefined} spellCheck={false} autoComplete="off" onChange={(event) => setTitle(event.target.value)} />
          </label>
        </div>
        {engine === "gaussian" ? (
          <label className="workbench-switch">
            <Switch checked={checkpoint} onCheckedChange={setCheckpoint} />
            <span>Checkpoint file</span>
          </label>
        ) : null}
        {requestedConstraints.length ? (
          <label className="workbench-switch" title={OPTIMIZING.includes(task) ? undefined : "Constraints apply to geometry optimizations"}>
            <Switch checked={useConstraints && OPTIMIZING.includes(task)} disabled={!OPTIMIZING.includes(task)} onCheckedChange={setUseConstraints} />
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
      {(!atoms || awaitingCell) && (source.loading || readingPdb) ? <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Reading structure</span> : null}
      {sourceError ?? (engine === "cp2k" && useCell ? cellRead.error : null) ?? generated?.error ?? exportError ? <p role="alert" className="workbench-error">{sourceError ?? (engine === "cp2k" && useCell ? cellRead.error : null) ?? generated?.error ?? exportError}</p> : null}
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
      </>}
    </>
  );
}
