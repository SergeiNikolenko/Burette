import path from "node:path";
import {
  PUBLIC_OUTPUT_LIMITS,
  type MoleculeGridInput,
  type MoleculeGridItem,
} from "./contracts";
import {
  fetchPublicText,
  MAX_PUBLIC_STRUCTURE_BYTES,
  MAX_PUBLIC_STRUCTURE_LINES,
  prepareStructureText,
  StructureServiceError,
  type PublicStructureSummary,
} from "./structure-service";

export type HostedGridFormat = "csv" | "tsv" | "smiles" | "sdf" | "dwar";

export interface PreparedGrid {
  summary: PublicStructureSummary;
  viewer: {
    data: string;
    format: HostedGridFormat;
    label: string;
    kind: "grid";
  };
}

const MAX_GRID_PROPERTY_COLUMNS = 64;

const GRID_EXTENSION_FORMATS = new Map<string, HostedGridFormat>([
  ["csv", "csv"],
  ["tsv", "tsv"],
  ["smi", "smiles"],
  ["smiles", "smiles"],
  ["sdf", "sdf"],
  ["sd", "sdf"],
  ["dwar", "dwar"],
]);

const GRID_MIME_EXTENSIONS = new Map<string, string>([
  ["text/csv", "csv"],
  ["text/tab-separated-values", "tsv"],
  ["chemical/x-daylight-smiles", "smi"],
  ["chemical/x-mdl-sdfile", "sdf"],
]);

const GRID_FORMAT_EXTENSIONS: Record<HostedGridFormat, string> = {
  csv: "csv",
  tsv: "tsv",
  smiles: "smi",
  sdf: "sdf",
  dwar: "dwar",
};

function boundedString(
  value: unknown,
  maxLength: number = PUBLIC_OUTPUT_LIMITS.scalarChars,
): string {
  return String(value ?? "").slice(0, maxLength);
}

function extensionFromName(fileName: string): string {
  return path.extname(fileName).replace(/^\./, "").toLowerCase();
}

function safeFileName(value: string | undefined, fallback: string): string {
  const basename = path.basename(String(value || "").trim());
  if (!basename || basename === "." || basename === "/") return fallback;
  return basename.slice(0, PUBLIC_OUTPUT_LIMITS.fileNameChars);
}

function sanitizeTsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\t\r\n]+/gu, " ").trim();
}

function countLinesBounded(text: string): number {
  let lineCount = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    lineCount += 1;
    if (lineCount > MAX_PUBLIC_STRUCTURE_LINES) {
      throw new StructureServiceError(
        "STRUCTURE_TOO_MANY_LINES",
        `The molecule grid exceeds the ${MAX_PUBLIC_STRUCTURE_LINES} line public preview limit.`,
      );
    }
  }
  return lineCount;
}

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function isSmilesHeader(header: string): boolean {
  const normalized = header.trim().toLowerCase().replace(/\s+/gu, "_");
  return normalized === "smile" || normalized === "smiels" || normalized.includes("smiles");
}

function isNameHeader(header: string): boolean {
  const normalized = header.trim().toLowerCase().replace(/\s+/gu, "_");
  return [
    "name",
    "title",
    "id",
    "compound_id",
    "molecule_id",
    "mol_id",
    "ligand",
    "ligand_id",
    "compound",
    "uid",
  ].includes(normalized);
}

export function isGridExtension(fileName: string): boolean {
  return GRID_EXTENSION_FORMATS.has(extensionFromName(fileName));
}

export function gridFormatForFileName(fileName: string): HostedGridFormat | null {
  return GRID_EXTENSION_FORMATS.get(extensionFromName(fileName)) ?? null;
}

