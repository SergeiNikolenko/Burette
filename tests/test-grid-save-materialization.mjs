import assert from "node:assert/strict";
import fs from "node:fs";

const viewerSource = fs.readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");

function functionSource(name) {
  const start = viewerSource.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = viewerSource.indexOf("\n  function ", start + 1);
  assert.notEqual(end, -1, `missing function after ${name}`);
  return viewerSource.slice(start, end);
}

function materializer(state) {
  return new Function(
    "state",
    `${functionSource("applyVirtualGridEdits")}\n${functionSource("materializeRemoteCollectionRows")}\nreturn materializeRemoteCollectionRows;`,
  )(state);
}

function state(overrides = {}) {
  return {
    hiddenRows: new Set(),
    rowPatches: new Map(),
    insertedRows: [],
    ...overrides,
  };
}

const base = { index: 0, name: "Base", smiles: "CC", props: {} };
const duplicate = { index: 1, name: "Base copy", smiles: "CC", props: {} };

{
  const current = state({ insertedRows: [duplicate] });
  assert.deepEqual(
    materializer(current)([base, duplicate]).map((row) => row.index),
    [0, 1],
    "an inserted row already present in the loaded window must be serialized once",
  );
}

{
  const current = state({ hiddenRows: new Set([1]), insertedRows: [duplicate] });
  assert.deepEqual(
    materializer(current)([base]).map((row) => row.index),
    [0],
    "deleting an inserted row must keep it out of the saved collection",
  );
}

{
  const current = state({
    insertedRows: [duplicate],
    rowPatches: new Map([[1, {
      name: "Edited copy",
      molblock: "",
      smiles: "CO",
      props: { source: "edited" },
    }]]),
  });
  assert.deepEqual(materializer(current)([base]), [
    base,
    {
      index: 1,
      name: "Edited copy",
      molblock: "",
      smiles: "CO",
      props: { source: "edited" },
    },
  ]);
}

{
  const collectionIndexReady = new Function(
    "state",
    `${functionSource("collectionIndexReady")}\nreturn collectionIndexReady;`,
  );
  assert.equal(collectionIndexReady({ remoteMode: true, indexReady: false, indexing: true })(), false);
  assert.equal(collectionIndexReady({ remoteMode: true, indexReady: true, indexing: false })(), true);
  assert.equal(collectionIndexReady({ remoteMode: false, indexReady: false, indexing: true })(), true);
}

{
  const serializeDelimitedRows = new Function(
    `${functionSource("serializeDelimitedRows")}\n${functionSource("gridDelimitedCell")}\n${functionSource("csv")}\nreturn serializeDelimitedRows;`,
  )();
  const csv = serializeDelimitedRows([
    {
      index: 0,
      name: "From \\ SDF",
      smiles: "",
      molblock: "Molecule \\ literal\nM  END",
      props: { Note: "Line 1\nLine 2 \\ tail" },
    },
    { index: 1, name: "From SMILES", smiles: "CC", molblock: "", props: {} },
  ], ",");
  assert.equal(csv.trimEnd().split("\n").length, 3, "saved CSV rows must remain single-line records");
  assert.match(csv, /burette_encoding/);
  assert.match(csv, /escaped-v1/);
  assert.match(csv, /Molecule \\\\ literal\\nM  END/);
  assert.match(csv, /Line 1\\nLine 2 \\\\ tail/);
}

console.log("Grid save materialization behavior checks passed.");
