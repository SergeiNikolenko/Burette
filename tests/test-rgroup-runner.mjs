// Runs the R-group decomposition script that ships inside
// apps/desktop/src-tauri/src/commands/rgroups.rs against a real Python RDKit
// interpreter, exactly the way the Rust command runs it: the script on `-c`,
// one JSON payload on stdin, one JSON line back.
//
// The interpreter comes from BURETTE_RGROUP_TEST_PYTHON, or from the managed
// descriptor runtime if it is installed. Without either, the test reports that
// it was skipped rather than failing - CI machines have no RDKit.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const runner = readFileSync(
  fileURLToPath(new URL("../apps/desktop/src-tauri/src/commands/rgroup_runner.py", import.meta.url)), "utf8",
);

function resolvePython() {
  const configured = process.env.BURETTE_RGROUP_TEST_PYTHON;
  if (configured && existsSync(configured)) return configured;
  const managed = `${process.env.HOME}/Library/Application Support/Burette/descriptor-python/bin/python3`;
  if (existsSync(managed)) return managed;
  return null;
}

function run(python, payload) {
  const result = spawnSync(python, ["-c", runner], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, PYTHONNOUSERSITE: "1" },
  });
  assert.equal(result.status, 0, `runner exited ${result.status}: ${result.stderr}`);
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

const python = resolvePython();
if (!python) {
  console.log("rgroup runner tests skipped: no Python RDKit interpreter (set BURETTE_RGROUP_TEST_PYTHON)");
  process.exit(0);
}

const status = run(python, { mode: "status" });
if (!status.ok) {
  console.log(`rgroup runner tests skipped: ${status.error}`);
  process.exit(0);
}
assert.ok(status.rdkitVersion, "status reports an RDKit version");

// A four-member benzene series with two substitution points. R1/R2 are what a
// chemist would read off the table, so the assertions name the exact groups.
const series = [
  { rowId: 1, smiles: "Cc1ccc(Cl)cc1" },
  { rowId: 2, smiles: "CCc1ccc(Cl)cc1" },
  { rowId: 3, smiles: "Cc1ccc(Br)cc1" },
  { rowId: 4, smiles: "CCc1ccc(Br)cc1" },
];
const decomposed = run(python, { mode: "decompose", core: "c1ccccc1", rows: series });
assert.ok(decomposed.ok, decomposed.error);
assert.equal(decomposed.rows.length, 4, "every member matched the core");
assert.ok(decomposed.labels.includes("Core"), "the core column is present");
const rGroupLabels = decomposed.labels.filter((label) => /^R\d+$/u.test(label));
assert.equal(rGroupLabels.length, 2, `two R positions, got ${decomposed.labels.join()}`);
for (const label of decomposed.labels) {
  assert.match(label, /^[A-Za-z0-9]{1,40}$/u, `label ${label} is usable as a derived column id`);
}
const byRow = new Map(decomposed.rows.map((row) => [row.rowId, row.values]));
const groupsOf = (rowId) => rGroupLabels
  .map((label) => byRow.get(rowId)[label].replace(/\[\*:\d+\]/gu, "").replace(/[()]/gu, ""))
  .sort()
  .join("|");
assert.equal(groupsOf(1), "C|Cl", "methyl + chloro");
assert.equal(groupsOf(2), "CC|Cl", "ethyl + chloro");
assert.equal(groupsOf(3), "Br|C", "methyl + bromo");
assert.equal(groupsOf(4), "Br|CC", "ethyl + bromo");
// Every member of a series sharing one core reports that same core.
assert.equal(new Set(decomposed.rows.map((row) => row.values.Core)).size, 1, "one core for the series");

// A molecule that does not contain the core is reported, not silently dropped.
const withStranger = run(python, {
  mode: "decompose",
  core: "c1ccccc1",
  rows: [...series, { rowId: 5, smiles: "CCCCCC" }],
});
assert.ok(withStranger.ok, withStranger.error);
assert.equal(withStranger.rows.length, 4, "the alkane is not assigned R groups");
assert.equal(withStranger.unmatchedRows, 1, "the alkane is counted as unmatched");
assert.ok(!withStranger.rows.some((row) => row.rowId === 5), "no row 5 in the results");

// A structure that does not parse is counted apart from a non-match.
const withBroken = run(python, {
  mode: "decompose",
  core: "c1ccccc1",
  rows: [...series, { rowId: 6, smiles: "not-a-smiles((" }],
});
assert.equal(withBroken.unparsedRows, 1, "the broken row is counted as unparsed");
assert.equal(withBroken.unmatchedRows, 0);

