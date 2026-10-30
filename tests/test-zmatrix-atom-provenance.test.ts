import { describe, expect, test } from "bun:test";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { editZmatrixRows, type ZmatrixRowAction } from "../scripts/zmatrix-rows.mjs";
import { zmatrixRowsRevision } from "../apps/desktop/src/lib/workbench/zmatrix-draft";
import { atomIdsAlong, rememberRevisionAtomIds, type AtomIdRevision } from "../apps/desktop/src/lib/science-session/state";
import type { ImportedRevision } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { formatXyz } from "../scripts/internal-coordinates.mjs";

const source = "O\r\nX 1 1\r\nH 1 R 2 A\r\nH 1 R 2 A 3 180\r\n\r\nR = 0.9572\r\nA = 52.26\r\n";
function baseline() {
  const document = parseScientificFile("water.zmat", source)!;
  const text = "\uFEFF" + formatXyz(document.atoms.map(a => ({ element: a.element, position: [a.x, a.y, a.z] })), "exact source").replace(/\n/gu, "\r\n");
  const first: ImportedRevision = { text, document };
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  rememberRevisionAtomIds(first, ids);
  return { first, ids };
}
function edit(previous: ImportedRevision, revisions: ImportedRevision[], action: ZmatrixRowAction) {
  const rowEdit = editZmatrixRows(previous.document.internalCoordinates!, action,
    previous.document.atoms.map(a => ({ element: a.element, position: [a.x, a.y, a.z] })));
  return zmatrixRowsRevision(previous.document, rowEdit, previous.text, revisions);
}
const idsAt = (revisions: ImportedRevision[], position: number) => atomIdsAlong(revisions, position, i => revisions[i].document.atoms.length);

test("actual row append/delete/reorder keeps authoritative atom UUIDs through Undo/Redo", () => {
  const { first, ids } = baseline();
  const revisions = [first];
  const appended = edit(first, revisions, { type: "append", row: { element: "H", refs: [3, 2, 1], values: [1.2, 109.5, 60] } });
  revisions.push(appended);
  expect(appended.sourceAtomIndices).toEqual([0, 1, 2, -1]);
  const afterAdd = idsAt(revisions, 1)!;
  expect(afterAdd.slice(0, 3)).toEqual(ids);
  expect(afterAdd[3]).not.toBeOneOf(ids);
  expect(idsAt(revisions, 0)).toBe(ids);
  expect(idsAt(revisions, 1)).toBe(afterAdd);
  const moved = edit(appended, revisions, { type: "move", index: 4, to: 3 });
  revisions.push(moved);
  expect(moved.sourceAtomIndices).toEqual([0, 1, 3, 2]);
  expect(idsAt(revisions, 2)).toEqual([ids[0], ids[1], afterAdd[3], ids[2]]);
  const deleted = edit(moved, revisions, { type: "remove", index: 3 });
  revisions.push(deleted);
  expect(deleted.sourceAtomIndices).toEqual([0, 1, 3]);
  expect(idsAt(revisions, 3)).toEqual(ids);
  expect(first.text.startsWith("\uFEFF3\r\n")).toBe(true);
  expect(first.document.internalCoordinates!.variables.map(v => v.name)).toEqual(["R", "A"]);
});

test("unknown restored ids and absent ambiguous provenance stay unknown", () => {
  const { first } = baseline(); rememberRevisionAtomIds(first, null);
  const appended = edit(first, [first], { type: "append", row: { element: "H", refs: [3, 2, 1], values: [1.2, 109.5, 60] } });
  expect(idsAt([first, appended], 1)).toBeNull();
  const unknown = { ...appended, sourceAtomIndices: undefined };
  expect(idsAt([first, unknown], 1)).toBeNull();
});

describe("malformed provenance is rejected even for unknown atom ids", () => {
  for (const idsKnown of [true, false]) for (const mapping of [[0, 1, 1], [0, 1, 3], [0, -2, 2], [0, 1, 1.5], [0, 1], [0, 1, Number.NaN]]) {
    test(`${idsKnown ? "known" : "unknown"} ids: ${String(mapping)}`, () => {
      const { first } = baseline(); if (!idsKnown) rememberRevisionAtomIds(first, null);
      const revision: AtomIdRevision = { topology: 1, sourceAtomIndices: mapping };
      expect(() => atomIdsAlong([first, revision], 1, () => 3)).toThrow("Invalid atom provenance");
    });
  }
  for (const known of [true, false]) test(`same-topology prefix deletion refuses ${known ? "known" : "unknown"} ids`, () => {
    const { first } = baseline(); if (!known) rememberRevisionAtomIds(first, null);
    expect(() => atomIdsAlong([first, { sourceAtomIndices: [0, 1] }], 1, i => i === 0 ? 3 : 2)).toThrow("without a topology");
  });
  test("reorder must declare a new topology", () => {
    const { first } = baseline();
    expect(() => atomIdsAlong([first, { sourceAtomIndices: [0, 2, 1] }], 1, () => 3)).toThrow("without a topology");
  });
});
