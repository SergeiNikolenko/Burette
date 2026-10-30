import { expect, test } from "bun:test";
import { atomsFromZmatrixDocument, parseZmatrixDocument } from "../scripts/zmatrix-document.mjs";
import { formatXyz } from "../scripts/internal-coordinates.mjs";
import { withVariable, zmatrixRevision } from "../apps/desktop/src/lib/workbench/zmatrix-draft";
import { adoptRestoredScientificSource, releaseScopedScientificSource, registeredRevision, recordImportedRevision, importedOriginalFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import { frameSpectra } from "./scientific-spectra-document-fixture";

test("real geometry revisions retain spectra for an unchanged definition, drop them on movement and restore the original source data on Undo lookup", () => {
  const definition = parseZmatrixDocument("O\nH 1 R\nH 1 R 2 A\nR=1\nA=90\n"), coordinates = atomsFromZmatrixDocument(definition);
  const atoms = coordinates.map(({ element, position: [x, y, z] }) => ({ element, x, y, z })), text = formatXyz(coordinates, "source geometry");
  const fileSpectra = frameSpectra(0, 1); fileSpectra.source = { name: "file source", format: "avogadro-matrix", scope: "file" };
  const document: ScientificDocument = { format: "orca", atoms, frames: [{ atoms, spectra: frameSpectra(0, 1) }], spectra: fileSpectra, modes: [], orbitals: [], internalCoordinates: definition };
  const original = { name: "source.out", file: new Blob(["EXACT Original\r\n"]) }, id = "spectral-revisions-a", other = "spectral-revisions-b";
  adoptRestoredScientificSource(id, { text, document }, original);
  const unrelated = structuredClone(document);
  unrelated.frames[0].spectra!.source.name = "another source with identical atoms/text";
  adoptRestoredScientificSource(other, { text, document: unrelated }, { name: "other.out", file: new Blob(["OTHER"]) });
  try {
    const same = zmatrixRevision(document, definition, text, [{ text, document }]);
    expect(same.document.spectra).toBe(document.spectra);
    expect(same.document.frames[0].spectra).toBe(document.frames[0].spectra);
    const moved = zmatrixRevision(document, withVariable(definition, "R", 1.1), text, [{ text, document }]);
    expect(moved.document.spectra).toBeUndefined();
    expect(moved.document.frames[0].spectra).toBeUndefined();
    const rollback = recordImportedRevision(id, text, moved)!;
    expect(registeredRevision(id, moved.text)!.revision.document).toBe(moved.document); // Redo/current moved revision.
    expect(registeredRevision(id, text)!.revision.document).toBe(document); // Undo/current original revision.
    expect(registeredRevision(id, text + "\n")).toBeNull(); // Raw source change, despite identical atoms.
    expect(registeredRevision("unowned-spectral-document", text)).toBeNull();
    expect(registeredRevision(other, text)!.revision.document).toBe(unrelated);
    expect(importedOriginalFor(id)).toBe(original);
    rollback();
    expect(registeredRevision(id, moved.text)).toBeNull();
    expect(registeredRevision(id, text)!.revision.document.frames[0].spectra).toBe(document.frames[0].spectra);
  } finally { releaseScopedScientificSource(id); releaseScopedScientificSource(other); }
  expect(registeredRevision(id, text)).toBeNull();
});
