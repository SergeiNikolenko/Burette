import { beforeAll, expect, test } from "bun:test";
import { act } from "react";
import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import { Molecule } from "openchemlib";
import { fixture } from "./measurement-pair-fixture";
import type { GraphEditResult } from "../apps/desktop/src/lib/molecular-workbench/graph-edit";
const { useGraphDraft } = await import("../apps/desktop/src/components/workbench/use-graph-draft");

let rdkit: MainModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });

// Tetrahedral methane, C–H 1.09 Å, every hydrogen explicit.
const h = 0.6293;
const methane = ["methane", "  hand-written", "",
  "  5  4  0  0  0  0  0  0  0  0999 V2000",
  ...[[0, 0, 0, "C"], [h, h, h, "H"], [-h, -h, h, "H"], [-h, h, -h, "H"], [h, -h, -h, "H"]]
    .map(([x, y, z, e]) => `${[x, y, z].map(v => (v as number).toFixed(4).padStart(10)).join("")} ${String(e).padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`),
  ...[2, 3, 4, 5].map(i => `  1${String(i).padStart(3)}  1  0`), "M  END", ""].join("\n");

/** Canonical heavy-atom SMILES as RDKit reads the drawn graph. */
const smiles = (structure: GraphEditResult) => {
  const mol = rdkit.get_mol(structure.molfile, JSON.stringify({ removeHs: true }))!;
  try { return mol.get_smiles(); } finally { mol.delete(); }
};
const canonical = (text: string) => { const mol = rdkit.get_mol(text)!; try { return mol.get_smiles(); } finally { mol.delete(); } };
/** Every atom has its full valence as explicit bonds: nothing is left implicit. */
const implicitHydrogens = (structure: GraphEditResult) => {
  const mol = Molecule.fromMolfile(structure.molfile);
  return Array.from({ length: mol.getAllAtoms() }, (_, i) => mol.getImplicitHydrogens(i)).reduce((a, b) => a + b, 0);
};
const length = (s: GraphEditResult, a: number, b: number) => Math.hypot(s.atoms[a].x - s.atoms[b].x, s.atoms[a].y - s.atoms[b].y, s.atoms[a].z - s.atoms[b].z);

test("drawing ethanol from methane in two drags gives RDKit's ethanol, and Undo walks back one stroke at a time", async () => {
  const view = await fixture("mol", useGraphDraft, methane);
  try {
    const start = view.graph.history!.current;
    // Drag from the carbon past the first hydrogen: that hydrogen gives way to the new carbon.
    const ethane = (await view.apply({ kind: "draw", hydrogens: true, stroke: { kind: "bonded-atom", from: 0, toward: [3 * h, 3 * h, 3 * h], element: "C", order: 1 } }))!;
    expect(view.graph.error).toBeNull();
    expect([smiles(ethane), ethane.atoms.length, implicitHydrogens(ethane)]).toEqual([canonical("CC"), 8, 0]);
    // The kept carbon and hydrogens are the source atoms; the removed H is the one the drag pointed at.
    expect(ethane.sourceAtomIndices.filter(i => i >= 0).sort()).toEqual([0, 2, 3, 4]);
    const second = ethane.atoms.findIndex((atom, i) => atom.element === "C" && i !== 0);
    expect(length(ethane, 0, second)).toBeCloseTo(1.52, 2);
    expect(ethane.atoms[second].x).toBeGreaterThan(0.8);

    const ethanol = (await view.apply({ kind: "draw", hydrogens: true, stroke: { kind: "bonded-atom", from: second, toward: [ethane.atoms[second].x + 1, ethane.atoms[second].y + 1, ethane.atoms[second].z - 1], element: "O", order: 1 } }))!;
    expect([smiles(ethanol), ethanol.atoms.length, implicitHydrogens(ethanol)]).toEqual([canonical("CCO"), 9, 0]);
    const oxygen = ethanol.atoms.findIndex(atom => atom.element === "O");
    const carbon = ethanol.atoms.findIndex((_, i) => ethanol.sourceAtomIndices[i] === second);
    expect(length(ethanol, carbon, oxygen)).toBeCloseTo(1.42, 2);
    // The new hydroxyl hydrogen sits on the oxygen at a bond length.
    const hydroxyl = ethanol.bonds.find(bond => (bond.a === oxygen || bond.b === oxygen) && ethanol.atoms[bond.a + bond.b - oxygen].element === "H")!;
    expect(length(ethanol, hydroxyl.a, hydroxyl.b)).toBeGreaterThan(0.9);
    expect(length(ethanol, hydroxyl.a, hydroxyl.b)).toBeLessThan(1.05);

    const afterEthane = view.graph.history!.undo.at(-1)!;
    await act(async () => view.graph.undo());
    expect(view.graph.history!.current).toBe(afterEthane);
    await act(async () => view.graph.undo());
    expect(view.graph.history!.current).toBe(start);
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(start.text);
    await act(async () => view.graph.redo());
    await act(async () => view.graph.redo());
    expect(smiles(view.graph.history!.current.structure)).toBe(canonical("CCO"));
  } finally { await view.close(); }
});

