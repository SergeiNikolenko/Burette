// Golden-value tests for the SAR analysis compute: Murcko scaffolds,
// substructure counting and reference-file similarity. Runs the exact code the
// app ships (apps/desktop/src/lib/derived-column-compute.mjs) against the real
// vendored engines: openchemlib and the RDKit WASM build.
//
// The scaffold expectations were taken from RDKit's own
// Chem.Scaffolds.MurckoScaffold.GetScaffoldForMol (2026.03.5) and then pinned
// here, so a change in our pruning shows up as a failure rather than as a
// quietly different core.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  closestReferenceMatch,
  compileSubstructureQuery,
  computeDerivedValue,
  countSubstructureMatches,
  morganFingerprint,
  murckoScaffoldMolecule,
  parseReferenceStructures,
  SCAFFOLD_COUNT_COLUMN,
  SIMILARITY_FINGERPRINT_SETTINGS,
  tanimoto,
} from "../apps/desktop/src/lib/derived-column-compute.mjs";

async function loadEngines() {
  const [ocl, rdkitLoader] = await Promise.all([
    import("openchemlib"),
    import("@rdkit/rdkit"),
  ]);
  const rdkit = await rdkitLoader.default();
  const oclNamespace = ocl.default ?? ocl;
  oclNamespace.Resources.registerFromNodejs();
  return { ocl: oclNamespace, rdkit };
}

const engines = await loadEngines();
const { ocl } = engines;

const canonical = (smiles) => (smiles ? ocl.Molecule.fromSmiles(smiles).getIDCode() : "");
const scaffoldOf = (smiles) => computeDerivedValue("murcko-scaffold", engines, { smiles, molblock: null });

// --- Murcko scaffolds against RDKit's answers ---
const SCAFFOLD_CASES = [
  ["aspirin", "CC(=O)Oc1ccccc1C(=O)O", "c1ccccc1"],
  ["paracetamol", "CC(=O)Nc1ccc(O)cc1", "c1ccccc1"],
  ["ibuprofen", "CC(C)Cc1ccc(cc1)C(C)C(=O)O", "c1ccccc1"],
  // A ring carbonyl survives: the oxygen is held by a double bond to the core.
  ["caffeine", "Cn1cnc2c1c(=O)n(C)c(=O)n2C", "O=c1[nH]c(=O)c2[nH]cnc2[nH]1"],
  ["cyclohexanone", "O=C1CCCCC1", "O=C1CCCCC1"],
  // Linkers between two ring systems stay, side chains do not.
  ["diphenylmethane", "c1ccccc1Cc1ccccc1", "c1ccc(Cc2ccccc2)cc1"],
  ["benzophenone", "O=C(c1ccccc1)c1ccccc1", "O=C(c1ccccc1)c1ccccc1"],
  ["nicotine", "CN1CCC[C@H]1c1cccnc1", "c1cncc(C2CCCN2)c1"],
  // Two rings joined by a chain keep the whole chain between them.
  ["4-phenylbutylpyridine", "c1ccccc1CCCCc1ccncc1", "c1ccc(CCCCc2ccncc2)cc1"],
  // A branch that dies in a chain is pruned all the way back to the ring.
  ["tert-butylbenzene", "CC(C)(C)c1ccccc1", "c1ccccc1"],
  // Fused and spiro systems are one ring system, kept whole.
  ["naphthalene-acid", "OC(=O)c1ccc2ccccc2c1", "c1ccc2ccccc2c1"],
  ["spiro", "C1CCC2(CC1)CCCCC2", "C1CCC2(CC1)CCCCC2"],
  // An acyclic molecule has no framework: a blank cell, not an error.
  ["hexane", "CCCCCC", ""],
  ["acetic acid", "CC(=O)O", ""],
];

for (const [name, smiles, expected] of SCAFFOLD_CASES) {
  const result = scaffoldOf(smiles);
  assert.equal(result.errorText, undefined, `${name} computed without error`);
  assert.equal(
    canonical(result.valueText),
    canonical(expected),
    `${name}: ${result.valueText} should be ${expected}`,
  );
}

// The scaffold column groups: two members of one series share one string.
const seriesScaffolds = [
  "CC(=O)Oc1ccccc1C(=O)O",
  "Oc1ccccc1",
  "Nc1ccc(Cl)cc1",
].map((smiles) => scaffoldOf(smiles).valueText);
assert.equal(new Set(seriesScaffolds).size, 1, "one benzene scaffold string for the whole series");

// Stereo is dropped so enantiomers land on one scaffold.
assert.equal(
  scaffoldOf("C[C@H]1CCCCN1c1ccccc1").valueText,
  scaffoldOf("C[C@@H]1CCCCN1c1ccccc1").valueText,
  "enantiomers share a scaffold",
);

// The molecule handed in is not modified: the scaffold is a copy.
{
  const molecule = ocl.Molecule.fromSmiles("CC(=O)Oc1ccccc1C(=O)O");
  const before = molecule.getAllAtoms();
  murckoScaffoldMolecule(ocl, molecule);
  assert.equal(molecule.getAllAtoms(), before, "the source molecule keeps its atoms");
}

