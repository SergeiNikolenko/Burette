"use client";

import type { MarkdownGreenfieldChunk } from "./markdown-greenfield-document";
import type { MarkdownGreenfieldChunkFrame } from "./markdown-greenfield-layout";

export type MarkdownGreenfieldScrollAnchor = {
  chunkId: string;
  /** Negative when the viewport is in document padding before the chunk. */
  offsetWithinChunkPx: number;
  chunkHeightPx: number;
};

export type MarkdownGreenfieldVisibleRange = {
  start: number;
  end: number;
};

export type MarkdownGreenfieldVisibleProjection = {
  frameIds: readonly string[];
  range: MarkdownGreenfieldVisibleRange;
};

export function getMarkdownGreenfieldVisibleRange({
  frames,
  overscanPx,
  scrollTop,
  viewportHeight,
}: {
  frames: readonly MarkdownGreenfieldChunkFrame[];
  overscanPx: number;
  scrollTop: number;
  viewportHeight: number;
}): MarkdownGreenfieldVisibleRange {
  if (!frames.length) return { start: 0, end: 0 };
  const start = firstFrameWithBottomAfter(
    frames,
    Math.max(0, scrollTop - overscanPx),
  );
  const end = firstFrameWithTopAtOrAfter(
    frames,
    scrollTop + viewportHeight + overscanPx,
  );
  return { start, end: Math.max(start + 1, end) };
}

export function createMarkdownGreenfieldVisibleProjection({
  frames,
  range,
}: {
  frames: readonly MarkdownGreenfieldChunkFrame[];
  range: MarkdownGreenfieldVisibleRange;
}): MarkdownGreenfieldVisibleProjection {
  return {
    frameIds: frames.slice(range.start, range.end).map((frame) => frame.id),
    range,
  };
}

export function getMarkdownGreenfieldVisibleProjection({
  frames,
  overscanPx,
  scrollTop,
  viewportHeight,
}: {
  frames: readonly MarkdownGreenfieldChunkFrame[];
  overscanPx: number;
  scrollTop: number;
  viewportHeight: number;
}): MarkdownGreenfieldVisibleProjection {
  return createMarkdownGreenfieldVisibleProjection({
    frames,
    range: getMarkdownGreenfieldVisibleRange({
      frames,
      overscanPx,
      scrollTop,
      viewportHeight,
    }),
  });
}

export function getMarkdownGreenfieldProjectedVisibleFrames({
  frames,
  projection,
}: {
  frames: readonly MarkdownGreenfieldChunkFrame[];
  projection: MarkdownGreenfieldVisibleProjection;
}) {
  const rangedFrames = frames.slice(
    projection.range.start,
    projection.range.end,
  );
  if (frameIdsEqual(rangedFrames, projection.frameIds)) return rangedFrames;

  const framesById = new Map(frames.map((frame) => [frame.id, frame]));
  return projection.frameIds.flatMap((frameId) => {
    const frame = framesById.get(frameId);
    return frame ? [frame] : [];
  });
}

export function isMarkdownGreenfieldVisibleProjectionSameWindow({
  frames,
  projection,
  range,
}: {
  frames: readonly MarkdownGreenfieldChunkFrame[];
  projection: MarkdownGreenfieldVisibleProjection;
  range: MarkdownGreenfieldVisibleRange;
}) {
  const nextLength = range.end - range.start;
  if (projection.frameIds.length !== nextLength) return false;
  for (let offset = 0; offset < nextLength; offset += 1) {
    if (frames[range.start + offset]?.id !== projection.frameIds[offset]) {
      return false;
    }
  }
  return true;
}

export function getMarkdownGreenfieldVisibleFrames({
  frames,
  overscanPx,
  scrollTop,
  viewportHeight,
}: {
  frames: readonly MarkdownGreenfieldChunkFrame[];
  overscanPx: number;
  scrollTop: number;
  viewportHeight: number;
}) {
  const range = getMarkdownGreenfieldVisibleRange({
    frames,
    overscanPx,
    scrollTop,
    viewportHeight,
  });
  return frames.slice(range.start, range.end);
}

export function getMarkdownGreenfieldScrollAnchor({
  frames,
  scrollTop,
}: {
  frames: readonly MarkdownGreenfieldChunkFrame[];
  scrollTop: number;
}): MarkdownGreenfieldScrollAnchor | null {
  if (!frames.length) return null;
  const frame =
    frames[
      Math.min(firstFrameWithBottomAfter(frames, scrollTop), frames.length - 1)
    ];
  if (!frame) return null;

  return {
    chunkId: frame.id,
    chunkHeightPx: frame.height,
    offsetWithinChunkPx: scrollTop - frame.top,
  };
}

