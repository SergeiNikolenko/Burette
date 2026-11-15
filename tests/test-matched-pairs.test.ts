// Matched molecular pairs against mmpdb on two public ChEMBL series. The
// module under test is the one the matched-pairs worker runs, on the RDKit
// WASM build the app ships; the expected tables come from mmpdb itself (see
// tests/fixtures/matched-pairs/README.md for the commands).
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import {
  createMatchedPairQueries,
  findMatchedPairs,
  fragmentMolecule,
  indexMatchedPairs,
  transformationStatistics,
  type FragmentedMolecule,
  type MatchedPairInput,
  type MatchedPairQueries,
} from "../apps/desktop/src/lib/matched-pairs/matched-pairs";

type Reference = {
  fragmentations: Array<[string, string, string, string, number]>;
  transformations: Array<[string, string, number, number, number | null, number, number]>;
  pairs: Array<[string, string, string, string, string]>;
};

let rdkit: MainModule;
let queries: MatchedPairQueries;
beforeAll(async () => { rdkit = await initRDKitModule(); queries = createMatchedPairQueries(rdkit); });

const fixture = (name: string) => readFileSync(new URL(`./fixtures/matched-pairs/${name}`, import.meta.url), "utf8");

function readSeries(name: string) {
  const records = fixture(`${name}.sdf`).split("$$$$\n").filter((record) => record.trim()).map((record, id) => {
    const end = record.indexOf("M  END\n") + "M  END\n".length;
    return {
      id,
      title: record.slice(0, record.indexOf("\n")),
      molblock: record.slice(0, end),
      pKi: Number(/>  <pKi>.*\n(.+)\n/.exec(record.slice(end))?.[1]),
    };
  });
  return { records, reference: JSON.parse(fixture(`${name}.mmpdb.json`)) as Reference };
}

const inputs = (records: Array<{ id: number; molblock: string }>): MatchedPairInput[] =>
  records.map(({ id, molblock }) => ({ id, smiles: null, molblock }));

describe.each([
  // Achiral benzamides: plain cuts, hydrogen pairs, one molecule too flexible to fragment.
  { name: "chembl-fxa-benzamides", molecules: 58, skipped: 1 },
  // cis and trans 1,4-cyclohexanes with isopropyl ethers: ring stereo in every
  // constant part, and 204 fragments carrying a stereocentre the cut created.
  { name: "chembl-d2-sulfonamides", molecules: 54, skipped: 0 },
])("$name against mmpdb", ({ name, molecules, skipped }) => {
  test("every fragmentation, pair and statistic is mmpdb's", () => {
    const { records, reference } = readSeries(name);
    expect(records).toHaveLength(molecules);
    const title = (id: number) => records[id].title;

    const fragmented = inputs(records).flatMap((input) => fragmentMolecule(rdkit, queries, input) ?? []);
    const fragmentations = fragmented.flatMap((molecule) => molecule.fragmentations
      .map(({ label, variable, constant, variableHeavies }) => [title(molecule.id), label, variable, constant, variableHeavies]));
    expect(fragmentations.map((row) => row.join(" ")).sort()).toEqual(reference.fragmentations.map((row) => row.join(" ")).sort());

    const result = findMatchedPairs(rdkit, inputs(records));
    expect(result.skippedMolecules).toBe(skipped);
    expect(result.capped).toEqual({ molecules: false, fragmentations: false, pairs: false });
    const pairs = result.transformations.flatMap(({ from, to, pairs: members }) => members
      .map(({ fromId, toId, constant }) => [from, to, title(fromId), title(toId), result.constants[constant]].join(" ")));
    expect(pairs.sort()).toEqual(reference.pairs.map((row) => row.join(" ")).sort());

    const values = new Map(records.map(({ id, pKi }) => [id, pKi]));
    const statistics = new Map(result.transformations.map((transformation) =>
      [`${transformation.from}>>${transformation.to}`, transformationStatistics(transformation, values)]));
    expect(statistics.size).toBe(reference.transformations.length);
    for (const [from, to, count, avg, std, min, max] of reference.transformations) {
      const mine = statistics.get(`${from}>>${to}`);
      expect(mine?.count, `${from}>>${to}`).toBe(count);
      expect(mine?.mean).toBeCloseTo(avg, 9);
      if (std === null) expect(mine?.sd).toBeNull();
      else expect(mine?.sd).toBeCloseTo(std, 9);
      expect(mine?.min).toBeCloseTo(min, 9);
      expect(mine?.max).toBeCloseTo(max, 9);
    }
  });
});

function fragment(smiles: string, id = 0): FragmentedMolecule {
  const molecule = fragmentMolecule(rdkit, queries, { id, smiles, molblock: null });
  if (!molecule) throw new Error(`${smiles} was not fragmented`);
  return molecule;
}

function rejoin(variable: string, constant: string): string {
  const [a, b] = [variable, constant].map((part) => rdkit.get_mol(part.replace("*", "[*:1]"))!);
  const joined = rdkit.molzip(a, b);
  try { return joined?.get_smiles() ?? ""; } finally { joined?.delete(); a.delete(); b.delete(); }
}

