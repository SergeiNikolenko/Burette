const FILE_VIEWER_DIAGNOSTIC_STORAGE_KEY = "retab-file-viewer-debug";
const PDF_DIAGNOSTIC_STORAGE_KEY = "retab-pdf-debug";
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];
const T0 = typeof performance !== "undefined" ? performance.now() : 0;
const seqRef = { n: 0 };
const sessionSeqRef = { n: 0 };

export type FileViewerDiagnosticLevel = "debug" | "info" | "warn" | "error";
export type PdfViewerDiagnosticLevel = FileViewerDiagnosticLevel;

export type FileViewerDiagnosticData = Record<string, unknown>;
export type PdfViewerDiagnosticData = FileViewerDiagnosticData;

function isTruthyDiagnosticFlag(value: string | null): boolean {
  return value === "1" || value === "true";
}

export function isFileViewerDiagnosticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const explicit = window.localStorage.getItem(
      FILE_VIEWER_DIAGNOSTIC_STORAGE_KEY,
    );
    if (explicit !== null) return isTruthyDiagnosticFlag(explicit);
    const legacyPdf = window.localStorage.getItem(PDF_DIAGNOSTIC_STORAGE_KEY);
    if (legacyPdf !== null) return isTruthyDiagnosticFlag(legacyPdf);
    return false;
  } catch {
    return false;
  }
}

export function isPdfViewerDiagnosticsEnabled(): boolean {
  return isFileViewerDiagnosticsEnabled();
}

export function fileViewerDiagnostic(
  level: FileViewerDiagnosticLevel,
  event: string,
  data?: FileViewerDiagnosticData,
): void {
  if (!isFileViewerDiagnosticsEnabled()) return;
  const seq = ++seqRef.n;
  const elapsedMs =
    (typeof performance !== "undefined" ? performance.now() : 0) - T0;
  const method = console[level] ?? console.log;
  method(
    `%cfile-viewer%c #${seq} %c${elapsedMs.toFixed(1)}ms%c ${event}`,
    "background:#0f766e;color:#fff;padding:0 4px;border-radius:3px;font-weight:bold",
    "color:#888",
    "color:#06c",
    "color:inherit",
    data ?? "",
  );
}

export function pdfViewerDiagnostic(
  level: PdfViewerDiagnosticLevel,
  event: string,
  data?: PdfViewerDiagnosticData,
): void {
  fileViewerDiagnostic(level, event, data);
}

export function viewerDiagnosticNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function viewerDiagnosticDurationMs(startedAt: number): number {
  return Math.max(0, Math.round(viewerDiagnosticNow() - startedAt));
}

export function nextFileViewerSessionId(prefix = "fv"): string {
  sessionSeqRef.n += 1;
  return `${prefix}_${sessionSeqRef.n.toString(36)}`;
}

export function fileBufferDiagnostics(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const head = bytes.slice(0, Math.min(16, bytes.byteLength));

  return {
    byteLength: bytes.byteLength,
    headHex: bytesToHex(head),
    looksLikeHtml: looksLikeHtml(bytes),
    pdfHeaderOffset: pdfHeaderOffset(bytes),
    tiffHeader: tiffHeader(bytes),
  };
}

export function pdfBufferDiagnostics(buffer: ArrayBuffer | Uint8Array) {
  return fileBufferDiagnostics(buffer);
}

export function summarizeViewerError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) {
    const value = String(error);
    return {
      type: typeof error,
      valueHash: hashString(value),
      valuePreview: redactDiagnosticText(value, 160),
    };
  }

  const details: PdfViewerDiagnosticData = {
    name: error.name,
    message: redactDiagnosticText(error.message, 240),
    messageHash: hashString(error.message),
  };

  const maybeCode = (error as { code?: unknown }).code;
  if (maybeCode !== undefined) details.code = maybeCode;

  const maybeStatus = (error as { status?: unknown }).status;
  if (maybeStatus !== undefined) details.status = maybeStatus;

  const maybeReason = (error as { reason?: unknown }).reason;
  if (maybeReason !== undefined) details.reason = maybeReason;

  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && depth < 1) {
    details.cause = summarizeViewerError(cause, depth + 1);
  }

  return details;
}

export function summarizePdfError(error: unknown, depth = 0): unknown {
  return summarizeViewerError(error, depth);
}

export function safeUrlSummary(url: string | null | undefined) {
  if (!url) return null;
  try {
    const currentOrigin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://local";
    const parsed = new URL(url, currentOrigin);
    return {
      origin:
        typeof window !== "undefined" &&
        window.location?.origin &&
        parsed.origin === window.location.origin
          ? "same-origin"
          : parsed.origin,
      path: redactUrlPath(parsed.pathname),
      hasSearch: parsed.search.length > 0,
    };
  } catch {
    return {
      valueHash: hashString(url),
      valuePreview: redactDiagnosticText(url, 160),
    };
  }
}

