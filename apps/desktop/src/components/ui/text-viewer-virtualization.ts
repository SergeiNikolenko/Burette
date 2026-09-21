"use client";

import * as React from "react";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

const DEFAULT_VIEWPORT_HEIGHT = 600;
const DEFAULT_VIEWPORT_WIDTH = 800;
const DEFAULT_OVERSCAN = 6;
const MAX_VIRTUAL_ITEMS = 500;

export interface TextVirtualItem {
  index: number;
  key: React.Key;
  start: number;
  size: number;
  end: number;
}

export interface TextVirtualOffsets {
  starts: number[];
  totalSize: number;
}

export interface TextVirtualViewport {
  scrollTop: number;
  clientHeight: number;
  clientWidth: number;
}

export interface TextScrollAnchor {
  index: number;
  offsetWithinLine: number;
}

export interface TextFrameVirtualItem {
  end: number;
  index: number;
  key: React.Key;
  size: number;
  start: number;
}

export interface TextFrameGeometry {
  bottom: number;
  height: number;
  top: number;
}

export interface TextFrameScrollAnchor {
  index: number;
  offsetWithinFrame: number;
}

export interface TextInverseStickyWindow {
  afterHeight: number;
  beforeHeight: number;
  renderedBottom: number;
  renderedHeight: number;
  renderedTop: number;
  stickyOffset: number;
}

export function buildTextVirtualOffsets({
  itemSizes,
  paddingStart = 0,
  paddingEnd = 0,
}: {
  itemSizes: readonly number[];
  paddingStart?: number;
  paddingEnd?: number;
}): TextVirtualOffsets {
  const starts: number[] = [];
  let offset = safeSize(paddingStart);

  for (const itemSize of itemSizes) {
    starts.push(offset);
    offset += safeSize(itemSize);
  }

  return {
    starts,
    totalSize: offset + safeSize(paddingEnd),
  };
}

export function getTextVirtualItems({
  itemSizes,
  offsets,
  scrollTop,
  viewportHeight,
  overscan = DEFAULT_OVERSCAN,
}: {
  itemSizes: readonly number[];
  offsets: TextVirtualOffsets;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}): TextVirtualItem[] {
  const count = itemSizes.length;
  if (count === 0) return [];

  const safeScrollTop = safeOffset(scrollTop);
  const safeViewportHeight = Math.max(1, safeSize(viewportHeight));
  const safeOverscan = safeCount(overscan);
  const visibleStartIndex = findFirstItemEndingAfter({
    itemSizes,
    starts: offsets.starts,
    offset: safeScrollTop,
  });
  const visibleEndExclusive = findFirstItemStartingAtOrAfter({
    starts: offsets.starts,
    offset: safeScrollTop + safeViewportHeight,
  });
  const start = Math.max(0, visibleStartIndex - safeOverscan);
  const end = Math.min(
    count,
    Math.max(visibleStartIndex + 1, visibleEndExclusive) + safeOverscan,
  );
  const cappedEnd = Math.min(count, start + MAX_VIRTUAL_ITEMS);

  return Array.from(
    { length: Math.min(end, cappedEnd) - start },
    (_, localIndex) => {
      const index = start + localIndex;
      const size = safeSize(itemSizes[index]);
      const itemStart = offsets.starts[index] ?? 0;
      return {
        index,
        key: index,
        start: itemStart,
        size,
        end: itemStart + size,
      };
    },
  );
}

export function textScrollTopForItem({
  itemIndex,
  itemSizes,
  offsets,
  viewportHeight,
  align = "center",
}: {
  itemIndex: number;
  itemSizes: readonly number[];
  offsets: TextVirtualOffsets;
  viewportHeight: number;
  align?: "start" | "center" | "end";
}) {
  if (!Number.isSafeInteger(itemIndex) || itemIndex < 0) return 0;
  const itemStart = offsets.starts[itemIndex];
  if (itemStart == null) return 0;

  const itemSize = safeSize(itemSizes[itemIndex]);
  const safeViewportHeight = safeSize(viewportHeight);
  if (align === "end") {
    return Math.max(0, itemStart - safeViewportHeight + itemSize);
  }
  if (align === "center") {
    return Math.max(0, itemStart - safeViewportHeight / 2 + itemSize / 2);
  }
  return Math.max(0, itemStart);
}

