import type { ViewerDescriptor } from "@/lib/viewer-source";
import { extensionOf } from "@/lib/viewer-source";

const CODE_THUMBNAIL_EXTENSIONS = new Set([
  "bash",
  "c",
  "cc",
  "cjs",
  "cpp",
  "cs",
  "css",
  "env",
  "go",
  "graphql",
  "h",
  "ini",
  "java",
  "js",
  "json",
  "json5",
  "jsonl",
  "jsx",
  "kt",
  "less",
  "log",
  "lua",
  "mjs",
  "ndjson",
  "php",
  "pl",
  "proto",
  "py",
  "r",
  "rb",
  "rs",
  "scala",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

export function isCodeThumbnailDescriptor(
  descriptor: ViewerDescriptor,
): boolean {
  const extension = extensionOf(descriptor.displayName);
  if (extension && CODE_THUMBNAIL_EXTENSIONS.has(extension)) return true;

  const mime = descriptor.mimeType?.toLowerCase().split(";")[0].trim();
  return (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "text/javascript" ||
    mime === "application/javascript" ||
    Boolean(mime?.endsWith("+json") || mime?.endsWith("+xml"))
  );
}

export function formatCodeThumbnailText(
  text: string,
  fileName: string,
  mimeType?: string,
) {
  if (!isStrictJson(fileName, mimeType)) return text;

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function isStrictJson(fileName: string, mimeType?: string) {
  const extension = extensionOf(fileName);
  if (extension === "json") return true;
  if (
    extension === "json5" ||
    extension === "jsonl" ||
    extension === "ndjson"
  ) {
    return false;
  }

  const mime = mimeType?.toLowerCase().split(";")[0].trim();
  return mime === "application/json" || Boolean(mime?.endsWith("+json"));
}