// Molblock rows reach the same scaffold as their SMILES.
{
  const molecule = ocl.Molecule.fromSmiles("CC(=O)Oc1ccccc1C(=O)O");
  const fromMolblock = computeDerivedValue("murcko-scaffold", engines, {
    smiles: null,
    molblock: molecule.toMolfile(),
  });
  assert.equal(canonical(fromMolblock.valueText), canonical("c1ccccc1"));
}

// A structure that does not parse is an error on the row, never a throw.
assert.ok(scaffoldOf("not-a-smiles((").errorText, "bad structure reports an error");

assert.match(SCAFFOLD_COUNT_COLUMN.columnId, /^[A-Za-z0-9_-]{1,80}$/u);

console.log("murcko scaffold golden tests passed");

// --- Substructure counting ---
const countIn = (smarts, smiles) => {
  const searcher = compileSubstructureQuery(ocl, smarts);
  return countSubstructureMatches(engines, searcher, { smiles, molblock: null });
};

const COUNT_CASES = [
  ["c1ccccc1", "c1ccccc1", 1],
  ["c1ccccc1", "c1ccccc1-c1ccccc1", 2],
  // Naphthalene contains two distinct six-membered aromatic atom sets.
  ["c1ccccc1", "c1ccc2ccccc2c1", 2],
  ["c1ccccc1", "CCCCCC", 0],
  ["[CX3](=O)[OX2H1]", "CC(=O)Oc1ccccc1C(=O)O", 1],
  ["[CX3](=O)[OX2][#6]", "CC(=O)Oc1ccccc1C(=O)O", 1],
  ["[N+](=O)[O-]", "Cc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]", 3],
  ["[F,Cl,Br,I]", "Clc1ccc(F)cc1", 2],
  ["[OH]", "OCCO", 2],
  ["c1ccncc1", "c1ccncc1", 1],
];
for (const [smarts, smiles, expected] of COUNT_CASES) {
  const result = countIn(smarts, smiles);
  assert.equal(result.errorText, undefined, `${smarts} in ${smiles} computed`);
  assert.equal(result.valueReal, expected, `${smarts} occurs ${expected}x in ${smiles}`);
}

// One compiled query serves a whole run.
{
  const searcher = compileSubstructureQuery(ocl, "c1ccccc1");
  const counts = ["c1ccccc1", "c1ccc2ccccc2c1", "CCO"].map(
    (smiles) => countSubstructureMatches(engines, searcher, { smiles, molblock: null }).valueReal,
  );
  assert.deepEqual(counts, [1, 2, 0], "the searcher is reusable across rows");
}

// Query problems are reported when the query is compiled, not per row.
assert.throws(() => compileSubstructureQuery(ocl, ""), /Enter a SMARTS/u);
assert.throws(() => compileSubstructureQuery(ocl, "c1ccccc"), /.*/u, "an unbalanced ring closure is rejected");

// A row that does not parse reports an error instead of counting zero.
{
  const searcher = compileSubstructureQuery(ocl, "c1ccccc1");
  const bad = countSubstructureMatches(engines, searcher, { smiles: "not-a-smiles((", molblock: null });
  assert.ok(bad.errorText, "an unparsable row reports an error");
  assert.equal(bad.valueReal, undefined);
}

console.log("substructure count golden tests passed");

// --- Reference-file similarity ---
assert.deepEqual(SIMILARITY_FINGERPRINT_SETTINGS, {
  radius: 2,
  fplen: 2048,
  useChirality: true,
  useFeatures: false,
}, "the fingerprint matches the cluster.v1 baseline the GPU path uses");

const fingerprintOf = (smiles) => morganFingerprint(engines.rdkit, smiles);
assert.equal(fingerprintOf("c1ccccc1").length, SIMILARITY_FINGERPRINT_SETTINGS.fplen / 32);
assert.equal(tanimoto(fingerprintOf("CC(=O)Oc1ccccc1C(=O)O"), fingerprintOf("CC(=O)Oc1ccccc1C(=O)O")), 1);
{
  const near = tanimoto(fingerprintOf("c1ccccc1CCO"), fingerprintOf("c1ccccc1CCCO"));
  const far = tanimoto(fingerprintOf("c1ccccc1CCO"), fingerprintOf("CCCCCCCCCC"));
  assert.ok(near > far, `a homologue is closer (${near}) than an alkane (${far})`);
  assert.ok(near > 0 && near < 1, "a different molecule is not identical");
  assert.ok(far >= 0, "similarity is never negative");
}

// The closest match names the reference molecule it found.
{
  const reference = [
    { name: "phenol", fingerprint: fingerprintOf("Oc1ccccc1") },
    { name: "aspirin", fingerprint: fingerprintOf("CC(=O)Oc1ccccc1C(=O)O") },
    { name: "decane", fingerprint: fingerprintOf("CCCCCCCCCC") },
  ];
  const exact = closestReferenceMatch(engines, { smiles: "CC(=O)Oc1ccccc1C(=O)O", molblock: null }, reference);
  assert.equal(exact.name, "aspirin");
  assert.equal(exact.similarity, 1);
  const alkane = closestReferenceMatch(engines, { smiles: "CCCCCCCCCCC", molblock: null }, reference);
  assert.equal(alkane.name, "decane", "an alkane finds the alkane");
  const broken = closestReferenceMatch(engines, { smiles: "not-a-smiles((", molblock: null }, reference);
  assert.ok(broken.errorText, "an unparsable row reports an error");
  assert.ok(closestReferenceMatch(engines, { smiles: "c1ccccc1", molblock: null }, []).errorText,
    "an empty reference set is an error, not a zero");
}

