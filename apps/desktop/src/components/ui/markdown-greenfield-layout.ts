"use client";

import type {
  MarkdownGreenfieldBlock,
  MarkdownGreenfieldChunk,
  MarkdownGreenfieldDocument,
} from "./markdown-greenfield-document";

// The chunk reading column's max inline size (the old max-w-4xl, 56rem at
// the 16px root). Shared with the surface motion resolver: the align
// translate that hides the close-leg recenter must agree with the markup
// about where the column's margin clamps.
export const MARKDOWN_GREENFIELD_CHUNK_MAX_INLINE_SIZE = 896;
const CHUNK_PADDING_X = 32;
const DOCUMENT_PADDING_TOP = CHUNK_PADDING_X;
const DOCUMENT_PADDING_BOTTOM = CHUNK_PADDING_X;
const MIN_CHUNK_HEIGHT = 64;
// Tuned to the rendered typography (15.5px body at leading-relaxed ≈ 25px,
// 14px mono code at leading-5 = 20px) so estimates track measured heights and
// scroll correction stays minimal.
const BODY_LINE_HEIGHT = 25;
const MONO_LINE_HEIGHT = 20;
const APPROX_BODY_CHAR_WIDTH = 7.9;
const APPROX_MONO_CHAR_WIDTH = 7.8;
export const MARKDOWN_GREENFIELD_LAYOUT_POLICY_VERSION =
  "greenfield-layout-rich-blocks-v7";
const MARKDOWN_TABLE_VIRTUALIZATION_ROW_THRESHOLD = 80;
const MARKDOWN_TABLE_VIRTUALIZED_HEIGHT = 640;
const LAYOUT_CACHE_LIMIT = 64;
const ESTIMATED_HEIGHT_CACHE_LIMIT = 12;

const markdownGreenfieldLayoutDocumentIds = new WeakMap<
  MarkdownGreenfieldDocument,
  number
>();
const markdownGreenfieldLayoutCache = new Map<
  string,
  {
    document: MarkdownGreenfieldDocument;
    frame: MarkdownGreenfieldFrame;
  }
>();
const markdownGreenfieldEstimatedHeightCaches = new WeakMap<
  MarkdownGreenfieldDocument,
  Map<string, readonly number[]>
>();
let nextMarkdownGreenfieldLayoutDocumentId = 1;

export type MarkdownGreenfieldFrame = {
  chunks: MarkdownGreenfieldChunkFrame[];
  totalHeight: number;
  width: number;
};

export type MarkdownGreenfieldChunkFrame = {
  bottom: number;
  height: number;
  id: string;
  index: number;
  measuredHeight: number | null;
  sourceEndLine: number;
  sourceStartLine: number;
  top: number;
};

export type MarkdownGreenfieldMeasuredHeights = {
  /** Compact revision key for the current measured-height snapshot. */
  cacheKey?: string;
  get(
    chunk: MarkdownGreenfieldChunk,
    context: MarkdownGreenfieldMeasurementContext,
  ): number | undefined;
};

export type MarkdownGreenfieldMeasurementContext = {
  fontScale: number;
  policyVersion: string;
  width: number;
};

