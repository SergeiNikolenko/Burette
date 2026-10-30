import { elementSymbol } from "./elements";
import type { NmrSpectrum } from "./scientific-spectra";

/** Offsets address the unchanged source text, for the coordinate parser's frame binding. */
export type OrcaNmrTable = { start: number; end: number; indexBase: 0 | 1; spectrum: NmrSpectrum };
type Row = { nucleus: number; element: string; isotropic: number; anisotropy: number };
const MAX_BYTES = 16 * 1024 * 1024, MAX_ROWS = 10_000;
const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?$/;
function fail(message: string): never { throw new Error(`Invalid ORCA NMR: ${message}`); }
function number(text: string) {
  const value = numeric.test(text) ? Number(text.replace(/[dD]/, "e")) : NaN;
  if (!Number.isFinite(value)) fail("expected a finite source quantity.");
  return value;
}

/**
 * Read absolute shielding, without applying a chemical-shift reference. A single
 * index base must explain every nucleus AND its element; sparse ambiguous tables
 * fail instead of guessing. Missing calculations are never replaced with zero.
 * This does not parse coordinates or assign a table to the current/final frame.
 */
export function readOrcaNmrTables(text: string, atomicNumbers: readonly number[]): OrcaNmrTable[] {
  if (text.length > MAX_BYTES || text.includes("\0") || new TextEncoder().encode(text).length > MAX_BYTES) fail("source exceeds the 16 MiB text budget.");
  if (!atomicNumbers.length || atomicNumbers.length > MAX_ROWS) fail("source atoms must list 1–10,000 elements.");
  const elements = Array.from(atomicNumbers, elementSymbol);
  const tables: OrcaNmrTable[] = [];
  let totalRows = 0;
  for (const header of text.matchAll(/^[\t ]*CHEMICAL SHIELDING SUMMARY \(ppm\)[\t ]*(?:\r\n?|\n|$)/gm)) {
    let cursor = header.index! + header[0].length;
    const linePattern = /([^\r\n]*)(?:\r\n?|\n|$)/y;
    const nextLine = () => {
      if (cursor >= text.length) return null;
      linePattern.lastIndex = cursor;
      const match = linePattern.exec(text)!;
      cursor = linePattern.lastIndex;
      return match[1].trim();
    };
    let line = nextLine();
    while (line !== null && (!line || /^-+$/.test(line))) line = nextLine();
    if (!/^Nucleus\s+Element\s+Isotropic\s+Anisotropy$/.test(line ?? "")) fail("unsupported shielding columns.");
    line = nextLine();
    while (line !== null && (!line || /^[\s-]+$/.test(line))) line = nextLine();
    const rows: Row[] = [], nuclei = new Set<number>();
    let end = cursor;
    while (line !== null && line !== "") {
      const fields = line.split(/\s+/);
      if (fields.length !== 4 || !/^\d+$/.test(fields[0])) fail("malformed shielding row.");
      const nucleus = Number(fields[0]);
      if (!Number.isSafeInteger(nucleus) || nucleus > atomicNumbers.length || nuclei.has(nucleus)) fail("invalid or repeated nucleus index.");
      nuclei.add(nucleus);
      rows.push({ nucleus, element: fields[1], isotropic: number(fields[2]), anisotropy: number(fields[3]) });
      if (++totalRows > MAX_ROWS) fail("shielding tables exceed 10,000 source rows.");
      end = cursor;
      line = nextLine();
    }
    if (!rows.length) fail("empty shielding table.");
    const candidates = ([0, 1] as const).filter(base => rows.every(row =>
      row.nucleus >= base && row.nucleus - base < elements.length && elements[row.nucleus - base] === row.element));
    if (candidates.length !== 1) fail("nucleus indices and source elements do not identify a unique index base.");
    const indexBase = candidates[0];
    tables.push({ start: header.index!, end, indexBase, spectrum: {
      kind: "nmr", quantity: "isotropic-shielding",
      atomIndices: rows.map(row => row.nucleus - indexBase), valuesPpm: rows.map(row => row.isotropic),
      auxiliary: [
        { name: "source nucleus index", unit: null, values: rows.map(row => row.nucleus) },
        { name: "anisotropy", unit: "ppm", values: rows.map(row => row.anisotropy) },
      ],
    } });
  }
  return tables;
}
