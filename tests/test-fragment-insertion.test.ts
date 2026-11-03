import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import { parseMolecule, type MolecularStructure } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import { insertFragment } from "../apps/desktop/src/lib/molecular-workbench/fragment-source";
import { sdfFromGraph } from "../apps/desktop/src/lib/workbench/formats";
import library from "../apps/desktop/src/lib/molecular-workbench/fragment-library.json";

let rdkit: MainModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });
const fixture = (name: string) => readFileSync(new URL(`./fixtures/fragments/${name}`, import.meta.url), "utf8");
const benzene = parseMolecule(fixture("benzene-cid241.sdf"), "sdf");
const ethanol = parseMolecule(fixture("ethanol-cid702.sdf"), "sdf");
const isobutane = parseMolecule(fixture("isobutane-cid6360.sdf"), "sdf");
const distance = (s: MolecularStructure, a: number, b: number) => Math.hypot(s.atoms[a].x - s.atoms[b].x, s.atoms[a].y - s.atoms[b].y, s.atoms[a].z - s.atoms[b].z);
const angle = (s: MolecularStructure, a: number, b: number, c: number) => {
  const u = ["x", "y", "z"].map(k => (s.atoms[a] as never)[k] - (s.atoms[b] as never)[k]), v = ["x", "y", "z"].map(k => (s.atoms[c] as never)[k] - (s.atoms[b] as never)[k]);
  return Math.acos(u.reduce((sum, x, i) => sum + x * v[i], 0) / Math.hypot(...u) / Math.hypot(...v)) * 180 / Math.PI;
};
// Constitution only: 3D coordinates of a group define double-bond and center configurations its SMILES omits.
const flat = (smiles: string) => { const mol = rdkit.get_mol(smiles.replace(/[\\/]|@+/gu, ""))!; try { return mol.get_smiles(); } finally { mol.delete(); } };
/** Canonical non-isomeric SMILES as RDKit reads the written graph. */
function canonical(molblock: string) {
  const mol = rdkit.get_mol(molblock, JSON.stringify({ removeHs: true, sanitize: true }));
  if (!mol) throw new Error("RDKit could not read the structure.");
  try { return flat(mol.get_smiles()); } finally { mol.delete(); }
}
const reference = flat;
const neighbours = (s: MolecularStructure, atom: number) => s.bonds.flatMap(bond => bond.a === atom ? [bond.b] : bond.b === atom ? [bond.a] : []);
const ringHydrogen = benzene.atoms.findIndex(atom => atom.element === "H");

test("every library group matches its upstream SMILES in RDKit, including the attachment atom", () => {
  // Upstream lists two SMILES under "phosphine" and none for phosphine oxide; reviewed-names.smi adds it.
  const smiles = new Map<string, string[]>();
  for (const line of `${fixture("groups.smi")}${fixture("reviewed-names.smi")}`.trim().split("\n").filter(line => !line.startsWith("#"))) {
    const [category, value, ...name] = line.split(" "), key = `${category}/${name.join(" ")}`;
    smiles.set(key, [...smiles.get(key) ?? [], value]);
  }
  const fragments = library.fragments as { id: string; category: string; name: string; elements: number[]; coords: number[]; bonds: number[]; charges?: number[] }[];
  expect(fragments).toHaveLength(166);
  const mismatched: string[] = [];
  for (const fragment of fragments) {
    const symbols = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br".split(" ");
    // Francium marks the attachment point in both graphs: it occurs in no group and RDKit gives it valence 1.
    const atoms = fragment.elements.map((z, i) => ({ element: z ? symbols[z - 1] : "Fr", x: fragment.coords[3 * i], y: fragment.coords[3 * i + 1], z: fragment.coords[3 * i + 2] }));
    const bonds = Array.from({ length: fragment.bonds.length / 3 }, (_, i) => ({ a: fragment.bonds[3 * i], b: fragment.bonds[3 * i + 1], order: fragment.bonds[3 * i + 2] }));
    let block = sdfFromGraph(atoms, bonds, fragment.name);
    const charged = (fragment.charges ?? []).flatMap((charge, i) => charge ? [`${String(i + 1).padStart(4)}${String(charge).padStart(4)}`] : []);
    if (charged.length) block = block.replace("M  END", `M  CHG${String(charged.length).padStart(3)}${charged.join("")}\nM  END`);
    const upstream = smiles.get(`${fragment.category.replace(/ /gu, "_")}/${fragment.name}`);
    expect(upstream, fragment.id).toBeDefined();
    if (!upstream!.some(value => canonical(block) === reference(`[Fr]${value.replace(/^\*/u, "")}`))) mismatched.push(fragment.id);
  }
  expect(mismatched).toEqual([]);
});

