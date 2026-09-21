import {
  createBlobDownloadAction,
  createHrefDownloadAction,
  createTextDownloadAction,
  type ViewerDownloadAction,
} from "@/lib/viewer-download-actions";
import {
  isAbortError,
  ResourceError,
  type ResourceTooLargeReason,
} from "@/lib/viewer-errors";
import {
  resolveViewerDescriptor,
  textPayloadKey,
  type BlobViewerSource,
  type FileCategory,
  type TextSource,
  type UrlViewerSource,
  type ViewerDescriptor,
  type ViewerSource,
} from "@/lib/viewer-source";

export interface ResourceReadOptions {
  cache?: RequestCache;
  signal?: AbortSignal;
}

export interface TextReadOptions extends ResourceReadOptions {
  maxBytes?: number;
  maxLines?: number;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface ByteRangeResult {
  buffer: ArrayBuffer;
  contentRange?: {
    start: number;
    end: number;
    total: number | null;
  };
  isComplete: boolean;
}

export interface ViewerResourceKeys {
  readonly load: string;
  readonly presentation: string;
  readonly resource: string;
}

export type ViewerResourcePayload =
  | { kind: "url"; url: string }
  | { kind: "blob"; blob: Blob }
  | { kind: "text"; text: string };

export interface ViewerResourceContent {
  readonly key: string;
  readonly sourceKind: ViewerSource["kind"];
  readonly directUrl: string | null;
  readonly mimeType?: string;
  readonly payload: ViewerResourcePayload;
  readBlob(options?: ResourceReadOptions): Promise<Blob>;
  readBytes(options?: ResourceReadOptions): Promise<ArrayBuffer>;
  readText(options?: TextReadOptions): Promise<string>;
  readStream(
    options?: ResourceReadOptions,
  ): Promise<ReadableStream<Uint8Array>>;
  readRange(
    range: ByteRange,
    options?: ResourceReadOptions,
  ): Promise<ByteRangeResult>;
}

export type ViewerContentIdentity = Pick<
  ViewerResourceContent,
  "key" | "sourceKind"
>;

export type ViewerContentDirectUrl = ViewerContentIdentity &
  Pick<ViewerResourceContent, "directUrl">;

export type ViewerContentPayload = ViewerContentIdentity &
  Pick<ViewerResourceContent, "payload">;

export type ViewerContentMime = ViewerContentIdentity &
  Pick<ViewerResourceContent, "mimeType">;

export type ViewerContentBlob = ViewerContentIdentity &
  Pick<ViewerResourceContent, "readBlob">;

export type ViewerContentBytes = ViewerContentIdentity &
  Pick<ViewerResourceContent, "readBytes">;

export type ViewerContentText = ViewerContentIdentity &
  Pick<ViewerResourceContent, "readText">;

export type ViewerContentStream = ViewerContentIdentity &
  Pick<ViewerResourceContent, "readStream">;

export type ViewerContentRange = ViewerContentIdentity &
  Pick<ViewerResourceContent, "readRange">;

export interface ViewerResource {
  readonly descriptor: ViewerDescriptor;
  readonly sourceKind: ViewerSource["kind"];
  readonly keys: ViewerResourceKeys;
  readonly identityKey: string;
  readonly fileName: string;
  readonly mimeType?: string;
  readonly content: ViewerResourceContent;
  readonly originalDownload: ViewerDownloadAction;
}

const URL_RESOURCE_REGISTRY_MAX = 128;
const TEXT_RESOURCE_REGISTRY_MAX = 64;
// LF, CR, CRLF, LINE SEPARATOR (U+2028), and PARAGRAPH SEPARATOR (U+2029) — the
// ECMAScript LineTerminator set, matching what a browser breaks on in a
// `white-space: pre` block. Kept in sync with text-viewer-resource's splitter.
const TEXT_LINE_BREAK_PATTERN = /\r\n|[\n\r\u2028\u2029]/g;

const urlViewerResourceRegistry = new Map<string, ViewerResource>();
const urlViewerResourceContentRegistry = new Map<
  string,
  ViewerResourceContent
>();
const textViewerResourceRegistry = new Map<string, ViewerResource>();
const textViewerResourceContentRegistry = new Map<
  string,
  ViewerResourceContent
>();
let blobViewerResourceRegistry = new WeakMap<
  Blob,
  Map<string, ViewerResource>
>();
let blobViewerResourceContentRegistry = new WeakMap<
  Blob,
  Map<string, ViewerResourceContent>
>();
const blobObjectKeys = new WeakMap<Blob, string>();
let nextBlobObjectKey = 0;

export function createViewerResource(
  source: ViewerSource,
  category?: FileCategory,
): ViewerResource {
  const descriptor = resolveViewerDescriptor({ source, category });
  const keys = viewerResourceKeys(source, descriptor);

  if (source.kind === "url") {
    return internUrlResource(source, descriptor, keys);
  }
  if (source.kind === "blob") {
    return internBlobResource(source, descriptor, keys);
  }
  return internTextResource(source, descriptor, keys);
}

export function clearViewerResourceRegistryForTests() {
  urlViewerResourceRegistry.clear();
  urlViewerResourceContentRegistry.clear();
  textViewerResourceRegistry.clear();
  textViewerResourceContentRegistry.clear();
  blobViewerResourceRegistry = new WeakMap();
  blobViewerResourceContentRegistry = new WeakMap();
}

function internUrlResource(
  source: UrlViewerSource,
  descriptor: ViewerDescriptor,
  keys: ViewerResourceKeys,
): ViewerResource {
  const cached = urlViewerResourceRegistry.get(keys.resource);
  if (cached) return cached;

  const resource = createUrlResource(source, descriptor, keys);
  urlViewerResourceRegistry.set(keys.resource, resource);
  pruneUrlResourceRegistry();
  return resource;
}

function internBlobResource(
  source: BlobViewerSource,
  descriptor: ViewerDescriptor,
  keys: ViewerResourceKeys,
): ViewerResource {
  let resources = blobViewerResourceRegistry.get(source.blob);
  if (!resources) {
    resources = new Map();
    blobViewerResourceRegistry.set(source.blob, resources);
  }

  const cached = resources.get(keys.resource);
  if (cached) return cached;

  const resource = createBlobResource(source, descriptor, keys);
  resources.set(keys.resource, resource);
  return resource;
}

function internTextResource(
  source: TextSource,
  descriptor: ViewerDescriptor,
  keys: ViewerResourceKeys,
): ViewerResource {
  const cached = textViewerResourceRegistry.get(keys.resource);
  if (cached) return cached;

  const resource = createTextResource(source, descriptor, keys);
  textViewerResourceRegistry.set(keys.resource, resource);
  pruneTextResourceRegistry();
  return resource;
}

function pruneUrlResourceRegistry() {
  while (urlViewerResourceRegistry.size > URL_RESOURCE_REGISTRY_MAX) {
    const firstKey = urlViewerResourceRegistry.keys().next().value;
    if (!firstKey) return;
    urlViewerResourceRegistry.delete(firstKey);
  }
}

function pruneUrlResourceContentRegistry() {
  while (urlViewerResourceContentRegistry.size > URL_RESOURCE_REGISTRY_MAX) {
    const firstKey = urlViewerResourceContentRegistry.keys().next().value;
    if (!firstKey) return;
    urlViewerResourceContentRegistry.delete(firstKey);
  }
}

function pruneTextResourceRegistry() {
  while (textViewerResourceRegistry.size > TEXT_RESOURCE_REGISTRY_MAX) {
    const firstKey = textViewerResourceRegistry.keys().next().value;
    if (!firstKey) return;
    textViewerResourceRegistry.delete(firstKey);
  }
}

function pruneTextResourceContentRegistry() {
  while (textViewerResourceContentRegistry.size > TEXT_RESOURCE_REGISTRY_MAX) {
    const firstKey = textViewerResourceContentRegistry.keys().next().value;
    if (!firstKey) return;
    textViewerResourceContentRegistry.delete(firstKey);
  }
}

function viewerResourceKeys(
  source: ViewerSource,
  descriptor: ViewerDescriptor,
): ViewerResourceKeys {
  const load = viewerResourceLoadKey(source, descriptor);
  const presentation = viewerResourcePresentationKey(source, descriptor);
  return {
    load,
    presentation,
    resource: [load, presentation].join("\u0000"),
  };
}

function viewerResourceLoadKey(
  source: ViewerSource,
  descriptor: ViewerDescriptor,
) {
  return [
    source.kind,
    source.identityKey ?? "",
    sourceMimeType(source) ?? "",
    directLoadCacheKey(source),
    payloadCacheKey(source, descriptor),
  ].join("\u0000");
}

function viewerResourcePresentationKey(
  source: ViewerSource,
  descriptor: ViewerDescriptor,
) {
  return [
    descriptor.category,
    descriptor.displayName,
    descriptor.fileName,
    descriptor.mimeType ?? "",
    downloadCacheKey(source),
  ].join("\u0000");
}

function directLoadCacheKey(source: ViewerSource) {
  return source.kind === "url" ? source.url : "";
}

function downloadCacheKey(source: ViewerSource) {
  if (source.kind === "text") return "";
  return source.downloadUrl ?? "";
}

function payloadCacheKey(source: ViewerSource, descriptor: ViewerDescriptor) {
  if (source.kind === "url") return "";
  if (source.kind === "blob") return blobObjectKey(source.blob);
  return source.identityKey ? "" : descriptor.identityKey;
}

export function viewerResourceRenderKey(resource: ViewerResource): string {
  const load = [
    resource.sourceKind,
    resource.identityKey,
    resource.mimeType ?? resource.content.mimeType ?? "",
    resource.content.directUrl ?? "",
    viewerContentRenderKey(resource.content),
  ].join("\u0000");

  return [load, resource.keys.presentation].join("\u0000");
}

export function viewerContentRenderKey(content: ViewerResourceContent): string {
  if (content.payload.kind === "text")
    return textPayloadKey(content.payload.text);
  return content.key;
}

function sourceMimeType(source: ViewerSource) {
  if (source.kind === "blob") return source.mimeType ?? source.blob.type;
  return source.mimeType;
}

function blobObjectKey(blob: Blob) {
  let key = blobObjectKeys.get(blob);
  if (!key) {
    nextBlobObjectKey += 1;
    key = `blob-object:${nextBlobObjectKey}`;
    blobObjectKeys.set(blob, key);
  }
  return key;
}

export function blobSource(
  bytes: Blob | ArrayBuffer | Uint8Array,
  metadata: {
    identityKey: string;
    fileName?: string;
    mimeType?: string;
    downloadUrl?: string;
  },
): BlobViewerSource {
  const blob =
    bytes instanceof Blob
      ? bytes
      : new Blob(
          [bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes)],
          {
            type: metadata.mimeType ?? "",
          },
        );
  return {
    kind: "blob",
    blob,
    fileName: metadata.fileName,
    mimeType: metadata.mimeType ?? blob.type,
    downloadUrl: metadata.downloadUrl,
    identityKey: metadata.identityKey,
  };
}

