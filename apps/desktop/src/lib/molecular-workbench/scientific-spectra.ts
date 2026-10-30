/** Source data for the six additional Avogadro spectra, separate from display curves. */
export type AdditionalSpectrumKind = "vcd" | "mcd" | "nmr" | "electronic" | "ecd" | "dos";
type SpectrumFormat = "avogadro-matrix" | "orca-output" | "orca-mcd" | "cjson" | "qcschema";
export type SpectralSource = { name: string; format: SpectrumFormat } &
  ({ scope: "file" } | { scope: "frame"; frameIndex: number; frameCount: number });
export type SpectralColumn = { name: string; unit: string | null; values: readonly number[] };
type Signal<K extends AdditionalSpectrumKind, U extends string> = {
  kind: K; xUnit: U; positions: readonly number[]; values: readonly number[];
  /** Null means that the source did not declare a physical signal unit. */
  valueUnit: string | null;
  /** Original transition labels, when the producer supplies identities beyond row order. */
  sourceRowIds?: readonly string[]; auxiliary?: readonly SpectralColumn[];
};
export type NmrSpectrum = {
  kind: "nmr"; quantity: "isotropic-shielding" | "native-input";
  /** Explicit source atom indices; absent calculations are omitted, never zero-filled. */
  atomIndices: readonly number[]; valuesPpm: readonly number[];
  auxiliary?: readonly SpectralColumn[];
};
export type AdditionalSpectrum = Signal<"vcd" | "mcd", "cm^-1"> |
  Signal<"electronic" | "ecd", "eV" | "nm" | "cm^-1"> | Signal<"dos", "eV"> | NmrSpectrum;
export type ScientificSpectra = {
  kind: "scientific-spectra"; version: 1; source: SpectralSource;
  atomicNumbers: readonly number[]; spectra: readonly AdditionalSpectrum[];
};

const KINDS = ["vcd", "mcd", "nmr", "electronic", "ecd", "dos"] as const;
const FORMATS = ["avogadro-matrix", "orca-output", "orca-mcd", "cjson", "qcschema"];
export const SCIENTIFIC_SPECTRA_LIMITS = Object.freeze({ rows: 10_000, scalars: 100_000, fileBytes: 8 * 1024 * 1024 });
const { rows: MAX_ROWS, scalars: MAX_SCALARS, fileBytes: MAX_FILE_BYTES } = SCIENTIFIC_SPECTRA_LIMITS;
function fail(message: string): never { throw new Error(`Invalid scientific spectra: ${message}`); }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const label = (value: unknown, maximum = 128): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum;
const unit = (value: unknown) => value === null || label(value);
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail("unknown fields must not be silently discarded.");
}
function vector(value: unknown, length?: number): value is readonly number[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS || (length !== undefined && value.length !== length)) return false;
  // for-of also visits sparse holes, unlike Array.every.
  for (const item of value) if (typeof item !== "number" || !Number.isFinite(item)) return false;
  return true;
}

