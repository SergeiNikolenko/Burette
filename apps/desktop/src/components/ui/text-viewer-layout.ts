"use client";

import {
  layoutNextLineRange,
  materializeLineRange,
  measureLineStats,
  measureNaturalWidth,
  prepareWithSegments,
  type LayoutCursor,
  type LayoutLine,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
  type PreparedRichInline,
  type RichInlineCursor,
  type RichInlineLine,
} from "@chenglou/pretext/rich-inline";
import { marked, type Token, type Tokens } from "marked";

import { splitTextLines } from "./text-viewer-resource";

export type TextViewerMode = "markdown" | "text";

export interface TextStyleConfig {
  fontEpoch?: number;
  fontScale: number;
}

export interface PreparedTextDocument {
  blocks: PreparedTextBlock[];
  mode: TextViewerMode;
  sourceLineCount: number;
  wordCount: number;
}

export type PreparedTextBlock =
  | PreparedInlineTextBlock
  | PreparedCodeTextBlock
  | PreparedImageTextBlock
  | PreparedRuleTextBlock
  | PreparedTableTextBlock;

export interface PreparedTextBlockBase {
  contentLeft: number;
  listDepth: number;
  marginTop: number;
  markerClassName: string | null;
  markerLeft: number | null;
  markerText: string | null;
  quoteDepth: number;
  quoteRailLefts: number[];
  sourceEndLine: number;
  sourceStartLine: number;
}

export interface PreparedInlineTextBlock extends PreparedTextBlockBase {
  classNames: string[];
  fallbackText: string;
  flow: PreparedRichInline | null;
  fonts: string[];
  headingId: string | null;
  hrefs: Array<string | null>;
  kind: "inline";
  lineHeight: number;
  texts: string[];
  titles: Array<string | null>;
  variant: InlineVariant;
}

export interface PreparedCodeTextBlock extends PreparedTextBlockBase {
  fallbackText: string;
  font: string;
  kind: "code";
  language: string | null;
  lineHeight: number;
  prepared: PreparedTextWithSegments | null;
}

export interface PreparedImageTextBlock extends PreparedTextBlockBase {
  alt: string;
  href: string | null;
  kind: "image";
  src: string | null;
  title: string | null;
}

export interface PreparedRuleTextBlock extends PreparedTextBlockBase {
  height: number;
  kind: "rule";
}

export interface PreparedTableTextBlock extends PreparedTextBlockBase {
  alignments: TableColumnAlignment[];
  columnWidths: number[];
  header: PreparedTableCell[];
  kind: "table";
  rowSourceStartLines: number[];
  rows: PreparedTableCell[][];
}

export interface PreparedTableCell {
  className: string;
  href: string | null;
  text: string;
  title: string | null;
}

export interface TextDocumentFrame {
  frames: TextBlockFrame[];
  totalHeight: number;
  width: number;
}

export type TextBlockFrame =
  | InlineTextBlockFrame
  | CodeTextBlockFrame
  | ImageTextBlockFrame
  | RuleTextBlockFrame
  | TableTextBlockFrame;

interface TextBlockFrameBase {
  blockIndex: number;
  bottom: number;
  contentLeft: number;
  height: number;
  listDepth: number;
  markerClassName: string | null;
  markerLeft: number | null;
  markerText: string | null;
  quoteDepth: number;
  quoteRailLefts: number[];
  sourceEndLine: number;
  sourceStartLine: number;
  scale: number;
  top: number;
}

export interface InlineTextBlockFrame extends TextBlockFrameBase {
  kind: "inline";
  lineCount: number;
  lineHeight: number;
  usedWidth: number;
}

export interface CodeTextBlockFrame extends TextBlockFrameBase {
  kind: "code";
  language: string | null;
  lineCount: number;
  lineHeight: number;
  width: number;
}

export interface ImageTextBlockFrame extends TextBlockFrameBase {
  alt: string;
  imageHeight: number;
  imageWidth: number;
  kind: "image";
}

export interface RuleTextBlockFrame extends TextBlockFrameBase {
  kind: "rule";
  width: number;
}

export interface TableTextBlockFrame extends TextBlockFrameBase {
  columnWidths: number[];
  headerHeight: number;
  kind: "table";
  rowHeights: number[];
  rowOffsets: number[];
  rowCount: number;
  rowSourceStartLines: number[];
  tableWidth: number;
}

export interface InlineFragmentLayout {
  className: string;
  font: string;
  href: string | null;
  leadingGap: number;
  text: string;
  title: string | null;
}

export interface InlineLineLayout {
  fragments: InlineFragmentLayout[];
  lineIndex: number;
  top: number;
  width: number;
}

export interface CodeLineLayout {
  lineIndex: number;
  line: LayoutLine;
  top: number;
}

export interface TextLineWindow {
  firstLine: number;
  lastLine: number;
}

export type TableColumnAlignment = "center" | "left" | "right";

export interface TableRowWindow {
  afterHeight: number;
  beforeHeight: number;
  endIndex: number;
  startIndex: number;
}

type InlineVariant = "body" | "heading-1" | "heading-2";

type MarkState = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  href: string | null;
  title: string | null;
};

type ParseContext = {
  listDepth: number;
  quoteDepth: number;
};

type HeadingIdRegistry = Map<string, number>;

type InlinePiece = {
  breakMode: "never" | "normal";
  className: string;
  extraWidth: number;
  font: string;
  href: string | null;
  text: string;
  title: string | null;
};

const BODY_FONT_PX = 15;
const BODY_LINE_PX = 24;
const HEADING_ONE_FONT_PX = 22;
const HEADING_ONE_LINE_PX = 32;
const HEADING_TWO_FONT_PX = 18;
const HEADING_TWO_LINE_PX = 28;
const CODE_FONT_PX = 13;
const CODE_LINE_PX = 20;
const MARKER_FONT_PX = 12;
const CHIP_FONT_PX = 12;
const INLINE_CODE_EXTRA_WIDTH = 12;
const IMAGE_EXTRA_WIDTH = 16;
const CODE_BLOCK_PADDING_X = 12;
const CODE_BLOCK_PADDING_Y = 10;
const DOCUMENT_PADDING_Y = 16;
const BLOCK_GAP = 12;
const RICH_BLOCK_GAP = 6;
const HARD_BREAK_GAP = 4;
const LIST_ITEM_GAP = 4;
const LIST_MARKER_GAP = 10;
const LIST_NESTING_INDENT = 20;
const BLOCKQUOTE_INDENT = 18;
const RAIL_OFFSET = 5;
const RULE_HEIGHT = 20;
const IMAGE_BLOCK_HEIGHT = 220;
const IMAGE_BLOCK_MAX_WIDTH = 720;
const IMAGE_BLOCK_MIN_WIDTH = 220;
const IMAGE_PLACEHOLDER_HEIGHT = 72;
const TABLE_CELL_FONT_PX = 13;
const TABLE_CELL_PADDING_X = 14;
const TABLE_COLUMN_MIN_WIDTH = 72;
const TABLE_COLUMN_MAX_WIDTH = 320;
const TABLE_HEADER_HEIGHT = 38;
const TABLE_ROW_MIN_HEIGHT = 34;
const TABLE_ROW_LINE_HEIGHT = 20;
const TABLE_ROW_OVERSCAN = 4;
const HARD_WRAPPED_LINE_MIN_LENGTH = 52;
const HARD_WRAPPED_RUN_AVERAGE_LENGTH = 64;
const SANS_FAMILY = "Arial, Helvetica, sans-serif";
const SERIF_FAMILY = "Georgia, Times New Roman, serif";
const MONO_FAMILY = '"SF Mono", Menlo, Monaco, Consolas, monospace';
const EMPTY_MARK_STATE: MarkState = {
  bold: false,
  href: null,
  italic: false,
  strike: false,
  title: null,
};
const PREPARED_TEXT_DOCUMENT_CACHE_LIMIT = 32;
const PREPARED_TEXT_DOCUMENT_CACHE_VERSION = "prepared-text-v1";
const TEXT_DOCUMENT_FRAME_CACHE_LIMIT = 12;
const LINE_RANGE_WIDTH_CACHE_LIMIT = 8;
const LINE_RANGE_MATERIALIZED_LINE_CACHE_LIMIT = 1024;
const LINE_RANGE_CHECKPOINT_CACHE_LIMIT = 128;
const LINE_RANGE_CHECKPOINT_INTERVAL = 64;
const markerWidthCache = new Map<string, number>();
const preparedTextDocumentCache = new Map<string, PreparedTextDocument>();
const preparedTextLineSourceIds = new WeakMap<readonly string[], number>();
const textDocumentFrameCache = new WeakMap<
  PreparedTextDocument,
  Map<string, TextDocumentFrame>
>();
const inlineLineRangeCaches = new WeakMap<
  PreparedInlineTextBlock,
  Map<string, RichInlineLineRangeCache>
>();
const codeLineRangeCaches = new WeakMap<
  PreparedCodeTextBlock,
  Map<string, CodeLineRangeCache>
>();
let nextPreparedTextLineSourceId = 1;

type RichInlineLineRangeCache = {
  checkpoints: Array<LineRangeCheckpoint<RichInlineCursor>>;
  lines: Map<number, RichInlineLine>;
};

