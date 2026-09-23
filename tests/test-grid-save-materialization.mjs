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
    [
      functionSource("applyVirtualGridEdits"),
      functionSource("stripDeletedPropColumns"),
      functionSource("materializeRemoteCollectionRows"),
      // A value range is applied where rows are materialised, so the saved
      // collection carries the limits the table showed.
      functionSource("applyColumnValueRanges"),
      functionSource("clampTextToValueRange"),
      functionSource("clampToValueRange"),
      "return materializeRemoteCollectionRows;",
    ].join("\n"),
  )(state);
}

function state(overrides = {}) {
  return {
    hiddenRows: new Set(),
    deletedPropColumns: new Set(),
    rowPatches: new Map(),
    insertedRows: [],
    columnValueRanges: new Map(),
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
  // A deleted column must stay out of the save while the others survive - and
  // rows patched by an edit go through the same strip as untouched rows.
  const withProps = { index: 0, name: "Base", smiles: "CC", props: { IC50: "4", Source: "assay" } };
  const current = state({ deletedPropColumns: new Set(["Source"]) });
  current.rowPatches.set(0, { name: "Base", smiles: "CC", props: { IC50: "5", Source: "assay" } });
  const [saved] = materializer(current)([withProps]);
  assert.deepEqual(saved.props, { IC50: "5" }, "a deleted column must not reach the saved collection");
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
  const current = state({ columnValueRanges: new Map([["prop:IC50", { min: 0, max: 9 }]]) });
  assert.deepEqual(
    materializer(current)([
      { index: 0, name: "High", smiles: "CC", props: { IC50: "12.5", Note: "kept" } },
      { index: 1, name: "Blank", smiles: "CO", props: { IC50: "" } },
    ]).map((row) => row.props),
    [{ IC50: "9", Note: "kept" }, { IC50: "" }],
    "a value range must reach the saved collection without touching empty cells or other columns",
  );
}

{
  const collectionIndexReady = new Function(
    "state",
    `${functionSource("collectionIndexReady")}\nreturn collectionIndexReady;`,
  );
  assert.equal(collectionIndexReady({ remoteMode: true, indexStateKnown: true, indexReady: false, indexing: true })(), false);
  assert.equal(collectionIndexReady({ remoteMode: true, indexStateKnown: true, indexReady: true, indexing: false })(), true);
  assert.equal(collectionIndexReady({ remoteMode: false, indexReady: false, indexing: true })(), true);
}

{
  const serializeDelimitedRows = new Function(
    `${functionSource("withSarProperties")}\n${functionSource("serializeDelimitedRows")}\n${functionSource("gridDelimitedCell")}\n${functionSource("csv")}\nreturn serializeDelimitedRows;`,
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

{
  const save = new Function(`${functionSource("withSarProperties")}\n${functionSource("serializeDelimitedRows")}\n${functionSource("gridDelimitedCell")}\n${functionSource("csv")}\nreturn serializeDelimitedRows;`)();
  const rows = [{index: 0, name: "Series member", smiles: "Cc1ccccc1", props: {R1: "user value"}, descriptors: {
    RGroup_Core: {value: "c1ccc([*:1])cc1"}, RGroup_R1: {value: "C[*:1]"}, RGroup_Status: {value: "Matched"},
  }}];
  const text = save(rows, ",");
  assert.match(text, /RGroup_Core,RGroup_R1,RGroup_Status/);
  assert.match(text, /user value,c1ccc\(\[\*:1\]\)cc1,C\[\*:1\],Matched/);
  assert.deepEqual(rows[0].props, {R1: "user value"}, "saving does not mutate original properties");
}
{
  const filters = new Function("state", `${functionSource("remoteTableColumnFilters")}\nreturn remoteTableColumnFilters();`)({ tableColumnFilters: {
    "descriptor:RGroup_Series": {type: "text", text: "S2"},
    "descriptor:MW": {type: "number", min: 100},
  }});
  assert.deepEqual(filters, [{id: "descriptor:RGroup_Series", filterType: "text", text: "S2"}]);
}

{
  // Rendering may discover an invalid structure after the page was loaded.
  // Card compaction must not alter table/export rows or remote paging offsets.
  const rows = [{ index: 0, smiles: 'CC' }, { index: 1, smiles: 'not-a-smiles((' }, { index: 2, smiles: 'CCC' }];
  const current = { rows, visibleCount: 3, viewMode: 'cards' };
  let scheduled = 0;
  const { omit, visible } = new Function('state', 'requestAnimationFrame', `
    const invalidCardSources = new WeakMap();
    ${functionSource('omitInvalidCard')}
    ${functionSource('cardViewRows')}
    return { omit: omitInvalidCard, visible: cardViewRows };
  `)(current, () => { scheduled++; });
  omit(rows[1]); omit(rows[1]);
  assert.equal(scheduled, 1, 'invalid cards request one compacting render');
  assert.deepEqual(visible(rows).map(row => row.index), [0, 2]);
  assert.equal(current.rows.length, 3, 'raw paging offset is unchanged');
  current.viewMode = 'table';
  assert.equal(visible(rows), rows, 'the table retains the original data');
  current.viewMode = 'cards';
  rows[1].smiles = 'CO';
  assert.deepEqual(visible(rows).map(row => row.index), [0, 1, 2], 'editing a bad structure restores its card');
}

{
  const { default: initRDKit } = await import('@rdkit/rdkit');
  const rdkit = await initRDKit();
  const omitted = [];
  const current = { rdkit, smartsMatches: new Map(), svgCache: new Map(), rdkitUseInputCoords: false };
  const draw = new Function('state', 'rowReactionText', 'rdkitCardKey', 'omitInvalidCard', `${functionSource('drawRdkit')} return drawRdkit;`)(
    current, () => '', row => row.smiles, row => omitted.push(row.index),
  );
  assert.equal(draw({ index: 0, smiles: 'not-a-smiles((' }), '');
  assert.equal(draw({ index: 1, smiles: '' }), '');
  assert.deepEqual(omitted, [0, 1], 'real RDKit rejects invalid and empty structures without error cards');
}