function summarizeDelimitedGrid(
  text: string,
  fileName: string,
  format: "csv" | "tsv",
  source: PublicStructureSummary["source"],
  byteCount: number,
  lineCount: number,
): PublicStructureSummary {
  const delimiter = format === "csv" ? "," : "\t";
  const rows = text
    .split(/\r?\n/u)
    .map((line) => parseDelimitedLine(line, delimiter))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length < 2) {
    throw new StructureServiceError(
      "EMPTY_GRID",
      "The table needs a header row and at least one data row.",
    );
  }
  const headers = rows[0]!.map((cell) => cell.trim());
  const dataRows = rows.slice(1);
  const smilesIndex = headers.findIndex((header) => isSmilesHeader(header));
  const nameIndex = headers.findIndex((header, index) => index !== smilesIndex && isNameHeader(header));
  const propertyHeaders = headers.filter((header, index) => (
    header.length > 0 && index !== smilesIndex && index !== nameIndex
  ));
  const moleculeItems = dataRows
    .slice(0, PUBLIC_OUTPUT_LIMITS.componentItems)
    .map((row, index) => ({
      index: index + 1,
      title: boundedString(
        (nameIndex >= 0 ? row[nameIndex]?.trim() : "") || `Molecule ${index + 1}`,
      ),
    }));
  const formatUpper = format.toUpperCase();
  const summaryLine = propertyHeaders.length > 0
    ? `${formatUpper} molecule grid, ${dataRows.length} molecule${dataRows.length === 1 ? "" : "s"}, ${propertyHeaders.length} propert${propertyHeaders.length === 1 ? "y" : "ies"}`
    : `${formatUpper} molecule grid, ${dataRows.length} molecule${dataRows.length === 1 ? "" : "s"}`;
  const summaryRows: Array<{ label: string; value: string }> = [
    { label: "Molecules", value: String(dataRows.length) },
    { label: "Format", value: formatUpper },
  ];
  if (propertyHeaders.length > 0) {
    summaryRows.push({
      label: "Properties",
      value: boundedString(propertyHeaders.slice(0, 8).join(", ")),
    });
  }
  const notes: string[] = [];
  if (smilesIndex < 0) {
    notes.push("No column header explicitly named SMILES; the viewer will infer structure columns where possible.");
  }
  return {
    source,
    fileName: boundedString(fileName, PUBLIC_OUTPUT_LIMITS.fileNameChars),
    format: formatUpper,
    kind: "Molecule grid",
    summaryLine: boundedString(summaryLine),
    byteCount,
    lineCount,
    counts: {
      molecules: dataRows.length,
      columns: headers.length,
      properties: propertyHeaders.length,
    },
    rows: summaryRows.slice(0, PUBLIC_OUTPUT_LIMITS.rows),
    components: moleculeItems.length > 0 ? { molecules: moleculeItems } : {},
    notes,
    viewerAvailable: true,
  };
}

function summarizeSmilesGrid(
  text: string,
  fileName: string,
  source: PublicStructureSummary["source"],
  byteCount: number,
  lineCount: number,
): PublicStructureSummary {
  const entries: Array<{ index: number; title: string }> = [];
  let count = 0;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/u);
    if (!parts[0]) continue;
    count += 1;
    if (entries.length < PUBLIC_OUTPUT_LIMITS.componentItems) {
      entries.push({
        index: count,
        title: boundedString(parts.slice(1).join(" ") || `Molecule ${count}`),
      });
    }
  }
  if (count === 0) {
    throw new StructureServiceError(
      "EMPTY_GRID",
      "No SMILES entries were found for the molecule grid.",
    );
  }
  return {
    source,
    fileName: boundedString(fileName, PUBLIC_OUTPUT_LIMITS.fileNameChars),
    format: "SMILES",
    kind: "Molecule grid",
    summaryLine: boundedString(`SMILES molecule grid, ${count} molecule${count === 1 ? "" : "s"}`),
    byteCount,
    lineCount,
    counts: { molecules: count },
    rows: [
      { label: "Molecules", value: String(count) },
      { label: "Format", value: "SMILES" },
    ],
    components: entries.length > 0 ? { molecules: entries } : {},
    notes: [],
    viewerAvailable: true,
  };
}