type CodeLineRangeCache = {
  checkpoints: Array<LineRangeCheckpoint<LayoutCursor>>;
  lines: Map<number, LayoutLine>;
};

type LineRangeCheckpoint<Cursor> = {
  cursor: Cursor;
  lineIndex: number;
};

export function resolveTextViewerMode({
  fileName,
  mimeType,
}: {
  fileName: string;
  mimeType?: string;
}): TextViewerMode {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType?.toLowerCase().split(";")[0].trim();
  return lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerMime === "text/markdown"
    ? "markdown"
    : "text";
}

export function createPreparedTextDocument({
  lines,
  mode,
  text,
  style,
}: {
  lines?: readonly string[];
  mode: TextViewerMode;
  text: string;
  style: TextStyleConfig;
}): PreparedTextDocument {
  const sourceLines = mode === "text" ? lines : undefined;
  const cacheKey = preparedTextDocumentCacheKey({
    lines: sourceLines,
    mode,
    text,
    style,
  });
  const cached = preparedTextDocumentCache.get(cacheKey);
  if (cached) {
    preparedTextDocumentCache.delete(cacheKey);
    preparedTextDocumentCache.set(cacheKey, cached);
    return cached;
  }

  const document = createUncachedPreparedTextDocument({
    lines: sourceLines,
    mode,
    text,
    style,
  });
  preparedTextDocumentCache.set(cacheKey, document);
  trimPreparedTextDocumentCache();
  return document;
}

export function clearPreparedTextDocumentCacheForTests() {
  preparedTextDocumentCache.clear();
}

function createUncachedPreparedTextDocument({
  lines,
  mode,
  text,
  style,
}: {
  lines?: readonly string[];
  mode: TextViewerMode;
  text: string;
  style: TextStyleConfig;
}): PreparedTextDocument {
  const sourceLines = mode === "text" ? lines : undefined;
  const sourceLineCount = sourceLines?.length ?? splitTextLines(text).length;
  const blocks =
    mode === "markdown"
      ? parseMarkdownBlocks(text, style)
      : buildPlainTextBlocks(sourceLines ?? splitTextLines(text), style);

  return {
    blocks,
    mode,
    sourceLineCount,
    wordCount: sourceLines
      ? countTextLineWords(sourceLines)
      : countTextWords(text),
  };
}

function preparedTextDocumentCacheKey({
  lines,
  mode,
  text,
  style,
}: {
  lines?: readonly string[];
  mode: TextViewerMode;
  text: string;
  style: TextStyleConfig;
}) {
  const sourceKey = lines
    ? ["lines", preparedTextLineSourceId(lines), lines.length]
    : ["text", text.length, hashTextForPreparedDocument(text)];
  return [
    PREPARED_TEXT_DOCUMENT_CACHE_VERSION,
    mode,
    style.fontEpoch ?? 0,
    safeScale(style.fontScale),
    ...sourceKey,
  ].join("\u0000");
}

function preparedTextLineSourceId(lines: readonly string[]) {
  const cached = preparedTextLineSourceIds.get(lines);
  if (cached !== undefined) return cached;

  const id = nextPreparedTextLineSourceId;
  nextPreparedTextLineSourceId += 1;
  preparedTextLineSourceIds.set(lines, id);
  return id;
}

function trimPreparedTextDocumentCache() {
  while (preparedTextDocumentCache.size > PREPARED_TEXT_DOCUMENT_CACHE_LIMIT) {
    const firstKey = preparedTextDocumentCache.keys().next().value;
    if (firstKey === undefined) return;
    preparedTextDocumentCache.delete(firstKey);
  }
}

function getTextDocumentFrameCache(document: PreparedTextDocument) {
  let cache = textDocumentFrameCache.get(document);
  if (!cache) {
    cache = new Map();
    textDocumentFrameCache.set(document, cache);
  }
  return cache;
}

function textDocumentFrameCacheKey({
  contentWidth,
  fontScale,
}: {
  contentWidth: number;
  fontScale: number;
}) {
  return [contentWidth, fontScale].join("\u0000");
}

function getRichInlineLineRangeCache(
  block: PreparedInlineTextBlock,
  lineWidth: number,
) {
  let blockCache = inlineLineRangeCaches.get(block);
  if (!blockCache) {
    blockCache = new Map();
    inlineLineRangeCaches.set(block, blockCache);
  }

  const cacheKey = textLineWidthCacheKey(lineWidth);
  let cache = blockCache.get(cacheKey);
  if (cache) {
    setBoundedCacheEntry(
      blockCache,
      cacheKey,
      cache,
      LINE_RANGE_WIDTH_CACHE_LIMIT,
    );
    return cache;
  }

  cache = {
    checkpoints: [
      {
        cursor: { graphemeIndex: 0, itemIndex: 0, segmentIndex: 0 },
        lineIndex: 0,
      },
    ],
    lines: new Map(),
  };
  setBoundedCacheEntry(
    blockCache,
    cacheKey,
    cache,
    LINE_RANGE_WIDTH_CACHE_LIMIT,
  );
  return cache;
}

function getCodeLineRangeCache(
  block: PreparedCodeTextBlock,
  innerWidth: number,
) {
  let blockCache = codeLineRangeCaches.get(block);
  if (!blockCache) {
    blockCache = new Map();
    codeLineRangeCaches.set(block, blockCache);
  }

  const cacheKey = textLineWidthCacheKey(innerWidth);
  let cache = blockCache.get(cacheKey);
  if (cache) {
    setBoundedCacheEntry(
      blockCache,
      cacheKey,
      cache,
      LINE_RANGE_WIDTH_CACHE_LIMIT,
    );
    return cache;
  }

  cache = {
    checkpoints: [
      {
        cursor: { graphemeIndex: 0, segmentIndex: 0 },
        lineIndex: 0,
      },
    ],
    lines: new Map(),
  };
  setBoundedCacheEntry(
    blockCache,
    cacheKey,
    cache,
    LINE_RANGE_WIDTH_CACHE_LIMIT,
  );
  return cache;
}

function textLineWidthCacheKey(width: number) {
  return String(width);
}

function setBoundedCacheEntry<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  limit: number,
) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const firstKey = cache.keys().next().value;
    if (firstKey === undefined) return;
    cache.delete(firstKey);
  }
}

function touchCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V) {
  cache.delete(key);
  cache.set(key, value);
}

function trimMaterializedLineCache<Line>(cache: Map<number, Line>) {
  while (cache.size > LINE_RANGE_MATERIALIZED_LINE_CACHE_LIMIT) {
    const firstKey = cache.keys().next().value;
    if (firstKey === undefined) return;
    cache.delete(firstKey);
  }
}