export function layoutMarkdownGreenfieldDocument({
  contentWidth,
  document,
  fontScale,
  measuredHeights,
}: {
  contentWidth: number;
  document: MarkdownGreenfieldDocument;
  fontScale: number;
  measuredHeights?: MarkdownGreenfieldMeasuredHeights;
}): MarkdownGreenfieldFrame {
  const width = Math.max(1, contentWidth);
  const context = {
    fontScale,
    policyVersion: MARKDOWN_GREENFIELD_LAYOUT_POLICY_VERSION,
    width,
  };
  const measuredHeightsCacheKey = measuredHeights?.cacheKey ?? null;
  const shouldCacheFrame = !measuredHeights || measuredHeightsCacheKey != null;
  const cacheKey = markdownGreenfieldLayoutCacheKey({
    context,
    document,
    measuredHeightsCacheKey,
  });
  if (shouldCacheFrame) {
    const cached = markdownGreenfieldLayoutCache.get(cacheKey);
    if (cached?.document === document) {
      markdownGreenfieldLayoutCache.delete(cacheKey);
      markdownGreenfieldLayoutCache.set(cacheKey, cached);
      return cached.frame;
    }
  }

  const estimatedHeights = readMarkdownGreenfieldEstimatedHeights({
    context,
    document,
  });
  const chunks: MarkdownGreenfieldChunkFrame[] = [];
  let y = DOCUMENT_PADDING_TOP;

  for (const [chunkIndex, chunk] of document.chunks.entries()) {
    const estimatedHeight = estimatedHeights[chunkIndex] ?? MIN_CHUNK_HEIGHT;
    const measuredHeight = readMarkdownGreenfieldMeasuredHeight({
      chunk,
      context,
      measuredHeights,
    });
    const height = Math.max(
      MIN_CHUNK_HEIGHT,
      measuredHeight == null ? estimatedHeight : measuredHeight,
    );
    chunks.push({
      bottom: y + height,
      height,
      id: chunk.id,
      index: chunk.index,
      measuredHeight,
      sourceEndLine: chunk.sourceEndLine,
      sourceStartLine: chunk.sourceStartLine,
      top: y,
    });
    y += height;
  }

  const frame = freezeMarkdownGreenfieldFrame({
    chunks,
    totalHeight: chunks.length ? y + DOCUMENT_PADDING_BOTTOM : 0,
    width,
  });
  if (shouldCacheFrame) {
    markdownGreenfieldLayoutCache.set(cacheKey, { document, frame });
    while (markdownGreenfieldLayoutCache.size > LAYOUT_CACHE_LIMIT) {
      const oldestKey = markdownGreenfieldLayoutCache.keys().next().value;
      if (!oldestKey) break;
      markdownGreenfieldLayoutCache.delete(oldestKey);
    }
  }
  return frame;
}

function readMarkdownGreenfieldEstimatedHeights({
  context,
  document,
}: {
  context: MarkdownGreenfieldMeasurementContext;
  document: MarkdownGreenfieldDocument;
}) {
  const cacheKey = markdownGreenfieldEstimateCacheKey(context);
  const cache = markdownGreenfieldEstimateCacheForDocument(document);
  const cached = cache.get(cacheKey);
  if (cached) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }

  const blocksById = new Map(document.blocks.map((block) => [block.id, block]));
  const estimatedHeights = Object.freeze(
    document.chunks.map((chunk) =>
      estimateMarkdownGreenfieldChunkHeight({
        blocks: chunk.blockIds
          .map((blockId) => blocksById.get(blockId))
          .filter((block): block is MarkdownGreenfieldBlock => Boolean(block)),
        fontScale: context.fontScale,
        width: context.width,
      }),
    ),
  );
  cache.set(cacheKey, estimatedHeights);
  while (cache.size > ESTIMATED_HEIGHT_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
  return estimatedHeights;
}

function estimateMarkdownGreenfieldChunkHeight({
  blocks,
  fontScale,
  width,
}: {
  blocks: readonly MarkdownGreenfieldBlock[];
  fontScale: number;
  width: number;
}) {
  const textWidth = Math.max(1, width - CHUNK_PADDING_X * 2);
  const height = blocks.reduce(
    (sum, block) =>
      sum +
      estimateMarkdownGreenfieldBlockHeight({
        block,
        fontScale,
        textWidth,
      }),
    0,
  );
  return Math.max(MIN_CHUNK_HEIGHT, height);
}