function summarizeDwarGrid(
  text: string,
  fileName: string,
  source: PublicStructureSummary["source"],
  byteCount: number,
  lineCount: number,
): PublicStructureSummary {
  const lines = text.split(/\r?\n/u);
  let index = 0;
  while (index < lines.length && !lines[index]!.trim()) index += 1;
  if (lines[index]?.trim() === "<datawarrior-fileinfo>") {
    while (index < lines.length && lines[index]!.trim() !== "</datawarrior-fileinfo>") index += 1;
    index += 1;
  }
  if (lines[index]?.trim() === "<column properties>") {
    while (index < lines.length && lines[index]!.trim() !== "</column properties>") index += 1;
    index += 1;
  }
  const headerLine = lines[index];
  if (!headerLine) {
    throw new StructureServiceError("EMPTY_GRID", "The DataWarrior file has no table header.");
  }
  const headers = headerLine.split("\t").map((cell) => cell.trim());
  const dataRows: string[][] = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === "<datawarrior properties>") break;
    if (!line.trim()) continue;
    dataRows.push(line.split("\t"));
  }
  if (dataRows.length === 0) {
    throw new StructureServiceError("EMPTY_GRID", "The DataWarrior file has no molecule rows.");
  }
  const nameIndex = headers.findIndex((header) => isNameHeader(header));
  const moleculeItems = dataRows
    .slice(0, PUBLIC_OUTPUT_LIMITS.componentItems)
    .map((row, rowIndex) => ({
      index: rowIndex + 1,
      title: boundedString((nameIndex >= 0 ? row[nameIndex]?.trim() : "") || `Molecule ${rowIndex + 1}`),
    }));
  return {
    source,
    fileName: boundedString(fileName, PUBLIC_OUTPUT_LIMITS.fileNameChars),
    format: "DWAR",
    kind: "Molecule grid",
    summaryLine: boundedString(`DataWarrior molecule grid, ${dataRows.length} molecule${dataRows.length === 1 ? "" : "s"}, ${headers.length} columns`),
    byteCount,
    lineCount,
    counts: { molecules: dataRows.length, columns: headers.length },
    rows: [
      { label: "Molecules", value: String(dataRows.length) },
      { label: "Format", value: "DWAR" },
      { label: "Columns", value: String(headers.length) },
    ],
    components: moleculeItems.length > 0 ? { molecules: moleculeItems } : {},
    notes: [],
    viewerAvailable: true,
  };
}

export function prepareGridText(
  text: string,
  fileName: string,
  source: PublicStructureSummary["source"],
  explicitFormat?: HostedGridFormat,
): PreparedGrid {
  const resolvedFormat = explicitFormat ?? gridFormatForFileName(fileName);
  if (!resolvedFormat) {
    throw new StructureServiceError(
      "UNSUPPORTED_FORMAT",
      "Molecule grid supports CSV, TSV, SMILES (.smi/.smiles), SDF (.sdf/.sd), and DataWarrior (.dwar) formats.",
    );
  }
  const byteCount = Buffer.byteLength(text, "utf8");
  if (byteCount === 0) {
    throw new StructureServiceError("EMPTY_GRID", "The molecule grid input is empty.");
  }
  if (byteCount > MAX_PUBLIC_STRUCTURE_BYTES) {
    throw new StructureServiceError(
      "STRUCTURE_TOO_LARGE",
      `The molecule grid exceeds the ${MAX_PUBLIC_STRUCTURE_BYTES} byte public preview limit.`,
    );
  }
  const lineCount = countLinesBounded(text);
  const defaultExt = GRID_FORMAT_EXTENSIONS[resolvedFormat];
  const normalizedName = extensionFromName(fileName)
    ? safeFileName(fileName, `molecule-grid.${defaultExt}`)
    : `${safeFileName(fileName, "molecule-grid")}.${defaultExt}`;

  if (resolvedFormat === "sdf") {
    const prepared = prepareStructureText(text, normalizedName, source);
    return {
      summary: {
        ...prepared.summary,
        kind: "Molecule grid",
      },
      viewer: {
        data: text,
        format: "sdf",
        label: boundedString(normalizedName, PUBLIC_OUTPUT_LIMITS.fileNameChars),
        kind: "grid",
      },
    };
  }

  const summary = resolvedFormat === "csv" || resolvedFormat === "tsv"
    ? summarizeDelimitedGrid(text, normalizedName, resolvedFormat, source, byteCount, lineCount)
    : resolvedFormat === "smiles"
      ? summarizeSmilesGrid(text, normalizedName, source, byteCount, lineCount)
      : summarizeDwarGrid(text, normalizedName, source, byteCount, lineCount);

  return {
    summary,
    viewer: {
      data: text,
      format: resolvedFormat,
      label: boundedString(normalizedName, PUBLIC_OUTPUT_LIMITS.fileNameChars),
      kind: "grid",
    },
  };
}