export function safePdfUrlSummary(url: string | null | undefined) {
  return safeUrlSummary(url);
}

export function responseHeadersDiagnostics(headers: Headers) {
  const retabFileId = headers.get("x-retab-file-id");
  return {
    contentLength: headers.get("content-length"),
    contentRange: headers.get("content-range"),
    contentType: headers.get("content-type"),
    requestId: headers.get("x-request-id"),
    retabFileIdHash: summarizeDiagnosticId(retabFileId),
    retabPreviewKind: headers.get("x-retab-preview-kind"),
  };
}

export function summarizeViewerReadOptions(options?: {
  signal?: AbortSignal;
  maxBytes?: number;
  maxLines?: number;
}) {
  return {
    hasSignal: Boolean(options?.signal),
    isSignalAborted: options?.signal?.aborted ?? false,
    maxBytes: options?.maxBytes,
    maxLines: options?.maxLines,
  };
}

export function summarizeViewerByteRange(range: {
  start: number;
  end: number;
}) {
  return {
    start: range.start,
    end: range.end,
    requestedBytes: range.end >= range.start ? range.end - range.start + 1 : 0,
  };
}

export function summarizeViewerContent(content: {
  key: string;
  sourceKind: string;
  directUrl?: string | null;
  mimeType?: string;
  payload?: {
    kind: string;
    url?: string;
    blob?: Blob;
    text?: string;
  };
}) {
  return {
    keyHash: summarizeDiagnosticId(content.key),
    sourceKind: content.sourceKind,
    mimeType: content.mimeType,
    directUrl: safeUrlSummary(content.directUrl),
    payload: content.payload
      ? summarizeViewerPayload(content.payload)
      : undefined,
  };
}

export function summarizeViewerKeys(keys: {
  load: string;
  presentation: string;
  resource: string;
}) {
  return {
    loadHash: summarizeDiagnosticId(keys.load),
    presentationHash: summarizeDiagnosticId(keys.presentation),
    resourceHash: summarizeDiagnosticId(keys.resource),
  };
}

export function summarizeViewerResource(resource: {
  descriptor?: {
    category: string;
    displayName: string;
    fileName: string;
    identityKey: string;
    mimeType?: string;
  };
  fileName: string;
  identityKey: string;
  mimeType?: string;
  sourceKind: string;
  keys: {
    load: string;
    presentation: string;
    resource: string;
  };
  content?: {
    key: string;
    sourceKind: string;
    directUrl?: string | null;
    mimeType?: string;
    payload?: {
      kind: string;
      url?: string;
      blob?: Blob;
      text?: string;
    };
  };
}) {
  return {
    fileName: summarizeFileName(resource.fileName),
    identityKeyHash: summarizeDiagnosticId(resource.identityKey),
    mimeType: resource.mimeType,
    sourceKind: resource.sourceKind,
    descriptor: resource.descriptor
      ? summarizeViewerDescriptor(resource.descriptor)
      : undefined,
    content: resource.content
      ? summarizeViewerContent(resource.content)
      : undefined,
    keys: summarizeViewerKeys(resource.keys),
  };
}

export function summarizeViewerSource(source: {
  kind: string;
  fileName?: string;
  mimeType?: string;
  identityKey?: string;
  downloadUrl?: string;
  url?: string;
  text?: string;
  blob?: Blob;
}) {
  return {
    kind: source.kind,
    fileName: summarizeFileName(source.fileName),
    extension: extensionOf(source.fileName),
    mimeType: source.mimeType ?? source.blob?.type,
    identityKeyHash: summarizeDiagnosticId(source.identityKey),
    url: safeUrlSummary(source.url),
    downloadUrl: safeUrlSummary(source.downloadUrl),
    textLength: source.kind === "text" ? (source.text?.length ?? 0) : undefined,
    blobSize: source.blob?.size,
    blobType: source.blob?.type || undefined,
  };
}

export function summarizeViewerDescriptor(descriptor: {
  category: string;
  displayName: string;
  fileName: string;
  identityKey: string;
  mimeType?: string;
}) {
  return {
    category: descriptor.category,
    displayName: summarizeFileName(descriptor.displayName),
    fileName: summarizeFileName(descriptor.fileName),
    extension: extensionOf(descriptor.fileName),
    mimeType: descriptor.mimeType,
    identityKeyHash: summarizeDiagnosticId(descriptor.identityKey),
    extensionCategory: categoryFromExtension(extensionOf(descriptor.fileName)),
    mimeCategory: categoryFromMime(descriptor.mimeType),
  };
}