function createUrlResource(
  source: UrlViewerSource,
  descriptor: ViewerDescriptor,
  keys: ViewerResourceKeys,
): ViewerResource {
  const content = internUrlResourceContent(source, keys);
  const originalDownload = createHrefDownloadAction({
    id: "download-original",
    label: "Download",
    href: source.downloadUrl ?? source.url,
    fileName: descriptor.fileName,
  });

  return resourceBase(source, descriptor, keys, { content, originalDownload });
}

function internUrlResourceContent(
  source: UrlViewerSource,
  keys: ViewerResourceKeys,
): ViewerResourceContent {
  const cached = urlViewerResourceContentRegistry.get(keys.load);
  if (cached) return cached;

  const content = resourceContentBase(source, keys, {
    directUrl: source.url,
    payload: { kind: "url", url: source.url },
    readBlob: async ({ cache, signal } = {}) => {
      const response = await fetchResource(
        source.url,
        cache ? { cache, signal } : { signal },
      );
      validateFullContentResponse(response);
      return readResponseBlob(response);
    },
    readBytes: async ({ cache, signal } = {}) => {
      const response = await fetchResource(
        source.url,
        cache ? { cache, signal } : { signal },
      );
      validateFullContentResponse(response);
      return readResponseArrayBuffer(response);
    },
    readText: async ({ cache, signal, maxBytes, maxLines } = {}) => {
      const response = await fetchResource(
        source.url,
        cache ? { cache, signal } : { signal },
      );
      return readBoundedResponseText(response, { maxBytes, maxLines });
    },
    readStream: async ({ cache, signal } = {}) => {
      const response = await fetchResource(
        source.url,
        cache ? { cache, signal } : { signal },
      );
      validateFullContentResponse(response);
      if (!response.body) {
        if (response.status === 204 || response.status === 205) {
          return emptyByteStream();
        }
        throw new ResourceError({
          kind: "unsupported_capability",
          message: "This response cannot be streamed.",
        });
      }
      return response.body;
    },
    readRange: async (range, { cache, signal } = {}) => {
      validateByteRange(range);
      const { start, end } = range;
      const init = {
        signal,
        headers: { Range: `bytes=${start}-${end}` },
      };
      const response = await fetchResource(
        source.url,
        cache ? { ...init, cache } : init,
      );
      const buffer = await readResponseArrayBuffer(response);
      const contentRange = parseContentRange(
        response.headers.get("content-range"),
      );
      validateUrlRangeResponse({
        bufferLength: buffer.byteLength,
        contentRange,
        range,
        status: response.status,
      });
      return {
        buffer,
        contentRange,
        isComplete: isByteRangeComplete({
          bufferLength: buffer.byteLength,
          contentRange,
          requestedLength: end - start + 1,
          status: response.status,
        }),
      };
    },
  });
  urlViewerResourceContentRegistry.set(keys.load, content);
  pruneUrlResourceContentRegistry();
  return content;
}