function nearestLineRangeCheckpoint<Cursor>(
  checkpoints: readonly LineRangeCheckpoint<Cursor>[],
  lineIndex: number,
) {
  let low = 0;
  let high = checkpoints.length - 1;
  let match = checkpoints[0]!;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const checkpoint = checkpoints[middle]!;
    if (checkpoint.lineIndex <= lineIndex) {
      match = checkpoint;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return match;
}

function maybeStoreLineRangeCheckpoint<Cursor>(
  checkpoints: Array<LineRangeCheckpoint<Cursor>>,
  lineIndex: number,
  cursor: Cursor,
  force = false,
) {
  if (
    !force &&
    (lineIndex === 0 || lineIndex % LINE_RANGE_CHECKPOINT_INTERVAL !== 0)
  ) {
    return;
  }

  let low = 0;
  let high = checkpoints.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const checkpoint = checkpoints[middle]!;
    if (checkpoint.lineIndex === lineIndex) {
      checkpoints[middle] = { cursor, lineIndex };
      return;
    }
    if (checkpoint.lineIndex < lineIndex) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  checkpoints.splice(low, 0, { cursor, lineIndex });
  while (checkpoints.length > LINE_RANGE_CHECKPOINT_CACHE_LIMIT) {
    checkpoints.splice(checkpoints.length > 1 ? 1 : 0, 1);
  }
}

function cloneLayoutCursor(cursor: LayoutCursor): LayoutCursor {
  return {
    graphemeIndex: cursor.graphemeIndex,
    segmentIndex: cursor.segmentIndex,
  };
}

function cloneRichInlineCursor(cursor: RichInlineCursor): RichInlineCursor {
  return {
    graphemeIndex: cursor.graphemeIndex,
    itemIndex: cursor.itemIndex,
    segmentIndex: cursor.segmentIndex,
  };
}

export function layoutTextDocument({
  contentWidth,
  document,
  fontScale = 1,
}: {
  contentWidth: number;
  document: PreparedTextDocument;
  fontScale?: number;
}): TextDocumentFrame {
  const safeContentWidth = safeWidth(contentWidth);
  const safeFontScale = safeScale(fontScale);
  const cacheKey = textDocumentFrameCacheKey({
    contentWidth: safeContentWidth,
    fontScale: safeFontScale,
  });
  const cachedFrame = getTextDocumentFrameCache(document).get(cacheKey);
  if (cachedFrame) return cachedFrame;

  const frames: TextBlockFrame[] = [];
  let y = DOCUMENT_PADDING_Y;

  for (let index = 0; index < document.blocks.length; index++) {
    const block = document.blocks[index]!;
    y += block.marginTop;
    const frame = layoutTextBlock({
      block,
      blockIndex: index,
      contentWidth: safeContentWidth,
      scale: safeFontScale,
      top: y,
    });
    frames.push(frame);
    y = frame.bottom;
  }

  const frame = {
    frames,
    totalHeight: y + DOCUMENT_PADDING_Y,
    width: safeContentWidth,
  };
  setBoundedCacheEntry(
    getTextDocumentFrameCache(document),
    cacheKey,
    frame,
    TEXT_DOCUMENT_FRAME_CACHE_LIMIT,
  );
  return frame;
}

export function materializeInlineVisibleLines({
  block,
  frame,
  lineWindow,
  maxWidth,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedInlineTextBlock;
  frame: InlineTextBlockFrame;
  lineWindow?: TextLineWindow | null;
  maxWidth: number;
  viewportBottom: number;
  viewportTop: number;
}): InlineLineLayout[] {
  const window =
    lineWindow ??
    getInlineVisibleLineWindow({ frame, viewportBottom, viewportTop });
  if (!window) return [];

  if (!block.flow) {
    return [
      {
        fragments: fallbackInlineFragments(block),
        lineIndex: 0,
        top: 0,
        width: frame.usedWidth,
      },
    ];
  }

  const lineWidth = safeWidth((maxWidth - frame.contentLeft) / frame.scale);
  return getRichInlineMaterializedLineWindow({
    block,
    lineWidth,
    window,
  }).map(({ line, lineIndex }) => ({
    fragments: richInlineFragments(block, line),
    lineIndex,
    top: lineIndex * frame.lineHeight,
    width: line.width * frame.scale,
  }));
}

export function materializeCodeVisibleLines({
  block,
  contentWidth,
  frame,
  lineWindow,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedCodeTextBlock;
  contentWidth: number;
  frame: CodeTextBlockFrame;
  lineWindow?: TextLineWindow | null;
  viewportBottom: number;
  viewportTop: number;
}): CodeLineLayout[] {
  const window =
    lineWindow ??
    getCodeVisibleLineWindow({ frame, viewportBottom, viewportTop });
  if (!window) return [];

  if (!block.prepared) {
    return [
      {
        lineIndex: 0,
        line: {
          end: { graphemeIndex: 0, segmentIndex: 0 },
          start: { graphemeIndex: 0, segmentIndex: 0 },
          text: block.fallbackText,
          width: frame.width,
        },
        top: CODE_BLOCK_PADDING_Y,
      },
    ];
  }

  const boxWidth = safeWidth(contentWidth - frame.contentLeft);
  const innerWidth = safeWidth(
    (boxWidth - CODE_BLOCK_PADDING_X * 2) / frame.scale,
  );
  return getCodeMaterializedLineWindow({
    block,
    innerWidth,
    window,
  }).map(({ line, lineIndex }) => ({
    lineIndex,
    line,
    top: CODE_BLOCK_PADDING_Y + lineIndex * frame.lineHeight,
  }));
}

function getRichInlineMaterializedLineWindow({
  block,
  lineWidth,
  window,
}: {
  block: PreparedInlineTextBlock;
  lineWidth: number;
  window: TextLineWindow;
}) {
  if (!block.flow) return [];

  const cache = getRichInlineLineRangeCache(block, lineWidth);
  const materializedLines = new Map<number, RichInlineLine>();
  let firstMissing = Number.POSITIVE_INFINITY;
  let lastMissing = -1;

  for (
    let lineIndex = window.firstLine;
    lineIndex <= window.lastLine;
    lineIndex++
  ) {
    const cachedLine = cache.lines.get(lineIndex);
    if (cachedLine) {
      touchCacheEntry(cache.lines, lineIndex, cachedLine);
      materializedLines.set(lineIndex, cachedLine);
      continue;
    }

    firstMissing = Math.min(firstMissing, lineIndex);
    lastMissing = lineIndex;
  }

  if (lastMissing >= firstMissing) {
    fillRichInlineMaterializedLineCache({
      cache,
      flow: block.flow,
      lineWidth,
      materializedLines,
      window: {
        firstLine: firstMissing,
        lastLine: lastMissing,
      },
    });
  }

  const lines: Array<{ line: RichInlineLine; lineIndex: number }> = [];
  for (
    let lineIndex = window.firstLine;
    lineIndex <= window.lastLine;
    lineIndex++
  ) {
    const line = materializedLines.get(lineIndex);
    if (line) lines.push({ line, lineIndex });
  }

  trimMaterializedLineCache(cache.lines);
  return lines;
}

function fillRichInlineMaterializedLineCache({
  cache,
  flow,
  lineWidth,
  materializedLines,
  window,
}: {
  cache: RichInlineLineRangeCache;
  flow: PreparedRichInline;
  lineWidth: number;
  materializedLines: Map<number, RichInlineLine>;
  window: TextLineWindow;
}) {
  const checkpoint = nearestLineRangeCheckpoint(
    cache.checkpoints,
    window.firstLine,
  );
  let cursor = cloneRichInlineCursor(checkpoint.cursor);

  for (
    let lineIndex = checkpoint.lineIndex;
    lineIndex <= window.lastLine;
    lineIndex++
  ) {
    const cachedLine = cache.lines.get(lineIndex);
    if (cachedLine) {
      cursor = cloneRichInlineCursor(cachedLine.end);
      if (lineIndex >= window.firstLine) {
        touchCacheEntry(cache.lines, lineIndex, cachedLine);
        materializedLines.set(lineIndex, cachedLine);
      }
      maybeStoreLineRangeCheckpoint(
        cache.checkpoints,
        lineIndex + 1,
        cloneRichInlineCursor(cachedLine.end),
        true,
      );
      continue;
    }

    const range = layoutNextRichInlineLineRange(flow, lineWidth, cursor);
    if (!range) return;

    const nextCursor = cloneRichInlineCursor(range.end);
    const nextLineIndex = lineIndex + 1;
    if (lineIndex >= window.firstLine) {
      const line = materializeRichInlineLineRange(flow, range);
      cache.lines.set(lineIndex, line);
      materializedLines.set(lineIndex, line);
      maybeStoreLineRangeCheckpoint(
        cache.checkpoints,
        lineIndex,
        cloneRichInlineCursor(cursor),
        true,
      );
    }
    maybeStoreLineRangeCheckpoint(
      cache.checkpoints,
      nextLineIndex,
      nextCursor,
      lineIndex >= window.firstLine,
    );
    cursor = nextCursor;
  }
}

function getCodeMaterializedLineWindow({
  block,
  innerWidth,
  window,
}: {
  block: PreparedCodeTextBlock;
  innerWidth: number;
  window: TextLineWindow;
}) {
  if (!block.prepared) return [];

  const cache = getCodeLineRangeCache(block, innerWidth);
  const materializedLines = new Map<number, LayoutLine>();
  let firstMissing = Number.POSITIVE_INFINITY;
  let lastMissing = -1;

  for (
    let lineIndex = window.firstLine;
    lineIndex <= window.lastLine;
    lineIndex++
  ) {
    const cachedLine = cache.lines.get(lineIndex);
    if (cachedLine) {
      touchCacheEntry(cache.lines, lineIndex, cachedLine);
      materializedLines.set(lineIndex, cachedLine);
      continue;
    }

    firstMissing = Math.min(firstMissing, lineIndex);
    lastMissing = lineIndex;
  }

  if (lastMissing >= firstMissing) {
    fillCodeMaterializedLineCache({
      cache,
      innerWidth,
      materializedLines,
      prepared: block.prepared,
      window: {
        firstLine: firstMissing,
        lastLine: lastMissing,
      },
    });
  }

  const lines: Array<{ line: LayoutLine; lineIndex: number }> = [];
  for (
    let lineIndex = window.firstLine;
    lineIndex <= window.lastLine;
    lineIndex++
  ) {
    const line = materializedLines.get(lineIndex);
    if (line) lines.push({ line, lineIndex });
  }

  trimMaterializedLineCache(cache.lines);
  return lines;
}

function fillCodeMaterializedLineCache({
  cache,
  innerWidth,
  materializedLines,
  prepared,
  window,
}: {
  cache: CodeLineRangeCache;
  innerWidth: number;
  materializedLines: Map<number, LayoutLine>;
  prepared: PreparedTextWithSegments;
  window: TextLineWindow;
}) {
  const checkpoint = nearestLineRangeCheckpoint(
    cache.checkpoints,
    window.firstLine,
  );
  let cursor = cloneLayoutCursor(checkpoint.cursor);

  for (
    let lineIndex = checkpoint.lineIndex;
    lineIndex <= window.lastLine;
    lineIndex++
  ) {
    const cachedLine = cache.lines.get(lineIndex);
    if (cachedLine) {
      cursor = cloneLayoutCursor(cachedLine.end);
      if (lineIndex >= window.firstLine) {
        touchCacheEntry(cache.lines, lineIndex, cachedLine);
        materializedLines.set(lineIndex, cachedLine);
      }
      maybeStoreLineRangeCheckpoint(
        cache.checkpoints,
        lineIndex + 1,
        cloneLayoutCursor(cachedLine.end),
        true,
      );
      continue;
    }

    const range = layoutNextLineRange(prepared, cursor, innerWidth);
    if (!range) return;

    const nextCursor = cloneLayoutCursor(range.end);
    const nextLineIndex = lineIndex + 1;
    if (lineIndex >= window.firstLine) {
      const line = materializeLineRange(prepared, range);
      cache.lines.set(lineIndex, line);
      materializedLines.set(lineIndex, line);
      maybeStoreLineRangeCheckpoint(
        cache.checkpoints,
        lineIndex,
        cloneLayoutCursor(cursor),
        true,
      );
    }
    maybeStoreLineRangeCheckpoint(
      cache.checkpoints,
      nextLineIndex,
      nextCursor,
      lineIndex >= window.firstLine,
    );
    cursor = nextCursor;
  }
}

export function getInlineVisibleLineWindow({
  frame,
  viewportBottom,
  viewportTop,
}: {
  frame: InlineTextBlockFrame;
  viewportBottom: number;
  viewportTop: number;
}): TextLineWindow | null {
  return getVisibleLineWindow({
    lineCount: frame.lineCount,
    lineHeight: frame.lineHeight,
    originTop: frame.top,
    viewportBottom,
    viewportTop,
  });
}

export function getCodeVisibleLineWindow({
  frame,
  viewportBottom,
  viewportTop,
}: {
  frame: CodeTextBlockFrame;
  viewportBottom: number;
  viewportTop: number;
}): TextLineWindow | null {
  return getVisibleLineWindow({
    lineCount: frame.lineCount,
    lineHeight: frame.lineHeight,
    originTop: frame.top + CODE_BLOCK_PADDING_Y,
    viewportBottom,
    viewportTop,
  });
}

function getVisibleLineWindow({
  lineCount,
  lineHeight,
  originTop,
  viewportBottom,
  viewportTop,
}: {
  lineCount: number;
  lineHeight: number;
  originTop: number;
  viewportBottom: number;
  viewportTop: number;
}): TextLineWindow | null {
  const firstLine = Math.max(
    0,
    Math.floor((viewportTop - originTop) / lineHeight) - 1,
  );
  const lastLine = Math.min(
    lineCount - 1,
    Math.ceil((viewportBottom - originTop) / lineHeight) + 1,
  );
  return lastLine < firstLine ? null : { firstLine, lastLine };
}

export function getTableVisibleRowWindow({
  frame,
  viewportBottom,
  viewportTop,
}: {
  frame: TableTextBlockFrame;
  viewportBottom: number;
  viewportTop: number;
}): TableRowWindow {
  const relativeTop = viewportTop - frame.top - frame.headerHeight;
  const relativeBottom = viewportBottom - frame.top - frame.headerHeight;
  const bodyHeight = frame.rowOffsets[frame.rowOffsets.length - 1] ?? 0;
  const startIndex = Math.max(
    0,
    findTableRowAtOffset(frame.rowOffsets, relativeTop) - TABLE_ROW_OVERSCAN,
  );
  const endIndex = Math.min(
    frame.rowCount,
    findTableRowEndAtOffset(frame.rowOffsets, relativeBottom) +
      TABLE_ROW_OVERSCAN,
  );
  return {
    afterHeight: Math.max(0, bodyHeight - (frame.rowOffsets[endIndex] ?? 0)),
    beforeHeight: frame.rowOffsets[startIndex] ?? 0,
    endIndex,
    startIndex,
  };
}

export function textFrameIntersectsLineRange({
  frame,
  range,
}: {
  frame: TextBlockFrame;
  range: { end: number; start: number } | null;
}) {
  return (
    range != null &&
    frame.sourceStartLine <= range.end &&
    frame.sourceEndLine >= range.start
  );
}

export function serializeMarkdownTableForClipboard(
  block: PreparedTableTextBlock,
) {
  const rows = [block.header, ...block.rows];
  return rows
    .map((row) => {
      return block.header
        .map((_headerCell, index) => tableClipboardCell(row[index]?.text ?? ""))
        .join("\t");
    })
    .join("\n");
}

function parseMarkdownBlocks(
  markdown: string,
  style: TextStyleConfig,
): PreparedTextBlock[] {
  const sourceEndLine = splitTextLines(markdown).length;
  try {
    const headingIds: HeadingIdRegistry = new Map();
    const frontmatter = extractMarkdownFrontmatter(markdown);
    if (frontmatter) {
      const blocks: PreparedTextBlock[] = [];
      appendBlockGroup(
        blocks,
        [
          buildCodeBlock({
            ctx: { listDepth: 0, quoteDepth: 0 },
            language: "yaml",
            sourceEndLine: frontmatter.endLine,
            sourceStartLine: 1,
            style,
            text: frontmatter.text,
          }),
        ],
        0,
      );
      appendBlockGroup(
        blocks,
        parseBlockTokens(marked.lexer(frontmatter.body, { gfm: true }), {
          ctx: { listDepth: 0, quoteDepth: 0 },
          headingIds,
          sourceEndLine,
          sourceStartLine: frontmatter.endLine + 1,
          style,
        }),
        BLOCK_GAP,
      );
      return blocks;
    }

    return parseBlockTokens(marked.lexer(markdown, { gfm: true }), {
      ctx: { listDepth: 0, quoteDepth: 0 },
      headingIds,
      sourceEndLine,
      sourceStartLine: 1,
      style,
    });
  } catch {
    return buildPlainTextBlocks(splitTextLines(markdown), style);
  }
}

function parseBlockTokens(
  tokens: readonly Token[],
  {
    ctx,
    headingIds,
    sourceEndLine,
    sourceStartLine,
    style,
  }: {
    ctx: ParseContext;
    headingIds: HeadingIdRegistry;
    sourceEndLine: number;
    sourceStartLine: number;
    style: TextStyleConfig;
  },
): PreparedTextBlock[] {
  const blocks: PreparedTextBlock[] = [];
  let cursorLine = sourceStartLine;

  for (const token of tokens) {
    // Advance by the number of line breaks the token's raw spans. `marked`
    // concatenates token raws to reconstruct the source, so this keeps the
    // cursor aligned even when a block's trailing newline is absorbed into the
    // following `space` token (a "\n\n" gap is two breaks, i.e. one blank line).
    const breaks = countSourceLineBreaks(token.raw);
    const tokenStartLine = Math.min(cursorLine, sourceEndLine);
    const tokenEndLine = Math.min(
      sourceEndLine,
      Math.max(
        tokenStartLine,
        cursorLine + breaks - (endsWithSourceLineBreak(token.raw) ? 1 : 0),
      ),
    );
    cursorLine += breaks;

    switch (token.type) {
      case "space":
      case "def":
        continue;

      case "paragraph":
        if (isStandaloneImageParagraph(token)) {
          appendBlockGroup(
            blocks,
            [
              buildImageBlock({
                ctx,
                sourceEndLine: tokenEndLine,
                sourceStartLine: tokenStartLine,
                token: token.tokens[0] as Tokens.Image,
              }),
            ],
            BLOCK_GAP,
          );
          continue;
        }
        appendBlockGroup(
          blocks,
          buildInlineBlocks({
            ctx,
            lines: collectInlinePieceLines(token.tokens ?? [], "body", style),
            sourceEndLine: tokenEndLine,
            sourceStartLine: tokenStartLine,
            style,
            variant: "body",
          }),
          BLOCK_GAP,
        );
        continue;

      case "heading": {
        const variant = headingVariant(token.depth);
        const lines = collectInlinePieceLines(
          token.tokens ?? [],
          variant,
          style,
        );
        appendBlockGroup(
          blocks,
          buildInlineBlocks({
            ctx,
            headingId: createMarkdownHeadingId(lines, headingIds),
            lines,
            sourceEndLine: tokenEndLine,
            sourceStartLine: tokenStartLine,
            style,
            variant,
          }),
          BLOCK_GAP + 4,
        );
        continue;
      }

      case "code":
        appendBlockGroup(
          blocks,
          [
            buildCodeBlock({
              ctx,
              language: sanitizeMarkdownLanguage(token.lang),
              sourceEndLine: tokenEndLine,
              sourceStartLine: tokenStartLine,
              style,
              text: token.text,
            }),
          ],
          RICH_BLOCK_GAP,
        );
        continue;

      case "list":
        appendBlockGroup(
          blocks,
          buildListBlocks({
            ctx,
            headingIds,
            sourceEndLine: tokenEndLine,
            sourceStartLine: tokenStartLine,
            style,
            token: token as Tokens.List,
          }),
          BLOCK_GAP,
        );
        continue;

      case "blockquote":
        appendBlockGroup(
          blocks,
          parseBlockTokens(token.tokens ?? [], {
            ctx: {
              listDepth: ctx.listDepth,
              quoteDepth: ctx.quoteDepth + 1,
            },
            headingIds,
            sourceEndLine: tokenEndLine,
            sourceStartLine: tokenStartLine,
            style,
          }),
          RICH_BLOCK_GAP,
        );
        continue;

      case "hr":
        appendBlockGroup(
          blocks,
          [
            buildRuleBlock({
              ctx,
              sourceEndLine: tokenEndLine,
              sourceStartLine: tokenStartLine,
            }),
          ],
          BLOCK_GAP + 2,
        );
        continue;

      case "table":
        appendBlockGroup(
          blocks,
          [
            buildTableBlock({
              ctx,
              sourceEndLine: tokenEndLine,
              sourceStartLine: tokenStartLine,
              token: token as Tokens.Table,
            }),
          ],
          RICH_BLOCK_GAP,
        );
        continue;

      case "html": {
        const htmlText = token.text.trim().length > 0 ? token.text : token.raw;
        if (token.block || ("pre" in token && token.pre === true)) {
          appendBlockGroup(
            blocks,
            [
              buildCodeBlock({
                ctx,
                language: null,
                sourceEndLine: tokenEndLine,
                sourceStartLine: tokenStartLine,
                style,
                text: htmlText,
              }),
            ],
            RICH_BLOCK_GAP,
          );
        } else {
          appendPlainTextFallback({
            blocks,
            ctx,
            sourceEndLine: tokenEndLine,
            sourceStartLine: tokenStartLine,
            style,
            text: htmlText,
          });
        }
        continue;
      }

      case "text":
        if (Array.isArray(token.tokens) && token.tokens.length > 0) {
          appendBlockGroup(
            blocks,
            buildInlineBlocks({
              ctx,
              lines: collectInlinePieceLines(token.tokens, "body", style),
              sourceEndLine: tokenEndLine,
              sourceStartLine: tokenStartLine,
              style,
              variant: "body",
            }),
            BLOCK_GAP,
          );
        } else {
          appendPlainTextFallback({
            blocks,
            ctx,
            sourceEndLine: tokenEndLine,
            sourceStartLine: tokenStartLine,
            style,
            text: token.text,
          });
        }
        continue;

      default: {
        const fallbackText = fallbackTextForToken(token);
        if (fallbackText) {
          appendPlainTextFallback({
            blocks,
            ctx,
            sourceEndLine: tokenEndLine,
            sourceStartLine: tokenStartLine,
            style,
            text: fallbackText,
          });
        }
      }
    }
  }

  return blocks;
}

function buildPlainTextBlocks(
  lines: readonly string[],
  style: TextStyleConfig,
): PreparedTextBlock[] {
  const blocks: PreparedTextBlock[] = [];
  let run: string[] = [];
  let runStartLine = 1;

  function appendLine(line: string, sourceLine: number) {
    blocks.push(buildPlainTextLineBlock(line, sourceLine, style));
  }

  function flushRun(endLine: number) {
    if (run.length === 0) return;
    if (shouldJoinPlainTextRun(run)) {
      blocks.push(
        buildInlineBlock({
          ctx: { listDepth: 0, quoteDepth: 0 },
          pieces: [
            createTextPiece(
              joinPlainTextRun(run),
              EMPTY_MARK_STATE,
              "body",
              style,
            )!,
          ],
          sourceEndLine: endLine,
          sourceStartLine: runStartLine,
          style,
          variant: "body",
        }),
      );
    } else {
      for (let index = 0; index < run.length; index++) {
        appendLine(run[index]!, runStartLine + index);
      }
    }
    run = [];
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const sourceLine = index + 1;
    if (line.trim() === "") {
      flushRun(sourceLine - 1);
      appendLine(" ", sourceLine);
      runStartLine = sourceLine + 1;
      continue;
    }
    if (run.length === 0) runStartLine = sourceLine;
    run.push(line);
  }

  flushRun(lines.length);
  return blocks;
}

function buildPlainTextLineBlock(
  line: string,
  sourceLine: number,
  style: TextStyleConfig,
): PreparedInlineTextBlock {
  return buildInlineBlock({
    ctx: { listDepth: 0, quoteDepth: 0 },
    pieces: [createTextPiece(line || " ", EMPTY_MARK_STATE, "body", style)!],
    sourceEndLine: sourceLine,
    sourceStartLine: sourceLine,
    style,
    variant: "body",
  });
}

function shouldJoinPlainTextRun(lines: readonly string[]) {
  if (lines.length < 2) return false;

  const trimmed = lines.map((line) => line.trim()).filter(Boolean);
  if (
    trimmed.length < 2 ||
    countRecordLikeLines(trimmed) > trimmed.length / 3
  ) {
    return false;
  }

  const lengths = trimmed.map((line) => line.length);
  const average =
    lengths.reduce((total, length) => total + length, 0) / lengths.length;
  if (average < HARD_WRAPPED_RUN_AVERAGE_LENGTH) return false;

  const internal = lengths.slice(0, -1);
  const shortInternalCount = internal.filter(
    (length) => length < HARD_WRAPPED_LINE_MIN_LENGTH,
  ).length;
  return shortInternalCount <= Math.floor(internal.length * 0.15);
}

function countRecordLikeLines(lines: readonly string[]) {
  return lines.reduce((count, line) => {
    return count + (isRecordLikePlainTextLine(line) ? 1 : 0);
  }, 0);
}

function isRecordLikePlainTextLine(line: string) {
  return (
    /^\d{4}-\d{2}-\d{2}(?:[T\s]|\b)/.test(line) ||
    /^\d{1,6}[:.)\]]\s/.test(line) ||
    /^[-*+]\s/.test(line) ||
    /^(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/.test(line) ||
    /\b(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/.test(line.slice(0, 80)) ||
    /^[{[]/.test(line)
  );
}

function joinPlainTextRun(lines: readonly string[]) {
  return lines.map((line) => line.trim()).join(" ");
}

function appendPlainTextFallback({
  blocks,
  ctx,
  sourceEndLine,
  sourceStartLine,
  style,
  text,
}: {
  blocks: PreparedTextBlock[];
  ctx: ParseContext;
  sourceEndLine: number;
  sourceStartLine: number;
  style: TextStyleConfig;
  text: string;
}) {
  appendBlockGroup(
    blocks,
    buildInlineBlocks({
      ctx,
      lines: [
        [createTextPiece(text, EMPTY_MARK_STATE, "body", style)].filter(
          Boolean,
        ) as InlinePiece[],
      ],
      sourceEndLine,
      sourceStartLine,
      style,
      variant: "body",
    }),
    BLOCK_GAP,
  );
}

function buildListBlocks({
  ctx,
  headingIds,
  sourceEndLine,
  sourceStartLine,
  style,
  token,
}: {
  ctx: ParseContext;
  headingIds: HeadingIdRegistry;
  sourceEndLine: number;
  sourceStartLine: number;
  style: TextStyleConfig;
  token: Tokens.List;
}): PreparedTextBlock[] {
  const blocks: PreparedTextBlock[] = [];
  const itemCtx = {
    listDepth: ctx.listDepth + 1,
    quoteDepth: ctx.quoteDepth,
  };

  let itemCursorLine = sourceStartLine;
  for (let index = 0; index < token.items.length; index++) {
    const item = token.items[index]!;
    const breaks = countSourceLineBreaks(item.raw);
    const itemStartLine = Math.min(sourceEndLine, itemCursorLine);
    const itemEndLine = Math.min(
      sourceEndLine,
      Math.max(
        itemStartLine,
        itemCursorLine + breaks - (endsWithSourceLineBreak(item.raw) ? 1 : 0),
      ),
    );
    itemCursorLine += breaks;

    let itemBlocks = parseBlockTokens(item.tokens, {
      ctx: itemCtx,
      headingIds,
      sourceEndLine: itemEndLine,
      sourceStartLine: itemStartLine,
      style,
    });
    if (itemBlocks.length === 0) {
      itemBlocks = buildInlineBlocks({
        ctx: itemCtx,
        lines: [
          [createTextPiece(item.text, EMPTY_MARK_STATE, "body", style)].filter(
            Boolean,
          ) as InlinePiece[],
        ],
        sourceEndLine: itemEndLine,
        sourceStartLine: itemStartLine,
        style,
        variant: "body",
      });
    }

    decorateListItemBlocks(
      itemBlocks,
      resolveListMarkerText(token, item, index),
      resolveListMarkerClassName(token, item),
      style,
    );
    appendBlockGroup(blocks, itemBlocks, LIST_ITEM_GAP);
  }

  return blocks;
}

function decorateListItemBlocks(
  blocks: PreparedTextBlock[],
  markerText: string,
  markerClassName: string,
  style: TextStyleConfig,
) {
  if (blocks.length === 0) return;

  const markerArea = measureMarkerWidth(markerText, style) + LIST_MARKER_GAP;
  for (let index = 0; index < blocks.length; index++) {
    blocks[index] = shiftBlock(blocks[index]!, markerArea);
  }

  const firstBlock = blocks[0]!;
  blocks[0] = {
    ...firstBlock,
    markerClassName,
    markerLeft: firstBlock.contentLeft - markerArea,
    markerText,
  } satisfies PreparedTextBlock;
}

function buildInlineBlocks({
  ctx,
  headingId = null,
  lines,
  sourceEndLine,
  sourceStartLine,
  style,
  variant,
}: {
  ctx: ParseContext;
  headingId?: string | null;
  lines: InlinePiece[][];
  sourceEndLine: number;
  sourceStartLine: number;
  style: TextStyleConfig;
  variant: InlineVariant;
}) {
  const blocks: PreparedTextBlock[] = [];
  for (const pieces of lines) {
    if (pieces.length === 0) continue;
    const isFirstBlock = blocks.length === 0;
    blocks.push({
      ...buildInlineBlock({
        ctx,
        pieces,
        sourceEndLine,
        sourceStartLine,
        style,
        variant,
      }),
      headingId: isFirstBlock ? headingId : null,
      marginTop: isFirstBlock ? 0 : HARD_BREAK_GAP,
    });
  }
  return blocks;
}

function buildInlineBlock({
  ctx,
  pieces,
  sourceEndLine,
  sourceStartLine,
  style,
  variant,
}: {
  ctx: ParseContext;
  pieces: InlinePiece[];
  sourceEndLine: number;
  sourceStartLine: number;
  style: TextStyleConfig;
  variant: InlineVariant;
}): PreparedInlineTextBlock {
  return {
    ...createBlockBase(ctx, sourceStartLine, sourceEndLine),
    classNames: pieces.map((piece) => piece.className),
    fallbackText: pieces.map((piece) => piece.text).join(""),
    flow: prepareRichInlineSafe(pieces),
    fonts: pieces.map((piece) => piece.font),
    headingId: null,
    hrefs: pieces.map((piece) => piece.href),
    kind: "inline",
    lineHeight: lineHeightForVariant(variant, style),
    texts: pieces.map((piece) => piece.text),
    titles: pieces.map((piece) => piece.title),
    variant,
  };
}

function buildCodeBlock({
  ctx,
  language,
  sourceEndLine,
  sourceStartLine,
  style,
  text,
}: {
  ctx: ParseContext;
  language: string | null;
  sourceEndLine: number;
  sourceStartLine: number;
  style: TextStyleConfig;
  text: string;
}): PreparedCodeTextBlock {
  const code = stripSingleTrailingNewline(text);
  const font = codeFont(style);
  return {
    ...createBlockBase(ctx, sourceStartLine, sourceEndLine),
    fallbackText: code,
    font,
    kind: "code",
    language,
    lineHeight: CODE_LINE_PX * style.fontScale,
    prepared: prepareWithSegmentsSafe(code || " ", font, {
      whiteSpace: "pre-wrap",
    }),
  };
}

function buildImageBlock({
  ctx,
  sourceEndLine,
  sourceStartLine,
  token,
}: {
  ctx: ParseContext;
  sourceEndLine: number;
  sourceStartLine: number;
  token: Tokens.Image;
}): PreparedImageTextBlock {
  const alt = token.text?.trim() || token.href || "Markdown image";
  return {
    ...createBlockBase(ctx, sourceStartLine, sourceEndLine),
    alt,
    href: parseMarkdownHref(token.href),
    kind: "image",
    src: parseMarkdownImageSrc(token.href),
    title: sanitizeMarkdownTitle(token.title),
  };
}

function buildRuleBlock({
  ctx,
  sourceEndLine,
  sourceStartLine,
}: {
  ctx: ParseContext;
  sourceEndLine: number;
  sourceStartLine: number;
}): PreparedRuleTextBlock {
  return {
    ...createBlockBase(ctx, sourceStartLine, sourceEndLine),
    height: RULE_HEIGHT,
    kind: "rule",
  };
}

function buildTableBlock({
  ctx,
  sourceEndLine,
  sourceStartLine,
  token,
}: {
  ctx: ParseContext;
  sourceEndLine: number;
  sourceStartLine: number;
  token: Tokens.Table;
}): PreparedTableTextBlock {
  const header = token.header.map((cell) => tableCellFromTokens(cell.tokens));
  const rows = token.rows.map((row) =>
    row.map((cell) => tableCellFromTokens(cell.tokens)),
  );
  const rowSourceStartLines = token.rows.map(
    (_row, index) => sourceStartLine + 2 + index,
  );
  const alignments = token.align.map((alignment) =>
    tableColumnAlignment(alignment),
  );
  return {
    ...createBlockBase(ctx, sourceStartLine, sourceEndLine),
    alignments,
    columnWidths: measureTableColumnWidths(header, rows),
    header,
    kind: "table",
    rowSourceStartLines,
    rows,
  };
}

function createBlockBase(
  ctx: ParseContext,
  sourceStartLine: number,
  sourceEndLine: number,
): PreparedTextBlockBase {
  const listIndent = Math.max(0, ctx.listDepth - 1) * LIST_NESTING_INDENT;
  const contentLeft = listIndent + ctx.quoteDepth * BLOCKQUOTE_INDENT;
  const quoteRailLefts = Array.from({ length: ctx.quoteDepth }, (_, depth) => {
    return listIndent + depth * BLOCKQUOTE_INDENT + RAIL_OFFSET;
  });

  return {
    contentLeft,
    listDepth: ctx.listDepth,
    marginTop: 0,
    markerClassName: null,
    markerLeft: null,
    markerText: null,
    quoteDepth: ctx.quoteDepth,
    quoteRailLefts,
    sourceEndLine,
    sourceStartLine,
  };
}

function collectInlinePieceLines(
  tokens: readonly Token[],
  variant: InlineVariant,
  style: TextStyleConfig,
): InlinePiece[][] {
  const lines: InlinePiece[][] = [[]];

  function currentLine() {
    return lines[lines.length - 1]!;
  }

  function pushLineBreak() {
    lines.push([]);
  }

  function pushPiece(piece: InlinePiece | null) {
    if (!piece) return;
    const line = currentLine();
    const previous = line[line.length - 1];
    if (previous && canMergeInlinePieces(previous, piece)) {
      previous.text += piece.text;
      return;
    }
    line.push(piece);
  }

  function walk(tokenList: readonly Token[], marks: MarkState) {
    for (const token of tokenList) {
      switch (token.type) {
        case "text":
          if (Array.isArray(token.tokens) && token.tokens.length > 0) {
            walk(token.tokens, marks);
          } else {
            pushPiece(createTextPiece(token.text, marks, variant, style));
          }
          continue;
        case "escape":
          pushPiece(createTextPiece(token.text, marks, variant, style));
          continue;
        case "strong":
          walk(token.tokens ?? [], { ...marks, bold: true });
          continue;
        case "em":
          walk(token.tokens ?? [], { ...marks, italic: true });
          continue;
        case "del":
          walk(token.tokens ?? [], { ...marks, strike: true });
          continue;
        case "codespan":
          pushPiece(createCodePiece(token.text, style));
          continue;
        case "link":
          walk(token.tokens ?? [], {
            ...marks,
            href: parseMarkdownHref(token.href),
            title: sanitizeMarkdownTitle(token.title),
          });
          continue;
        case "image":
          pushPiece(createImagePiece(token.text || token.href, style));
          continue;
        case "br":
          pushLineBreak();
          continue;
        case "checkbox":
          pushPiece(
            createTextPiece(
              token.checked ? "[x] " : "[ ] ",
              marks,
              variant,
              style,
            ),
          );
          continue;
        case "html":
          pushPiece(createTextPiece(token.text, marks, variant, style));
          continue;
        default: {
          const fallback = fallbackTextForToken(token);
          if (fallback) {
            pushPiece(createTextPiece(fallback, marks, variant, style));
          }
        }
      }
    }
  }

  walk(tokens, EMPTY_MARK_STATE);
  while (lines.length > 0 && lines[lines.length - 1]!.length === 0) {
    lines.pop();
  }
  return lines;
}

function createTextPiece(
  text: string,
  marks: MarkState,
  variant: InlineVariant,
  style: TextStyleConfig,
): InlinePiece | null {
  if (!text) return null;
  return {
    breakMode: "normal",
    className: inlineClassName(variant, marks),
    extraWidth: 0,
    font: inlineFont(variant, marks, style),
    href: marks.href,
    text,
    title: marks.title,
  };
}

function createCodePiece(
  text: string,
  style: TextStyleConfig,
): InlinePiece | null {
  if (!text) return null;
  return {
    breakMode: "normal",
    className: "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.92em]",
    extraWidth: INLINE_CODE_EXTRA_WIDTH,
    font: codeInlineFont(style),
    href: null,
    text,
    title: null,
  };
}

function codeFont(style: TextStyleConfig) {
  return `500 ${CODE_FONT_PX * style.fontScale}px ${MONO_FAMILY}`;
}

function codeInlineFont(style: TextStyleConfig) {
  return `600 ${CODE_FONT_PX * style.fontScale}px ${MONO_FAMILY}`;
}

function createImagePiece(text: string, style: TextStyleConfig): InlinePiece {
  return {
    breakMode: "never",
    className:
      "inline-flex min-h-5 items-center rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground",
    extraWidth: IMAGE_EXTRA_WIDTH,
    font: `600 ${CHIP_FONT_PX * style.fontScale}px ${SANS_FAMILY}`,
    href: null,
    text: text || "image",
    title: null,
  };
}

function layoutTextBlock({
  block,
  blockIndex,
  contentWidth,
  scale,
  top,
}: {
  block: PreparedTextBlock;
  blockIndex: number;
  contentWidth: number;
  scale: number;
  top: number;
}): TextBlockFrame {
  switch (block.kind) {
    case "inline": {
      const lineWidth = safeWidth((contentWidth - block.contentLeft) / scale);
      const stats = block.flow
        ? measureRichInlineStatsSafe(block.flow, lineWidth, block.fallbackText)
        : estimateInlineStats(block.fallbackText, lineWidth);
      const lineCount = Math.max(1, stats.lineCount);
      const lineHeight = block.lineHeight * scale;
      const height = lineCount * lineHeight;
      return {
        ...frameBase(block, blockIndex, top, height, scale),
        kind: "inline",
        lineCount,
        lineHeight,
        usedWidth: stats.maxLineWidth * scale,
      };
    }

    case "code": {
      const boxWidth = safeWidth(contentWidth - block.contentLeft);
      const innerWidth = safeWidth(
        (boxWidth - CODE_BLOCK_PADDING_X * 2) / scale,
      );
      const stats = block.prepared
        ? measureLineStatsSafe(block.prepared, innerWidth, block.fallbackText)
        : estimateInlineStats(block.fallbackText, innerWidth);
      const lineCount = Math.max(1, stats.lineCount);
      const width = Math.min(
        boxWidth,
        Math.max(1, stats.maxLineWidth * scale + CODE_BLOCK_PADDING_X * 2),
      );
      const lineHeight = block.lineHeight * scale;
      const height = lineCount * lineHeight + CODE_BLOCK_PADDING_Y * 2;
      return {
        ...frameBase(block, blockIndex, top, height, scale),
        kind: "code",
        language: block.language,
        lineCount,
        lineHeight,
        width,
      };
    }

    case "image": {
      const availableWidth = safeWidth(contentWidth - block.contentLeft);
      const imageWidth = Math.min(
        IMAGE_BLOCK_MAX_WIDTH,
        Math.max(IMAGE_BLOCK_MIN_WIDTH, availableWidth),
      );
      const imageHeight = block.src
        ? IMAGE_BLOCK_HEIGHT
        : IMAGE_PLACEHOLDER_HEIGHT;
      return {
        ...frameBase(block, blockIndex, top, imageHeight, scale),
        alt: block.alt,
        imageHeight,
        imageWidth,
        kind: "image",
      };
    }

    case "rule": {
      return {
        ...frameBase(block, blockIndex, top, block.height, scale),
        kind: "rule",
        width: safeWidth(contentWidth - block.contentLeft),
      };
    }

    case "table": {
      const availableWidth = safeWidth(contentWidth - block.contentLeft);
      const intrinsicWidth = block.columnWidths.reduce(
        (total, width) => total + width,
        0,
      );
      const tableWidth = Math.max(availableWidth, intrinsicWidth);
      const rowHeights = measureTableRowHeights(block.rows, block.columnWidths);
      const rowOffsets = buildRowOffsets(rowHeights);
      const bodyHeight = rowOffsets[rowOffsets.length - 1] ?? 0;
      const height = TABLE_HEADER_HEIGHT + bodyHeight + 2;
      return {
        ...frameBase(block, blockIndex, top, height, scale),
        columnWidths: block.columnWidths,
        headerHeight: TABLE_HEADER_HEIGHT,
        kind: "table",
        rowHeights,
        rowOffsets,
        rowCount: block.rows.length,
        rowSourceStartLines: block.rowSourceStartLines,
        tableWidth,
      };
    }
  }
}

function frameBase(
  block: PreparedTextBlock,
  blockIndex: number,
  top: number,
  height: number,
  scale: number,
): TextBlockFrameBase {
  return {
    blockIndex,
    bottom: top + height,
    contentLeft: block.contentLeft,
    height,
    listDepth: block.listDepth,
    markerClassName: block.markerClassName,
    markerLeft: block.markerLeft,
    markerText: block.markerText,
    quoteDepth: block.quoteDepth,
    quoteRailLefts: block.quoteRailLefts,
    scale,
    sourceEndLine: block.sourceEndLine,
    sourceStartLine: block.sourceStartLine,
    top,
  };
}

function richInlineFragments(
  block: PreparedInlineTextBlock,
  line: RichInlineLine,
): InlineFragmentLayout[] {
  return line.fragments.map((fragment) => ({
    className: block.classNames[fragment.itemIndex] ?? "",
    font:
      block.fonts[fragment.itemIndex] ??
      inlineFont("body", EMPTY_MARK_STATE, { fontScale: 1 }),
    href: block.hrefs[fragment.itemIndex] ?? null,
    leadingGap: fragment.gapBefore,
    text: fragment.text,
    title: block.titles[fragment.itemIndex] ?? null,
  }));
}

function fallbackInlineFragments(
  block: PreparedInlineTextBlock,
): InlineFragmentLayout[] {
  const fragments = block.texts.map((text, index) => ({
    className: block.classNames[index] ?? "",
    font:
      block.fonts[index] ??
      inlineFont(block.variant, EMPTY_MARK_STATE, { fontScale: 1 }),
    href: block.hrefs[index] ?? null,
    leadingGap: 0,
    text,
    title: block.titles[index] ?? null,
  }));

  return fragments.length > 0
    ? fragments
    : [
        {
          className: inlineClassName(block.variant, EMPTY_MARK_STATE),
          font: inlineFont(block.variant, EMPTY_MARK_STATE, { fontScale: 1 }),
          href: null,
          leadingGap: 0,
          text: block.fallbackText || " ",
          title: null,
        },
      ];
}

function prepareRichInlineSafe(pieces: InlinePiece[]) {
  try {
    return prepareRichInline(
      pieces.map((piece) => ({
        break: piece.breakMode,
        extraWidth: piece.extraWidth,
        font: piece.font,
        text: piece.text,
      })),
    );
  } catch {
    return null;
  }
}

function prepareWithSegmentsSafe(
  text: string,
  font: string,
  options?: Parameters<typeof prepareWithSegments>[2],
) {
  try {
    return prepareWithSegments(text, font, options);
  } catch {
    return null;
  }
}

function measureRichInlineStatsSafe(
  flow: PreparedRichInline,
  width: number,
  fallbackText: string,
) {
  try {
    return measureRichInlineStats(flow, width);
  } catch {
    return estimateInlineStats(fallbackText, width);
  }
}

function measureLineStatsSafe(
  prepared: PreparedTextWithSegments,
  width: number,
  fallbackText: string,
) {
  try {
    return measureLineStats(prepared, width);
  } catch {
    return estimateInlineStats(fallbackText, width);
  }
}

function estimateInlineStats(text: string, width: number) {
  const columns = Math.max(1, Math.floor(width / 8));
  const lines = splitTextLines(text || " ");
  const lineCount = lines.reduce(
    (sum, line) => sum + Math.max(1, Math.ceil((line || " ").length / columns)),
    0,
  );
  const maxLineWidth = Math.min(
    width,
    Math.max(...lines.map((line) => (line || " ").length * 8), 1),
  );
  return { lineCount, maxLineWidth };
}

function measureMarkerWidth(text: string, style: TextStyleConfig) {
  const font = `600 ${MARKER_FONT_PX * style.fontScale}px ${MONO_FAMILY}`;
  const cacheKey = `${font}\u0000${text}`;
  const cached = markerWidthCache.get(cacheKey);
  if (cached != null) return cached;

  let width = Math.max(8, text.length * MARKER_FONT_PX * style.fontScale);
  const prepared = prepareWithSegmentsSafe(text, font);
  if (prepared) {
    try {
      width = measureNaturalWidth(prepared);
    } catch {
      // keep estimate
    }
  }
  markerWidthCache.set(cacheKey, width);
  return width;
}

function appendBlockGroup(
  target: PreparedTextBlock[],
  group: PreparedTextBlock[],
  firstMargin: number,
) {
  if (group.length === 0) return;

  for (let index = 0; index < group.length; index++) {
    const block = group[index]!;
    target.push({
      ...block,
      marginTop:
        index === 0 ? (target.length === 0 ? 0 : firstMargin) : block.marginTop,
    } satisfies PreparedTextBlock);
  }
}

function extractMarkdownFrontmatter(markdown: string) {
  const lines = splitTextLines(markdown);
  if (lines[0]?.trim() !== "---") return null;

  for (let index = 1; index < lines.length; index++) {
    if (lines[index]!.trim() !== "---") continue;
    if (index === 1) return null;

    return {
      body: lines.slice(index + 1).join("\n"),
      endLine: index + 1,
      text: lines.slice(1, index).join("\n"),
    };
  }

  return null;
}

function createMarkdownHeadingId(
  lines: readonly InlinePiece[][],
  headingIds: HeadingIdRegistry,
) {
  const text = lines
    .flatMap((line) => line.map((piece) => piece.text))
    .join(" ");
  const base = slugifyMarkdownHeading(text) || "section";
  const count = headingIds.get(base) ?? 0;
  headingIds.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function slugifyMarkdownHeading(text: string) {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function shiftBlock(
  block: PreparedTextBlock,
  delta: number,
): PreparedTextBlock {
  return {
    ...block,
    contentLeft: block.contentLeft + delta,
  } satisfies PreparedTextBlock;
}

function resolveListMarkerText(
  list: Tokens.List,
  item: Tokens.ListItem,
  index: number,
) {
  if (item.task) return item.checked ? "☑" : "☐";
  if (list.ordered) {
    const start = typeof list.start === "number" ? list.start : 1;
    return `${start + index}.`;
  }
  return "•";
}

function resolveListMarkerClassName(list: Tokens.List, item: Tokens.ListItem) {
  if (item.task) return "text-muted-foreground";
  return list.ordered ? "text-muted-foreground" : "text-muted-foreground";
}

function isStandaloneImageParagraph(
  token: Token,
): token is Tokens.Paragraph & { tokens: [Tokens.Image] } {
  return (
    token.type === "paragraph" &&
    Array.isArray(token.tokens) &&
    token.tokens.length === 1 &&
    token.tokens[0]?.type === "image"
  );
}

function parseMarkdownHref(href: string | null | undefined) {
  return sanitizeMarkdownUrl(href, {
    allowedAbsoluteProtocols: new Set(["http:", "https:", "mailto:"]),
    allowRelative: true,
  });
}

function parseMarkdownImageSrc(src: string | null | undefined) {
  return sanitizeMarkdownUrl(src, {
    allowedAbsoluteProtocols: new Set(["http:", "https:", "blob:"]),
    allowRelative: true,
  });
}

function sanitizeMarkdownTitle(title: string | null | undefined) {
  if (!title) return null;
  return title.replace(/[\u0000-\u001f\u007f]/g, "").trim() || null;
}

function sanitizeMarkdownLanguage(language: string | null | undefined) {
  if (!language) return null;
  return (
    language
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 40) || null
  );
}

function sanitizeMarkdownUrl(
  value: string | null | undefined,
  {
    allowedAbsoluteProtocols,
    allowRelative,
  }: {
    allowedAbsoluteProtocols: ReadonlySet<string>;
    allowRelative: boolean;
  },
) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (trimmed.startsWith("#")) return trimmed;
  if (allowRelative && /^\.{0,2}\//.test(trimmed)) return trimmed;
  if (allowRelative && /^\//.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    return allowedAbsoluteProtocols.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function fallbackTextForToken(token: Token) {
  if ("text" in token && typeof token.text === "string") return token.text;
  return token.raw ?? "";
}

function countSourceLineBreaks(raw: string | null | undefined) {
  if (!raw) return 0;
  const matches = raw.match(/\r\n|[\n\r\u2028\u2029]/g);
  return matches ? matches.length : 0;
}

function endsWithSourceLineBreak(raw: string | null | undefined) {
  return raw ? /(?:\r\n|[\n\r\u2028\u2029])$/.test(raw) : false;
}

function tableCellFromTokens(tokens: readonly Token[]): PreparedTableCell {
  const { className, href, text, title } = inlineTokensToTableCell(tokens);
  return {
    className,
    href,
    text: text || " ",
    title,
  };
}

function inlineTokensToTableCell(tokens: readonly Token[]): PreparedTableCell {
  let className = "";
  let href: string | null = null;
  let text = "";
  let title: string | null = null;
  for (const token of tokens) {
    switch (token.type) {
      case "strong":
        text += inlineTokensToTableCell(token.tokens ?? []).text;
        className = cnClassNames(className, "font-semibold");
        break;
      case "em":
        text += inlineTokensToTableCell(token.tokens ?? []).text;
        className = cnClassNames(className, "italic");
        break;
      case "del":
        text += inlineTokensToTableCell(token.tokens ?? []).text;
        className = cnClassNames(className, "line-through");
        break;
      case "link": {
        const child = inlineTokensToTableCell(token.tokens ?? []);
        text += child.text;
        href = href ?? parseMarkdownHref(token.href);
        title = title ?? sanitizeMarkdownTitle(token.title);
        className = cnClassNames(className, "text-primary underline");
        break;
      }
      case "codespan":
        text += token.text;
        className = cnClassNames(className, "font-mono");
        break;
      case "escape":
      case "text":
      case "html":
        text += token.text;
        break;
      case "br":
        text += " ";
        break;
      case "image":
        text += token.text || token.href;
        break;
      default:
        text += fallbackTextForToken(token);
    }
  }
  return { className, href, text, title };
}

function measureTableColumnWidths(
  header: readonly PreparedTableCell[],
  rows: readonly PreparedTableCell[][],
) {
  return header.map((cell, columnIndex) => {
    const columnTexts = [
      cell.text,
      ...rows.map((row) => row[columnIndex]?.text ?? ""),
    ];
    const maxLength = Math.max(
      1,
      ...columnTexts.map((text) => Math.min(48, text.length)),
    );
    return Math.min(
      TABLE_COLUMN_MAX_WIDTH,
      Math.max(
        TABLE_COLUMN_MIN_WIDTH,
        maxLength * TABLE_CELL_FONT_PX * 0.58 + TABLE_CELL_PADDING_X * 2,
      ),
    );
  });
}

function measureTableRowHeights(
  rows: readonly PreparedTableCell[][],
  columnWidths: readonly number[],
) {
  return rows.map((row) => {
    const lineCount = Math.max(
      1,
      ...row.map((cell, index) =>
        measureTableCellLineCount(cell.text, columnWidths[index] ?? 0),
      ),
    );
    return Math.max(
      TABLE_ROW_MIN_HEIGHT,
      lineCount * TABLE_ROW_LINE_HEIGHT + 12,
    );
  });
}

function measureTableCellLineCount(text: string, columnWidth: number) {
  const innerWidth = Math.max(1, columnWidth - TABLE_CELL_PADDING_X * 2);
  const charsPerLine = Math.max(
    1,
    Math.floor(innerWidth / (TABLE_CELL_FONT_PX * 0.58)),
  );
  return splitTextLines(text || " ").reduce((count, line) => {
    return count + Math.max(1, Math.ceil((line || " ").length / charsPerLine));
  }, 0);
}

function buildRowOffsets(rowHeights: readonly number[]) {
  const offsets = [0];
  for (const height of rowHeights) {
    offsets.push(offsets[offsets.length - 1]! + height);
  }
  return offsets;
}

function findTableRowAtOffset(rowOffsets: readonly number[], offset: number) {
  if (offset <= 0) return 0;
  const rowCount = Math.max(0, rowOffsets.length - 1);
  let low = 0;
  let high = rowCount;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((rowOffsets[mid + 1] ?? 0) <= offset) low = mid + 1;
    else high = mid;
  }
  return low;
}

function findTableRowEndAtOffset(
  rowOffsets: readonly number[],
  offset: number,
) {
  if (offset <= 0) return 0;
  const rowCount = Math.max(0, rowOffsets.length - 1);
  let low = 0;
  let high = rowCount;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((rowOffsets[mid] ?? 0) < offset) low = mid + 1;
    else high = mid;
  }
  return low;
}

function tableColumnAlignment(
  alignment: "center" | "left" | "right" | null,
): TableColumnAlignment {
  if (alignment === "center" || alignment === "right") return alignment;
  return "left";
}

function tableClipboardCell(text: string) {
  return text.replace(/[\t\r\n]+/g, " ").trim();
}

function cnClassNames(...classes: Array<string | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function headingVariant(depth: number): InlineVariant {
  if (depth <= 1) return "heading-1";
  if (depth === 2) return "heading-2";
  return "body";
}

function lineHeightForVariant(variant: InlineVariant, style: TextStyleConfig) {
  switch (variant) {
    case "heading-1":
      return HEADING_ONE_LINE_PX * style.fontScale;
    case "heading-2":
      return HEADING_TWO_LINE_PX * style.fontScale;
    case "body":
      return BODY_LINE_PX * style.fontScale;
  }
}

function inlineFont(
  variant: InlineVariant,
  marks: MarkState,
  style: TextStyleConfig,
) {
  const italic = marks.italic ? "italic " : "";
  switch (variant) {
    case "heading-1":
      return `${italic}${marks.bold ? 800 : 700} ${HEADING_ONE_FONT_PX * style.fontScale}px ${SERIF_FAMILY}`;
    case "heading-2":
      return `${italic}${marks.bold ? 800 : 700} ${HEADING_TWO_FONT_PX * style.fontScale}px ${SERIF_FAMILY}`;
    case "body":
      return `${italic}${marks.bold ? 700 : marks.href ? 500 : 400} ${BODY_FONT_PX * style.fontScale}px ${SANS_FAMILY}`;
  }
}

function inlineClassName(variant: InlineVariant, marks: MarkState) {
  const classes = [
    "inline-block wrap-break-word whitespace-pre-wrap whitespace-pre align-baseline leading-none",
  ];
  if (variant === "heading-1")
    classes.push("font-serif text-[1.45em] font-semibold");
  if (variant === "heading-2")
    classes.push("font-serif text-[1.18em] font-semibold");
  if (marks.bold) classes.push("font-semibold");
  if (marks.italic) classes.push("italic");
  if (marks.strike) classes.push("line-through");
  if (marks.href) classes.push("text-primary underline underline-offset-2");
  return classes.join(" ");
}

function canMergeInlinePieces(a: InlinePiece, b: InlinePiece) {
  return (
    a.breakMode === b.breakMode &&
    a.className === b.className &&
    a.extraWidth === b.extraWidth &&
    a.font === b.font &&
    a.href === b.href &&
    a.title === b.title
  );
}

function stripSingleTrailingNewline(text: string) {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function countTextWords(text: string) {
  const matches = text.trim().match(/\S+/g);
  return matches?.length ?? 0;
}

function countTextLineWords(lines: readonly string[]) {
  return lines.reduce((count, line) => count + countTextWords(line), 0);
}

function hashTextForPreparedDocument(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeWidth(width: number) {
  return Number.isFinite(width) && width > 0 ? width : 1;
}

function safeScale(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
