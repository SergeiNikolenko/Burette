import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Molecule } from "openchemlib";
import { buildMetalComplex, COORDINATION_GEOMETRIES, defaultDonorDistance, METAL_COVALENT_RADII, METAL_LIGANDS,
  type MetalComplex, type MetalComplexOptions, type MetalLigandId } from "../apps/desktop/src/lib/molecular-workbench/metal-complex";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import { sdfFromGraph } from "../apps/desktop/src/lib/workbench/formats";
import complexes from "./fixtures/metal-complex/complexes.json";
import reference from "./fixtures/metal-complex/reference.json";
const require = createRequire(import.meta.url);
const { parseSdf } = require("@molstar/io/reader/sdf/parser");
const { trajectoryFromSdf } = require("@molstar/model/formats/structure/sdf");
const { Structure, StructureProperties: P, StructureElement } = require("@molstar/model/model/structure");
const { CIF } = require("@molstar/io/reader/cif");
const { trajectoryFromMmCIF } = require("@molstar/model/formats/structure/mmcif");
const { to_mmCIF } = require("@molstar/model/model/structure/export/mmcif");

type Crystal = { angleTolerance: number; biteTolerance?: number; jahnTellerApical?: string };
type Reference = { rdkit: { formula: string; charge: number; atoms: number; bonds: number; dative: number; donorToMetal: number; metal: string; metalCharge: number; ligandSmiles: string[] };
  openbabel: { formula: string; charge: number; atoms: number; bonds: number; coordination: number };
  crystal?: { cod: string; spheres: { site: string; distances: number[]; angles: number[]; donorDistances: Record<string, number[]> }[] } };
const entries = Object.entries(complexes) as [string, { options: MetalComplexOptions; crystal?: Crystal }][];
const refs = reference.complexes as Record<string, Reference>;
const sdf = (complex: MetalComplex) => sdfFromGraph(complex.atoms, complex.bonds, complex.name, complex.coordination, complex.atoms.map(atom => atom.charge));
const sample = (id: string) => readFileSync(new URL(`fixtures/metal-complex/samples/${id}.sdf`, import.meta.url), "utf8");
const degrees = (u: number[], v: number[]) => Math.acos(Math.max(-1, Math.min(1, u.reduce((s, x, i) => s + x * v[i], 0) / Math.hypot(...u) / Math.hypot(...v)))) * 180 / Math.PI;
const donorVectors = (complex: MetalComplex) => complex.coordination.map(edge => [complex.atoms[edge.a].x, complex.atoms[edge.a].y, complex.atoms[edge.a].z]);
const sortedAngles = (vectors: number[][]) => vectors.flatMap((u, i) => vectors.slice(i + 1).map(v => degrees(u, v))).sort((a, b) => a - b);
// Ligand identity independent of the templates: PubChem structures written as RDKit canonical SMILES (H removed, metal deleted).
const LIGAND_SMILES: Record<MetalLigandId, string> = { aqua: "O", hydroxido: "[OH-]", ammine: "N", fluorido: "[F-]", chlorido: "[Cl-]", bromido: "[Br-]", iodido: "[I-]",
  cyanido: "[C-]#N", carbonyl: "[C-]#[O+]", phosphane: "P", trimethylphosphane: "CP(C)C", pyridine: "c1ccncc1", ethylenediamine: "NCCN",
  bipyridine: "c1ccc(-c2ccccn2)nc1", phenanthroline: "c1cnc2c(c1)ccc1cccnc12", oxalato: "O=C([O-])C(=O)[O-]", acetylacetonato: "CC(=O)C=C(C)[O-]" };

test("the builder reproduces the exact SDF bytes RDKit and Open Babel read back, with formula, charge, graph and ligands intact", () => {
  for (const [id, { options }] of entries) {
    const complex = buildMetalComplex(options), text = sdf(complex), ref = refs[id], sites = COORDINATION_GEOMETRIES[options.geometry].sites.length;
    expect(text, id).toBe(sample(id));
    const bonds = complex.bonds.length + complex.coordination.length;
    expect({ formula: complex.formula, charge: complex.charge, atoms: complex.atoms.length, bonds, coordination: complex.coordination.length }, id)
      .toEqual({ formula: ref.openbabel.formula.replace(/[+-]+$/u, ""), charge: ref.openbabel.charge, atoms: ref.openbabel.atoms, bonds: ref.openbabel.bonds, coordination: sites });
    expect(ref.openbabel.coordination, id).toBe(sites);
    expect({ charge: ref.rdkit.charge, atoms: ref.rdkit.atoms, bonds: ref.rdkit.bonds, dative: ref.rdkit.dative, donorToMetal: ref.rdkit.donorToMetal, metal: ref.rdkit.metal, metalCharge: ref.rdkit.metalCharge }, id)
      .toEqual({ charge: complex.charge, atoms: complex.atoms.length, bonds, dative: sites, donorToMetal: sites, metal: options.metal, metalCharge: options.oxidationState });
    expect(ref.rdkit.ligandSmiles, id).toEqual(options.ligands.map(ligand => LIGAND_SMILES[ligand.ligand]).sort());
  }
});