function emptyByteStream() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function createBlobResource(
  source: BlobViewerSource,
  descriptor: ViewerDescriptor,
  keys: ViewerResourceKeys,
): ViewerResource {
  const blob = source.blob;
  const content = internBlobResourceContent(source, keys);
  const originalDownload = source.downloadUrl
    ? createHrefDownloadAction({
        id: "download-original",
        label: "Download",
        href: source.downloadUrl,
        fileName: descriptor.fileName,
      })
    : createBlobDownloadAction({
        id: "download-original",
        label: "Download",
        blob,
        fileName: descriptor.fileName,
      });

  return resourceBase(source, descriptor, keys, { content, originalDownload });
}

function internBlobResourceContent(
  source: BlobViewerSource,
  keys: ViewerResourceKeys,
): ViewerResourceContent {
  const blob = source.blob;
  let contents = blobViewerResourceContentRegistry.get(blob);
  if (!contents) {
    contents = new Map();
    blobViewerResourceContentRegistry.set(blob, contents);
  }

  const cached = contents.get(keys.load);
  if (cached) return cached;

  const content = resourceContentBase(source, keys, {
    directUrl: null,
    payload: { kind: "blob", blob },
    readBlob: async () => blob,
    readBytes: async () => blob.arrayBuffer(),
    readText: async ({ maxBytes, maxLines } = {}) =>
      readBoundedBlobText(blob, { maxBytes, maxLines }),
    readStream: async () => blob.stream(),
    readRange: async (range) => {
      validateByteRange(range);
      const { start, end } = range;
      validateKnownByteRangeStart(start, blob.size);
      const rangeBlob = blob.slice(start, end + 1);
      return {
        buffer: await rangeBlob.arrayBuffer(),
        contentRange: {
          start,
          end: Math.min(end, blob.size - 1),
          total: blob.size,
        },
        isComplete: end >= blob.size - 1,
      };
    },
  });
  contents.set(keys.load, content);
  return content;
}

