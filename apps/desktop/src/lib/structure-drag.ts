export const STRUCTURE_DRAG_MIME = "application/x-burrete-structure-paths";

export type StructureDragRecord = {
  path: string;
  inputExtension: string;
  text: string;
};

export type StructureDragPoint = {
  x: number;
  y: number;
};

export type StructureDragItem = {
  kind: "file" | "tab" | "tool" | "ketcher" | "writer";
  title: string;
  detail?: string;
  path?: string;
};

export type StructureDragPayload = {
  paths: string[];
  records: StructureDragRecord[];
  items?: StructureDragItem[];
  point?: StructureDragPoint | null;
};

export function emptyStructureDragPayload(): StructureDragPayload {
  return { paths: [], records: [] };
}

export function writeStructureDragPayload(dataTransfer: DataTransfer, input: StructureDragPayload) {
  const paths = Array.from(new Set(input.paths.map((path) => path.trim()).filter(Boolean)));
  const records = input.records.map(normalizeStructureDragRecord).filter((record): record is StructureDragRecord => record !== null);
  const items = (input.items ?? []).map(normalizeStructureDragItem).filter((item): item is StructureDragItem => item !== null);
  if (paths.length === 0 && records.length === 0 && items.length === 0) return false;
  const payload: StructureDragPayload = { paths, records, items };
  dataTransfer.setData(STRUCTURE_DRAG_MIME, JSON.stringify(payload));
  const plainText = [
    ...paths,
    ...records.map((record) => record.text.trimEnd()),
    ...items.map((item) => item.path ?? item.title),
  ].filter(Boolean).join("\n");
  if (plainText) dataTransfer.setData("text/plain", plainText + (records.length > 0 ? "\n" : ""));
  dataTransfer.effectAllowed = "copy";
  return true;
}

export function writeStructureDrag(dataTransfer: DataTransfer, paths: string[]) {
  const cleanPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  if (cleanPaths.length === 0) return;
  writeStructureDragPayload(dataTransfer, { paths: cleanPaths, records: [] });
}

export function writeStructureDragRecords(dataTransfer: DataTransfer, records: StructureDragRecord[]) {
  const cleanRecords = records.map(normalizeStructureDragRecord).filter((record): record is StructureDragRecord => record !== null);
  if (cleanRecords.length === 0) return false;
  return writeStructureDragPayload(dataTransfer, { paths: [], records: cleanRecords });
}

export function writeStructureDragItems(dataTransfer: DataTransfer, items: StructureDragItem[]) {
  return writeStructureDragPayload(dataTransfer, { paths: [], records: [], items });
}

export function readStructureDragPayload(dataTransfer: DataTransfer): StructureDragPayload {
  const payload = emptyStructureDragPayload();
  const explicit = dataTransfer.getData(STRUCTURE_DRAG_MIME);
  if (explicit) {
    try {
      const parsed = JSON.parse(explicit) as Partial<StructureDragPayload> | string[];
      if (Array.isArray(parsed)) {
        payload.paths.push(...parsed);
      } else {
        if (Array.isArray(parsed.paths)) payload.paths.push(...parsed.paths);
        if (Array.isArray(parsed.records)) payload.records.push(...parsed.records);
        if (Array.isArray(parsed.items)) {
          payload.items ??= [];
          payload.items.push(...parsed.items);
        }
      }
    } catch {
      return payload;
    }
  } else {
    payload.paths.push(
      ...Array.from(dataTransfer.files)
        .map((file) => (file as File & { path?: string }).path)
        .filter((path): path is string => Boolean(path)),
    );
    if (payload.paths.length === 0) {
      const plainText = dataTransfer.getData("text/plain").trim();
      if (plainText) {
        const textPayload = structureDragPayloadFromText(plainText);
        payload.paths.push(...textPayload.paths);
        payload.records.push(...textPayload.records);
      }
    }
  }
  payload.paths = Array.from(new Set(
    payload.paths
      .map((path) => (typeof path === "string" ? path.trim() : ""))
      .filter(Boolean),
  ));
  payload.records = payload.records.map(normalizeStructureDragRecord).filter((record): record is StructureDragRecord => record !== null);
  const items = (payload.items ?? []).map(normalizeStructureDragItem).filter((item): item is StructureDragItem => item !== null);
  if (items.length > 0) payload.items = items;
  else delete payload.items;
  return payload;
}

export function readStructureDrag(dataTransfer: DataTransfer) {
  return readStructureDragPayload(dataTransfer).paths;
}

export function structureDragPayloadFromText(text: string): StructureDragPayload {
  const plainText = text.trim();
  if (!plainText) return emptyStructureDragPayload();
  const inlineRecord = structureDragRecordFromPlainText(plainText);
  if (inlineRecord) {
    return { paths: [], records: [inlineRecord] };
  }
  return { paths: structureDragPathsFromPlainText(plainText), records: [] };
}

export function structureDragRecordsToFragments(records: StructureDragRecord[]) {
  return records
    .map((record) => ({
      title: record.path.trim() || `structure.${record.inputExtension}`,
      text: structureDragRecordFragmentText(record),
    }))
    .filter((fragment) => fragment.text.trim().length > 0);
}