export function prepareGridFromMolecules(
  molecules: readonly MoleculeGridItem[],
  title?: string,
): PreparedGrid {
  if (molecules.length === 0) {
    throw new StructureServiceError("EMPTY_GRID", "Provide at least one molecule for the grid.");
  }
  const propertyKeys: string[] = [];
  const seenKeys = new Set<string>(["name", "smiles"]);
  for (const item of molecules) {
    if (!item.properties) continue;
    for (const rawKey of Object.keys(item.properties)) {
      const cleanKey = sanitizeTsvCell(rawKey);
      if (!cleanKey) continue;
      const normalized = cleanKey.toLowerCase();
      if (seenKeys.has(normalized)) continue;
      if (propertyKeys.length >= MAX_GRID_PROPERTY_COLUMNS) break;
      seenKeys.add(normalized);
      propertyKeys.push(cleanKey);
    }
  }
  const header = ["name", "smiles", ...propertyKeys].join("\t");
  const lines = [header];
  for (let index = 0; index < molecules.length; index += 1) {
    const item = molecules[index]!;
    const name = sanitizeTsvCell(item.name) || `Molecule ${index + 1}`;
    const smiles = sanitizeTsvCell(item.smiles);
    const propValues = propertyKeys.map((key) => {
      if (!item.properties) return "";
      if (Object.hasOwn(item.properties, key)) return sanitizeTsvCell(item.properties[key]);
      const matched = Object.entries(item.properties).find(
        ([candidate]) => sanitizeTsvCell(candidate).toLowerCase() === key.toLowerCase(),
      );
      return matched ? sanitizeTsvCell(matched[1]) : "";
    });
    lines.push([name, smiles, ...propValues].join("\t"));
  }
  const tsv = `${lines.join("\n")}\n`;
  const baseTitle = safeFileName(title, "molecule-grid.tsv");
  const fileName = extensionFromName(baseTitle) === "tsv"
    ? baseTitle
    : `${baseTitle.replace(/\.[^.]+$/u, "")}.tsv`;
  return prepareGridText(tsv, fileName, "inline", "tsv");
}

export async function prepareMoleculeGrid(input: MoleculeGridInput): Promise<PreparedGrid> {
  if (input.molecules) {
    return prepareGridFromMolecules(input.molecules, input.title);
  }
  if (input.content !== undefined) {
    const inferred = input.format ?? (input.title ? gridFormatForFileName(input.title) : null);
    if (!inferred) {
      throw new StructureServiceError(
        "UNSUPPORTED_FORMAT",
        "Specify format (csv, tsv, smiles, sdf, or dwar) when passing inline grid content.",
      );
    }
    const ext = GRID_FORMAT_EXTENSIONS[inferred];
    const fileName = input.title ? safeFileName(input.title, `molecule-grid.${ext}`) : `molecule-grid.${ext}`;
    return prepareGridText(input.content, fileName, "inline", inferred);
  }
  if (input.gridFile) {
    const supplied = safeFileName(input.gridFile.file_name, "");
    let resolvedName = supplied;
    if (!extensionFromName(resolvedName)) {
      const mimeExt = GRID_MIME_EXTENSIONS.get(
        String(input.gridFile.mime_type || "").split(";", 1)[0]?.trim().toLowerCase() ?? "",
      );
      if (mimeExt) {
        resolvedName = `${supplied || "molecule-grid"}.${mimeExt}`;
      } else {
        try {
          const fromUrl = safeFileName(new URL(input.gridFile.download_url).pathname, "");
          if (extensionFromName(fromUrl)) resolvedName = fromUrl;
        } catch {
          // fetchPublicText will report invalid URL.
        }
      }
    }
    const format = input.format ?? gridFormatForFileName(resolvedName);
    if (!format) {
      throw new StructureServiceError(
        "UNSUPPORTED_FORMAT",
        "The grid attachment needs a .csv, .tsv, .smi, .smiles, .sdf, .sd, or .dwar filename.",
      );
    }
    const text = await fetchPublicText(input.gridFile.download_url);
    const finalName = input.title
      ? safeFileName(input.title, resolvedName || `molecule-grid.${GRID_FORMAT_EXTENSIONS[format]}`)
      : (resolvedName || `molecule-grid.${GRID_FORMAT_EXTENSIONS[format]}`);
    return prepareGridText(text, finalName, "attachment", format);
  }
  throw new StructureServiceError("INVALID_GRID_INPUT", "Provide molecules, content, or gridFile.");
}
