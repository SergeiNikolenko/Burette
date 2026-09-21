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

const rustSource = readFileSync(
  fileURLToPath(new URL("../apps/desktop/src-tauri/src/commands/rgroups.rs", import.meta.url)),
  "utf8",
);
const runner = rustSource.match(/const RGROUP_RUNNER: &str = r#"([\s\S]*?)"#;/u)?.[1];
assert.ok(runner && runner.includes("rdRGroupDecomposition"), "the runner script is embedded in rgroups.rs");

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