export function getTextScrollAnchor({
  itemSizes,
  offsets,
  scrollTop,
}: {
  itemSizes: readonly number[];
  offsets: Pick<TextVirtualOffsets, "starts">;
  scrollTop: number;
}): TextScrollAnchor | null {
  if (itemSizes.length === 0) return null;

  const safeScrollTop = safeOffset(scrollTop);
  let low = 0;
  let high = itemSizes.length - 1;
  let index = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = offsets.starts[mid] ?? 0;
    const end = start + safeSize(itemSizes[mid]);
    if (end > safeScrollTop) {
      index = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return {
    index,
    offsetWithinLine: Math.max(0, safeScrollTop - (offsets.starts[index] ?? 0)),
  };
}

export function useTextVariableVirtualizer({
  itemSizes,
  overscan = DEFAULT_OVERSCAN,
  paddingStart = 0,
  paddingEnd = 0,
  scrollRef,
}: {
  itemSizes: readonly number[];
  overscan?: number;
  paddingStart?: number;
  paddingEnd?: number;
  scrollRef: React.RefObject<HTMLElement | null>;
}) {
  const viewport = useTextVirtualViewport(scrollRef);
  const offsets = React.useMemo(
    () => buildTextVirtualOffsets({ itemSizes, paddingStart, paddingEnd }),
    [itemSizes, paddingEnd, paddingStart],
  );
  const viewportHeight = viewport.clientHeight || DEFAULT_VIEWPORT_HEIGHT;
  const viewportWidth = viewport.clientWidth || DEFAULT_VIEWPORT_WIDTH;
  const virtualItems = React.useMemo(
    () =>
      getTextVirtualItems({
        itemSizes,
        offsets,
        overscan,
        scrollTop: viewport.scrollTop,
        viewportHeight,
      }),
    [itemSizes, offsets, overscan, viewport.scrollTop, viewportHeight],
  );
  return {
    offsets,
    totalSize: offsets.totalSize,
    viewportHeight,
    viewportWidth,
    virtualItems,
  };
}

export function getTextFrameVirtualItems({
  frames,
  maxItems = MAX_VIRTUAL_ITEMS,
  overscanPx = 0,
  scrollTop,
  viewportHeight,
}: {
  frames: readonly TextFrameGeometry[];
  maxItems?: number;
  overscanPx?: number;
  scrollTop: number;
  viewportHeight: number;
}): TextFrameVirtualItem[] {
  if (frames.length === 0) return [];

  const safeScrollTop = safeOffset(scrollTop);
  const safeViewportHeight = Math.max(1, safeSize(viewportHeight));
  const safeOverscanPx = safeSize(overscanPx);
  const visibleStart = findFirstFrameEndingAfter(frames, safeScrollTop);
  const visibleEnd = Math.max(
    visibleStart + 1,
    findFirstFrameStartingAtOrAfter(
      frames,
      safeScrollTop + safeViewportHeight,
      visibleStart,
    ),
  );
  const start = findFirstFrameEndingAfter(
    frames,
    Math.max(0, safeScrollTop - safeOverscanPx),
  );
  const end = Math.max(
    visibleEnd,
    findFirstFrameStartingAtOrAfter(
      frames,
      safeScrollTop + safeViewportHeight + safeOverscanPx,
      visibleStart,
    ),
  );
  const safeMaxItems = Math.max(visibleEnd - start, safeCount(maxItems));
  const cappedEnd = Math.min(frames.length, end, start + safeMaxItems);

  return Array.from({ length: cappedEnd - start }, (_, localIndex) => {
    const index = start + localIndex;
    const frame = frames[index]!;
    return {
      end: frame.bottom,
      index,
      key: index,
      size: safeSize(frame.height),
      start: frame.top,
    };
  });
}

export function getTextInverseStickyWindow({
  renderedBottom,
  renderedTop,
  totalHeight,
  viewportHeight,
}: {
  renderedBottom: number;
  renderedTop: number;
  totalHeight: number;
  viewportHeight: number;
}): TextInverseStickyWindow {
  const safeTotalHeight = safeOffset(totalHeight);
  const safeViewportHeight = Math.max(1, safeSize(viewportHeight));
  const top = clamp(safeOffset(renderedTop), 0, safeTotalHeight);
  const bottom = clamp(
    Math.max(top, safeOffset(renderedBottom)),
    top,
    safeTotalHeight,
  );
  const renderedHeight = bottom - top;

  return {
    afterHeight: Math.max(0, safeTotalHeight - bottom),
    beforeHeight: top,
    renderedBottom: bottom,
    renderedHeight,
    renderedTop: top,
    stickyOffset: -Math.max(0, renderedHeight - safeViewportHeight),
  };
}

export function getTextFrameScrollAnchor({
  frames,
  scrollTop,
}: {
  frames: readonly TextFrameGeometry[];
  scrollTop: number;
}): TextFrameScrollAnchor | null {
  if (frames.length === 0) return null;

  const safeScrollTop = safeOffset(scrollTop);
  const index = findFirstFrameEndingAfter(frames, safeScrollTop);
  const frame = frames[index] ?? frames[frames.length - 1];
  if (!frame) return null;

  return {
    index,
    offsetWithinFrame: Math.max(0, safeScrollTop - frame.top),
  };
}

export function useTextVirtualViewport(
  scrollRef: React.RefObject<HTMLElement | null>,
): TextVirtualViewport {
  const [viewport, setViewport] = React.useState<TextVirtualViewport>({
    scrollTop: 0,
    clientHeight: 0,
    clientWidth: 0,
  });

  useKeyedLayoutEffect(joinEffectKey([scrollRef]), () => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    let frame = 0;
    const readViewport = () => {
      frame = 0;
      const next = {
        scrollTop: safeOffset(scrollElement.scrollTop),
        clientHeight: safeSize(scrollElement.clientHeight),
        clientWidth: safeSize(scrollElement.clientWidth),
      };
      setViewport((current) =>
        current.scrollTop === next.scrollTop &&
        current.clientHeight === next.clientHeight &&
        current.clientWidth === next.clientWidth
          ? current
          : next,
      );
    };
    const scheduleRead = () => {
      if (frame) return;
      frame = requestAnimationFrame(readViewport);
    };

    readViewport();
    scrollElement.addEventListener("scroll", scheduleRead, { passive: true });
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleRead)
        : null;
    observer?.observe(scrollElement);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      scrollElement.removeEventListener("scroll", scheduleRead);
      observer?.disconnect();
    };
  });

  return viewport;
}

