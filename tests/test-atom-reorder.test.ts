import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { moveAtomOrder } from "../apps/desktop/src/lib/molecular-workbench/atom-order";
import { runGraphOperation } from "../apps/desktop/src/lib/molecular-workbench/graph-operations";
import { graphDraftText, graphSourceMetadata } from "../apps/desktop/src/lib/workbench/graph-draft";
import { remapGraphMetadata } from "../apps/desktop/src/lib/workbench/graph-metadata";
import { measurementPreviewTransfer, prepareMeasurementSourcePair, publishMeasurementSourcePair } from "../apps/desktop/src/lib/workbench/measurement-preview";
import { sha256Hex } from "../apps/desktop/src/lib/source-editing/source-identity";
import { REORDER_FIXTURES, orders, reorderCase } from "./fixtures/reorder-stereo/oracle-cases";

test("moving a row follows Avogadro's insertion-point semantics", () => {
  expect(moveAtomOrder(5, 0, 5)).toEqual([1, 2, 3, 4, 0]);
  expect(moveAtomOrder(5, 4, 0)).toEqual([4, 0, 1, 2, 3]);
  expect(moveAtomOrder(5, 1, 4)).toEqual([0, 2, 3, 1, 4]);
  expect(moveAtomOrder(5, 2, 2)).toEqual([0, 1, 2, 3, 4]);
  expect(moveAtomOrder(5, 2, 3)).toEqual([0, 1, 2, 3, 4]);
  expect(() => moveAtomOrder(5, 5, 0)).toThrow("Choose an atom");
  expect(() => moveAtomOrder(5, 0, 6)).toThrow("Choose an atom");
});

test("reorder, save copy and reopen keep the reordered graph; the inverse restores the normalized source", () => {
  for (const name of REORDER_FIXTURES) {
    for (const order of Object.values(orders(readFileSync(new URL(`./fixtures/reorder-stereo/${name}.mol`, import.meta.url), "utf8").split("\n")[3].trim().split(/\s+/u).map(Number)[0]))) {
      const { normalized, reordered, reopened } = reorderCase(name, order);
      expect(reordered.sourceAtomIndices).toEqual(order);
      expect([reopened.atoms, reopened.bonds]).toEqual([reordered.atoms, reordered.bonds]);
      const inverse = Array<number>(order.length);
      order.forEach((source, target) => { inverse[source] = target; });
      const back = runGraphOperation({ action: "edit-graph", molecule: reordered, edits: [{ kind: "reorder-atoms", order: inverse }] });
      expect(back.molfile).toBe(normalized.molfile);
    }
  }
});

test("SDF metadata identities follow a reorder through a saved copy", () => {
  const { source, reordered } = reorderCase("lactic-acid-r", moveAtomOrder(12, 1, 12));
  const sdf = `${source.trimEnd()}\n> <COMMENT>\nkept\n\n$$$$\n`;
  const metadata = graphSourceMetadata(sdf, "sdf", 12)!;
  const next = remapGraphMetadata(metadata, reordered.sourceAtomIndices);
  const saved = graphDraftText(sdf, "sdf", reordered.molfile, next);
  const reopened = graphSourceMetadata(saved, "sdf", 12)!;
  expect(reopened.atoms.map(atom => atom.id)).toEqual(reordered.sourceAtomIndices.map(index => metadata.atoms[index].id));
  expect(saved).toContain("> <COMMENT>\nkept\n");
  expect(reopened.conformer.id).toBe(metadata.conformer.id);
});

test("measurements follow reordered atoms forward, through Undo and across several reorders", async () => {
  const documentId = `reorder-measurements-${crypto.randomUUID()}`;
  const [a, b, c] = ["a", "b", "c"];
  const first = moveAtomOrder(4, 0, 4), second = [3, 2, 1, 0];
  publishMeasurementSourcePair(documentId, await prepareMeasurementSourcePair(a, b, 4, "mol", first));
  publishMeasurementSourcePair(documentId, await prepareMeasurementSourcePair(b, c, 4, "mol", second));
  const [hashA, hashB, hashC] = await Promise.all([sha256Hex(a), sha256Hex(b), sha256Hex(c)]);
  const items = [{ kind: "distance", points: [[0], [1]] }, { kind: "angle", points: [[0], [1], [2]] }];
  const capture = (sourceSha256: string) => ({ atomCount: 4, sourceFormat: "mol", sourceSha256, items, group: {} });
  // a → b: atom 0 moved to the end, so a's atoms 0, 1, 2 are b's rows 3, 0, 1.
  expect(measurementPreviewTransfer(documentId, hashB, capture(hashA)).items.map(item => item.points)).toEqual([[[3], [0]], [[3], [0], [1]]]);
  // a → c composes both reorders; c → a is the Undo direction.
  const toC = measurementPreviewTransfer(documentId, hashC, capture(hashA)).items.map(item => item.points);
  expect(toC).toEqual([[[0], [3]], [[0], [3], [2]]]);
  expect(measurementPreviewTransfer(documentId, hashA, { ...capture(hashC), items: [{ kind: "distance", points: [[0], [3]] }] }).items[0].points).toEqual([[0], [1]]);
  await expect(prepareMeasurementSourcePair(a, b, 4, "mol", [0, 0, 1, 2])).rejects.toThrow("permutation");
});
