import assert from "node:assert/strict";
import { test } from "bun:test";
import { graphMetadataData, hasGraphMetadata, readGraphMetadata, validateGraphMetadata, remapGraphMetadata, patchGraphMetadata } from "../apps/desktop/src/lib/workbench/graph-metadata";

const foreign = "> <COMMENT>\nline one\n> <BURETTE_METADATA_V1>\nliteral foreign value\nline two  \n\n> <OTHER>\nkeep me  \n\n> <BURETTE_METADATA_V1_EXTRA>\nforeign suffix  ";

test("strict metadata rejects malformed, duplicate, oversized and ambiguous reserved data", () => {
  const metadata = readGraphMetadata("", 3);
  assert.deepEqual(validateGraphMetadata(metadata, 3), metadata);
  for (const value of [ { ...metadata, extra: true }, { ...metadata, atoms: [metadata.atoms[0], metadata.atoms[0], metadata.atoms[2]] },
    { ...metadata, conformer: { ...metadata.conformer, label: "x\n" } }, { ...metadata, conformer: { ...metadata.conformer, label: "x".repeat(65537) } },
    { ...metadata, atoms: metadata.atoms.map(atom => ({ ...atom, residue: { name: "ALA", sequence: NaN, chain: "", insertionCode: "" } })) } ]) assert.throws(() => validateGraphMetadata(value, 3));
  assert.throws(() => validateGraphMetadata(metadata, 2));
  assert.throws(() => remapGraphMetadata(metadata, [0, 0]));
  assert.throws(() => readGraphMetadata("", 257));
  assert.throws(() => remapGraphMetadata(metadata, Array(257).fill(-1)));
  assert.throws(() => patchGraphMetadata(metadata, { atoms: [{ id: "unknown", atomName: "C" }] }));
  for (const data of ["> <BURETTE_METADATA_V1>\n{bad}", "> <BURETTE_METADATA_V1>\n" + "x".repeat(65537),
    `> <BURETTE_METADATA_V1>\n${JSON.stringify(metadata)}\n\n> <BURETTE_METADATA_V1>\n${JSON.stringify(metadata)}` ]) {
    assert.throws(() => readGraphMetadata(data, 3));
    assert.throws(() => graphMetadataData(data, metadata));
  }
});

test("SDF metadata round trips while preserving foreign multiline values", () => {
  assert.equal(hasGraphMetadata(foreign), false);
  const original = readGraphMetadata(foreign, 3);
  const patch = { atoms: [{ id: original.atoms[1].id, atomName: "CA", residue: { name: "ALA", sequence: 7, chain: "A", insertionCode: "" } }], conformerLabel: "Conformer one" };
  const edited = patchGraphMetadata(original, patch);
  assert.deepEqual(original.atoms[1], { id: original.atoms[1].id });
  const encoded = graphMetadataData(foreign, edited);
  assert.ok(encoded.startsWith(`${foreign}\n\n`));
  assert.equal(hasGraphMetadata(encoded), true);
  assert.deepEqual(readGraphMetadata(encoded, 3), edited);
  const cleared = patchGraphMetadata(edited, { atoms: [{ id: edited.atoms[1].id, atomName: null, residue: null }], conformerLabel: null });
  assert.deepEqual(cleared, original);
  const replaced = graphMetadataData(encoded, cleared);
  assert.equal(replaced, graphMetadataData(foreign, original));
  // Validation copies nested records, so callers cannot mutate an older snapshot.
  patch.atoms[0].residue.name = "GLY";
  assert.equal(edited.atoms[1].residue!.name, "ALA");
});

test("atom provenance retains survivor identities and creates unannotated new atoms", () => {
  const original = readGraphMetadata("", 3);
  const labeled = patchGraphMetadata(original, { atoms: [{ id: original.atoms[1].id, atomName: "CA" }], conformerLabel: "Conformer one" });
  const remapped = remapGraphMetadata(labeled, [2, 1, -1]);
  assert.deepEqual(remapped.atoms.slice(0, 2), [labeled.atoms[2], labeled.atoms[1]]);
  assert.deepEqual(remapped.conformer, labeled.conformer);
  assert.deepEqual(Object.keys(remapped.atoms[2]), ["id"]);
  assert.ok(!original.atoms.some(atom => atom.id === remapped.atoms[2].id));
  assert.equal(new Set(remapped.atoms.map(atom => atom.id)).size, 3);
  assert.deepEqual(readGraphMetadata(graphMetadataData("", remapped), 3), remapped);
});