function createTextResource(
  source: TextSource,
  descriptor: ViewerDescriptor,
  keys: ViewerResourceKeys,
): ViewerResource {
  const content = internTextResourceContent(source, keys);
  const originalDownload = createTextDownloadAction({
    id: "download-original",
    label: "Download",
    text: source.text,
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
  });

  return resourceBase(source, descriptor, keys, { content, originalDownload });
}

function internTextResourceContent(
  source: TextSource,
  keys: ViewerResourceKeys,
): ViewerResourceContent {
  const cached = textViewerResourceContentRegistry.get(keys.load);
  if (cached) return cached;

  const content = resourceContentBase(source, keys, {
    directUrl: null,
    payload: { kind: "text", text: source.text },
    readBlob: async () =>
      new Blob([source.text], {
        type: "text/plain;charset=utf-8",
      }),
    readBytes: async () =>
      typedArrayBuffer(new TextEncoder().encode(source.text)),
    readText: async ({ maxBytes, maxLines } = {}) =>
      readBoundedInlineText(source.text, { maxBytes, maxLines }),
    readStream: async () => new Blob([source.text]).stream(),
    readRange: async (range) => {
      validateByteRange(range);
      const { start, end } = range;
      const buffer = new TextEncoder().encode(source.text);
      validateKnownByteRangeStart(start, buffer.byteLength);
      const slice = buffer.slice(start, end + 1);
      return {
        buffer: typedArrayBuffer(slice),
        contentRange: {
          start,
          end: Math.min(end, buffer.byteLength - 1),
          total: buffer.byteLength,
        },
        isComplete: end >= buffer.byteLength - 1,
      };
    },
  });
  textViewerResourceContentRegistry.set(keys.load, content);
  pruneTextResourceContentRegistry();
  return content;
}

