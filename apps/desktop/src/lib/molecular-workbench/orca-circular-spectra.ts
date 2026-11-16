import type { AdditionalSpectrum } from "./scientific-spectra";

type CircularSpectrum = Extract<AdditionalSpectrum, { kind: "vcd" | "mcd" }>;
export type OrcaCircularTable = { start: number; end: number; spectrum: CircularSpectrum };
const MAX_BYTES = 16 * 1024 * 1024, MAX_ROWS = 10_000;
function fail(message: string): never { throw new Error(`Invalid ORCA circular spectrum: ${message}`); }
function bounded(text: string) {
  if (text.length > MAX_BYTES || text.includes("\0") || new TextEncoder().encode(text).length > MAX_BYTES) fail("source exceeds the 16 MiB text budget.");
}
function number(text: string) {
  const value = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?$/.test(text) ? Number(text.replace(/[dD]/, "e")) : NaN;
  if (!Number.isFinite(value)) fail("expected finite source quantities.");
  return value;
}

/** Caller supplies ONE source vibration set and its already parsed indexed modes. */
export function readOrcaVcdTables(vibrationText: string, modes: readonly { index: number; frequencyCm1: number }[]): OrcaCircularTable[] {
  bounded(vibrationText);
  if (modes.length > 30_000) fail("source mode count exceeds the geometry bound.");
  const frequencies = new Map<number, number>();
  for (const mode of modes) {
    if (!Number.isSafeInteger(mode.index) || mode.index < 0 || mode.index >= 30_000 || !Number.isFinite(mode.frequencyCm1) || frequencies.has(mode.index)) fail("invalid source mode identity.");
    frequencies.set(mode.index, mode.frequencyCm1);
  }
  const tables: OrcaCircularTable[] = [];
  let totalRows = 0;
  for (const title of vibrationText.matchAll(/^[\t ]*VCD SPECTRUM[\t ]*(?:\r\n?|\n|$)/gm)) {
    let cursor = title.index! + title[0].length;
    const pattern = /([^\r\n]*)(?:\r\n?|\n|$)/y;
    const nextLine = () => {
      if (cursor >= vibrationText.length) return null;
      pattern.lastIndex = cursor;
      const match = pattern.exec(vibrationText)!;
      cursor = pattern.lastIndex;
      return match[1].trim();
    };
    let line: string | null = null;
    for (let i = 0; i < 10; i++) {
      line = nextLine();
      if (/^(?:(?:IR|RAMAN|VCD|CD|ABSORPTION) SPECTRUM\b|VIBRATIONAL FREQUENCIES\b|NORMAL MODES\b|CARTESIAN COORDINATES\b|THERMOCHEMISTRY\b)/.test(line ?? "")) fail("VCD header crosses a source section boundary.");
      if (/\bMode\b.*\bFreq(?:uency)?\b/i.test(line ?? "")) break;
    }
    if (!/\bMode\b.*\bFreq(?:uency)?\b/i.test(line ?? "")) fail("missing VCD source columns.");
    const unitMatch = (nextLine() ?? "").match(/^\(?cm(?:\*\*|\^)?-1\)?(?:\s+(.*))?$/);
    if (!unitMatch) fail("VCD frequencies must declare inverse centimetres.");
    const valueUnit = unitMatch[1]?.replace(/^\((.*)\)$/, "$1") ?? null;
    if (valueUnit !== null && (!valueUnit || valueUnit.length > 128)) fail("invalid source VCD signal unit.");
    if (!/^-+$/.test(nextLine() ?? "")) fail("missing VCD table separator.");
    const positions: number[] = [], values: number[] = [], printed: number[] = [], sourceRowIds: string[] = [];
    const seen = new Set<number>();
    let end = cursor;
    line = nextLine();
    while (line !== null && line !== "") {
      const fields = line.split(/\s+/), indexMatch = fields[0].match(/^(\d+):?$/);
      if (fields.length !== 3 || !indexMatch || indexMatch[1].length > 128) fail("malformed VCD source row.");
      const index = Number(indexMatch[1]), frequency = frequencies.get(index), printedFrequency = number(fields[1]);
      if (frequency === undefined || seen.has(index) || Math.abs(printedFrequency - frequency) > 0.02) fail("VCD row does not match its source mode.");
      seen.add(index); sourceRowIds.push(indexMatch[1]); positions.push(frequency); printed.push(printedFrequency); values.push(number(fields[2]));
      if (++totalRows > MAX_ROWS) fail("VCD tables exceed 10,000 source rows.");
      end = cursor;
      line = nextLine();
    }
    if (!positions.length) fail("empty VCD table.");
    tables.push({ start: title.index!, end, spectrum: { kind: "vcd", xUnit: "cm^-1", positions, values, valueUnit, sourceRowIds,
      auxiliary: [{ name: "printed frequency", unit: "cm^-1", values: printed }] } });
  }
  return tables;
}

/**
 * Parse ONLY explicitly supplied companion text; never discover/open a sibling.
 * A decreasing frequency begins a separate block. The native reader selects the
 * first monotonic block; returning all blocks avoids silently losing the rest.
 */
export function readOrcaMcdBlocks(text: string): OrcaCircularTable[] {
  bounded(text);
  const blocks: OrcaCircularTable[] = [];
  const tokens = text.matchAll(/\S+/g);
  let rows = 0, current: OrcaCircularTable | undefined;
  let positions: number[] = [], values: number[] = [], absorptionValues: number[] = [];
  for (let first = tokens.next(); !first.done; first = tokens.next()) {
    const second = tokens.next(), third = tokens.next();
    if (second.done || third.done) fail("incomplete MCD frequency/signal/absorption triple.");
    const position = number(first.value[0]), value = number(second.value[0]), absorption = number(third.value[0]);
    if (++rows > MAX_ROWS) fail("MCD blocks exceed 10,000 source rows.");
    const last = positions.at(-1);
    if (!current || (last !== undefined && position < last)) {
      positions = []; values = []; absorptionValues = [];
      current = { start: first.value.index!, end: 0, spectrum: { kind: "mcd", xUnit: "cm^-1", positions, values, valueUnit: null,
        auxiliary: [{ name: "absorption", unit: null, values: absorptionValues }] } };
      blocks.push(current);
    }
    positions.push(position); values.push(value); absorptionValues.push(absorption);
    current.end = third.value.index! + third.value[0].length;
  }
  if (!blocks.length) fail("empty MCD companion data.");
  return blocks;
}
