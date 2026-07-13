export type DataWarriorGridRecord = {
  index: number;
  name: string;
  smiles?: string;
  idcode?: string;
  idcoordinates?: string;
  props: Record<string, string>;
};

type DataWarriorColumn = {
  name: string;
  parent?: string;
  specialType?: string;
};

const NAME_HEADERS = new Set(["compound_id", "id", "name", "title", "compound"]);

export function parseDataWarrior(text: string): DataWarriorGridRecord[] {
  const lines = normalizedLines(text);
  const columns = parseColumnProperties(lines);
  const tableStart = dataTableStart(lines);
  if (tableStart < 0) return [];

  const headers = parseTabLine(lines[tableStart] ?? "").map((value) => value.trim());
  if (!headers.length) return [];
  const tableRows: string[][] = [];
  for (let index = tableStart + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (looksLikeSectionTag(line)) break;
    if (line.trim()) tableRows.push(parseTabLine(line));
  }

  const structureIndexes = headers
    .map((header, index) => {
      const specialType = columns.get(header)?.specialType?.toLowerCase();
      if (specialType === "idcode") return { index, kind: "idcode" as const };
      if (isSmilesHeader(header)) return { index, kind: "smiles" as const };
      return null;
    })
    .filter((value): value is { index: number; kind: "idcode" | "smiles" } => value !== null);
  if (!structureIndexes.length) return [];

  const coordinateIndexes = new Map<string, number>();
  headers.forEach((header, index) => {
    const column = columns.get(header);
    if (column?.parent && column.specialType?.toLowerCase().startsWith("idcoordinates")) {
      coordinateIndexes.set(column.parent, index);
    }
  });
  const specialIndexes = new Set<number>();
  headers.forEach((header, index) => {
    if (columns.get(header)?.specialType) specialIndexes.add(index);
  });
  const nameIndex = headers.findIndex((header, index) => (
    !specialIndexes.has(index) && NAME_HEADERS.has(normalizeHeader(header))
  ));
  const multipleStructureColumns = structureIndexes.length > 1;
  const records: DataWarriorGridRecord[] = [];

  tableRows.forEach((row, rowIndex) => {
    for (const structure of structureIndexes) {
      const value = row[structure.index]?.trim() ?? "";
      if (!value) continue;
      const columnName = headers[structure.index] || `Column ${structure.index + 1}`;
      const rawName = nameIndex >= 0 ? row[nameIndex]?.trim() ?? "" : "";
      const baseName = rawName || `Molecule ${rowIndex + 1}`;
      const props: Record<string, string> = {
        "DataWarrior row": String(rowIndex + 1),
        "Structure column": columnName,
      };
      headers.forEach((header, index) => {
        if (index === nameIndex || specialIndexes.has(index) || index === structure.index) return;
        const cell = row[index]?.trim();
        if (cell && Object.keys(props).length < 64) props[clip(header || `Column ${index + 1}`, 80)] = clip(cell, 500);
      });
      const coordinateIndex = coordinateIndexes.get(columnName);
      const idcoordinates = coordinateIndex === undefined ? "" : row[coordinateIndex]?.trim() ?? "";
      records.push({
        index: records.length,
        name: clip(multipleStructureColumns ? `${baseName} ${columnName}` : baseName, 160),
        ...(structure.kind === "idcode" ? {
          idcode: clip(value, 4096),
          ...(idcoordinates ? { idcoordinates: clip(idcoordinates, 16_384) } : {}),
        } : { smiles: clip(value, 2048) }),
        props,
      });
    }
  });
  return records;
}

function parseColumnProperties(lines: string[]) {
  const columns = new Map<string, DataWarriorColumn>();
  let inProperties = false;
  let current: DataWarriorColumn | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "<column properties>") {
      inProperties = true;
      continue;
    }
    if (trimmed === "</column properties>") break;
    if (!inProperties) continue;
    const name = tagValue(trimmed, "columnName");
    if (name !== null) {
      current = { name };
      columns.set(name, current);
      continue;
    }
    const property = tagValue(trimmed, "columnProperty");
    if (property === null || !current) continue;
    const [key, ...valueParts] = property.split(/\t|\\t/u);
    const value = valueParts.join("\t").trim();
    if (key === "specialType" && value) current.specialType = value;
    if (key === "parent" && value) current.parent = value;
  }
  return columns;
}

function dataTableStart(lines: string[]) {
  let section: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? "";
    if (/^<\/([^>]+)>$/u.test(trimmed)) {
      section = null;
      continue;
    }
    const opening = /^<([^=/>]+)>$/u.exec(trimmed);
    if (opening) {
      section = opening[1];
      continue;
    }
    if (!section && trimmed && !trimmed.startsWith("<")) return index;
  }
  return -1;
}

function tagValue(line: string, tag: string) {
  const match = new RegExp(`^<${tag}="([\\s\\S]*)">$`, "u").exec(line);
  return match ? decodeEntities(match[1] ?? "") : null;
}

function decodeEntities(value: string) {
  return value
    .replace(/&#(?:x0*9|0*9);/giu, "\t")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&");
}

function parseTabLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "\t" && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function looksLikeSectionTag(line: string) {
  return /^<[^>]+>\s*$/u.test(line.trim());
}

function isSmilesHeader(header: string) {
  const normalized = normalizeHeader(header);
  return normalized === "smile" || normalized === "smiels" || normalized.includes("smiles");
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/gu, "_");
}

function normalizedLines(text: string) {
  return text.replace(/\r\n?/gu, "\n").split("\n");
}

function clip(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 3))}...`;
}
