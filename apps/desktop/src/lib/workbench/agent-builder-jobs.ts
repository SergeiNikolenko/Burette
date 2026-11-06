import { runChemistryTask } from "../molecular-workbench/compute-client";
import { runGraphTask } from "../molecular-workbench/graph-compute-client";
import type { GraphEdit, GraphEditResult } from "../molecular-workbench/graph-edit";
import type { WorkbenchGraphEdit } from "../../../../../scripts/workbench-agent-contract.mjs";
import { runFragmentTask } from "./fragment-task";
import { preparePolymerRequest, runPolymerTask } from "./polymer-task";
import { runPeptideTask } from "./peptide-task";
import { runMetalComplexTask } from "./metal-complex-task";
import { runNucleicTask } from "./nucleic-task";
import type { MetalLigandId } from "../molecular-workbench/metal-complex";
import { optimizationArtifacts, optimizationSummary } from "./agent-graph-jobs";
import type { Snapshot } from "./agent-source";
import type { AgentBuildRunner, AgentJobContext, AgentJobRunner } from "./agent-jobs";

/** Hill-order formula of explicit atoms with the net formal charge of a V3000 table. */
function formulaOf(elements: readonly string[], molfile: string) {
  const counts = new Map<string, number>();
  for (const element of elements) counts.set(element, (counts.get(element) ?? 0) + 1);
  const carbon = counts.has("C"), rank = (element: string) => carbon && element === "C" ? 0 : carbon && element === "H" ? 1 : 2;
  const order = [...counts.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const charge = [...molfile.matchAll(/ CHG=(-?\d+)/gu)].reduce((sum, match) => sum + Number(match[1]), 0);
  return { formula: order.map(element => `${element}${counts.get(element)! > 1 ? counts.get(element) : ""}`).join(""), formalCharge: charge };
}

function explicitGraph(snapshot: Snapshot): string | null {
  const structure = snapshot.structure;
  if (["sdf", "sd", "mol"].includes(snapshot.extension) && structure?.graphSource === "explicit" && structure.graphComplete) return null;
  return snapshot.structureError ?? "This job requires one explicit MOL or SDF connection table.";
}

/** The edited V3000 table under the source title, as an SDF record or a bare MOL. */
function structureArtifact(input: Snapshot, suffix: string, molfile: string, { stem, artifact }: AgentJobContext) {
  const mol = input.extension === "mol", lines = molfile.replace(/\s+$/u, "").split("\n");
  lines[0] = stem.slice(0, 80);
  return artifact("structure", `${stem}-${suffix}.${mol ? "mol" : "sdf"}`, mol ? "chemical/x-mdl-molfile" : "chemical/x-mdl-sdfile", `${lines.join("\n")}\n${mol ? "" : "$$$$\n"}`);
}

function graphSummary(structure: GraphEditResult, source: number) {
  return { atomCount: structure.atoms.length, bondCount: structure.bonds.length, ...formulaOf(structure.atoms.map(atom => atom.element), structure.molfile),
    sourceAtomCount: source, sourceAtomIndices: structure.sourceAtomIndices };
}

/** Structure edits on an explicit graph. Each returns a new structure artifact; the open document is never changed. */
// The contract's snake_case edits are the Edit tab's own graph edits.
function graphEdit(edit: WorkbenchGraphEdit): GraphEdit {
  switch (edit.kind) {
    case "add_atom": return { kind: "add-atom", element: edit.element, position: edit.position };
    case "update_atom": return { ...edit, kind: "update-atom" };
    case "delete_atoms": return { kind: "delete-atoms", indices: edit.indices };
    case "set_bond": return { kind: "set-bond", a: edit.a, b: edit.b, order: edit.order };
  }
}

export const builderJobs: { [K in "insert_fragment" | "hydrogens" | "polymer" | "graph_edit"]: AgentJobRunner<K> } = {
  insert_fragment: {
    unavailable: explicitGraph,
    paramsUnavailable: (snapshot, { atomIndex }) => atomIndex !== undefined && atomIndex >= snapshot.structure!.atoms.length ? `atomIndex must be below ${snapshot.structure!.atoms.length}.` : null,
    async run(input, { library, smiles, atomIndex }, context) {
      const structure = input.structure!;
      const inserted = await runFragmentTask({ molecule: structure, fragment: library !== undefined ? { source: "library", id: library } : { source: "smiles", smiles: smiles! }, target: atomIndex ?? null }, context);
      return { summary: { ...graphSummary(inserted.structure, structure.atoms.length), fragment: inserted.name.slice(0, 128), addedAtoms: inserted.addedAtoms, anchorAtom: inserted.anchor, replacedAtom: inserted.replaced, bondLengthAngstrom: inserted.bondLength },
        artifacts: [await structureArtifact(input, "fragment", inserted.structure.molfile, context)] };
    },
  },
  hydrogens: {
    unavailable: explicitGraph,
    async run(input, params, context) {
      const { mode } = params, structure = input.structure!, identity = (atoms: number) => ({ kind: "reorder-atoms" as const, order: Array.from({ length: atoms }, (_, i) => i) });
      const hydrogens = structure.atoms.flatMap((atom, index) => atom.element === "H" ? [index] : []);
      let edited: GraphEditResult, protonation = {};
      if (params.mode === "ph") {
        const result = await runChemistryTask({ action: "protonate", molecule: structure, pH: params.pH }, context);
        const ordered = await runGraphTask({ action: "edit-graph", molecule: result.structure, edits: [identity(result.structure.atoms.length)] }, context);
        // Protonation adds and removes hydrogens; provenance comes from the worker.
        edited = { ...ordered, sourceAtomIndices: ordered.sourceAtomIndices.map(index => result.structure.sourceAtomIndices[index]) };
        protonation = { pH: result.pH, changes: result.changes, omittedChanges: result.omittedChanges };
      } else if (mode === "remove") edited = await runGraphTask({ action: "edit-graph", molecule: structure, edits: [hydrogens.length ? { kind: "delete-atoms", indices: hydrogens } : identity(structure.atoms.length)] }, context);
      else {
        const added = await runChemistryTask({ action: "add-hydrogens", molecule: structure }, context);
        const ordered = await runGraphTask({ action: "edit-graph", molecule: added, edits: [identity(added.atoms.length)] }, context);
        // Added hydrogens follow the source atoms, so only the source prefix keeps its provenance.
        edited = { ...ordered, sourceAtomIndices: ordered.sourceAtomIndices.map(index => index < structure.atoms.length ? index : -1) };
      }
      return { summary: { ...graphSummary(edited, structure.atoms.length), mode, ...protonation, changedAtoms: Math.abs(edited.atoms.length - structure.atoms.length) },
        artifacts: [await structureArtifact(input, params.mode === "ph" ? `ph-${params.pH}` : mode === "add" ? "with-h" : "no-h", edited.molfile, context)] };
    },
  },
  polymer: {
    unavailable: explicitGraph,
    paramsUnavailable: (snapshot, params) => [params.head, params.tail, params.headLeaving, params.tailLeaving].some(index => index >= snapshot.structure!.atoms.length) ? `Polymer atom indices must be below ${snapshot.structure!.atoms.length}.` : null,
    async run(input, { head, tail, headLeaving, tailLeaving, count, bondLengthAngstrom, tacticity, headEnd, tailEnd, relax }, context) {
      const polymer = await runPolymerTask(preparePolymerRequest({ text: input.text, format: input.extension === "mol" ? "mol" : "sdf" },
        { head, tail, headLeaving, tailLeaving, count, bondLength: bondLengthAngstrom, endGroups: "hydrogen", tacticity, ends: { head: headEnd, tail: tailEnd }, relax }), context);
      return { summary: { atomCount: polymer.atomCount, bondCount: polymer.bondCount, repeatCount: count, repeatAlternatives: polymer.repeatAlternatives, relaxation: polymer.relaxation ?? null },
        artifacts: [await context.artifact("structure", `${context.stem}-polymer-${count}.sdf`, "chemical/x-mdl-sdfile", polymer.sdf)] };
    },
  },
  graph_edit: {
    unavailable: explicitGraph,
    // Edits apply together or not at all; sourceAtomIndices maps each result atom to its source atom (-1 for added ones).
    async run(input, { edits }, context) {
      const structure = input.structure!;
      const edited = await runGraphTask({ action: "edit-graph", molecule: structure, edits: edits.map(graphEdit) }, context);
      return { summary: { ...graphSummary(edited, structure.atoms.length), editCount: edits.length },
        artifacts: [await structureArtifact(input, "edited", edited.molfile, context)] };
    },
  },
};

/** Documentless builders requested with operation `build`. */
export const buildJobs: { [K in "smiles" | "peptide" | "metal_complex" | "nucleic_acid"]: AgentBuildRunner<K> } = {
  smiles: {
    // The conformer that opening a SMILES produces, relaxed by the optimize engine.
    async run({ smiles, seed, ...options }, context) {
      const conformer = await runChemistryTask({ action: "generate", smiles, seed }, context);
      const result = await runChemistryTask({ action: "optimize", molecule: conformer, options }, context);
      const lines = result.molecule.molfile.replace(/\s+$/u, "").split("\n");
      lines[0] = smiles.slice(0, 80);
      return { summary: { ...optimizationSummary(result), seed, atomCount: result.molecule.atoms.length, bondCount: result.molecule.bonds.length,
        ...formulaOf(result.molecule.atoms.map(atom => atom.element), result.molecule.molfile) },
        artifacts: await optimizationArtifacts(`${lines.join("\n")}\n$$$$\n`, result, "smiles-3d", context) };
    },
  },
  nucleic_acid: {
    async run({ sequence, ...options }, context) {
      const result = await runNucleicTask({ sequence, options }, context);
      return { summary: { sequence: result.sequence, strands: result.strands, residueCount: result.residueCount, atomCount: result.atomCount,
        formula: formulaOf(result.graph.atoms.map(atom => atom.element), "").formula, formalCharge: result.charge },
        artifacts: [await context.artifact("structure", `${result.name}.cif`, "chemical/x-mmcif", result.text)] };
    },
  },
  metal_complex: {
    async run({ ligands, ...options }, context) {
      // Ligand ids are validated against the same list as metal-ligands.json; the core refuses invalid site assignments.
      const result = await runMetalComplexTask({ ...options, ligands: ligands.map(({ ligand, sites, distanceAngstrom }) => ({ ligand: ligand as MetalLigandId, sites, distance: distanceAngstrom })) }, context);
      const { name, formula, charge, atomCount, bondCount, coordinationNumber, geometry } = result;
      return { summary: { name, formula, formalCharge: charge, atomCount, bondCount, coordinationNumber, geometry },
        artifacts: [await context.artifact("structure", `${name}.${result.format}`, result.format === "mol" ? "chemical/x-mdl-molfile" : "chemical/x-mdl-sdfile", result.text)] };
    },
  },
  peptide: {
    async run(params, context) {
      const result = await runPeptideTask({ sequence: params.sequence, codes: params.codes, options: { chirality: params.chirality, phi: params.phiDegrees, psi: params.psiDegrees, nTerminus: params.nTerminus, cTerminus: params.cTerminus, chain: params.chain } }, context);
      return { summary: { sequence: result.sequence, residueCount: result.residueCount, atomCount: result.atomCount, formalCharge: result.charge },
        artifacts: [await context.artifact("structure", `Peptide ${result.sequence.slice(0, 32)}.cif`, "chemical/x-mmcif", result.cif)] };
    },
  },
};