test("donor–metal–donor angles match COD crystal structures; chelate bites match within the rigid-template tolerance", () => {
  for (const [id, { options, crystal }] of entries) {
    if (!crystal) continue;
    const complex = buildMetalComplex(options), ours = sortedAngles(donorVectors(complex)), chelates = options.ligands.filter(ligand => ligand.sites.length === 2).length;
    const spheres = refs[id].crystal!.spheres;
    expect(spheres.length, id).toBeGreaterThan(0);
    for (const sphere of spheres) {
      // Same cis/trans pattern; ideal polyhedra cannot follow crystal distortions (Jahn–Teller, trigonal twist) beyond the stated tolerance.
      expect(sphere.angles.filter(angle => angle >= 135).length, `${id} ${sphere.site} trans count`).toBe(ours.filter(angle => angle >= 135).length);
      expect(Math.max(...sphere.angles.map((angle, index) => Math.abs(angle - ours[index]))), `${id} ${sphere.site}`).toBeLessThanOrEqual(crystal.angleTolerance);
      if (chelates) expect(Math.max(...ours.slice(0, chelates).map((angle, index) => Math.abs(angle - sphere.angles[index]))), `${id} bite`).toBeLessThanOrEqual(crystal.biteTolerance!);
    }
  }
});

test("default metal–donor distances (Cordero covalent radii) are within 0.25 Å of crystal means and match Open Babel's radii", () => {
  for (const [metal, radius] of Object.entries(METAL_COVALENT_RADII)) expect(Math.abs(radius - (reference.openbabelCovalentRadii as Record<string, number>)[metal]), metal).toBeLessThanOrEqual(0.011);
  for (const [id, { options, crystal }] of entries) {
    if (!crystal) continue;
    for (const ligand of options.ligands) {
      const template = METAL_LIGANDS[ligand.ligand], element = template.atoms[template.donors[0]][0];
      if (element === crystal.jahnTellerApical) continue;
      for (const sphere of refs[id].crystal!.spheres) {
        const values = sphere.donorDistances[element], mean = values.reduce((a, b) => a + b, 0) / values.length;
        expect(Math.abs(defaultDonorDistance(options.metal, ligand.ligand) - mean), `${id} ${options.metal}–${element}`).toBeLessThanOrEqual(0.25);
      }
    }
  }
});

test("each ligand keeps its template geometry and points its template lone-pair direction at the metal", () => {
  const complex = buildMetalComplex(complexes["mixed-octahedral"].options as MetalComplexOptions);
  let offset = 1;
  for (const assignment of complexes["mixed-octahedral"].options.ligands) {
    const template = METAL_LIGANDS[assignment.ligand as MetalLigandId], points = template.atoms.map(atom => [atom[1], atom[2], atom[3]]);
    const placed = points.map((_, index) => complex.atoms[offset + index]).map(atom => [atom.x, atom.y, atom.z]);
    for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++)
      expect(Math.hypot(...placed[a].map((v, k) => v - placed[b][k])) - Math.hypot(...points[a].map((v, k) => v - points[b][k]))).toBeCloseTo(0, 6);
    for (const donor of template.donors) for (const [x, y] of template.bonds.filter(bond => bond[0] === donor || bond[1] === donor)) {
      const neighbor = x === donor ? y : x, toMetal = (from: number[]) => from.map(v => -v);
      const ours = degrees(toMetal(placed[donor]), placed[neighbor].map((v, k) => v - placed[donor][k]));
      const ideal = degrees(template.metal.map((v, k) => v - points[donor][k]), points[neighbor].map((v, k) => v - points[donor][k]));
      // Monodentate donors keep the template M–D–X angle exactly; chelate donors move with the bite.
      if (template.donors.length === 1) expect(ours - ideal, assignment.ligand).toBeCloseTo(0, 6);
      else expect(Math.abs(ours - ideal), assignment.ligand).toBeLessThan(6);
    }
    offset += points.length;
  }
  expect(buildMetalComplex(complexes["mixed-octahedral"].options as MetalComplexOptions)).toEqual(complex);
});

