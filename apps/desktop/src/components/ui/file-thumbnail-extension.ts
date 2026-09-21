import type { ThumbnailFile } from "./file-thumbnail-frame-types";

export function getFileThumbnailExtension(
  file: ThumbnailFile | File,
): string | null {
  const fromName = extensionFromName(file.name);
  if (fromName) return fromName.toLowerCase();
  const subtype = mimeSubtypeToExtension(file.type);
  return subtype ? subtype.toLowerCase() : null;
}

function extensionFromName(name: string | undefined): string | null {
  if (!name) return null;
  const clean = name.split(/[?#]/)[0];
  const base = clean.split(/[\\/]/).pop() ?? clean;
  if (!base.includes(".")) return null;
  return base.split(".").pop() || null;
}

function mimeSubtypeToExtension(type: string | undefined): string | null {
  if (!type) return null;
  const normalized = type.toLowerCase().split(";")[0].trim();
  if (normalized in MIME_EXTENSION) return MIME_EXTENSION[normalized];
  const subtype = normalized.split("/").pop();
  return subtype || null;
}

const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tiff",
  "text/csv": "csv",
  "text/html": "html",
  "text/markdown": "md",
  "text/plain": "txt",
};