test("a library group replaces the picked hydrogen along its bond, keeping every existing atom and the group's internal geometry", async () => {
  const result = await insertFragment(benzene, { source: "library", id: "alkanes/ethyl" }, ringHydrogen);
  const out = result.structure;
  expect(canonical(out.molfile)).toBe(reference("CCc1ccccc1"));
  expect(result.replaced).toBe(ringHydrogen);
  const anchor = result.anchor!;
  expect(benzene.atoms[anchor].element).toBe("C");
  // Every surviving source atom keeps its exact coordinates; only the replaced H is gone.
  out.sourceAtomIndices.forEach((source, i) => { if (source >= 0) expect(out.atoms[i]).toEqual(benzene.atoms[source]); });
  expect(out.sourceAtomIndices.filter(i => i >= 0).sort((a, b) => a - b)).toEqual(benzene.atoms.map((_, i) => i).filter(i => i !== ringHydrogen));
  const newAnchor = out.sourceAtomIndices.indexOf(anchor), joined = neighbours(out, newAnchor).find(i => out.sourceAtomIndices[i] < 0)!;
  // C(ar)-C(sp3) mean 1.513 A, Allen et al., J. Chem. Soc. Perkin Trans. 2 1987, S1.
  expect(Math.abs(distance(out, newAnchor, joined) - 1.513)).toBeLessThan(0.03);
  // The new bond follows the replaced C-H direction: both ring C-C-C(ethyl) angles stay at the source C-C-H angles.
  for (const ring of neighbours(out, newAnchor).filter(i => i !== joined)) {
    expect(angle(out, ring, newAnchor, joined)).toBeCloseTo(angle(benzene, out.sourceAtomIndices[ring], anchor, ringHydrogen), 6);
  }
  const template = (library.fragments as { id: string; coords: number[]; elements: number[] }[]).find(f => f.id === "alkanes/ethyl")!;
  const added = out.atoms.map((_, i) => i).filter(i => out.sourceAtomIndices[i] < 0);
  const kept = template.elements.map((z, i) => i).filter(i => template.elements[i] !== 0);
  expect(added).toHaveLength(kept.length);
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
    const t = [0, 1, 2].map(k => template.coords[3 * kept[i] + k] - template.coords[3 * kept[j] + k]);
    expect(distance(out, added[i], added[j])).toBeCloseTo(Math.hypot(...t), 6);
  }
  // No new nonbonded contact is closer than the sum of the H van der Waals radii (Bondi 1964, 2 x 1.2 A).
  for (const i of added) for (let j = 0; j < out.atoms.length; j++) {
    if (out.sourceAtomIndices[j] >= 0 && !neighbours(out, i).includes(j) && !neighbours(out, j).some(k => neighbours(out, i).includes(k))) expect(distance(out, i, j)).toBeGreaterThan(2.0);
  }
});

test("a picked heavy atom attaches through one of its hydrogens; an atom with only free valence uses the Add Hydrogens position", async () => {
  const carbon = ethanol.atoms.findIndex((atom, i) => atom.element === "C" && neighbours(ethanol, i).some(j => ethanol.atoms[j].element === "O"));
  const methylated = await insertFragment(ethanol, { source: "smiles", smiles: "*C" }, carbon);
  expect(canonical(methylated.structure.molfile)).toBe(reference("CC(C)O"));
  expect(ethanol.atoms[methylated.replaced!].element).toBe("H");
  expect(neighbours(ethanol, methylated.replaced!)).toEqual([carbon]);
  // Hydrogen-free benzene keeps free valences on every ring carbon.
  const heavy = rdkit.get_mol(fixture("benzene-cid241.sdf"), JSON.stringify({ removeHs: true }))!;
  const bare = parseMolecule(heavy.get_molblock(), "mol"); heavy.delete();
  expect(bare.atoms.every(atom => atom.element === "C")).toBe(true);
  const biphenyl = await insertFragment(bare, { source: "library", id: "aromatics/phenyl" }, 0);
  expect(biphenyl.replaced).toBeNull();
  expect(canonical(biphenyl.structure.molfile)).toBe(reference("c1ccc(-c2ccccc2)cc1"));
  // C(ar)-C(ar) single bond between rings 1.487 A (biphenyl, Allen et al. 1987).
  expect(Math.abs((biphenyl.bondLength ?? 0) - 1.487)).toBeLessThan(0.03);
});