function resourceBase(
  source: ViewerSource,
  descriptor: ViewerDescriptor,
  keys: ViewerResourceKeys,
  options: {
    content: ViewerResourceContent;
    originalDownload: ViewerDownloadAction;
  },
): ViewerResource {
  const { content, originalDownload } = options;
  return Object.freeze({
    descriptor,
    sourceKind: source.kind,
    keys,
    identityKey: descriptor.identityKey,
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
    content,
    originalDownload,
  });
}

function resourceContentBase(
  source: ViewerSource,
  keys: ViewerResourceKeys,
  methods: Omit<ViewerResourceContent, "key" | "sourceKind" | "mimeType">,
): ViewerResourceContent {
  return Object.freeze({
    key: keys.load,
    sourceKind: source.kind,
    mimeType: sourceMimeType(source),
    ...methods,
  });
}

function typedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function fetchResource(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    if (isAbortError(error)) {
      throw new ResourceError({
        kind: "aborted",
        message: "Loading was cancelled.",
        cause: error,
      });
    }
    throw new ResourceError({
      kind: "fetch_failed",
      message: "Could not fetch this resource.",
      cause: error,
    });
  }

  if (!response.ok && response.status !== 206) {
    throw new ResourceError({
      kind: "http_error",
      message: `Failed to load resource: ${response.status}`,
      status: response.status,
    });
  }

  return response;
}