test("our ideal polyhedra match the Avogadro 2 center templates; its square pyramid is a different C4v choice", () => {
  for (const [geometry, { sites }] of Object.entries(COORDINATION_GEOMETRIES)) {
    const avogadro = (reference.avogadroCenters as Record<string, { angles: number[] }>)[geometry].angles, ours = sortedAngles(sites.map(site => [...site[1]]));
    if (geometry === "square-pyramidal") { expect(ours.filter(angle => angle > 135)).toEqual([180, 180]); expect(avogadro.filter(angle => angle > 135)).toEqual([]); continue; }
    expect(Math.max(...avogadro.map((angle, index) => Math.abs(angle - ours[index]))), geometry).toBeLessThanOrEqual(0.2);
  }
});

test("Burette's OpenChemLib reader and Mol* read the coordination bonds and formal charges back", async () => {
  for (const [id, { options }] of entries) {
    const complex = buildMetalComplex(options), text = sample(id), parsed = parseMolecule(text, "sdf");
    expect(parsed.atoms.map(atom => atom.element), id).toEqual(complex.atoms.map(atom => atom.element));
    expect(parsed.bonds.filter(bond => bond.order === 0).map(bond => [bond.a, bond.b].sort((a, b) => a - b).join("-")).sort(), id)
      .toEqual(complex.coordination.map(edge => [0, edge.a].join("-")).sort());
    const ocl = Molecule.fromMolfile(parsed.molfile);
    expect(Array.from({ length: ocl.getAllAtoms() }, (_, i) => ocl.getAtomCharge(i)).reduce((a, b) => a + b, 0), id).toBe(complex.charge);
    const structure = Structure.ofModel((await trajectoryFromSdf((await parseSdf(text).run()).result.compounds[0]).run()).representative);
    const loc = StructureElement.Location.create(structure), charges: number[] = [], orders: number[] = [];
    for (const unit of structure.units) {
      for (let i = 0; i < unit.elements.length; i++) { loc.unit = unit; loc.element = unit.elements[i]; charges.push(P.atom.pdbx_formal_charge(loc)); }
      for (let e = 0; e < unit.bonds.a.length; e++) if (unit.bonds.a[e] < unit.bonds.b[e]) orders.push(unit.bonds.edgeProps.order[e]);
    }
    expect({ charges, coordination: orders.filter(order => order === 9).length, bonds: orders.length }, id)
      .toEqual({ charges: complex.atoms.map(atom => atom.charge), coordination: complex.coordination.length, bonds: complex.bonds.length + complex.coordination.length });
    // The viewer's mmCIF export route: atoms and formal charges survive, bond types are re-perceived.
    const exported = Structure.ofModel((await trajectoryFromMmCIF((await CIF.parse(to_mmCIF(id, structure, false, { copyAllCategories: true })).run()).result.blocks[0]).run()).representative);
    const exportedCharges: number[] = [];
    for (const unit of exported.units) for (let i = 0; i < unit.elements.length; i++) { loc.unit = unit; loc.element = unit.elements[i]; exportedCharges.push(P.atom.pdbx_formal_charge(loc)); }
    expect(exportedCharges, `${id} mmCIF`).toEqual(charges);
  }
});

test("invalid requests are refused with a reason before any atom is placed", () => {
  const octahedral = (ligands: MetalComplexOptions["ligands"], extra: Partial<MetalComplexOptions> = {}) => () => buildMetalComplex({ metal: "Co", oxidationState: 3, geometry: "octahedral", ligands, ...extra });
  const ammines = (sites: number[]) => sites.map(site => ({ ligand: "ammine" as const, sites: [site] }));
  expect(octahedral(ammines([0, 1, 2, 3, 4, 5]), { metal: "C" })).toThrow("supported metal");
  expect(octahedral(ammines([0, 1, 2, 3, 4, 5]), { oxidationState: 2.5 })).toThrow("oxidation state");
  expect(octahedral(ammines([0, 1, 2, 3, 4]))).toThrow("every octahedral site");
  expect(octahedral(ammines([0, 1, 2, 3, 4, 4]))).toThrow("Site 5 has more than one ligand");
  expect(octahedral(ammines([0, 1, 2, 3, 4, 6]))).toThrow("sites 1–6");
  expect(octahedral([...ammines([1, 3, 4, 5]), { ligand: "ethylenediamine", sites: [0, 2] }])).toThrow("two cis sites");
  expect(octahedral([...ammines([1, 2, 3, 4, 5]), { ligand: "ethylenediamine", sites: [0] }])).toThrow("occupies 2 sites");
  expect(octahedral([...ammines([1, 2, 3, 4, 5]), { ligand: "ammine", sites: [0], distance: 4 }])).toThrow("1.4 to 3.5 Å");
  expect(octahedral([0, 1, 2, 3, 4, 5].map(site => ({ ligand: "trimethylphosphane", sites: [site] })))).toThrow("overlap");
  expect(() => buildMetalComplex({ metal: "Au", oxidationState: 1, geometry: "linear", ligands: [{ ligand: "ethylenediamine", sites: [0, 1] }] })).toThrow("two cis sites");
});