function estimateMarkdownGreenfieldBlockHeight({
  block,
  fontScale,
  textWidth,
}: {
  block: MarkdownGreenfieldBlock;
  fontScale: number;
  textWidth: number;
}) {
  if (block.kind === "thematicBreak") return 36 * fontScale;
  if (block.kind === "frontmatter") {
    const lines = Math.max(1, block.sourceLineCount);
    return (72 + lines * MONO_LINE_HEIGHT) * fontScale;
  }
  if (block.kind === "footnotes")
    return estimateTextBlock(block, textWidth, fontScale, 0.9);
  if (block.kind === "heading") {
    return estimateTextBlock(block, textWidth, fontScale, 1.3) + 18 * fontScale;
  }
  if (block.kind === "diagram") return 360 * fontScale;
  if (block.kind === "math") return 120 * fontScale;
  if (block.kind === "component") return 160 * fontScale;
  if (block.kind === "code") {
    const lines = Math.max(1, block.sourceLineCount);
    return 48 * fontScale + lines * MONO_LINE_HEIGHT * fontScale;
  }
  if (block.kind === "table") {
    const rows = Math.max(2, block.sourceLineCount);
    if (rows >= MARKDOWN_TABLE_VIRTUALIZATION_ROW_THRESHOLD) {
      return MARKDOWN_TABLE_VIRTUALIZED_HEIGHT * fontScale;
    }
    return (48 + rows * 36) * fontScale;
  }
  if (block.kind === "image") return 280 * fontScale;
  if (block.isHostile) return 420 * fontScale;
  return estimateTextBlock(block, textWidth, fontScale, 1);
}

function estimateTextBlock(
  block: MarkdownGreenfieldBlock,
  textWidth: number,
  fontScale: number,
  multiplier: number,
) {
  const charWidth =
    block.kind === "code" ? APPROX_MONO_CHAR_WIDTH : APPROX_BODY_CHAR_WIDTH;
  const columns = Math.max(12, Math.floor(textWidth / (charWidth * fontScale)));
  const visualLines = block.sourceLineLengths.reduce(
    (sum, lineLength) => sum + Math.max(1, Math.ceil(lineLength / columns)),
    0,
  );
  return (
    16 * fontScale + visualLines * BODY_LINE_HEIGHT * fontScale * multiplier
  );
}

function readMarkdownGreenfieldMeasuredHeight({
  chunk,
  context,
  measuredHeights,
}: {
  chunk: MarkdownGreenfieldChunk;
  context: MarkdownGreenfieldMeasurementContext;
  measuredHeights?: MarkdownGreenfieldMeasuredHeights;
}) {
  if (!measuredHeights) return null;
  const measuredHeight = measuredHeights.get(chunk, context);
  if (
    typeof measuredHeight === "number" &&
    Number.isFinite(measuredHeight) &&
    measuredHeight > 0
  ) {
    return measuredHeight;
  }
  return null;
}

function markdownGreenfieldLayoutCacheKey({
  context,
  document,
  measuredHeightsCacheKey,
}: {
  context: MarkdownGreenfieldMeasurementContext;
  document: MarkdownGreenfieldDocument;
  measuredHeightsCacheKey: string | null;
}) {
  return [
    markdownGreenfieldLayoutDocumentId(document),
    Math.round(context.width * 100) / 100,
    context.fontScale.toFixed(4),
    context.policyVersion,
    measuredHeightsCacheKey ?? "unmeasured",
  ].join(":");
}

function markdownGreenfieldEstimateCacheKey(
  context: MarkdownGreenfieldMeasurementContext,
) {
  return [
    Math.round(context.width * 100) / 100,
    context.fontScale.toFixed(4),
    context.policyVersion,
  ].join(":");
}

function markdownGreenfieldEstimateCacheForDocument(
  document: MarkdownGreenfieldDocument,
) {
  let cache = markdownGreenfieldEstimatedHeightCaches.get(document);
  if (cache) return cache;
  cache = new Map();
  markdownGreenfieldEstimatedHeightCaches.set(document, cache);
  return cache;
}

function markdownGreenfieldLayoutDocumentId(
  document: MarkdownGreenfieldDocument,
) {
  const existing = markdownGreenfieldLayoutDocumentIds.get(document);
  if (existing) return existing;
  const next = nextMarkdownGreenfieldLayoutDocumentId++;
  markdownGreenfieldLayoutDocumentIds.set(document, next);
  return next;
}

function freezeMarkdownGreenfieldFrame(frame: MarkdownGreenfieldFrame) {
  for (const chunk of frame.chunks) Object.freeze(chunk);
  Object.freeze(frame.chunks);
  return Object.freeze(frame);
}
