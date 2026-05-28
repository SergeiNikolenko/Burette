export const STRUCTURE_DRAG_MIME = "application/x-burrete-structure-paths";

export type StructureDragPayload = {
  paths: string[];
};

export function writeStructureDrag(dataTransfer: DataTransfer, paths: string[]) {
  const cleanPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  if (cleanPaths.length === 0) return;
  const payload: StructureDragPayload = { paths: cleanPaths };
  dataTransfer.setData(STRUCTURE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", cleanPaths.join("\n"));
  dataTransfer.effectAllowed = "copy";
}

export function readStructureDrag(dataTransfer: DataTransfer) {
  const explicit = dataTransfer.getData(STRUCTURE_DRAG_MIME);
  if (explicit) {
    try {
      const payload = JSON.parse(explicit) as Partial<StructureDragPayload>;
      if (Array.isArray(payload.paths)) {
        return payload.paths.filter((path): path is string => typeof path === "string" && path.trim().length > 0);
      }
    } catch {
      return [];
    }
  }
  return Array.from(dataTransfer.files)
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path));
}

export function hasStructureDrag(dataTransfer: DataTransfer) {
  const types = Array.from(dataTransfer.types);
  return types.includes(STRUCTURE_DRAG_MIME) || types.includes("Files");
}
