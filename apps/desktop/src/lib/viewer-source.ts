export type FileCategory =
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "csv"
  | "image"
  | "markdown"
  | "html"
  | "email"
  | "text"
  | "unsupported";

export type ViewerSource = UrlViewerSource | TextSource | BlobViewerSource;

export interface UrlViewerSource {
  kind: "url";
  url: string;
  fileName?: string;
  mimeType?: string;
  downloadUrl?: string;
  identityKey?: string;
}

export interface TextSource {
  kind: "text";
  text: string;
  fileName?: string;
  mimeType?: string;
  identityKey?: string;
}

export interface BlobViewerSource {
  kind: "blob";
  blob: Blob;
  identityKey: string;
  fileName?: string;
  mimeType?: string;
  downloadUrl?: string;
}

export interface ViewerDescriptor {
  source: ViewerSource;
  category: FileCategory;
  identityKey: string;
  displayName: string;
  fileName: string;
  mimeType?: string;
}

const EXTENSION_CATEGORY: Record<string, FileCategory> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  xls: "xlsx",
  xlsm: "xlsx",
  pptx: "pptx",
  csv: "csv",
  tsv: "csv",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
  svg: "image",
  ico: "image",
  tif: "image",
  tiff: "image",
  md: "markdown",
  markdown: "markdown",
  mdx: "text",
  html: "html",
  htm: "html",
  eml: "email",
  txt: "text",
  text: "text",
  log: "text",
  json: "text",
  jsonl: "text",
  json5: "text",
  ndjson: "text",
  xml: "text",
  yaml: "text",
  yml: "text",
  toml: "text",
  ini: "text",
  env: "text",
  js: "text",
  mjs: "text",
  cjs: "text",
  jsx: "text",
  ts: "text",
  tsx: "text",
  css: "text",
  scss: "text",
  less: "text",
  py: "text",
  rb: "text",
  go: "text",
  rs: "text",
  java: "text",
  kt: "text",
  c: "text",
  h: "text",
  cpp: "text",
  cc: "text",
  cs: "text",
  php: "text",
  sh: "text",
  bash: "text",
  zsh: "text",
  sql: "text",
  graphql: "text",
  proto: "text",
  lua: "text",
  r: "text",
  swift: "text",
  scala: "text",
  pl: "text",
  vue: "text",
  svelte: "text",
};

export function extensionOf(name: string): string | null {
  const clean = name.split(/[?#]/)[0];
  const base = clean.split("/").pop() ?? clean;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : null;
}

export function extractName(url: string): string {
  const clean = url.split(/[?#]/)[0];
  return clean.split("/").pop() || "file";
}

export function detectCategory(
  fileName: string,
  mimeType?: string,
): FileCategory {
  const ext = extensionOf(fileName);
  if (ext && EXTENSION_CATEGORY[ext]) return EXTENSION_CATEGORY[ext];
  if (mimeType) {
    const fromMime = categoryFromMime(mimeType);
    if (fromMime) return fromMime;
  }
  return "unsupported";
}

export function resolveViewerDescriptor({
  source,
  category,
}: {
  source: ViewerSource;
  category?: FileCategory;
}): ViewerDescriptor {
  const resolvedMimeType =
    source.mimeType ??
    (source.kind === "blob" && source.blob.type ? source.blob.type : undefined);
  const displayName = source.fileName ?? defaultDisplayName(source);
  const fileName = source.fileName ?? defaultFileName(source);
  const resolvedCategory =
    category ?? detectCategory(displayName, resolvedMimeType);

  return {
    source,
    category: resolvedCategory,
    identityKey: source.identityKey ?? defaultIdentityKey(source),
    displayName,
    fileName,
    mimeType: resolvedMimeType,
  };
}

function categoryFromMime(mimeType: string): FileCategory | null {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("wordprocessingml")) return "docx";
  if (mime.includes("spreadsheet") || mime.includes("ms-excel")) return "xlsx";
  if (mime.includes("presentation") || mime.includes("ms-powerpoint")) {
    return "pptx";
  }
  if (mime === "text/csv" || mime === "text/tab-separated-values") return "csv";
  if (mime === "text/markdown") return "markdown";
  if (mime === "text/html") return "html";
  if (mime === "message/rfc822" || mime === "message/global") {
    return "email";
  }
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/json" || mime === "application/xml") return "text";
  if (mime.startsWith("text/")) return "text";
  return null;
}

function defaultDisplayName(source: ViewerSource) {
  if (source.kind === "url") return source.url;
  if (source.kind === "text") return "text.txt";
  return "file";
}

function defaultFileName(source: ViewerSource) {
  if (source.kind === "url") return extractName(source.url);
  if (source.kind === "text") return "text.txt";
  return "file";
}

function defaultIdentityKey(source: ViewerSource) {
  if (source.kind === "url") return `url:${source.url}`;
  if (source.kind === "text") return textPayloadIdentityKey(source.text);
  return source.identityKey;
}

export function textPayloadIdentityKey(text: string) {
  return textPayloadKey(text);
}

export function textPayloadKey(text: string) {
  return `text:${text.length}:${hashString(text)}`;
}

function hashString(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