export function resolveMarkdownGreenfieldScrollAnchor({
  anchor,
  frames,
}: {
  anchor: MarkdownGreenfieldScrollAnchor;
  frames: readonly MarkdownGreenfieldChunkFrame[];
}) {
  const frame = frames.find((item) => item.id === anchor.chunkId);
  if (!frame) return null;
  if (anchor.offsetWithinChunkPx < 0) {
    return Math.max(0, frame.top + anchor.offsetWithinChunkPx);
  }
  // Preserve the position *within* the anchored chunk proportionally. When the
  // chunk keeps its height this reduces to the original pixel offset; when an
  // over-estimated chunk shrinks after measurement, the viewport stays at the
  // same relative content instead of snapping toward the chunk's top (which is
  // what `min(offset, height - 1)` did, yanking the reader upward).
  const fraction =
    anchor.chunkHeightPx > 0
      ? Math.min(
          1,
          Math.max(0, anchor.offsetWithinChunkPx / anchor.chunkHeightPx),
        )
      : 0;
  return frame.top + fraction * frame.height;
}

export function getMarkdownGreenfieldScrollTopForLineRange({
  chunks,
  frames,
  preferredChunkId,
  range,
  viewportHeight,
}: {
  chunks: readonly Pick<
    MarkdownGreenfieldChunk,
    "id" | "index" | "sourceEndLine" | "sourceStartLine"
  >[];
  frames: readonly MarkdownGreenfieldChunkFrame[];
  preferredChunkId?: string | null;
  range: { end: number; start: number } | null;
  viewportHeight: number;
}) {
  if (!range) return null;
  const preferredChunk =
    preferredChunkId == null
      ? null
      : chunks.find((item) => item.id === preferredChunkId);
  const chunk =
    preferredChunk ??
    chunks.find(
      (item) =>
        item.sourceStartLine <= range.start &&
        item.sourceEndLine >= range.start,
    ) ??
    chunks[0];
  const frame = chunk
    ? frames.find((candidate) => candidate.index === chunk.index)
    : null;
  if (!frame) return null;

  const lineCount = Math.max(
    1,
    frame.sourceEndLine - frame.sourceStartLine + 1,
  );
  const lineOffset =
    (Math.max(0, range.start - frame.sourceStartLine) / lineCount) *
      frame.height || 0;
  return Math.max(0, frame.top + lineOffset - viewportHeight * 0.25);
}

export function getMarkdownGreenfieldSourceLineForScrollTop({
  chunks,
  frames,
  scrollTop,
}: {
  chunks: readonly Pick<
    MarkdownGreenfieldChunk,
    "index" | "sourceEndLine" | "sourceStartLine"
  >[];
  frames: readonly MarkdownGreenfieldChunkFrame[];
  scrollTop: number;
}) {
  if (!frames.length) return 1;
  const frame =
    frames[
      Math.min(firstFrameWithBottomAfter(frames, scrollTop), frames.length - 1)
    ];
  if (!frame) return 1;
  const chunk = chunks.find((item) => item.index === frame.index);
  if (!chunk) return frame.sourceStartLine;
  const lineCount = Math.max(
    1,
    chunk.sourceEndLine - chunk.sourceStartLine + 1,
  );
  const ratio = Math.max(
    0,
    Math.min(1, (scrollTop - frame.top) / frame.height),
  );
  return (
    chunk.sourceStartLine +
    Math.min(lineCount - 1, Math.floor(ratio * lineCount))
  );
}

function firstFrameWithBottomAfter(
  frames: readonly MarkdownGreenfieldChunkFrame[],
  y: number,
) {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid]!.bottom > y) high = mid;
    else low = mid + 1;
  }
  return low;
}

function firstFrameWithTopAtOrAfter(
  frames: readonly MarkdownGreenfieldChunkFrame[],
  y: number,
) {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid]!.top >= y) high = mid;
    else low = mid + 1;
  }
  return low;
}

function frameIdsEqual(
  frames: readonly MarkdownGreenfieldChunkFrame[],
  frameIds: readonly string[],
) {
  if (frames.length !== frameIds.length) return false;
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index]?.id !== frameIds[index]) return false;
  }
  return true;
}