// A SMARTS core works as well as a SMILES one.
const smartsCore = run(python, {
  mode: "decompose",
  core: "c1ccc(cc1)[#6]",
  rows: series,
});
assert.ok(smartsCore.ok, smartsCore.error);
assert.equal(smartsCore.rows.length, 4, "the SMARTS core matches the series");

// Molblock rows decompose like their SMILES.
const molblockRows = run(python, {
  mode: "decompose",
  core: "c1ccccc1",
  rows: [{ rowId: 7, smiles: null, molblock: null }],
});
assert.ok(molblockRows.ok, "an empty row is an unparsed count, not a crash");
assert.equal(molblockRows.unparsedRows, 1);

// A core that reads as neither SMILES nor SMARTS is an error, not an empty run.
const badCore = run(python, { mode: "decompose", core: "))not a core((", rows: series });
assert.equal(badCore.ok, false);
assert.match(badCore.error, /core/iu);

console.log(`rgroup runner tests passed (RDKit ${status.rdkitVersion})`);

// Automatic mode covers both families, retaining a reason for every exclusion.
const mixed = run(python, { mode: "decompose", core: "", rows: [
  ...series, { rowId: 5, smiles: "Cc1ccncc1" }, { rowId: 6, smiles: "CCc1ccncc1" },
  { rowId: 7, smiles: "CCCC" }, { rowId: 8, smiles: "broken((" },
] });
assert.ok(mixed.ok, mixed.error);
assert.deepEqual([mixed.rows.length, mixed.series.length, mixed.noScaffoldRows, mixed.unparsedRows], [6, 2, 1, 1]);
assert.deepEqual(mixed.excludedRows, [{ rowId: 7, status: "No ring scaffold" }, { rowId: 8, status: "Invalid structure" }]);
assert.deepEqual(mixed.series.map(s => s.matchedRows), [4, 2]);
const constant = run(python, { mode: "decompose", core: "c1ccccc1", rows: series.slice(0, 2) });
assert.ok(constant.ok, constant.error);
assert.equal(constant.series[0].labels.length, 1, "constant chloro position is folded into core");
assert.ok(constant.rows.every(row => row.values.Core.includes("Cl")));
assert.equal(constant.series[0].constantPositions, 1);
const reversed = run(python, { mode: "decompose", core: "c1ccccc1", rows: [...series].reverse() });
assert.deepEqual([...reversed.rows].sort((a,b)=>a.rowId-b.rowId), [...decomposed.rows].sort((a,b)=>a.rowId-b.rowId), "input order does not change R positions");
// Rejoin every decomposition to its input, including hydrogen, stereo, salt,
// and a bridge attached to the core at two positions.
const reconstructionCases = [
  ["c1ccccc1", ["c1ccccc1", "Cc1ccccc1", "C[C@H](O)c1ccccc1", "C[C@@H](O)c1ccccc1"]],
  ["c1ccccc1", ["Oc1ccccc1", "COc1ccccc1"]],
  ["c1ccccc1", ["[Na+].[O-]c1ccccc1", "[Na+].[O-]c1ccc(C)cc1"]],
  ["c1ccccc1", ["c1ccc2c(c1)OCO2", "Cc1ccc2c(c1)OCO2"]],
];
for (const [core, smiles] of reconstructionCases) {
  const result = run(python, { mode: "decompose", core, rows: smiles.map((smiles, i) => ({ rowId: i+1, smiles })) });
  assert.ok(result.ok, result.error);
  const check = spawnSync(python, ["-c", `
import json,sys
from rdkit import Chem
x=json.load(sys.stdin)
for row in x['result']['rows']:
 vals=row['values']
 parts=list(dict.fromkeys([vals['Core']]+[v for k,v in vals.items() if k.startswith('R')]))
 mol=Chem.MolFromSmiles(parts[0])
 for part in parts[1:]: mol=Chem.CombineMols(mol,Chem.MolFromSmiles(part))
 mol=Chem.RemoveHs(Chem.molzip(mol))
 if vals.get('Components'): mol=Chem.CombineMols(mol,Chem.MolFromSmiles(vals['Components']))
 assert Chem.MolToSmiles(mol)==Chem.MolToSmiles(Chem.MolFromSmiles(x['smiles'][row['rowId']-1]))
`], { input: JSON.stringify({result, smiles}), encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
}
console.log("multi-scaffold, constant-group, order and reconstruction tests passed");
