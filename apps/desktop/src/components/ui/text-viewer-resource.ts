import {
  isResourceError,
  isViewerFormatError,
  ViewerFormatError,
  type ViewerFormatErrorMapperOptions,
} from "@/lib/viewer-errors";
import type {
  ViewerContentIdentity,
  ViewerContentPayload,
  ViewerContentText,
} from "@/lib/viewer-resource";

export const DEFAULT_MAX_BYTES = 1_000_000;
export const DEFAULT_MAX_LINES = 10_000;
export const MAX_TEXT_RESOURCE_CACHE_ENTRIES = 64;
export const TEXT_LINE_DETACHMENT_SOURCE_MIN_LENGTH = 64 * 1024;
export const TEXT_LINE_DETACHMENT_MAX_LINE_LENGTH = 16 * 1024;

export interface TextViewerBounds {
  maxBytes?: number;
  maxLines?: number;
}

export type TextViewerTooLargeReason = "bytes" | "lines";
export type TextViewerBoundName = "maxBytes" | "maxLines";

export class TextViewerTooLargeError extends ViewerFormatError {
  readonly reason: TextViewerTooLargeReason;

  constructor(reason: TextViewerTooLargeReason) {
    super({
      format: "text",
      kind: "bounds",
      message: `Text file exceeds ${reason} limit`,
    });
    this.name = "TextViewerTooLargeError";
    this.reason = reason;
  }
}

export class TextViewerInvalidBoundsError extends ViewerFormatError {
  readonly boundName: TextViewerBoundName;

  constructor(boundName: TextViewerBoundName) {
    super({
      format: "text",
      kind: "bounds",
      message: `${boundName} must be a positive integer`,
    });
    this.name = "TextViewerInvalidBoundsError";
    this.boundName = boundName;
  }
}

export function toTextFormatError(
  error: unknown,
  options: ViewerFormatErrorMapperOptions = {
    kind: "load_failed",
    message: "Failed to load text.",
  },
): ViewerFormatError {
  if (isViewerFormatError(error)) return error;
  return new ViewerFormatError({
    format: "text",
    kind: options.kind,
    message: options.message,
    cause: error,
  });
}

export interface PreparedTextDocument {
  text: string;
  lines: readonly string[];
  lineCount: number;
}

interface TextResource {
  promise: Promise<PreparedTextDocument>;
  status: "pending" | "resolved" | "rejected";
  value?: PreparedTextDocument;
  error?: unknown;
}

const textResourceCache = new Map<string, TextResource>();

export type TextViewerContent = ViewerContentIdentity &
  ViewerContentPayload &
  ViewerContentText;

function textViewerResourceKey({
  content,
  retryVersion,
  bounds,
}: {
  content: ViewerContentIdentity;
  retryVersion: number;
  bounds: Required<TextViewerBounds>;
}) {
  return `${content.key}\0${retryVersion}\0${bounds.maxBytes}\0${bounds.maxLines}`;
}

export function clearTextViewerResourceCacheForTests() {
  textResourceCache.clear();
}

export function resolvedTextViewerBounds({
  maxBytes = DEFAULT_MAX_BYTES,
  maxLines = DEFAULT_MAX_LINES,
}: TextViewerBounds = {}): Required<TextViewerBounds> {
  return {
    maxBytes: resolveTextViewerBound(maxBytes, "maxBytes"),
    maxLines: resolveTextViewerBound(maxLines, "maxLines"),
  };
}

export function assertTextWithinBounds(
  text: string,
  bounds: Required<TextViewerBounds>,
) {
  prepareTextDocument(text, bounds);
}

// Split into stable source lines. The prose viewer may wrap each source line
// into several visual lines, but highlighting and scroll APIs stay source-line
// based.
export function splitTextLines(text: string) {
  return splitTextLinesForDocument(text).lines;
}

export function shouldDetachTextLine({
  lineLength,
  sourceLength,
}: {
  lineLength: number;
  sourceLength: number;
}) {
  return (
    sourceLength >= TEXT_LINE_DETACHMENT_SOURCE_MIN_LENGTH &&
    lineLength > 0 &&
    lineLength <= TEXT_LINE_DETACHMENT_MAX_LINE_LENGTH
  );
}

export function detachTextLine(line: string) {
  return line.length === 0 ? line : ` ${line}`.slice(1);
}

export function readTextResource({
  content,
  retryVersion,
  bounds,
}: {
  content: TextViewerContent;
  retryVersion: number;
  bounds: Required<TextViewerBounds>;
}) {
  return readTextDocument({ content, retryVersion, bounds }).text;
}

