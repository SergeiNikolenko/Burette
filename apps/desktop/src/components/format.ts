import type { ViewerDocument } from "../types";

export function rendererLabel(renderer: string) {
  if (renderer === "xyz-fast") return "Fast XYZ";
  if (renderer === "xyzrender-external") return "xyzrender";
  if (renderer === "grid2d") return "Grid";
  return "Mol*";
}

export function formatBytes(value: number) {
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  return (value / 1024 / 1024).toFixed(1) + " MB";
}

export function matchesQuery(document: ViewerDocument, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [document.title, document.path, document.extension, rendererLabel(document.renderer)]
    .some((value) => value.toLowerCase().includes(needle));
}
