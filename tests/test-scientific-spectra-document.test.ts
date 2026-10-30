import { expect, test } from "bun:test";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { checkScientificSpectra } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import { spectralDocument } from "./scientific-spectra-document-fixture";

test("file data and all six frame datasets retain raw arrays and their exact source frame", () => {
  const { document, text } = spectralDocument(), before = structuredClone(document);
  const sourceAtoms = document.frames[0].spectra!.atomicNumbers, sourceRows = document.frames[0].spectra!.spectra;
  expect(validateScientificDocument(document, readXyzFrames(text))).toBe(document);
  expect(document.frames[1].spectra!.spectra.map(signal => signal.kind)).toEqual(["vcd", "mcd", "nmr", "electronic", "ecd", "dos"]);
  expect(document.frames[1].spectra!.source).toEqual({ name: "authored-source-matrices", format: "avogadro-matrix", scope: "frame", frameIndex: 1, frameCount: 2 });
  expect(document).toEqual(before);
  expect(document.frames[0].spectra!.atomicNumbers).toBe(sourceAtoms);
  expect(document.frames[0].spectra!.spectra).toBe(sourceRows);
});

test("same-count atoms, borrowed frame metadata, file/frame scope and unsupported quantities cannot rebind spectra", () => {
  const changes: Array<(document: any) => void> = [
    doc => { doc.frames[1].spectra.source.frameIndex = 0; },
    doc => { doc.frames[0].spectra.source.frameCount = 1; },
    doc => { doc.frames[1].spectra.source = { name: "wrong", format: "avogadro-matrix", scope: "file" }; },
    doc => { doc.spectra.source = { name: "wrong", format: "avogadro-matrix", scope: "frame", frameIndex: 0, frameCount: 2 }; },
    doc => { doc.frames[1].spectra.atomicNumbers = [1, 8, 1]; },
    doc => { doc.spectra.atomicNumbers = [8, 1]; },
    doc => { doc.frames[1].spectra.spectra[2].atomIndices = [0, 0]; },
    doc => { doc.frames[1].spectra.spectra[2].quantity = "already-referenced-chemical-shift"; },
    doc => { doc.frames[1].spectra.spectra[3].sourceRowIds = ["x", "x"]; },
    doc => { doc.frames[1].spectra.spectra[4].values = [1]; },
  ];
  for (const change of changes) { const { document, text } = spectralDocument(); change(document); expect(() => validateScientificDocument(document, readXyzFrames(text))).toThrow(); }
  const { document } = spectralDocument();
  document.frames[1].atoms = document.frames[0].atoms.map(atom => ({ ...atom }));
  const text = `3\nfirst\n${document.atoms.map(atom => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`).join("\n")}\n`.repeat(2);
  expect(validateScientificDocument(document, readXyzFrames(text))).toBe(document);
  document.frames[1].spectra = document.frames[0].spectra; // geometries and counts match, provenance does not.
  expect(() => validateScientificDocument(document, readXyzFrames(text))).toThrow("exact source frame");
});

test("all source frames share one row budget, including the file-scoped dataset", () => {
  const { document, text } = spectralDocument(); delete document.spectra;
  for (const [i, frame] of document.frames.entries()) {
    frame.spectra!.spectra = [{ kind: "dos", xUnit: "eV", positions: Array.from({ length: 5000 }, (_, n) => n), values: Array(5000).fill(i + 1), valueUnit: null }];
  }
  expect(validateScientificDocument(document, readXyzFrames(text))).toBe(document);
  document.spectra = { ...document.frames[0].spectra!, source: { name: "extra file data", format: "avogadro-matrix", scope: "file" },
    spectra: [{ kind: "dos", xUnit: "eV", positions: [-1], values: [1], valueUnit: null }] };
  expect(checkScientificSpectra(document.spectra)).toBe(document.spectra);
  expect(() => validateScientificDocument(document, readXyzFrames(text))).toThrow("across all source frames");
});

test("per-dataset valid scalars cannot multiply their budget across source frames", () => {
  const atoms = Array.from({ length: 10000 }, () => ({ element: "C", x: 0, y: 0, z: 0 }));
  const rows = Array(5000).fill(0) as number[];
  const frames = [0, 1].map(i => ({ atoms, spectra: { kind: "scientific-spectra" as const, version: 1 as const,
    source: { name: "bounded frame", format: "avogadro-matrix" as const, scope: "frame" as const, frameIndex: i, frameCount: 2 },
    atomicNumbers: Array(10000).fill(6) as number[], spectra: [{ kind: "electronic" as const, xUnit: "eV" as const, positions: rows, values: rows, valueUnit: null,
      sourceRowIds: rows.map((_, n) => String(n)), auxiliary: Array.from({ length: 6 }, (_, n) => ({ name: `source ${n}`, unit: null, values: rows })) }] } }));
  frames.forEach(frame => expect(checkScientificSpectra(frame.spectra)).toBe(frame.spectra));
  const document: ScientificDocument = { format: "orca", atoms, frames, modes: [], orbitals: [] };
  const source = { elements: Array(10000).fill("C") as string[], positions: new Float64Array(30000) };
  expect(() => validateScientificDocument(document, [source, source])).toThrow("row/scalar budget");
});