export function readTextDocument({
  content,
  retryVersion,
  bounds,
}: {
  content: TextViewerContent;
  retryVersion: number;
  bounds: Required<TextViewerBounds>;
}): PreparedTextDocument {
  const resourceKey = textViewerResourceKey({ content, retryVersion, bounds });
  const inlineText = inlineTextResource(content);
  if (inlineText != null) {
    return getInlineTextDocument({
      bounds,
      resourceKey,
      text: inlineText,
    });
  }

  const textResource = getTextResource({ content, resourceKey, bounds });

  if (textResource.status === "resolved") {
    return textResource.value ?? emptyPreparedTextDocument(bounds);
  }
  if (textResource.status === "rejected") throw textResource.error;

  throw textResource.promise;
}

export function prepareTextDocument(
  text: string,
  bounds: Required<TextViewerBounds>,
  options: { isByteLengthChecked?: boolean } = {},
): PreparedTextDocument {
  if (
    !options.isByteLengthChecked &&
    new TextEncoder().encode(text).byteLength > bounds.maxBytes
  ) {
    throw new TextViewerTooLargeError("bytes");
  }

  const lines = splitTextLinesForDocument(text, {
    maxLines: bounds.maxLines,
  }).lines;

  return {
    lineCount: lines.length,
    lines,
    text,
  };
}

function inlineTextResource(content: ViewerContentPayload) {
  return content.payload.kind === "text" ? content.payload.text : null;
}

function splitTextLinesForDocument(
  text: string,
  options: { maxLines?: number } = {},
) {
  const maxLines = options.maxLines ?? Number.POSITIVE_INFINITY;
  const lines: string[] = [];
  let lineStart = 0;

  for (let index = 0; index < text.length; index += 1) {
    const breakLength = textLineBreakLength(text, index);
    if (breakLength === 0) continue;

    appendTextLine(lines, text, lineStart, index, maxLines);
    index += breakLength - 1;
    lineStart = index + 1;
  }

  appendTextLine(lines, text, lineStart, text.length, maxLines);
  return { lines };
}

function appendTextLine(
  lines: string[],
  text: string,
  start: number,
  end: number,
  maxLines: number,
) {
  if (lines.length >= maxLines) {
    throw new TextViewerTooLargeError("lines");
  }

  const line = text.slice(start, end);
  lines.push(
    shouldDetachTextLine({
      lineLength: end - start,
      sourceLength: text.length,
    })
      ? detachTextLine(line)
      : line,
  );
}

function textLineBreakLength(text: string, index: number) {
  const code = text.charCodeAt(index);
  if (code === 0x0d) {
    return text.charCodeAt(index + 1) === 0x0a ? 2 : 1;
  }
  return code === 0x0a || code === 0x2028 || code === 0x2029 ? 1 : 0;
}

function getInlineTextDocument({
  bounds,
  resourceKey,
  text,
}: {
  bounds: Required<TextViewerBounds>;
  resourceKey: string;
  text: string;
}) {
  const cached = textResourceCache.get(resourceKey);
  if (cached?.status === "resolved" && cached.value) return cached.value;

  const document = prepareTextDocument(text, bounds);
  textResourceCache.set(resourceKey, {
    promise: Promise.resolve(document),
    status: "resolved",
    value: document,
  });
  trimTextResourceCache();
  return document;
}

function getTextResource({
  content,
  resourceKey,
  bounds,
}: {
  content: TextViewerContent;
  resourceKey: string;
  bounds: Required<TextViewerBounds>;
}) {
  let textResource = textResourceCache.get(resourceKey);
  if (!textResource) {
    const nextResource: TextResource = {
      status: "pending",
      promise: readBoundedTextResource(content, bounds).then((text) =>
        prepareTextDocument(text, bounds, { isByteLengthChecked: true }),
      ),
    };
    nextResource.promise.then(
      (value) => {
        nextResource.status = "resolved";
        nextResource.value = value;
      },
      (error) => {
        nextResource.status = "rejected";
        nextResource.error = error;
      },
    );
    textResource = nextResource;
    textResourceCache.set(resourceKey, textResource);
    trimTextResourceCache();
  }
  return textResource;
}

async function readBoundedTextResource(
  content: ViewerContentText,
  bounds: Required<TextViewerBounds>,
) {
  try {
    return await content.readText(bounds);
  } catch (error) {
    if (isResourceError(error)) throw error;
    throw toTextFormatError(error);
  }
}

function emptyPreparedTextDocument(
  bounds: Required<TextViewerBounds>,
): PreparedTextDocument {
  return prepareTextDocument("", bounds);
}

function resolveTextViewerBound(value: number, boundName: TextViewerBoundName) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TextViewerInvalidBoundsError(boundName);
  }
  return value;
}

function trimTextResourceCache() {
  while (textResourceCache.size > MAX_TEXT_RESOURCE_CACHE_ENTRIES) {
    const firstKey = textResourceCache.keys().next().value;
    if (firstKey === undefined) return;
    textResourceCache.delete(firstKey);
  }
}
