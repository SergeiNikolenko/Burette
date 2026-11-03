import { parseMolecule } from "../molecular-workbench/molecular-graph";
import { buildPolymer } from "../molecular-workbench/polymer";
import { applyFragmentEdit, placeFragment } from "../molecular-workbench/fragment-insertion";
import { fragmentTemplate } from "../molecular-workbench/fragment-source";
import { optimize } from "../molecular-workbench/chemistry";
import { sdfFromGraph, unsupportedAtomMetadata } from "./formats";
import { POLYMER_END_GROUPS, POLYMER_RELAXATION_ATOMS, type PolymerInput, type PolymerRequest, type PolymerResult } from "./polymer-task";

async function build(data: PolymerRequest, source: ReturnType<typeof parseMolecule>): Promise<PolymerResult> {
  const graph = buildPolymer(source.atoms, source.bonds, data.options);
  let { atoms, bonds } = graph, sourceAtomIndices = [...graph.sourceAtomIndices], repeatIndices = [...graph.repeatIndices], terminals = { ...graph.terminals };
  for (const end of ["head", "tail"] as const) {
    const group = data.ends ? POLYMER_END_GROUPS[data.ends[end]] : null;
    if (group === undefined) throw new Error("Unsupported polymer end group.");
    if (!group) continue;
    const template = await fragmentTemplate(group, true), hydrogen = terminals[end];
    if (template.charges.some(Boolean)) throw new Error("Polymer end groups must be neutral.");
    const anchor = bonds.find(bond => bond.a === hydrogen || bond.b === hydrogen)!;
    const placement = placeFragment({ atoms, bonds }, template, { anchor: anchor.a === hydrogen ? anchor.b : anchor.a, leaving: [{ position: [atoms[hydrogen].x, atoms[hydrogen].y, atoms[hydrogen].z], atom: hydrogen }] });
    const merged = applyFragmentEdit(atoms, bonds, placement.edit);
    atoms = merged.atoms; bonds = merged.bonds;
    sourceAtomIndices = merged.source.map(i => i < 0 ? -1 : sourceAtomIndices[i]);
    repeatIndices = merged.source.map(i => i < 0 ? -1 : repeatIndices[i]);
    terminals = { head: merged.source.indexOf(terminals.head), tail: merged.source.indexOf(terminals.tail) };
  }
  let sdf = sdfFromGraph(atoms, bonds, "Polymer"), relaxation: PolymerResult["relaxation"];
  if (data.relax) {
    if (atoms.length > POLYMER_RELAXATION_ATOMS) throw new Error(`Relaxation supports polymers of up to ${POLYMER_RELAXATION_ATOMS} atoms.`);
    const structure = parseMolecule(sdf, "sdf"), result = optimize(structure, { forceField: "MMFF94", maxIterations: 1000 });
    if (result.molecule.atoms.some((atom, i) => atom.element !== atoms[i].element)) throw new Error("Relaxation changed the atom order.");
    sdf = sdfFromGraph(result.molecule.atoms, bonds, "Polymer");
    relaxation = { forceField: "MMFF94", initialEnergy: result.initialEnergy, energy: result.energy, unit: "kcal/mol", converged: result.converged };
  }
  return { sdf, atomCount: atoms.length, bondCount: bonds.length, sourceAtomIndices, repeatIndices, repeatAlternatives: graph.repeatAlternatives, ...(relaxation ? { relaxation } : {}) };
}

self.onmessage = async ({ data }: MessageEvent<PolymerRequest | (PolymerInput & { action: "source" })>) => {
  try {
    const source = parseMolecule(data.text, data.format);
    const unsupported = unsupportedAtomMetadata(source.molfile);
    if (unsupported) throw new Error(`Polymer construction does not preserve ${unsupported}.`);
    self.postMessage({ ok: true, result: data.action === "source" ? source : await build(data, source) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