function findFirstFrameEndingAfter(
  frames: readonly TextFrameGeometry[],
  offset: number,
) {
  let low = 0;
  let high = frames.length - 1;
  let result = frames.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((frames[mid]?.bottom ?? 0) > offset) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

function findFirstFrameStartingAtOrAfter(
  frames: readonly TextFrameGeometry[],
  offset: number,
  start: number,
) {
  let low = Math.max(0, start);
  let high = frames.length - 1;
  let result = frames.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((frames[mid]?.top ?? 0) >= offset) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

function findFirstItemEndingAfter({
  itemSizes,
  starts,
  offset,
}: {
  itemSizes: readonly number[];
  starts: readonly number[];
  offset: number;
}) {
  let low = 0;
  let high = itemSizes.length - 1;
  let result = itemSizes.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const end = (starts[mid] ?? 0) + safeSize(itemSizes[mid]);
    if (end > offset) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

function findFirstItemStartingAtOrAfter({
  starts,
  offset,
}: {
  starts: readonly number[];
  offset: number;
}) {
  let low = 0;
  let high = starts.length - 1;
  let result = starts.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((starts[mid] ?? 0) >= offset) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

function safeCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function safeOffset(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeSize(value: number | undefined) {
  return Number.isFinite(value) && value != null && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
