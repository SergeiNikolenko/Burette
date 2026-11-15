/**
 * Reorders the RDKit-written fixtures through Burette's graph edit, saves them
 * as a draft copy and reopens that copy.
 * `rdkit-oracle.py` compares the results with RDKit on its own terms.
 *
 *   bun tests/fixtures/reorder-stereo/oracle-cases.ts <output directory>
 *   uv run --with rdkit==2026.09.1 python tests/fixtures/reorder-stereo/rdkit-oracle.py <output directory>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGraphOperation } from "../../../apps/desktop/src/lib/molecular-workbench/graph-operations";
import { moveAtomOrder } from "../../../apps/desktop/src/lib/molecular-workbench/atom-order";
import { graphDraftText } from "../../../apps/desktop/src/lib/workbench/graph-draft";

export const REORDER_FIXTURES = ["lactic-acid-r", "crotonic-acid-e", "dimethylcyclohexane-trans", "sodium-alaninate-s", "chlorofluoro-pentene-z", "but-2-yne-linear"];

/** Deterministic permutations: reverse, a rotation, Avogadro's drag of the first row to the end, and a shuffle. */
export function orders(count: number) {
  let seed = 7;
  const shuffled = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const other = seed % (index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return {
    reverse: Array.from({ length: count }, (_, index) => count - 1 - index),
    rotate: Array.from({ length: count }, (_, index) => (index + 3) % count),
    drag: moveAtomOrder(count, 0, count),
    shuffle: shuffled,
  };
}

export function reorderCase(name: string, order: number[]) {
  const source = readFileSync(new URL(`./${name}.mol`, import.meta.url), "utf8");
  const parsed = runGraphOperation({ action: "parse", source, format: "mol" });
  const normalized = runGraphOperation({ action: "edit-graph", molecule: parsed, edits: [{ kind: "reorder-atoms", order: parsed.atoms.map((_, index) => index) }] });
  const reordered = runGraphOperation({ action: "edit-graph", molecule: normalized, edits: [{ kind: "reorder-atoms", order }] });
  const saved = graphDraftText(source, "mol", reordered.molfile);
  const reopened = runGraphOperation({ action: "edit-graph", molecule: runGraphOperation({ action: "parse", source: saved, format: "mol" }), edits: [{ kind: "reorder-atoms", order: reordered.atoms.map((_, index) => index) }] });
  return { source, normalized, reordered, saved, reopened };
}

if (import.meta.main) {
  const output = process.argv[2];
  if (!output) throw new Error("Pass an output directory.");
  mkdirSync(output, { recursive: true });
  const manifest = REORDER_FIXTURES.flatMap(name => {
    const count = runGraphOperation({ action: "parse", source: readFileSync(new URL(`./${name}.mol`, import.meta.url), "utf8"), format: "mol" }).atoms.length;
    return Object.entries(orders(count)).map(([kind, order]) => {
      const { normalized, reordered, saved, reopened } = reorderCase(name, order);
      if (normalized.sourceAtomIndices.some((source, index) => source !== index)) throw new Error("Parsing changed the source atom order.");
      const file = `${name}-${kind}.mol`;
      writeFileSync(join(output, file), saved);
      return {
        fixture: `${name}.mol`, output: file, kind,
        // Displayed atom i of the reopened copy is source atom map[i] of the RDKit file.
        map: reordered.sourceAtomIndices,
        reopenedIsSame: JSON.stringify(reopened.atoms) === JSON.stringify(reordered.atoms) && JSON.stringify(reopened.bonds) === JSON.stringify(reordered.bonds),
      };
    });
  });
  writeFileSync(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${manifest.length} reordered copies to ${output}`);
}
