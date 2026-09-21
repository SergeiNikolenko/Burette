// Golden-value tests for the reaction columns. Runs the code the app ships
// (apps/desktop/src/lib/derived-column-compute.mjs) against the vendored
// engines and the MDL fixtures under tests/fixtures/reactions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  computeDerivedValue,
  createReactionRunner,
  looksLikeReactionSmiles,
  looksLikeRxnBlock,
  reactionPartsFromRow,
  reactionSmilesFromParts,
  reactionSourceFromRow,
  runReactionOnRow,
} from "../apps/desktop/src/lib/derived-column-compute.mjs";

function fixture(name) {
  return readFileSync(new URL(`./fixtures/reactions/${name}`, import.meta.url), "utf8");
}

async function loadEngines() {
  const [ocl, rdkitLoader] = await Promise.all([import("openchemlib"), import("@rdkit/rdkit")]);
  const rdkit = await rdkitLoader.default();
  const oclNamespace = ocl.default ?? ocl;
  oclNamespace.Resources.registerFromNodejs();
  return { ocl: oclNamespace, rdkit };
}

const engines = await loadEngines();
const AMIDATION_RXN = fixture("amidation.rxn");
const amidationRow = { smiles: null, molblock: AMIDATION_RXN };
const amidationSmilesRow = { smiles: "CC(=O)O.NCC>>CCNC(C)=O", molblock: null };

// --- what counts as a reaction ---------------------------------------------
assert.ok(looksLikeRxnBlock(AMIDATION_RXN));
assert.ok(!looksLikeRxnBlock("\n\n  4  3  0  0  0  0  0  0  0  0999 V2000\n"));
assert.ok(looksLikeReactionSmiles("CC(=O)O.NCC>>CCNC(C)=O"));
assert.ok(looksLikeReactionSmiles("Brc1ccccc1.OB(O)c1ccncc1>[Pd]>c1ccc(-c2ccncc2)cc1"));
assert.ok(!looksLikeReactionSmiles("CC(=O)Oc1ccccc1C(=O)O"));
assert.ok(!looksLikeReactionSmiles("a > b > c"), "spaces are prose, not a reaction");
assert.equal(reactionSourceFromRow({ smiles: "CCO", molblock: null }), null);
assert.equal(reactionSourceFromRow(amidationRow).kind, "rxn");
assert.equal(reactionSourceFromRow(amidationSmilesRow).kind, "smiles");
// A molblock wins over the smiles column, the way it does for molecules.
assert.equal(
  reactionSourceFromRow({ smiles: "CC(=O)O.NCC>>CCNC(C)=O", molblock: AMIDATION_RXN }).kind,
  "rxn",
);

// --- parts, from both spellings of the same reaction ------------------------
const fromBlock = reactionPartsFromRow(engines, amidationRow);
const fromSmiles = reactionPartsFromRow(engines, amidationSmilesRow);
assert.deepEqual(fromBlock, fromSmiles, "an RXN block and its reaction SMILES agree");
assert.equal(fromBlock.reactants.length, 2);
assert.equal(fromBlock.products.length, 1);
assert.equal(fromBlock.catalysts.length, 0);
const canonical = (smiles) => engines.ocl.Molecule.fromSmiles(smiles).toSmiles();
assert.deepEqual(fromBlock.reactants, [canonical("CC(=O)O"), canonical("NCC")]);
assert.deepEqual(fromBlock.products, [canonical("CCNC(C)=O")]);

// Agents over the arrow are kept apart from the reactants.
const suzuki = reactionPartsFromRow(engines, {
  smiles: "Brc1ccccc1.OB(O)c1ccncc1>[Pd]>c1ccc(-c2ccncc2)cc1",
  molblock: null,
});
assert.deepEqual(suzuki.catalysts, [canonical("[Pd]")]);
assert.equal(suzuki.reactants.length, 2);
assert.equal(suzuki.products.length, 1);

