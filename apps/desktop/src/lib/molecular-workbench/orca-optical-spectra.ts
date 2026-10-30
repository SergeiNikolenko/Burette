import type { AdditionalSpectrum } from "./scientific-spectra";

type OpticalSpectrum = Extract<AdditionalSpectrum, { kind: "electronic" | "ecd" }>;
/** Offsets address the unchanged text; the coordinate reader owns frame association. */
export type OrcaOpticalTable = { start: number; end: number; spectrum: OpticalSpectrum };
const MAX_BYTES = 16 * 1024 * 1024, MAX_ROWS = 10_000;
function fail(message: string): never { throw new Error(`Invalid ORCA optical spectrum: ${message}`); }
function number(text: string) {
  const value = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?$/.test(text) ? Number(text.replace(/[dD]/, "e")) : NaN;
  if (!Number.isFinite(value)) fail("expected finite source quantities.");
  return value;
}

/** Electric-dipole absorption/CD, preserving every declared numeric column and transition ID. */
export function readOrcaOpticalTables(text: string): OrcaOpticalTable[] {
  if (text.length > MAX_BYTES || text.includes("\0") || new TextEncoder().encode(text).length > MAX_BYTES) fail("source exceeds the 16 MiB text budget.");
  const tables: OrcaOpticalTable[] = [];
  let totalRows = 0;
  for (const title of text.matchAll(/^[\t ]*(ABSORPTION|CD) SPECTRUM VIA TRANSITION ELECTRIC DIPOLE MOMENTS[\t ]*(?:\r\n?|\n|$)/gm)) {
    const kind = title[1] === "CD" ? "ecd" : "electronic";
    let cursor = title.index! + title[0].length;
    const pattern = /([^\r\n]*)(?:\r\n?|\n|$)/y;
    const nextLine = () => {
      if (cursor >= text.length) return null;
      pattern.lastIndex = cursor;
      const match = pattern.exec(text)!;
      cursor = pattern.lastIndex;
      return match[1].trim();
    };
    let line = nextLine();
    while (line !== null && (!line || /^-+$/.test(line))) line = nextLine();
    if (!/^(?:State|Transition)\s+Energy\b/.test(line ?? "")) fail("unsupported transition header.");
    const components = line!.split(/\s+/).slice(kind === "electronic" ? -4 : -3);
    if (kind === "electronic" ? !/^[DT]2 [DT]X [DT]Y [DT]Z$/.test(components.join(" ")) : components.join(" ") !== "MX MY MZ") fail("unsupported dipole columns.");
    if (kind === "electronic" && !/\bfosc(?:\(|\s|$)/.test(line!)) fail("missing oscillator-strength column.");
    if (kind === "ecd" && !/\bR\s+MX\b/.test(line!)) fail("missing rotatory-strength column.");
    const units = [...(nextLine() ?? "").matchAll(/\(([^()]*)\)/g)].map(match => match[1]);
    const modern = units[0] === "eV", signalIndex = modern ? 3 : 2;
    if (units.length !== (modern ? 7 : 6) || units[modern ? 1 : 0] !== "cm-1" || units[modern ? 2 : 1] !== "nm") fail("unsupported declared energy units.");
    const valueUnit = kind === "ecd" ? units[signalIndex] : null;
    if (valueUnit !== null && (!valueUnit || valueUnit.length > 128)) fail("invalid declared rotatory-strength unit.");
    const componentUnits = units.slice(kind === "electronic" ? signalIndex : signalIndex + 1);
    if (componentUnits.join(" ") !== (kind === "electronic" ? "au**2 au au au" : "au au au")) fail("unsupported declared dipole units.");
    if (!/^-+$/.test(nextLine() ?? "")) fail("missing transition table separator.");
    const rows: number[][] = [], sourceRowIds: string[] = [], seen = new Set<string>();
    let end = cursor;
    line = nextLine();
    while (line !== null && line !== "") {
      const fields = line.split(/\s+/), labels = modern ? 3 : 1;
      if (fields.length !== (modern ? 11 : 8) - (kind === "ecd" ? 1 : 0)) fail("malformed or incomplete transition row.");
      if (modern ? fields[1] !== "->" || ![fields[0], fields[2]].every(label => /^\d+-[A-Za-z0-9'"*]+$/.test(label)) : !/^\d+$/.test(fields[0])) fail("invalid source transition identity.");
      const id = fields.slice(0, labels).join(" ");
      if (id.length > 128 || seen.has(id)) fail("duplicate or oversized source transition identity.");
      seen.add(id); sourceRowIds.push(id);
      rows.push(fields.slice(labels).map(number));
      if (++totalRows > MAX_ROWS) fail("tables exceed 10,000 source rows.");
      end = cursor;
      line = nextLine();
    }
    if (!rows.length) fail("empty transition table.");
    const column = (index: number) => rows.map(row => row[index]);
    const auxiliary = [{ name: "wavelength", unit: "nm", values: column(signalIndex - 1) }];
    if (modern) auxiliary.unshift({ name: "wavenumber", unit: "cm-1", values: column(1) });
    components.forEach((name, i) => auxiliary.push({ name, unit: componentUnits[i], values: column(signalIndex + 1 + i) }));
    tables.push({ start: title.index!, end, spectrum: { kind, xUnit: modern ? "eV" : "cm^-1", positions: column(0), values: column(signalIndex),
      valueUnit, sourceRowIds, auxiliary } });
  }
  return tables;
}