function structureDragRecordFragmentText(record: StructureDragRecord) {
  const text = record.text.trim();
  if (record.inputExtension === "sdf" || record.inputExtension === "sd") {
    return text.replace(/\n?\$\$\$\$\s*$/u, "").trimEnd() + "\n";
  }
  return text;
}

function normalizeStructureDragRecord(record: unknown): StructureDragRecord | null {
  if (!record || typeof record !== "object") return null;
  const candidate = record as Partial<StructureDragRecord>;
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  if (!text) return null;
  const inputExtension = typeof candidate.inputExtension === "string"
    ? candidate.inputExtension.trim().replace(/^\./u, "").toLowerCase()
    : "";
  const extension = inputExtension || "xyz";
  const path = typeof candidate.path === "string" && candidate.path.trim().length > 0
    ? candidate.path.trim()
    : `structure.${extension}`;
  return { path, inputExtension: extension, text };
}

function normalizeStructureDragItem(item: unknown): StructureDragItem | null {
  if (!item || typeof item !== "object") return null;
  const candidate = item as Partial<StructureDragItem>;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  if (!title) return null;
  const kind = candidate.kind === "file" || candidate.kind === "tab" || candidate.kind === "tool" || candidate.kind === "ketcher" || candidate.kind === "writer"
    ? candidate.kind
    : "file";
  const detail = typeof candidate.detail === "string" && candidate.detail.trim() ? candidate.detail.trim() : undefined;
  const path = typeof candidate.path === "string" && candidate.path.trim() ? candidate.path.trim() : undefined;
  return { kind, title, detail, path };
}

export function hasStructureDrag(dataTransfer: DataTransfer) {
  const types = Array.from(dataTransfer.types);
  if (types.includes(STRUCTURE_DRAG_MIME) || types.includes("Files")) return true;
  if (!types.includes("text/plain")) return false;
  let plainText = "";
  try {
    plainText = dataTransfer.getData("text/plain").trim();
  } catch {
    return false;
  }
  return Boolean(structureDragRecordFromPlainText(plainText) || structureDragPathsFromPlainText(plainText).length > 0);
}

function structureDragRecordFromPlainText(text: string): StructureDragRecord | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^[/~.]|\r?\n[/~.]/u.test(trimmed)) return null;
  const classified = classifyStructurePlainText(trimmed);
  if (!classified) return null;
  return {
    path: `structure.${classified.inputExtension}`,
    inputExtension: classified.inputExtension,
    text: classified.text,
  };
}

function classifyStructurePlainText(text: string): { inputExtension: string; text: string } | null {
  if (looksLikeSdfOrMolText(text)) return { inputExtension: "sdf", text };
  if (looksLikePdbText(text)) return { inputExtension: "pdb", text };
  if (looksLikeCifText(text)) return { inputExtension: "cif", text };
  if (looksLikeXyzText(text)) return { inputExtension: "xyz", text };
  if (looksLikeSmilesText(text)) return { inputExtension: "smi", text: text.trim() + "\n" };
  return null;
}

function looksLikeSdfOrMolText(text: string) {
  return /\r?\n/u.test(text) && /(?:V2000|V3000|\$\$\$\$|M\s+END)/u.test(text);
}

function looksLikePdbText(text: string) {
  return /^(?:HEADER|TITLE|CRYST1|MODEL|ATOM\s|HETATM)/mu.test(text);
}

function looksLikeCifText(text: string) {
  return /^data_[^\s]*/imu.test(text) || /(?:^|\n)_atom_site\./u.test(text);
}

function looksLikeXyzText(text: string) {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const atomCount = Number(lines[0]);
  if (!Number.isInteger(atomCount) || atomCount < 1 || lines.length < atomCount + 2) return false;
  return lines.slice(2, atomCount + 2).every((line) => (
    /^[A-Z][a-z]?\s+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?(?:\s|$)/u.test(line)
  ));
}

function looksLikeSmilesText(text: string) {
  if (/\r?\n/u.test(text)) return false;
  const [smiles, ...rest] = text.trim().split(/\s+/u);
  if (!smiles || rest.length > 2) return false;
  const withoutAtoms = smiles.replace(/Br|Cl|\[[^\]]+\]|[BCNOFPSIHKbcnops]/gu, "");
  if (!Array.from(withoutAtoms).every((char) => "0123456789@+-[]()\\/%=#$:.".includes(char))) return false;
  return withoutAtoms.length < smiles.length;
}

function structureDragPathsFromPlainText(text: string) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(looksLikeStructurePathLine);
}

function looksLikeStructurePathLine(line: string) {
  if (!line || /\s/u.test(line)) return false;
  if (/^(?:file:\/\/|\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/])/u.test(line)) return true;
  return /\.(?:abi|bcif|cif|cms|com|cub|cube|csv|ent|fdf|in|inp|log|mae|maegz|mmcif|mol|mol2|nw|out|pdb|psi4|qcin|sd|sdf|smi|smiles|tsv|vasp|xyz)$/iu.test(line);
}