async function readBoundedResponseText(
  response: Response,
  bounds: { maxBytes?: number; maxLines?: number },
) {
  validateFullContentResponse(response);

  const maxBytes = bounds.maxBytes;
  if (
    isContentLengthOverLimit(response.headers.get("content-length"), maxBytes)
  ) {
    throw tooLarge("bytes");
  }

  const body = response.body;
  if (!body) {
    const buffer = await readResponseArrayBuffer(response);
    if (maxBytes != null && buffer.byteLength > maxBytes) {
      throw tooLarge("bytes");
    }
    const text = new TextDecoder().decode(buffer);
    assertLineLimit(text, bounds.maxLines);
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const lineLimitTracker = createLineLimitTracker(bounds.maxLines);
  let receivedBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await readResponseStreamChunk(reader);
    if (done) break;
    receivedBytes += value.byteLength;
    if (maxBytes != null && receivedBytes > maxBytes) {
      await cancelReaderSilently(reader);
      throw tooLarge("bytes");
    }
    const chunkText = decoder.decode(value, { stream: true });
    try {
      lineLimitTracker.push(chunkText);
    } catch (error) {
      await cancelReaderSilently(reader);
      throw error;
    }
    text += chunkText;
  }

  const finalText = decoder.decode();
  lineLimitTracker.push(finalText);
  text += finalText;
  return text;
}

function isContentLengthOverLimit(
  contentLength: string | null,
  maxBytes: number | undefined,
) {
  if (maxBytes == null || contentLength == null) return false;

  const normalizedLength = contentLength.trim().replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(normalizedLength)) return false;

  const maxLength = String(maxBytes);
  return (
    normalizedLength.length > maxLength.length ||
    (normalizedLength.length === maxLength.length &&
      normalizedLength > maxLength)
  );
}

function validateFullContentResponse(response: Response) {
  if (response.status !== 206) return;

  const contentRange = parseContentRange(response.headers.get("content-range"));
  if (
    contentRange?.total != null &&
    contentRange.start === 0 &&
    contentRange.end === contentRange.total - 1
  ) {
    return;
  }

  throw new ResourceError({
    kind: "partial_content",
    message: "Full response returned partial content.",
    status: response.status,
  });
}

async function readResponseStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  try {
    return await reader.read();
  } catch (error) {
    throw resourceReadError(error);
  }
}

async function readResponseArrayBuffer(response: Response) {
  try {
    return await response.arrayBuffer();
  } catch (error) {
    throw resourceReadError(error);
  }
}

async function readResponseBlob(response: Response) {
  try {
    return await response.blob();
  } catch (error) {
    throw resourceReadError(error);
  }
}

function resourceReadError(error: unknown) {
  if (isAbortError(error)) {
    return new ResourceError({
      kind: "aborted",
      message: "Loading was cancelled.",
      cause: error,
    });
  }
  return new ResourceError({
    kind: "fetch_failed",
    message: "Could not read this resource.",
    cause: error,
  });
}

async function readBoundedBlobText(
  blob: Blob,
  bounds: { maxBytes?: number; maxLines?: number },
) {
  if (bounds.maxBytes != null && blob.size > bounds.maxBytes) {
    throw tooLarge("bytes");
  }
  const text = await blob.text();
  assertLineLimit(text, bounds.maxLines);
  return text;
}

function readBoundedInlineText(
  text: string,
  { maxBytes, maxLines }: { maxBytes?: number; maxLines?: number },
) {
  // For inline sources the string *is* the resource, so its UTF-8 byte length
  // is the authoritative size to measure against maxBytes.
  if (
    maxBytes != null &&
    new TextEncoder().encode(text).byteLength > maxBytes
  ) {
    throw tooLarge("bytes");
  }
  assertLineLimit(text, maxLines);
  return text;
}

// Used after a transferred-byte check has already enforced maxBytes (URL/blob).
// Re-encoding the decoded text here would double-count: invalid UTF-8 decodes to
// U+FFFD (3 bytes each), inflating the measured size past the real wire bytes
// and falsely rejecting small resources as "too large".
function assertLineLimit(text: string, maxLines: number | undefined) {
  if (
    maxLines != null &&
    text.split(TEXT_LINE_BREAK_PATTERN).length > maxLines
  ) {
    throw tooLarge("lines");
  }
}