test("SMILES fragments attach at * or at the first atom, keep formal charges, or insert as a separate molecule", async () => {
  const acid = await insertFragment(benzene, { source: "smiles", smiles: "C(=O)[O-]" }, ringHydrogen);
  expect(canonical(acid.structure.molfile)).toBe(reference("[O-]C(=O)c1ccccc1"));
  const amine = await insertFragment(benzene, { source: "smiles", smiles: "[NH3+]*" }, ringHydrogen);
  expect(canonical(amine.structure.molfile)).toBe(reference("[NH3+]c1ccccc1"));
  const lysine = await insertFragment(benzene, { source: "library", id: "amino_sidechains/lysine" }, ringHydrogen);
  const mol = rdkit.get_mol(lysine.structure.molfile)!;
  expect(JSON.parse(mol.get_descriptors()).NumHeavyAtoms).toBe(11); mol.delete();
  expect(canonical(lysine.structure.molfile)).toBe(reference("[NH3+]CCCCc1ccccc1"));
  const separate = await insertFragment(benzene, { source: "smiles", smiles: "O" }, null);
  expect(canonical(separate.structure.molfile)).toBe(reference("c1ccccc1.O"));
  expect(separate.structure.sourceAtomIndices.slice(0, benzene.atoms.length)).toEqual(benzene.atoms.map((_, i) => i));
  const added = separate.structure.atoms.slice(benzene.atoms.length);
  for (const atom of added) for (const existing of benzene.atoms) expect(Math.hypot(atom.x - existing.x, atom.y - existing.y, atom.z - existing.z)).toBeGreaterThan(2.5);
});

test("named failures leave the structure unchanged", async () => {
  const quaternary = isobutane.atoms.findIndex((atom, i) => atom.element === "C" && neighbours(isobutane, i).filter(j => isobutane.atoms[j].element === "C").length === 3);
  const before = structuredClone(isobutane);
  await expect(insertFragment(benzene, { source: "smiles", smiles: "*C*" }, ringHydrogen)).rejects.toThrow("at most one attachment point");
  await expect(insertFragment(benzene, { source: "smiles", smiles: "C1CC" }, ringHydrogen)).rejects.toThrow("Could not read");
  await expect(insertFragment(benzene, { source: "library", id: "missing/group" }, ringHydrogen)).rejects.toThrow("not in the library");
  await expect(insertFragment(benzene, { source: "smiles", smiles: "C(C)(C)(C)C" }, ringHydrogen)).rejects.toThrow("no hydrogen to replace");
  const tertiary = await insertFragment(isobutane, { source: "smiles", smiles: "*Cl" }, quaternary);
  expect(canonical(tertiary.structure.molfile)).toBe(reference("CC(C)(C)Cl"));
  expect(isobutane).toEqual(before);
});

test("a built graph inserts as one separate molecule with its charges, and refuses an attachment atom", async () => {
  // Glycine zwitterion, NH3+ and CO2-; coordinates are a rigid input, not a reference.
  const atoms = [["N", 0, 0, 0, 1], ["C", 1.47, 0, 0], ["C", 2.0, 1.42, 0], ["O", 1.3, 2.4, 0], ["O", 3.25, 1.5, 0, -1],
    ["H", -0.35, -0.95, 0], ["H", -0.35, 0.47, 0.82], ["H", -0.35, 0.47, -0.82], ["H", 1.83, -0.51, 0.89], ["H", 1.83, -0.51, -0.89]] as const;
  const graph = { source: "graph" as const, name: "Glycine", atoms: atoms.map(([element, x, y, z, charge]) => ({ element, x, y, z, ...(charge ? { charge } : {}) })),
    bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 2], [2, 4, 1], [0, 5, 1], [0, 6, 1], [0, 7, 1], [1, 8, 1], [1, 9, 1]].map(([a, b, order]) => ({ a, b, order: order as 1 | 2 })) };
  const result = await insertFragment(benzene, graph, null);
  expect(canonical(result.structure.molfile)).toBe(reference("c1ccccc1.[NH3+]CC(=O)[O-]"));
  expect(result.addedAtoms).toBe(10);
  await expect(insertFragment(benzene, graph, 0)).rejects.toThrow("separate molecule");
});