// --- Reference file parsing ---
{
  const smi = parseReferenceStructures("CCO ethanol\nc1ccccc1\tbenzene\n\n# comment\n", "smi");
  assert.deepEqual(smi, [
    { smiles: "CCO", name: "ethanol" },
    { smiles: "c1ccccc1", name: "benzene" },
  ]);
  const headed = parseReferenceStructures("smiles\nCCO\n", "smi");
  assert.deepEqual(headed, [{ smiles: "CCO", name: "CCO" }]);

  const csv = parseReferenceStructures("name,smiles,pIC50\nfirst,CCO,5\nsecond,c1ccccc1,6\n,,7\n", "csv");
  assert.deepEqual(csv, [
    { smiles: "CCO", name: "first" },
    { smiles: "c1ccccc1", name: "second" },
  ]);
  const tsv = parseReferenceStructures("smiles\tid\nCCO\tX1\n", "tsv");
  assert.deepEqual(tsv, [{ smiles: "CCO", name: "X1" }]);
  // A prefixed id column is still an id column.
  assert.deepEqual(
    parseReferenceStructures("compound_id,canonical_smiles\nCMPD-1,CCO\n", "csv"),
    [{ smiles: "CCO", name: "CMPD-1" }],
  );
  assert.throws(() => parseReferenceStructures("a,b\n1,2\n", "csv"), /no SMILES column/u);

  const phenol = ocl.Molecule.fromSmiles("c1ccccc1O");
  const toluene = ocl.Molecule.fromSmiles("Cc1ccccc1");
  const record = (name, molecule) => `${name}\n${molecule.toMolfile().split("\n").slice(1).join("\n")}`;
  // Two records, the second one nameless: the blank first line must stay part
  // of the molfile rather than be trimmed away with the delimiter's newline.
  const sdf = parseReferenceStructures(
    `${record("phenol", phenol)}\n$$$$\n${record("", toluene)}\n$$$$\n`,
    "sdf",
  );
  assert.equal(sdf.length, 2, "both SDF records");
  assert.equal(sdf[0].name, "phenol");
  assert.equal(sdf[1].name, "Record 2", "a nameless record still gets a label");
  assert.ok(sdf[0].molblock.includes("V2000"), "the molblock is carried whole");
  assert.equal(
    ocl.Molecule.fromMolfile(sdf[0].molblock).getIDCode(),
    phenol.getIDCode(),
    "the parsed record is the molecule that was written",
  );
  assert.equal(
    ocl.Molecule.fromMolfile(sdf[1].molblock).getIDCode(),
    toluene.getIDCode(),
    "the nameless record parses with its header intact",
  );
}

// The whole Find Similar In File pass over files the picker actually offers:
// the reference file is read, fingerprinted, and every row of the collection
// gets its closest match. Only the file dialog is desktop-only; this is the
// work it hands off.
{
  const readFixture = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const reference = parseReferenceStructures(readFixture("samples/collections/tables/compounds.csv"), "csv");
  assert.ok(reference.length >= 3, `compounds.csv yields molecules (${reference.length})`);
  assert.ok(reference.every((entry) => entry.smiles && entry.name), "every reference row has a structure and a name");
  assert.ok(reference.some((entry) => entry.name.startsWith("CMPD-")), "the id column becomes the name");

  const fingerprinted = reference.map((entry) => ({
    name: entry.name,
    fingerprint: morganFingerprint(engines.rdkit, entry.smiles),
  }));
  // A row taken from the reference file itself must find itself exactly.
  const selfMatch = closestReferenceMatch(engines, { smiles: reference[0].smiles, molblock: null }, fingerprinted);
  assert.equal(selfMatch.name, reference[0].name);
  assert.equal(selfMatch.similarity, 1);

  // A real SAR collection scored against that reference: every row gets a
  // number in [0, 1] and names one of the reference molecules.
  const collection = parseReferenceStructures(readFixture("samples/large/bace1_sar.csv"), "csv").slice(0, 50);
  assert.equal(collection.length, 50, "the SAR table parses as a reference table too");
  const names = new Set(fingerprinted.map((entry) => entry.name));
  for (const row of collection) {
    const match = closestReferenceMatch(engines, { smiles: row.smiles, molblock: null }, fingerprinted);
    assert.equal(match.errorText, undefined, `${row.name} scored`);
    assert.ok(match.similarity >= 0 && match.similarity <= 1, `${row.name}: ${match.similarity} in [0,1]`);
    assert.ok(names.has(match.name), `${row.name} matched a reference molecule`);
  }
}

console.log("find-similar-in-file golden tests passed");
