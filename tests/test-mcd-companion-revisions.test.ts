import { expect, test } from "bun:test";
import { atomsFromZmatrixDocument, parseZmatrixDocument } from "../scripts/zmatrix-document.mjs";
import { editZmatrixRows } from "../scripts/zmatrix-rows.mjs";
import { formatXyz } from "../scripts/internal-coordinates.mjs";
import { withVariable, zmatrixRevision, zmatrixRowsRevision } from "../apps/desktop/src/lib/workbench/zmatrix-draft";
import { encodeScienceSession } from "../apps/desktop/src/lib/science-session/codec";
import { mcdDataForExport } from "../apps/desktop/src/lib/workbench/mcd-export";
import { sha256Hex } from "../apps/desktop/src/lib/source-editing/source-identity";
import { adoptRestoredScientificSource, recordImportedRevision, scientificStateFor, releaseScopedScientificSource } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
async function fixture() {
  const definition = parseZmatrixDocument("O\nH 1 R\nH 1 R 2 A\nR=1\nA=90\nUNUSED=1\n"), coordinates = atomsFromZmatrixDocument(definition);
  const atoms = coordinates.map(({ element, position: [x,y,z] }) => ({ element,x,y,z })), text = formatXyz(coordinates, "source geometry import-abc12345");
  const original = { name: "authored.out", file: new Blob(["Original\r\n"]) }, file = new Blob(["10000 -2.25 .12\r\n"]);
  const hashes = { primaryOriginalSha256: await sha256Hex(new Uint8Array(await original.file.arrayBuffer())), companionOriginalSha256: await sha256Hex(new Uint8Array(await file.arrayBuffer())), sourceRevisionSha256: await sha256Hex(text) };
  const document: ScientificDocument = { format: "orca", atoms, frames: [{ atoms, mcdCompanion: { ...hashes,
    spectra: { kind: "scientific-spectra", version: 1, source: { name: "explicit.mcd", format: "orca-mcd", scope: "frame", frameIndex: 0, frameCount: 1 }, atomicNumbers: [8,1,1], spectra: [
      { kind: "mcd", xUnit: "cm^-1", positions: [10000], values: [-2.25], valueUnit: null, auxiliary: [{ name: "absorption", unit: null, values: [.12] }] } ] } } }], modes: [], orbitals: [], internalCoordinates: definition };
  const companions = [{ role: "orca-mcd" as const, frameIndex: 0, frameCount: 1, name: "explicit.mcd", file, ...hashes }];
  const content = { documentUuid: "0f8fad5b-d9cb-469f-a165-70867728950e", atomIds: null, binding: { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: 3 }, original };
  return { definition, document, text, companions, content };
}

test("actual managed no-op definitions carry receipts without changing source arrays or losing raw provenance on movement", async () => {
  const { definition, document, text, companions, content } = await fixture(), id = "mcd-managed-revision", origin = { text, document };
  adoptRestoredScientificSource(id, origin, content.original, companions);
  try {
    const first = zmatrixRevision(document, withVariable(definition, "UNUSED", 2), text, [origin]);
    recordImportedRevision(id, text, first);
    const second = zmatrixRevision(first.document, withVariable(definition, "UNUSED", 3), first.text, scientificStateFor(id, first.text).revisions!);
    recordImportedRevision(id, first.text, second);
    expect(second.text).not.toBe(text); expect(second.document.frames).toBe(document.frames);
    const carried = await mcdDataForExport(second, second.text, companions), digest = await sha256Hex(second.text);
    expect(carried.science!.frames[0].mcdCompanion!.sourceRevisionSha256).toBe(digest);
    expect(carried.science!.frames[0].mcdCompanion!.spectra).toBe(document.frames[0].mcdCompanion!.spectra);
    expect(carried.companions![0]).toMatchObject({ sourceRevisionSha256: digest, originRevisionSha256: companions[0].sourceRevisionSha256 });
    expect(carried.companions![0].file).toBe(companions[0].file);
    expect(document.frames[0].mcdCompanion!.sourceRevisionSha256).toBe(companions[0].sourceRevisionSha256);
    expect((await encodeScienceSession({ ...content, ...carried, source: { extension: "xyz", text: second.text } })).manifest.version).toBe(3);
    expect(first.retainedScienceFrom).toBe(origin); expect(second.retainedScienceFrom).toBe(origin); // Direct, bounded origin.
    const moved = zmatrixRevision(second.document, withVariable(definition, "R", 1.1), second.text, scientificStateFor(id, second.text).revisions!);
    recordImportedRevision(id, second.text, moved);
    expect(moved.document.frames[0].mcdCompanion).toBeUndefined(); expect(moved.retainedScienceFrom).toBeUndefined();
    const retained = scientificStateFor(id, moved.text).companions;
    expect(retained![0].file).toBe(companions[0].file);
    expect((await encodeScienceSession({ ...content, companions: retained, science: moved.document, source: { extension: "xyz", text: moved.text } })).manifest.version).toBe(3);
    expect(scientificStateFor(id, second.text).revision).toBe(second); // Undo lookup owns the prior calculated frame.
  } finally { releaseScopedScientificSource(id); }
});

test("same coordinates, a borrowed witness or an unrelated source text cannot carry an old receipt", async () => {
  const { definition, document, text, companions } = await fixture(), origin = { text, document }, next = zmatrixRevision(document, withVariable(definition, "UNUSED", 2), text, [origin]);
  await expect(mcdDataForExport({ text: next.text, document }, next.text, companions)).rejects.toMatchObject({ code: "source" });
  await expect(mcdDataForExport({ ...next, document: { ...document, frames: [...document.frames] } }, next.text, companions)).rejects.toMatchObject({ code: "source" });
  await expect(mcdDataForExport(next, next.text + "\n", companions)).rejects.toMatchObject({ code: "source" });
});

test("reference-only row edits carry MCD ownership while real atom insertions do not", async () => {
  const { definition, document, text, companions, content } = await fixture(), origin = { text, document };
  const atoms = document.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
  const reference = editZmatrixRows(definition, { type: "append", row: { element: "X", refs: [0, 1, 2], values: [2, 90, 90] } }, atoms);
  const next = zmatrixRowsRevision(document, reference, text, [origin]);
  expect(next.document.frames).toBe(document.frames);
  const carried = await mcdDataForExport(next, next.text, companions);
  expect(carried.companions![0].file).toBe(companions[0].file);
  expect((await encodeScienceSession({ ...content, ...carried, source: { extension: "xyz", text: next.text } })).manifest.version).toBe(3);
  const chemical = editZmatrixRows(definition, { type: "append", row: { element: "H", refs: [0, 1, 2], values: [2, 90, 90] } }, atoms);
  const inserted = zmatrixRowsRevision(document, chemical, text, [origin]);
  expect(inserted.retainedScienceFrom).toBeUndefined(); expect(inserted.document.frames[0].mcdCompanion).toBeUndefined();
});