test("a cut next to a double bond keeps the bond's geometry", () => {
  // mmpdb 3.1.6 writes the styryl fragment of this E amide as the Z isomer,
  // and which isomer it writes depends on the atom order of its input.
  for (const smiles of ["CNC(=O)/C=C/c1ccccc1", "CNC(=O)/C=C\\c1ccccc1", "C/N=C(\\N)c1ccccc1", "F/C=C/c1ccccc1"]) {
    const molecule = fragment(smiles);
    const stereo = molecule.fragmentations.filter(({ variable, constant }) => /[/\\]/.test(variable + constant));
    expect(stereo.length).toBeGreaterThan(0);
    for (const { variable, constant } of molecule.fragmentations) expect(rejoin(variable, constant)).toBe(molecule.smiles);
  }
  expect(fragment("CNC(=O)/C=C/c1ccccc1").fragmentations).toContainEqual(
    { label: "N", variable: "*/C=C/c1ccccc1", constant: "*C(=O)NC", variableHeavies: 8 });
});

test("a cut that creates a stereocentre lets the fragment meet its chiral analogue", () => {
  // Cutting one methyl of the gem-dimethyl carbinol leaves a carbon with four
  // different neighbours; the ethyl analogue has that centre already.
  const achiral = fragment("CC(C)(O)c1ccccc1", 0);
  expect(achiral.fragmentations.filter(({ label }) => label === "C").map(({ constant }) => constant).sort())
    .toEqual(["*[C@@](C)(O)c1ccccc1", "*[C@](C)(O)c1ccccc1"]);
  const chiral = fragment("CC[C@](C)(O)c1ccccc1", 1);
  const { transformations } = indexMatchedPairs(rdkit, [achiral, chiral]);
  expect(transformations.map(({ from, to, pairs }) => [from, to, pairs.length])).toContainEqual(["[*:1]C", "[*:1]CC", 1]);
});

test("a molecule that is a constant capped with hydrogen pairs through [*:1][H]", () => {
  const { transformations } = indexMatchedPairs(rdkit, [fragment("Clc1ccccc1", 0), fragment("Cc1ccccc1", 1), fragment("c1ccccc1", 2)]);
  expect(transformations.map(({ from, to, pairs }) => [from, to, pairs.map(({ fromId, toId }) => [fromId, toId])]).sort()).toEqual([
    ["[*:1]C", "[*:1]Cl", [[1, 0]]],
    ["[*:1]C", "[*:1][H]", [[1, 2]]],
    ["[*:1]Cl", "[*:1][H]", [[0, 2]]],
  ]);
});

test("molecules mmpdb would not fragment are skipped and counted", () => {
  const result = findMatchedPairs(rdkit, [
    { id: 0, smiles: "Cc1ccccc1", molblock: null },
    { id: 1, smiles: "Clc1ccccc1", molblock: null },
    { id: 2, smiles: "Cc1ccccc1.Cl", molblock: null },
    { id: 3, smiles: "not a molecule", molblock: null },
    { id: 4, smiles: "C", molblock: null },
    { id: 5, smiles: "CCCCCCCCCCCCCCc1ccccc1", molblock: null },
  ]);
  expect(result.molecules.map(({ id }) => id)).toEqual([0, 1]);
  expect(result.skippedMolecules).toBe(4);
  expect(result.transformations).toEqual([{ from: "[*:1]C", to: "[*:1]Cl", pairs: [{ fromId: 0, toId: 1, constant: 0 }] }]);
  expect(result.constants).toEqual(["[*:1]c1ccccc1"]);
});

test("pairing stops at the limit and says so", () => {
  const halides = ["F", "Cl", "Br", "I", "C", "O", "N"].map((group, id) => fragment(`${group}c1ccccc1`, id));
  const all = indexMatchedPairs(rdkit, halides);
  expect(all.capped).toBe(false);
  const total = all.transformations.reduce((sum, { pairs }) => sum + pairs.length, 0);
  expect(total).toBe(21);
  const limited = indexMatchedPairs(rdkit, halides, 5);
  expect(limited.capped).toBe(true);
  expect(limited.transformations.reduce((sum, { pairs }) => sum + pairs.length, 0)).toBe(5);
});

test("the change is to minus from, over the pairs that have both values", () => {
  const transformation = { from: "[*:1]C", to: "[*:1]Cl", pairs: [
    { fromId: 0, toId: 1, constant: 0 }, { fromId: 2, toId: 3, constant: 1 }, { fromId: 4, toId: 5, constant: 2 },
  ] };
  expect(transformationStatistics(transformation, new Map([[0, 5], [1, 6.5], [2, 7], [3, 7.5], [4, 6]])))
    .toEqual({ count: 2, mean: 1, sd: Math.SQRT1_2, min: 0.5, max: 1.5 });
  expect(transformationStatistics(transformation, new Map([[0, 5], [1, 6.5]]))).toEqual({ count: 1, mean: 1.5, sd: null, min: 1.5, max: 1.5 });
  expect(transformationStatistics(transformation, new Map())).toBeNull();
});