function tooLarge(reason: ResourceTooLargeReason) {
  return new ResourceError({
    kind: "too_large",
    tooLargeReason: reason,
    message: `Resource exceeds ${reason} limit.`,
  });
}

async function cancelReaderSilently(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  try {
    await reader.cancel();
  } catch {
    // Preserve the user-facing load failure; cancellation is best-effort cleanup.
  }
}

function validateByteRange({ start, end }: ByteRange) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start
  ) {
    throw new ResourceError({
      kind: "invalid_range",
      message: "Byte range must use non-negative integer bounds.",
    });
  }
}

function validateKnownByteRangeStart(start: number, total: number) {
  if (start > 0 && start >= total) {
    throw new ResourceError({
      kind: "invalid_range",
      message: "Byte range starts past the available resource.",
    });
  }
}

function validateUrlRangeResponse({
  bufferLength,
  contentRange,
  range,
  status,
}: {
  bufferLength: number;
  contentRange: ByteRangeResult["contentRange"];
  range: ByteRange;
  status: number;
}) {
  if (status === 200) {
    if (range.start !== 0 || bufferLength > range.end - range.start + 1) {
      throw new ResourceError({
        kind: "invalid_range",
        message: "Full response does not match the requested byte range.",
      });
    }
    return;
  }
  if (status !== 206) {
    throw new ResourceError({
      kind: "invalid_range",
      message: "Range response must return full or partial content.",
    });
  }
  if (!contentRange) {
    throw new ResourceError({
      kind: "invalid_range",
      message: "Partial content response is missing a valid byte range.",
    });
  }
  const declaredLength = contentRange.end - contentRange.start + 1;
  if (
    contentRange.start !== range.start ||
    contentRange.end < contentRange.start ||
    contentRange.end > range.end ||
    (contentRange.total != null && contentRange.end >= contentRange.total) ||
    declaredLength !== bufferLength
  ) {
    throw new ResourceError({
      kind: "invalid_range",
      message: "Response byte range does not match the requested range.",
    });
  }
}

function isByteRangeComplete({
  bufferLength,
  contentRange,
  requestedLength,
  status,
}: {
  bufferLength: number;
  contentRange: ByteRangeResult["contentRange"];
  requestedLength: number;
  status: number;
}) {
  if (status === 200) return true;
  if (contentRange?.total != null) {
    if (contentRange.total <= 0) return true;
    return contentRange.end >= contentRange.total - 1;
  }
  if (contentRange) return false;
  return bufferLength < requestedLength;
}

function isStandaloneLineBreak(character: string) {
  const code = character.charCodeAt(0);
  return code === 0x0a || code === 0x2028 || code === 0x2029;
}

function createLineLimitTracker(maxLines: number | undefined) {
  let lineCount = 1;
  let previousWasCR = false;

  return {
    push(text: string) {
      if (maxLines == null || text.length === 0) return;

      for (const character of text) {
        if (previousWasCR) {
          previousWasCR = false;
          if (character === "\n") continue;
        }

        if (character === "\r") {
          lineCount += 1;
          previousWasCR = true;
        } else if (isStandaloneLineBreak(character)) {
          // LF, plus LINE/PARAGRAPH SEPARATOR (U+2028/U+2029); none pair with CR.
          lineCount += 1;
        }

        if (lineCount > maxLines) {
          throw tooLarge("lines");
        }
      }
    },
  };
}

function parseContentRange(value: string | null) {
  if (!value) return undefined;
  const match = value.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i);
  if (!match) return undefined;
  const start = parseContentRangeNumber(match[1]);
  const end = parseContentRangeNumber(match[2]);
  const total =
    match[3] === "*" ? null : parseContentRangeNumber(match[3] ?? "");
  if (start == null || end == null || total === undefined) return undefined;
  return {
    start,
    end,
    total,
  };
}

function parseContentRangeNumber(value: string) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}