test("clicking a bond cycles its order and the hydrogens follow; clicking an atom sets its element", async () => {
  const view = await fixture("mol", useGraphDraft, methane);
  try {
    const ethane = (await view.apply({ kind: "draw", hydrogens: true, stroke: { kind: "bonded-atom", from: 0, toward: [3 * h, 3 * h, 3 * h], element: "C", order: 1 } }))!;
    const second = ethane.atoms.findIndex((atom, i) => atom.element === "C" && i !== 0);
    const ethene = (await view.apply({ kind: "draw", hydrogens: true, stroke: { kind: "cycle-bond", a: 0, b: second } }))!;
    expect([smiles(ethene), ethene.atoms.length, implicitHydrogens(ethene)]).toEqual([canonical("C=C"), 6, 0]);
    const c1 = ethene.atoms.findIndex(atom => atom.element === "C"), c2 = ethene.atoms.findIndex((atom, i) => atom.element === "C" && i !== c1);
    const ethyne = (await view.apply({ kind: "draw", hydrogens: true, stroke: { kind: "cycle-bond", a: c1, b: c2 } }))!;
    expect([smiles(ethyne), ethyne.atoms.length]).toEqual([canonical("C#C"), 4]);
    // Triple wraps back to single, and both carbons get their hydrogens again.
    const back = (await view.apply({ kind: "draw", hydrogens: true, stroke: { kind: "cycle-bond", a: 0, b: 1 } }))!;
    expect([smiles(back), back.atoms.length, implicitHydrogens(back)]).toEqual([canonical("CC"), 8, 0]);
    // Carbon to nitrogen drops one hydrogen to keep the valence: methylamine.
    const amine = (await view.apply({ kind: "draw", hydrogens: true, stroke: { kind: "element", atom: 1, element: "N" } }))!;
    expect([smiles(amine), amine.atoms.length, implicitHydrogens(amine)]).toEqual([canonical("CN"), 7, 0]);
    // The same element again changes nothing and adds no Undo step.
    const steps = view.graph.history!.undo.length;
    expect(await view.apply({ kind: "draw", hydrogens: true, stroke: { kind: "element", atom: 1, element: "N" } })).toBeNull();
    expect([view.graph.history!.undo.length, view.graph.error]).toEqual([steps, null]);
  } finally { await view.close(); }
});

test("a click on empty space adds a separate atom with its hydrogens, and without hydrogens only the atom", async () => {
  const view = await fixture("mol", useGraphDraft, methane);
  try {
    const water = (await view.apply({ kind: "draw", hydrogens: true, stroke: { kind: "atom", element: "O", position: [5, 0, 0] } }))!;
    expect([smiles(water), water.atoms.length, implicitHydrogens(water)]).toEqual([canonical("C.O"), 8, 0]);
    const bare = (await view.apply({ kind: "draw", hydrogens: false, stroke: { kind: "atom", element: "N", position: [-5, 0, 0] } }))!;
    expect(bare.atoms.length).toBe(9);
    expect(bare.atoms.at(-1)!.element).toBe("N");
  } finally { await view.close(); }
});