/** Validate without normalizing values, copying arrays, or changing object identity. */
export function checkScientificSpectra(value: unknown): ScientificSpectra {
  if (!record(value)) fail("expected an object.");
  keys(value, ["kind", "version", "source", "atomicNumbers", "spectra"]);
  if (value.kind !== "scientific-spectra" || value.version !== 1 || !record(value.source)) fail("wrong data contract.");
  const source = value.source;
  keys(source, ["name", "format", "scope", "frameIndex", "frameCount"]);
  if (!label(source.name, 1024) || !FORMATS.includes(source.format as string)) fail("missing source provenance.");
  if (source.scope === "frame") {
    if (!Number.isSafeInteger(source.frameIndex) || !Number.isSafeInteger(source.frameCount) ||
      (source.frameIndex as number) < 0 || (source.frameIndex as number) >= (source.frameCount as number)) fail("invalid source frame.");
  } else if (source.scope !== "file" || source.frameIndex !== undefined || source.frameCount !== undefined) fail("file scope is not a final-frame alias.");
  if (!vector(value.atomicNumbers)) fail("invalid source atoms.");
  for (const number of value.atomicNumbers) if (!Number.isInteger(number) || number < 1 || number > 118) fail("invalid source atomic number.");
  if (!Array.isArray(value.spectra) || value.spectra.length > KINDS.length) fail("invalid spectrum set.");
  const seen = new Set<string>();
  let rows = 0, scalars = value.atomicNumbers.length;
  for (const spectrum of value.spectra) {
    if (!record(spectrum) || !KINDS.includes(spectrum.kind as AdditionalSpectrumKind) || seen.has(spectrum.kind as string)) fail("unknown or repeated spectrum kind.");
    seen.add(spectrum.kind as string);
    let size: number;
    if (spectrum.kind === "nmr") {
      keys(spectrum, ["kind", "quantity", "atomIndices", "valuesPpm", "auxiliary"]);
      if (!["isotropic-shielding", "native-input"].includes(spectrum.quantity as string) || !vector(spectrum.valuesPpm) ||
        !vector(spectrum.atomIndices, spectrum.valuesPpm.length)) fail("invalid NMR source quantities.");
      const atoms = new Set<number>();
      for (const index of spectrum.atomIndices) {
        if (!Number.isInteger(index) || index < 0 || index >= value.atomicNumbers.length || atoms.has(index)) fail("ambiguous NMR atom identity.");
        atoms.add(index);
      }
      size = spectrum.valuesPpm.length;
    } else {
      keys(spectrum, ["kind", "xUnit", "positions", "values", "valueUnit", "sourceRowIds", "auxiliary"]);
      const units = spectrum.kind === "vcd" || spectrum.kind === "mcd" ? ["cm^-1"] : spectrum.kind === "dos" ? ["eV"] : ["eV", "nm", "cm^-1"];
      if (!units.includes(spectrum.xUnit as string) || !vector(spectrum.positions) || !vector(spectrum.values, spectrum.positions.length) || !unit(spectrum.valueUnit)) fail("invalid source signal or unit.");
      if (spectrum.xUnit === "nm" && spectrum.positions.some(position => position <= 0)) fail("wavelengths must be positive.");
      size = spectrum.positions.length;
      if (spectrum.sourceRowIds !== undefined) {
        if (!Array.isArray(spectrum.sourceRowIds) || spectrum.sourceRowIds.length !== size) fail("source row identities do not match the signal.");
        const ids = new Set<string>();
        for (const id of spectrum.sourceRowIds) {
          if (!label(id) || ids.has(id)) fail("invalid or duplicate source row identity.");
          ids.add(id);
        }
        scalars += size;
      }
    }
    if (size === 0) fail("empty datasets do not advertise a spectrum.");
    rows += size; scalars += size * 2;
    if (spectrum.auxiliary !== undefined) {
      if (!Array.isArray(spectrum.auxiliary) || spectrum.auxiliary.length > 6) fail("too many auxiliary source columns.");
      const names = new Set<string>();
      for (const column of spectrum.auxiliary) {
        if (!record(column)) fail("invalid auxiliary column.");
        keys(column, ["name", "unit", "values"]);
        if (!label(column.name) || names.has(column.name) || !unit(column.unit) || !vector(column.values, size)) fail("invalid auxiliary source values.");
        names.add(column.name); scalars += size;
      }
    }
    if (rows > MAX_ROWS || scalars > MAX_SCALARS) fail("source data exceeds the bounded row/scalar budget.");
  }
  return value as unknown as ScientificSpectra;
}

function boundedFile(text: string) {
  if (text.length > MAX_FILE_BYTES || new TextEncoder().encode(text).length > MAX_FILE_BYTES) fail("file exceeds 8 MiB.");
  return text;
}
/** Reopen this explicitly typed data file; this is not the MS1/MS2 JSON parser. */
export function parseScientificSpectraJson(text: string) {
  return checkScientificSpectra(JSON.parse(boundedFile(text)) as unknown);
}
export function scientificSpectraJson(data: ScientificSpectra) {
  return boundedFile(`${JSON.stringify(checkScientificSpectra(data), null, 2)}\n`);
}
const oneLine = (value: string) => value.replace(/\p{Cc}+/gu, " ");
const csv = (value: string | number) => /[",\r\n]/u.test(String(value)) ? `"${String(value).replace(/"/gu, '""')}"` : String(value);

/** Export original source columns, never reference-adjusted or broadened samples. */
export function scientificSpectrumCsv(data: ScientificSpectra, kind: AdditionalSpectrumKind) {
  checkScientificSpectra(data);
  const spectrum = data.spectra.find(item => item.kind === kind);
  if (!spectrum) fail("requested source spectrum is absent.");
  const headers = spectrum.kind === "nmr" ? ["atom_index_0_based", "atomic_number", `source_ppm (${spectrum.quantity})`] :
    [`position (${spectrum.xUnit})`, `signal (${spectrum.valueUnit ?? "source unit unspecified"})`];
  const rowIds = spectrum.kind === "nmr" ? undefined : spectrum.sourceRowIds;
  if (rowIds) headers.unshift("source_row_id");
  for (const column of spectrum.auxiliary ?? []) headers.push(`${column.name} (${column.unit ?? "source unit unspecified"})`);
  const count = spectrum.kind === "nmr" ? spectrum.valuesPpm.length : spectrum.positions.length;
  const lines = [`# source: ${oneLine(data.source.name)}`, `# format: ${data.source.format}`,
    `# scope: ${data.source.scope === "file" ? "file" : `frame ${data.source.frameIndex + 1} of ${data.source.frameCount}`}`,
    headers.map(csv).join(",")];
  for (let index = 0; index < count; index++) {
    const values: Array<string | number> = spectrum.kind === "nmr" ? [spectrum.atomIndices[index], data.atomicNumbers[spectrum.atomIndices[index]], spectrum.valuesPpm[index]] :
      [spectrum.positions[index], spectrum.values[index]];
    if (rowIds) values.unshift(rowIds[index]);
    for (const column of spectrum.auxiliary ?? []) values.push(column.values[index]);
    lines.push(values.map(csv).join(","));
  }
  return boundedFile(`${lines.join("\n")}\n`);
}
