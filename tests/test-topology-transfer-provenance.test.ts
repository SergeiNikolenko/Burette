import { expect, test } from "bun:test";
import { topologyAtomMapping, remapSourcePoints } from "../apps/desktop/src/lib/science-session/atom-provenance";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { editZmatrixRows, type ZmatrixRowAction } from "../scripts/zmatrix-rows.mjs";
import { zmatrixRowsRevision } from "../apps/desktop/src/lib/workbench/zmatrix-draft";
import { formatXyz } from "../scripts/internal-coordinates.mjs";
import type { ImportedRevision } from "../apps/desktop/src/lib/workbench/scientific-source-state";

const zmat = "O\nX 1 1\nH 1 1 2 50\nH 1 1 2 50 3 180\n";
function revisions() {
  const document = parseScientificFile("water.zmat", zmat)!;
  const first: ImportedRevision = { text: formatXyz(document.atoms.map(a => ({ element: a.element, position: [a.x, a.y, a.z] })), "source"), document };
  const list = [first];
  const edit = (action: ZmatrixRowAction) => {
    const previous = list.at(-1)!;
    const result = editZmatrixRows(previous.document.internalCoordinates!, action, previous.document.atoms.map(a => ({ element: a.element, position: [a.x, a.y, a.z] })));
    const next = zmatrixRowsRevision(previous.document, result, previous.text, list); list.push(next); return next;
  };
  const added = edit({ type: "append", row: { element: "F", refs: [3, 2, 1], values: [1.2, 110, 60] } });
  const moved = edit({ type: "move", index: 4, to: 3 });
  const removed = edit({ type: "remove", index: 2 });
  return { first, added, moved, removed, list };
}

test("actual row provenance composes forward and backward without same-element guesses", () => {
  const { first, added, moved, removed, list } = revisions();
  expect(topologyAtomMapping(list, first, added)).toEqual([0, 1, 2, -1]);
  expect(topologyAtomMapping(list, first, moved)).toEqual([0, 1, -1, 2]);
  expect(topologyAtomMapping(list, moved, first)).toEqual([0, 1, 3]);
  expect(topologyAtomMapping(list, removed, first)).toEqual([0, -1, 2]);
  expect(topologyAtomMapping(list, first, removed)).toEqual([0, -1, 2]);
  expect(topologyAtomMapping(list, added, added)).toEqual([0, 1, 2, 3]);
  expect(topologyAtomMapping([first], first, added)).toEqual([0, 1, 2, -1]);
});

test("surviving grouped measurement points and layer selections remap exactly", () => {
  const { moved, removed, list } = revisions();
  const mapping = topologyAtomMapping(list, moved, removed);
  expect(mapping).toEqual([0, 2, 3]);
  expect(remapSourcePoints([[0], [2, 3]], mapping, 4)).toEqual([[0], [1, 2]]);
  expect(remapSourcePoints([[0], [1]], mapping, 4)).toBeNull();
  expect(remapSourcePoints([[1, 2]], mapping, 4)).toBeNull();
});

test("unknown or malformed correspondence refuses before any remap", () => {
  const { first, added } = revisions();
  expect(() => topologyAtomMapping([first], first, { ...added, sourceAtomIndices: undefined })).toThrow("no exact atom");
  expect(() => topologyAtomMapping([first], first, { ...added, sourceAtomIndices: [0, 1, 2, 2] })).toThrow("Invalid atom provenance");
  expect(() => topologyAtomMapping([first], first, { ...first, document: added.document })).toThrow();
  expect(() => remapSourcePoints([[3]], [0, 1, 2], 3)).toThrow("source atoms");
  expect(() => remapSourcePoints([[0, 0]], [0, 1, 2], 3)).toThrow("source atoms");
  expect(() => remapSourcePoints([[0]], [0, 0], 3)).toThrow("Invalid atom provenance");
});