// --- Add Reaction SMILES ----------------------------------------------------
assert.equal(
  computeDerivedValue("reaction-smiles", engines, amidationRow).valueText,
  reactionSmilesFromParts(fromBlock),
);
assert.equal(
  computeDerivedValue("reaction-smiles", engines, amidationRow).valueText,
  computeDerivedValue("reaction-smiles", engines, amidationSmilesRow).valueText,
  "the column reads the same off a block and off a reaction SMILES",
);
assert.match(
  computeDerivedValue("reaction-smiles", engines, amidationRow).valueText,
  /^[^>]+>[^>]*>[^>]+$/u,
  "the column is a reaction SMILES",
);
// RDKit reads what the column writes: the value is a real reaction, not a label.
{
  const written = computeDerivedValue("reaction-smiles", engines, amidationRow).valueText;
  const rxn = engines.rdkit.get_rxn(written);
  assert.ok(rxn, "RDKit parses the written reaction SMILES");
  assert.ok(rxn.get_svg(320, 120).includes("<svg"), "and draws it");
  rxn.delete();
}
// A molecule row is an error on the row, never a thrown run.
const moleculeRow = computeDerivedValue("reaction-smiles", engines, {
  smiles: "CC(=O)Oc1ccccc1C(=O)O",
  molblock: null,
});
assert.ok(moleculeRow.errorText && !moleculeRow.valueText);

// --- the RDF fixture, read by the parser browser dev ships ------------------
// The records it produces have to be reactions the engines can read back: a
// block that lost its $MOL separators would still look like a reaction here.
const { parseReactionCollectionRecords } = await import(
  "../apps/desktop/src/lib/collection-documents.ts"
);
const rdfRecords = parseReactionCollectionRecords(fixture("three-reactions.rdf"), "rdf");
assert.equal(rdfRecords.length, 3);
assert.deepEqual(rdfRecords.map((record) => record.name), ["RXN-1", "RXN-2", "RXN-3"]);
assert.deepEqual(rdfRecords.map((record) => record.props.Yield), ["88", "61", "74"]);
const expectedParts = [
  { reactants: 2, products: 1 },
  { reactants: 2, products: 1 },
  { reactants: 2, products: 1 },
];
rdfRecords.forEach((record, index) => {
  assert.ok(record.molblock.startsWith("$RXN"), `${record.name} keeps its block`);
  assert.ok(!record.molblock.includes("$DTYPE"), `${record.name} keeps fields out of the block`);
  const parts = reactionPartsFromRow(engines, { smiles: null, molblock: record.molblock });
  assert.equal(parts.reactants.length, expectedParts[index].reactants, `${record.name} reactants`);
  assert.equal(parts.products.length, expectedParts[index].products, `${record.name} products`);
  const rxn = engines.rdkit.get_rxn(record.molblock);
  assert.ok(rxn && rxn.get_svg(400, 160).includes("<svg"), `${record.name} draws`);
  rxn.delete();
});
// The single-reaction path reads the .rxn fixture as one record.
const rxnRecords = parseReactionCollectionRecords(AMIDATION_RXN, "rxn");
assert.equal(rxnRecords.length, 1);
assert.equal(rxnRecords[0].name, "Amidation");
assert.deepEqual(
  reactionPartsFromRow(engines, { smiles: null, molblock: rxnRecords[0].molblock }),
  fromBlock,
);

// The CSV fixture's reaction column is readable by the same path.
const csv = fixture("reactions.csv").trim().split("\n").slice(1);
assert.equal(csv.length, 3);
for (const line of csv) {
  const reactionSmiles = line.split(",")[1];
  assert.ok(looksLikeReactionSmiles(reactionSmiles), `${reactionSmiles} is a reaction`);
  const parts = reactionPartsFromRow(engines, { smiles: reactionSmiles, molblock: null });
  assert.ok(parts.products.length === 1);
}

// --- Extract Reactants / Catalysts / Products ------------------------------
{
  const expect = (kind, row, value) => assert.equal(
    computeDerivedValue(kind, engines, row).valueText,
    value,
    `${kind} on ${row.smiles ?? "block"}`,
  );
  expect("reaction-reactants", amidationRow, fromBlock.reactants.join("."));
  expect("reaction-products", amidationRow, fromBlock.products.join("."));
  expect("reaction-catalysts", amidationRow, "");
  // The same three columns read the same off a reaction SMILES.
  for (const kind of ["reaction-reactants", "reaction-products", "reaction-catalysts"]) {
    assert.equal(
      computeDerivedValue(kind, engines, amidationSmilesRow).valueText,
      computeDerivedValue(kind, engines, amidationRow).valueText,
      `${kind} agrees across both spellings`,
    );
  }
  const suzukiRow = {
    smiles: "Brc1ccccc1.OB(O)c1ccncc1>[Pd]>c1ccc(-c2ccncc2)cc1",
    molblock: null,
  };
  expect("reaction-catalysts", suzukiRow, canonical("[Pd]"));
  expect("reaction-products", suzukiRow, canonical("c1ccc(-c2ccncc2)cc1"));
  // Extracted parts are structures the rest of the app can read.
  const productsColumn = computeDerivedValue("reaction-products", engines, amidationRow).valueText;
  assert.equal(
    computeDerivedValue("formula", engines, { smiles: productsColumn, molblock: null }).valueText,
    "C4H9NO",
    "the products column is a structure the molecule columns can read",
  );
  // A molecule row errors on the row rather than throwing the run.
  for (const kind of ["reaction-reactants", "reaction-products", "reaction-transformation"]) {
    const result = computeDerivedValue(kind, engines, { smiles: "CCO", molblock: null });
    assert.ok(result.errorText && !result.valueText, `${kind} refuses a molecule row`);
  }
}

