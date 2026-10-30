import { useEffect, useState } from "react";
import { runChemistryTask, type ChemistryResults } from "../../lib/molecular-workbench/compute-client";
import type { MolecularForceField } from "../../lib/molecular-workbench/forcefield";
import type { MinimizerMethod } from "../../lib/molecular-workbench/minimizer";
import { HARTREE_KCAL_MOL, fileStem, forcesCsv, sdfRecord } from "../../lib/workbench/formats";
import { openGeneratedStructure, openScientificDocument } from "../../lib/workbench/generated-document-open";
import type { ShellActions } from "../types";
import type { ViewerDocument } from "../../types";
import { Button } from "../ui/button";
import { DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { toast } from "../ui/toast";
import { structureEditAvailable } from "../../lib/workbench/graph-draft";
import { OptimizeButton, optimizerLabel } from "./optimize-button";
import { useGraphDraft, type GraphOperation } from "./use-graph-draft";
import { useCancellableJob, useWorkbenchSource } from "./use-workbench-source";

type Properties = ChemistryResults["properties"];
type Operation = "add-hydrogens" | "remove-hydrogens" | "optimize";
const OPERATION_LABELS: Record<Operation, string> = { "add-hydrogens": "Add hydrogens", "remove-hydrogens": "Remove hydrogens", optimize: "Optimize" };
const OPERATION_SUFFIX: Record<Operation, string> = { "add-hydrogens": "with-h", "remove-hydrogens": "no-h", optimize: "mmff94" };
const FORCES_ATOM_LIMIT = 64;

function rows(properties: Properties, energy: number | null): [string, string][] {
  return [
    ["Formula", properties.formula],
    ["Molecular weight", `${properties.molecularWeight.toFixed(3)} g/mol`],
    ["Exact mass", `${properties.exactMass.toFixed(4)} Da`],
    ["Atoms", String(properties.atomCount)],
    ["Bonds", String(properties.bondCount)],
    ["Net charge", `${properties.charge > 0 ? "+" : ""}${properties.charge} e`],
    ["H-bond donors", String(properties.hydrogenBondDonors)],
    ["H-bond acceptors", String(properties.hydrogenBondAcceptors)],
    ["Rotatable bonds", String(properties.rotatableBonds)],
    ["Polar surface area", `${properties.polarSurfaceArea.toFixed(2)} Å²`],
    ["cLogP", properties.logP.toFixed(2)],
    ...(energy === null ? [] : [["MMFF94 energy", `${energy.toFixed(3)} kcal/mol`] as [string, string]]),
  ];
}

export function PropertiesDialogBody({ document, actions, onDone }: { document: ViewerDocument; actions: ShellActions; onDone: () => void }) {
  const source = useWorkbenchSource(document, { graph: true });
  const structure = source.structure;
  const [computedValues, setValues] = useState<{ structure: typeof structure; properties: Properties; energy: number | null } | null>(null);
  const [computedError, setValuesError] = useState<{ structure: typeof structure; message: string } | null>(null);
  const values = computedValues?.structure === structure ? computedValues : null;
  const valuesError = computedError?.structure === structure ? computedError.message : null;
  const job = useCancellableJob(source.revision);
  // SDF/MOL documents change in place: the result is an undoable step of the document's
  // own draft, continued in the Edit tab. Other formats have no explicit graph to edit
  // and open the result as a new document.
  const inPlace = structureEditAvailable(document);
  const graph = useGraphDraft(inPlace ? document : null);
  const runInPlace = async (operation: GraphOperation) => {
    if (!await graph.apply(operation)) return;
    actions.openDockTab("right", "structure-edit");
    onDone();
  };

  useEffect(() => {
    setValues(null);
    setValuesError(null);
    if (!structure) return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const properties = await runChemistryTask({ action: "properties", molecule: structure }, { signal: controller.signal });
        // MMFF94 needs explicit hydrogens; the other properties do not.
        const energy = await runChemistryTask({ action: "energy", molecule: structure }, { signal: controller.signal }).catch(() => null);
        if (!controller.signal.aborted) setValues({ structure, properties, energy });
      } catch (error) {
        if (!controller.signal.aborted) setValuesError({ structure, message: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => controller.abort();
  }, [structure]);

  const runOperation = async (operation: Operation, method?: MinimizerMethod, forceField: MolecularForceField = "MMFF94") => {
    if (!structure) return;
    const result = await job.run(OPERATION_LABELS[operation], async (signal) => {
      if (operation === "optimize") {
        const optimized = await runChemistryTask({ action: "optimize", molecule: structure, options: { method, forceField } }, { signal, timeoutMs: 300_000 });
        const steps = optimized.iterations === undefined ? "" : `, ${optimized.iterations} step${optimized.iterations === 1 ? "" : "s"}`;
        return { molfile: optimized.molecule.molfile, frames: optimized.frames,
          note: `${forceField}, ${optimizerLabel(method)}: ${optimized.initialEnergy.toFixed(2)} → ${optimized.energy.toFixed(2)} kcal/mol${steps}${optimized.converged ? "" : ", not converged"}` };
      }
      const changed = await runChemistryTask({ action: operation, molecule: structure }, { signal });
      return { molfile: changed.molfile, frames: undefined, note: null };
    });
    if (!result) return;
    const stem = `${fileStem(document.title)}-${operation === "optimize" ? forceField.toLowerCase() : OPERATION_SUFFIX[operation]}`;
    // Numerical minimizers report every step; the steps open as a trajectory the Plots tab can chart.
    const frames = result.frames;
    if (result.note) toast.add({ title: `${forceField} optimization`, description: result.note, ...(frames && frames.length > 1 ? { actionProps: {
      children: "Open steps",
      onClick: () => void openScientificDocument(actions, `${stem}-steps`, {
        format: "xyz", atoms: frames[0].atoms, modes: [], orbitals: [],
        frames: frames.map((frame) => ({ atoms: frame.atoms, energyHartree: frame.energy / HARTREE_KCAL_MOL })),
      }, "steps"),
    } } : {}) });
    await openGeneratedStructure(actions, stem, "sdf", sdfRecord(result.molfile));
    onDone();
  };

  const exportForces = async () => {
    if (!structure) return;
    const result = await job.run("Calculating forces…", (signal) => runChemistryTask({ action: "energy-forces", molecule: structure }, { signal }));
    if (!result) return;
    await actions.saveKetcherExportFile({ title: `${fileStem(document.title)}-mmff94-forces.csv`, extension: "csv",
      text: forcesCsv(structure.atoms.map((atom) => atom.element), [{ energy: result.energy, forces: result.forces }]) });
  };

  const exportCharges = async () => {
    if (!structure) return;
    const result = await job.run("Calculating charges…", (signal) => runChemistryTask({ action: "charges", molecule: structure }, { signal }));
    if (!result) return;
    await actions.saveKetcherExportFile({ title: `${fileStem(document.title)}-gasteiger-charges.csv`, extension: "csv",
      text: ["atom,element,charge_e", ...result.charges.map((charge, index) => `${index + 1},${structure.atoms[index].element},${charge.toPrecision(12)}`)].join("\n") + "\n" });
  };

  const error = source.error ?? source.structureError ?? valuesError ?? job.error ?? (inPlace ? graph.error : null);
  const running = job.running ?? (graph.busy ? "Applying…" : null);
  const cancel = graph.busy ? graph.cancel : job.cancel;
  const ready = inPlace ? Boolean(graph.history) : Boolean(structure);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Properties</DialogTitle>
        <DialogDescription className="truncate" title={document.title}>{document.title}</DialogDescription>
      </DialogHeader>
      {values ? (
        <dl className="workbench-properties">
          {rows(values.properties, values.energy).map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
          <div>
            <dt>Gasteiger charges</dt>
            <dd><Button type="button" variant="ghost" size="xs" disabled={Boolean(job.running)} onClick={() => void exportCharges()}>Export CSV</Button></dd>
          </div>
          {values.energy !== null && structure && structure.atoms.length <= FORCES_ATOM_LIMIT ? (
            <div>
              <dt>MMFF94 forces</dt>
              <dd><Button type="button" variant="ghost" size="xs" disabled={Boolean(job.running)} onClick={() => void exportForces()}>Export CSV</Button></dd>
            </div>
          ) : null}
        </dl>
      ) : !error ? <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Calculating…</span> : null}
      {error ? <p role="alert" className="workbench-error">{error}</p> : null}
      <DialogFooter>
        {running ? (
          <>
            <span role="status" className="workbench-status mr-auto"><Spinner aria-hidden className="size-3" />{running}</span>
            <Button type="button" variant="secondary" onClick={cancel}>Cancel</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" className="mr-auto" disabled={!ready}
              onClick={() => void (inPlace ? runInPlace({ kind: "remove-hydrogens" }) : runOperation("remove-hydrogens"))}>Remove hydrogens</Button>
            <Button type="button" variant="secondary" disabled={!ready}
              onClick={() => void (inPlace ? runInPlace({ kind: "add-hydrogens" }) : runOperation("add-hydrogens"))}>Add hydrogens</Button>
            <OptimizeButton atomCount={structure?.atoms.length ?? 0} disabled={!ready}
              onOptimize={(method, forceField) => void (inPlace ? runInPlace({ kind: "optimize", method, forceField }) : runOperation("optimize", method, forceField))} />
          </>
        )}
      </DialogFooter>
    </>
  );
}

import "./workbench-layout.css";
