export const STRUCTURE_DRAG_MIME = "application/x-burrete-structure-paths";

export type StructureDragRecord = {
  path: string;
  inputExtension: string;
  text: string;
};

export type StructureDragPayload = {
  paths: string[];
  records: StructureDragRecord[];
};

export function emptyStructureDragPayload(): StructureDragPayload {
  return { paths: [], records: [] };
}

export function writeStructureDrag(dataTransfer: DataTransfer, paths: string[]) {
  const cleanPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  if (cleanPaths.length === 0) return;
  const payload: StructureDragPayload = { paths: cleanPaths, records: [] };
  dataTransfer.setData(STRUCTURE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", cleanPaths.join("\n"));
  dataTransfer.effectAllowed = "copy";
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
  }
  payload.paths = Array.from(new Set(
    payload.paths
      .map((path) => (typeof path === "string" ? path.trim() : ""))
      .filter(Boolean),
  ));
  payload.records = payload.records.map(normalizeStructureDragRecord).filter((record): record is StructureDragRecord => record !== null);
  return payload;
}

export function readStructureDrag(dataTransfer: DataTransfer) {
  return readStructureDragPayload(dataTransfer).paths;
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

export function hasStructureDrag(dataTransfer: DataTransfer) {
  const types = Array.from(dataTransfer.types);
  return types.includes(STRUCTURE_DRAG_MIME) || types.includes("Files");
}