// --- Extract Transformation -------------------------------------------------
{
  const mapped = { smiles: null, molblock: fixture("mapped-amidation.rxn") };
  const transformation = computeDerivedValue("reaction-transformation", engines, mapped);
  // The reaction centre plus one shell: the acid and amine cores becoming the
  // amide core, not the whole molecules and not two bare atoms.
  assert.equal(
    transformation.valueText,
    `${engines.ocl.Molecule.fromSmiles("CC(O)=O").toSmiles()}.${engines.ocl.Molecule.fromSmiles("CN").toSmiles()}>>${engines.ocl.Molecule.fromSmiles("CC(NC)=O").toSmiles()}`,
  );
  assert.ok(
    transformation.valueText.split(">>")[0].length < fromBlock.reactants.join(".").length + 8,
    "the transformation is smaller than the reaction it came from",
  );
  // Without atom maps there is no reaction centre, and the row says so instead
  // of guessing - mapping needs an engine this build does not ship.
  const unmapped = computeDerivedValue("reaction-transformation", engines, amidationRow);
  assert.equal(unmapped.valueText, undefined);
  assert.match(unmapped.errorText, /atom mapping/u);
}

// --- Perform Reaction -------------------------------------------------------
// The engine choice, checked rather than assumed: openchemlib's Reactor and
// RDKit's run_reactants on the same three reactions, from the SMARTS a chemist
// writes. RDKit gets all three; OCL needs hand-mapped templates and still
// misses Suzuki, which is why runReactionOnRow uses RDKit.
{
  const cases = [
    {
      name: "amidation",
      smarts: "[C:1](=[O:2])[OH].[N;!$(N=*);!$(N-[!#6;!#1]);!$(N-C=[O,N,S]):3]>>[C:1](=[O:2])[N:3]",
      row: { smiles: "CC(=O)O", molblock: null },
      coReactants: ["NCC"],
      expected: "CCNC(C)=O",
    },
    {
      name: "esterification",
      smarts: "[C:1](=[O:2])[OH].[O;H1;$(O[#6]):3]>>[C:1](=[O:2])[O:3]",
      row: { smiles: "c1ccccc1C(=O)O", molblock: null },
      coReactants: ["CCO"],
      expected: "CCOC(=O)c1ccccc1",
    },
    {
      name: "suzuki",
      smarts: "[c:1][Br,I,Cl].[c:2][B]([OH])[OH]>>[c:1][c:2]",
      row: { smiles: "Brc1ccccc1", molblock: null },
      coReactants: ["OB(O)c1ccncc1"],
      expected: "c1ccc(-c2ccncc2)cc1",
    },
  ];
  const rdkitCanonical = (smiles) => {
    const mol = engines.rdkit.get_mol(smiles);
    try {
      return mol.get_smiles();
    } finally {
      mol.delete();
    }
  };
  for (const testCase of cases) {
    const runner = createReactionRunner(engines, testCase.smarts);
    try {
      const result = runReactionOnRow(engines, runner, testCase.row, testCase.coReactants);
      assert.equal(
        result.valueText,
        rdkitCanonical(testCase.expected),
        `${testCase.name} product`,
      );
    } finally {
      runner.delete();
    }
  }
  // A structure the reaction does not touch is an answer on the row, not a
  // thrown run, and neither is a co-reactant that will not parse.
  const runner = createReactionRunner(engines, cases[0].smarts);
  try {
    const missed = runReactionOnRow(engines, runner, { smiles: "c1ccccc1", molblock: null }, ["NCC"]);
    assert.match(missed.errorText, /does not apply/u);
    const badCoReactant = runReactionOnRow(engines, runner, cases[0].row, ["((broken"]);
    assert.ok(badCoReactant.errorText && !badCoReactant.valueText);
  } finally {
    runner.delete();
  }
  assert.throws(() => createReactionRunner(engines, "   "), /Enter a reaction SMARTS/u);
  assert.throws(() => createReactionRunner(engines, "not a reaction"), /Could not read/u);
}

console.log("reaction column golden tests passed");
