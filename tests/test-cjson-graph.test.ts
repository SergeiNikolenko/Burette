import { beforeAll, expect, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import { Molecule } from "openchemlib";
import { readCjsonGraph } from "../apps/desktop/src/lib/molecular-workbench/cjson-graph";
import { molstarMolV3000Plugin } from "../scripts/molstar-mol-v3000.mjs";
import { molstarV3000ChargesPlugin } from "../scripts/molstar-v3000-charges.mjs";

const browser = new Window(); Object.assign(browser, { setImmediate, clearImmediate });
Object.assign(globalThis, { window: browser, document: browser.document });
plugin(molstarMolV3000Plugin); plugin(molstarV3000ChargesPlugin);
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js");
const { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
const { IndexPairBonds } = await import("molstar/lib/mol-model-formats/structure/property/bonds/index-pair.js");
let rdkit: MainModule; beforeAll(async () => { rdkit = await initRDKitModule(); });
const fixture = (name: string) => readFileSync(new URL(`./fixtures/cjson/${name}`, import.meta.url), "utf8");

test("real producer L/D alanine retains source atom order, explicit graph and absolute 3D stereo through MOL", async () => {
  for (const [name, chirality, center] of [["L-alanine.cjson", "(S)", 3], ["D-alanine.cjson", "(R)", 1]] as const) {
    const text = fixture(name), original = JSON.parse(text), result = readCjsonGraph(name, text);
    const graph = rdkit.get_mol(result.structure.molfile, JSON.stringify({ removeHs: false }));
    expect(Boolean(graph)).toBe(true);
    if (!graph) throw new Error("RDKit rejected the materialized graph");
    try {
      expect(JSON.parse(graph.get_stereo_tags()).CIP_atoms).toEqual([[center, chirality]]);
      expect(graph.get_num_atoms()).toBe(13); expect(graph.get_num_bonds()).toBe(12);
      const again = rdkit.get_mol(graph.get_v3Kmolblock(), JSON.stringify({ removeHs: false }));
      if (!again) throw new Error("RDKit rejected its MOL roundtrip");
      try { expect(JSON.parse(again.get_stereo_tags()).CIP_atoms).toEqual([[center, chirality]]); } finally { again.delete(); }
    } finally { graph.delete(); }
    const parsed = Molecule.fromMolfileWithAtomMap(result.structure.molfile);
    parsed.molecule.ensureHelperArrays(Molecule.cHelperCIP);
    expect(parsed.molecule.getAtomCIPParity(parsed.map[center])).toBe(chirality === "(S)" ? Molecule.cAtomCIPParitySorP : Molecule.cAtomCIPParityRorM);
    expect(result.structure.bonds).toEqual(original.bonds.order.map((order: number, i: number) => ({
      a: original.bonds.connections.index[2 * i], b: original.bonds.connections.index[2 * i + 1], order,
    })));
    const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
    try {
      const raw = await plugin.builders.data.rawData({ data: result.structure.molfile });
      const trajectory = await plugin.builders.structure.parseTrajectory(raw, "mol"), model = trajectory.data!.representative;
      expect(Array.from(model.atomicHierarchy.atomSourceIndex.toArray())).toEqual(Array.from({ length: 13 }, (_, i) => i));
      expect(Array.from(model.atomicHierarchy.atoms.type_symbol.toArray(), String)).toEqual(result.structure.atoms.map(atom => atom.element));
      for (const axis of ["x", "y", "z"] as const) result.coordinateSets[0].forEach((atom, i) => expect(model.atomicConformation[axis][i]).toBeCloseTo(atom[axis], 6));
      expect(Array.from(IndexPairBonds.Provider.get(model)!.bonds.edgeProps.order).sort()).toEqual(original.bonds.order.flatMap((order: number) => [order, order]).sort());
      expect(raw.data).toBe(result.structure.molfile);
    } finally { plugin.dispose(); }
    expect(text).toBe(fixture(name));
  }
});

test("CJSON charge and isotope arrays survive OCL and RDKit graph materialization", async () => {
  const source = JSON.parse(fixture("L-alanine.cjson"));
  source.atoms.formalCharges[1] = 1;
  source.atoms.isotopes = Array(13).fill(0); source.atoms.isotopes[0] = 2; source.atoms.isotopes[3] = 13;
  const result = readCjsonGraph("charged.cjson", JSON.stringify(source));
  const parsed = Molecule.fromMolfileWithAtomMap(result.structure.molfile);
  expect(Array.from(parsed.map, i => parsed.molecule.getAtomCharge(i))).toEqual(source.atoms.formalCharges);
  expect(Array.from(parsed.map, i => parsed.molecule.getAtomMass(i))).toEqual(source.atoms.isotopes);
  const graph = rdkit.get_mol(result.structure.molfile, JSON.stringify({ removeHs: false }));
  if (!graph) throw new Error("RDKit rejected charge/isotope graph");
  try {
    const json = JSON.parse(graph.get_json()), atoms = json.molecules[0].atoms;
    expect(atoms.map((atom: { chg?: number }) => atom.chg ?? json.defaults.atom.chg)).toEqual(source.atoms.formalCharges);
    expect(atoms.map((atom: { isotope?: number }) => atom.isotope ?? json.defaults.atom.isotope)).toEqual(source.atoms.isotopes);
  } finally { graph.delete(); }
});

test("active coordinate set is exact while NMR stays file-scoped in original source atom order", () => {
  const source = JSON.parse(readFileSync(new URL("./fixtures/quantum/spectra-native-nmr.cjson", import.meta.url), "utf8"));
  const first = source.atoms.coords["3d"], second = first.map((value: number, i: number) => value + (i % 3 === 0 ? 2 : 0));
  source.atoms.coords["3dSets"] = [first, second]; source.atoms.coords["3dSetsActive"] = 1;
  const result = readCjsonGraph("nmr.cjson", JSON.stringify(source));
  expect(result.activeSet).toBe(1); expect(result.coordinateSets).toHaveLength(2);
  result.structure.atoms.forEach((atom, i) => expect([atom.x, atom.y, atom.z]).toEqual(second.slice(i * 3, i * 3 + 3)));
  expect(result.spectra).toEqual({ kind: "scientific-spectra", version: 1,
    source: { name: "nmr.cjson", format: "cjson", scope: "file" }, atomicNumbers: [6, 8, 1, 1],
    spectra: [{ kind: "nmr", quantity: "native-input", atomIndices: [0, 1, 2, 3], valuesPpm: [8.356, -394.078, 21.901, 21.901] }] });
  delete source.atoms.coords["3dSetsActive"];
  expect(readCjsonGraph("nmr.cjson", JSON.stringify(source)).activeSet).toBe(0);
});

test("bonds are never perceived and unsupported native orders, periodic data or invalid identities cannot be silently rewritten", () => {
  const source = JSON.parse(fixture("L-alanine.cjson"));
  delete source.bonds;
  expect(readCjsonGraph("disconnected.cjson", JSON.stringify(source)).structure.bonds).toEqual([]);
  const invalid = [
    (v: any) => { v.bonds.order[0] = 4; }, (v: any) => { v.bonds.order[0] = 5; }, (v: any) => { v.bonds.order[0] = 6; },
    (v: any) => { v.unitCell = { a: 10, b: 10, c: 10, alpha: 90, beta: 90, gamma: 90 }; },
    (v: any) => { v.atoms.coords["3dFractional"] = v.atoms.coords["3d"]; },
    (v: any) => { v.bonds.connections.index[0] = 99; }, (v: any) => { v.bonds.connections.index[0] = v.bonds.connections.index[1]; },
    (v: any) => { v.bonds.order.pop(); }, (v: any) => { v.atoms.formalCharges.pop(); },
    (v: any) => { v.atoms.coords["3dSetsActive"] = 1; }, (v: any) => { v.atoms.isotopes = Array(13).fill(1); },
  ];
  for (const mutate of invalid) { const value = JSON.parse(fixture("L-alanine.cjson")); mutate(value); expect(() => readCjsonGraph("invalid.cjson", JSON.stringify(value))).toThrow(); }
});