export function viewerCategoryMismatch(descriptor: {
  fileName: string;
  mimeType?: string;
}) {
  const extensionCategory = categoryFromExtension(
    extensionOf(descriptor.fileName),
  );
  const mimeCategory = categoryFromMime(descriptor.mimeType);
  if (
    !extensionCategory ||
    !mimeCategory ||
    extensionCategory === mimeCategory
  ) {
    return null;
  }
  return {
    extension: extensionOf(descriptor.fileName),
    extensionCategory,
    mimeCategory,
    mimeType: descriptor.mimeType,
  };
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export function summarizeDiagnosticId(value: string | null | undefined) {
  if (!value) return null;
  return {
    hash: hashString(value),
    length: value.length,
  };
}

function summarizeFileName(name: string | null | undefined) {
  if (!name) return null;
  return {
    extension: extensionOf(name),
    hash: hashString(name),
    length: name.length,
  };
}

function redactUrlPath(pathname: string) {
  const segments = pathname.split("/").map((segment, index, parts) => {
    if (!segment) return segment;
    const previous = parts[index - 1];
    if (previous === "files") return ":file_id";
    if (previous === "primitive-executions") return ":primitive_execution_id";
    if (previous === "runs") return ":run_id";
    if (previous === "workflows") return ":workflow_id";
    return redactIdentifierSegment(segment);
  });
  return segments.join("/");
}

function redactIdentifierSegment(segment: string) {
  if (
    /^(file|pexec|run|wf|doc|artifact|clss|parse|split|part|edit|extr)[_-]/i.test(
      segment,
    )
  ) {
    return `:${segment.split(/[_-]/, 1)[0].toLowerCase()}_id`;
  }
  if (segment.length >= 18 && /^[a-z0-9_-]+$/i.test(segment)) {
    return ":id";
  }
  return segment;
}

function redactDiagnosticText(value: string, maxLength: number) {
  return truncate(
    value
      .replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/data:[^\s"'<>]+/gi, "[data-url]")
      .replace(/[?&][^=\s"'<>]+=[^\s"'<>]+/g, "[query]"),
    maxLength,
  );
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function summarizeViewerPayload(payload: {
  kind: string;
  url?: string;
  blob?: Blob;
  text?: string;
}) {
  if (payload.kind === "url") {
    return {
      kind: payload.kind,
      url: safeUrlSummary(payload.url),
    };
  }
  if (payload.kind === "blob") {
    return {
      kind: payload.kind,
      blobSize: payload.blob?.size,
      blobType: payload.blob?.type || undefined,
    };
  }
  if (payload.kind === "text") {
    return {
      kind: payload.kind,
      textLength: payload.text?.length ?? 0,
    };
  }
  return { kind: payload.kind };
}

function pdfHeaderOffset(bytes: Uint8Array): number {
  const limit = Math.min(bytes.byteLength, 1024);
  for (let i = 0; i <= limit - PDF_HEADER.length; i += 1) {
    let matches = true;
    for (let offset = 0; offset < PDF_HEADER.length; offset += 1) {
      if (bytes[i + offset] !== PDF_HEADER[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return i;
  }
  return -1;
}

function tiffHeader(bytes: Uint8Array): "little_endian" | "big_endian" | null {
  if (bytes.byteLength < 4) return null;
  if (
    bytes[0] === 0x49 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x2a &&
    bytes[3] === 0x00
  ) {
    return "little_endian";
  }
  if (
    bytes[0] === 0x4d &&
    bytes[1] === 0x4d &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x2a
  ) {
    return "big_endian";
  }
  return null;
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const sample = new TextDecoder()
    .decode(bytes.slice(0, Math.min(bytes.byteLength, 64)))
    .trimStart()
    .toLowerCase();
  return sample.startsWith("<!doctype html") || sample.startsWith("<html");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function extensionOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = name.split(/[?#]/)[0];
  const base = clean.split("/").pop() ?? clean;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : null;
}

function categoryFromExtension(extension: string | null): string | null {
  if (!extension) return null;
  if (extension === "pdf") return "pdf";
  if (extension === "tif" || extension === "tiff") return "image";
  if (
    extension === "png" ||
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "gif" ||
    extension === "webp" ||
    extension === "avif" ||
    extension === "bmp" ||
    extension === "svg" ||
    extension === "ico"
  ) {
    return "image";
  }
  if (extension === "docx") return "docx";
  if (extension === "xlsx" || extension === "xls" || extension === "xlsm") {
    return "xlsx";
  }
  if (extension === "pptx") return "pptx";
  if (extension === "csv" || extension === "tsv") return "csv";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "html" || extension === "htm") return "html";
  return null;
}

function categoryFromMime(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null;
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("wordprocessingml")) return "docx";
  if (mime.includes("spreadsheet") || mime.includes("ms-excel")) return "xlsx";
  if (mime.includes("presentation") || mime.includes("ms-powerpoint")) {
    return "pptx";
  }
  if (mime === "text/csv" || mime === "text/tab-separated-values") return "csv";
  if (mime === "text/markdown") return "markdown";
  if (mime === "text/html") return "html";
  if (mime.startsWith("text/")) return "text";
  return null;
}
