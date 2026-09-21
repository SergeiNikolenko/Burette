import {
  CODE_VIEWER_BLOCK_PADDING,
  CODE_VIEWER_LINE_CHECKPOINT_INTERVAL,
  CODE_VIEWER_SCROLL_REBASE_CONTAINER_PX,
  CODE_VIEWER_SCROLL_REBASE_TARGET_BOTTOM_PX,
  CODE_VIEWER_SCROLL_REBASE_TARGET_PX,
  CODE_VIEWER_SCROLL_REBASE_THRESHOLD_PX,
  CODE_VIEWER_SCROLL_REBASE_TRIGGER_PX,
} from "./code-viewer-scale";

export interface CodeVirtualLine {
  index: number;
  key: number;
  size: number;
  start: number;
}

export interface CodeVirtualLineWindow {
  lineCount: number;
  lineHeight: number;
  overscanPx: number;
  paddingStart: number;
  scrollTop: number;
  viewportHeight: number;
}

export interface CodeVirtualPixelWindow {
  bottom: number;
  top: number;
}

export interface CodeVirtualLineWindowResult {
  lines: CodeVirtualLine[];
  pixelWindow: CodeVirtualPixelWindow;
}

export interface CodeLineCheckpoint {
  index: number;
  start: number;
}

export interface CodeScrollRebaseState {
  scrollPageOffset: number;
}

export interface CodeScrollRebasePosition extends CodeScrollRebaseState {
  physicalScrollTop: number;
}

export function getCodeVirtualLines({
  lineCount,
  lineHeight,
  overscanPx,
  paddingStart,
  scrollTop,
  viewportHeight,
}: CodeVirtualLineWindow): CodeVirtualLine[] {
  return getCodeVirtualLineWindow({
    lineCount,
    lineHeight,
    overscanPx,
    paddingStart,
    scrollTop,
    viewportHeight,
  }).lines;
}

export function getCodeVirtualLineWindow({
  lineCount,
  lineHeight,
  overscanPx,
  paddingStart,
  scrollTop,
  viewportHeight,
}: CodeVirtualLineWindow): CodeVirtualLineWindowResult {
  const safeLineCount = safeCount(lineCount);
  const safeLineHeight = safeSize(lineHeight);
  if (safeLineCount === 0) {
    return {
      lines: [],
      pixelWindow: { bottom: 0, top: 0 },
    };
  }

  const safeScrollTop = Math.max(0, finiteNumber(scrollTop));
  const safeViewportHeight = Math.max(0, finiteNumber(viewportHeight));
  const safePaddingStart = safePadding(paddingStart);
  const totalSize = getCodeVirtualTotalSize({
    lineCount: safeLineCount,
    lineHeight: safeLineHeight,
    paddingStart: safePaddingStart,
  });
  const window = getCodeVirtualPixelWindow({
    overscanPx,
    scrollHeight: totalSize,
    scrollTop: safeScrollTop,
    viewportHeight: safeViewportHeight,
  });
  const start = getCodeLineIndexAtOffset({
    lineCount: safeLineCount,
    lineHeight: safeLineHeight,
    offset: window.top,
    paddingStart: safePaddingStart,
  });
  const end = Math.min(
    safeLineCount,
    getCodeLineIndexAfterOffset({
      lineCount: safeLineCount,
      lineHeight: safeLineHeight,
      offset: window.bottom,
      paddingStart: safePaddingStart,
    }),
  );

  return {
    lines: Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      return {
        index,
        key: index,
        size: safeLineHeight,
        start: safePaddingStart + index * safeLineHeight,
      };
    }),
    pixelWindow: window,
  };
}

export function getCodeLineCheckpoint({
  lineCount,
  lineHeight,
  offset,
  paddingStart = CODE_VIEWER_BLOCK_PADDING,
}: {
  lineCount: number;
  lineHeight: number;
  offset: number;
  paddingStart?: number;
}): CodeLineCheckpoint {
  const safeLineCount = safeCount(lineCount);
  if (safeLineCount === 0) {
    return {
      index: 0,
      start: safePadding(paddingStart),
    };
  }

  const safeLineHeight = safeSize(lineHeight);
  const safePaddingStart = safePadding(paddingStart);
  const lineIndex = clamp(
    Math.floor(Math.max(0, finiteNumber(offset) - safePaddingStart) / safeLineHeight),
    0,
    safeLineCount - 1,
  );
  const checkpointIndex =
    Math.floor(lineIndex / CODE_VIEWER_LINE_CHECKPOINT_INTERVAL) *
    CODE_VIEWER_LINE_CHECKPOINT_INTERVAL;

  return {
    index: checkpointIndex,
    start: safePaddingStart + checkpointIndex * safeLineHeight,
  };
}

export function getCodeLineIndexAtOffset({
  lineCount,
  lineHeight,
  offset,
  paddingStart = CODE_VIEWER_BLOCK_PADDING,
}: {
  lineCount: number;
  lineHeight: number;
  offset: number;
  paddingStart?: number;
}) {
  const safeLineCount = safeCount(lineCount);
  if (safeLineCount === 0) return 0;

  const safeLineHeight = safeSize(lineHeight);
  const checkpoint = getCodeLineCheckpoint({
    lineCount: safeLineCount,
    lineHeight: safeLineHeight,
    offset,
    paddingStart,
  });
  const indexFromCheckpoint = Math.floor(
    Math.max(0, finiteNumber(offset) - checkpoint.start) / safeLineHeight,
  );

  return clamp(checkpoint.index + indexFromCheckpoint, 0, safeLineCount - 1);
}

export function getCodeLineIndexAfterOffset({
  lineCount,
  lineHeight,
  offset,
  paddingStart = CODE_VIEWER_BLOCK_PADDING,
}: {
  lineCount: number;
  lineHeight: number;
  offset: number;
  paddingStart?: number;
}) {
  const safeLineCount = safeCount(lineCount);
  if (safeLineCount === 0) return 0;

  const safeLineHeight = safeSize(lineHeight);
  const checkpoint = getCodeLineCheckpoint({
    lineCount: safeLineCount,
    lineHeight: safeLineHeight,
    offset,
    paddingStart,
  });
  const indexFromCheckpoint = Math.ceil(
    Math.max(0, finiteNumber(offset) - checkpoint.start) / safeLineHeight,
  );

  return clamp(checkpoint.index + indexFromCheckpoint, 0, safeLineCount);
}

export function getCodeVirtualPixelWindow({
  overscanPx,
  scrollHeight,
  scrollTop,
  viewportHeight,
}: {
  overscanPx: number;
  scrollHeight: number;
  scrollTop: number;
  viewportHeight: number;
}): CodeVirtualPixelWindow {
  const safeOverscanPx = safePadding(overscanPx);
  const safeViewportHeight = Math.max(0, finiteNumber(viewportHeight));
  const windowHeight = safeViewportHeight + safeOverscanPx * 2;
  const safeScrollHeight = Math.max(0, finiteNumber(scrollHeight));

  if (windowHeight >= safeScrollHeight) {
    return { bottom: safeScrollHeight, top: 0 };
  }

  const scrollCenter = Math.max(0, finiteNumber(scrollTop)) + safeViewportHeight / 2;
  let top = scrollCenter - windowHeight / 2;
  let bottom = top + windowHeight;

  if (top < 0) {
    top = 0;
    bottom = windowHeight;
  }
  if (bottom > safeScrollHeight) {
    bottom = safeScrollHeight;
    top = safeScrollHeight - windowHeight;
  }

  return {
    bottom: Math.ceil(Math.max(bottom, top)),
    top: Math.floor(Math.max(0, top)),
  };
}

export function getCodeVirtualTotalSize({
  lineCount,
  lineHeight,
  paddingEnd = CODE_VIEWER_BLOCK_PADDING,
  paddingStart = CODE_VIEWER_BLOCK_PADDING,
}: {
  lineCount: number;
  lineHeight: number;
  paddingEnd?: number;
  paddingStart?: number;
}) {
  return (
    safePadding(paddingStart) +
    safeCount(lineCount) * safeSize(lineHeight) +
    safePadding(paddingEnd)
  );
}

export function getCodePhysicalScrollSize({
  totalSize,
  viewportHeight,
}: {
  totalSize: number;
  viewportHeight: number;
}) {
  const safeTotalSize = safeSize(totalSize);
  return shouldRebaseCodeScroll({ totalSize: safeTotalSize, viewportHeight })
    ? Math.min(safeTotalSize, CODE_VIEWER_SCROLL_REBASE_CONTAINER_PX)
    : safeTotalSize;
}

export function getCodeLogicalScrollTop({
  physicalScrollTop,
  scrollPageOffset,
  totalSize,
  viewportHeight,
}: {
  physicalScrollTop: number;
  scrollPageOffset: number;
  totalSize: number;
  viewportHeight: number;
}) {
  return clamp(
    finiteNumber(physicalScrollTop) + safePadding(scrollPageOffset),
    0,
    getCodeMaxLogicalScrollTop({ totalSize, viewportHeight }),
  );
}

export function resolveCodePhysicalScrollPosition({
  logicalScrollTop,
  scrollPageOffset,
  totalSize,
  viewportHeight,
}: {
  logicalScrollTop: number;
  scrollPageOffset: number;
  totalSize: number;
  viewportHeight: number;
}): CodeScrollRebasePosition {
  const safeLogicalScrollTop = clamp(
    finiteNumber(logicalScrollTop),
    0,
    getCodeMaxLogicalScrollTop({ totalSize, viewportHeight }),
  );

  if (!shouldRebaseCodeScroll({ totalSize, viewportHeight })) {
    return {
      physicalScrollTop: clamp(
        safeLogicalScrollTop,
        0,
        getCodeMaxPhysicalScrollTop({ totalSize, viewportHeight }),
      ),
      scrollPageOffset: 0,
    };
  }

  const currentPageOffset = clampCodeScrollPageOffset({
    scrollPageOffset,
    totalSize,
    viewportHeight,
  });
  const physicalScrollTop = safeLogicalScrollTop - currentPageOffset;
  const maxPhysicalScrollTop = getCodeMaxPhysicalScrollTop({
    totalSize,
    viewportHeight,
  });
  const maxPageOffset = getCodeMaxScrollPageOffset({ totalSize, viewportHeight });
  const shouldMoveDown =
    physicalScrollTop > CODE_VIEWER_SCROLL_REBASE_THRESHOLD_PX &&
    currentPageOffset < maxPageOffset;
  const shouldMoveUp =
    physicalScrollTop < CODE_VIEWER_SCROLL_REBASE_TRIGGER_PX &&
    currentPageOffset > 0;

  if (
    physicalScrollTop < 0 ||
    physicalScrollTop > maxPhysicalScrollTop ||
    shouldMoveDown ||
    shouldMoveUp
  ) {
    return resolveCodeScrollPageWindow({
      logicalScrollTop: safeLogicalScrollTop,
      preferredPhysicalScrollTop: shouldMoveUp
        ? Math.min(
            CODE_VIEWER_SCROLL_REBASE_TARGET_BOTTOM_PX,
            maxPhysicalScrollTop,
          )
        : CODE_VIEWER_SCROLL_REBASE_TARGET_PX,
      totalSize,
      viewportHeight,
    });
  }

  return {
    physicalScrollTop: roundCodeScrollPixel(
      clamp(physicalScrollTop, 0, maxPhysicalScrollTop),
    ),
    scrollPageOffset: currentPageOffset,
  };
}

export function getCodePagedLayoutTop({
  logicalTop,
  scrollPageOffset,
  totalSize,
  viewportHeight,
}: {
  logicalTop: number;
  scrollPageOffset: number;
  totalSize: number;
  viewportHeight: number;
}) {
  if (!shouldRebaseCodeScroll({ totalSize, viewportHeight })) {
    return finiteNumber(logicalTop);
  }
  return Math.max(0, finiteNumber(logicalTop) - safePadding(scrollPageOffset));
}

function shouldRebaseCodeScroll({
  totalSize,
  viewportHeight,
}: {
  totalSize: number;
  viewportHeight: number;
}) {
  return (
    getCodeMaxLogicalScrollTop({ totalSize, viewportHeight }) >
    CODE_VIEWER_SCROLL_REBASE_THRESHOLD_PX
  );
}

function getCodeMaxLogicalScrollTop({
  totalSize,
  viewportHeight,
}: {
  totalSize: number;
  viewportHeight: number;
}) {
  return Math.max(safeSize(totalSize) - Math.max(0, finiteNumber(viewportHeight)), 0);
}

function getCodeMaxPhysicalScrollTop({
  totalSize,
  viewportHeight,
}: {
  totalSize: number;
  viewportHeight: number;
}) {
  return Math.max(
    getCodePhysicalScrollSize({ totalSize, viewportHeight }) -
      Math.max(0, finiteNumber(viewportHeight)),
    0,
  );
}

function getCodeMaxScrollPageOffset({
  totalSize,
  viewportHeight,
}: {
  totalSize: number;
  viewportHeight: number;
}) {
  return Math.max(
    getCodeMaxLogicalScrollTop({ totalSize, viewportHeight }) -
      getCodeMaxPhysicalScrollTop({ totalSize, viewportHeight }),
    0,
  );
}

function clampCodeScrollPageOffset({
  scrollPageOffset,
  totalSize,
  viewportHeight,
}: {
  scrollPageOffset: number;
  totalSize: number;
  viewportHeight: number;
}) {
  return clamp(
    safePadding(scrollPageOffset),
    0,
    getCodeMaxScrollPageOffset({ totalSize, viewportHeight }),
  );
}

function resolveCodeScrollPageWindow({
  logicalScrollTop,
  preferredPhysicalScrollTop,
  totalSize,
  viewportHeight,
}: {
  logicalScrollTop: number;
  preferredPhysicalScrollTop: number;
  totalSize: number;
  viewportHeight: number;
}): CodeScrollRebasePosition {
  let physicalScrollTop = roundCodeScrollPixel(
    clamp(
      finiteNumber(preferredPhysicalScrollTop),
      0,
      getCodeMaxPhysicalScrollTop({ totalSize, viewportHeight }),
    ),
  );
  let scrollPageOffset = clampCodeScrollPageOffset({
    scrollPageOffset: logicalScrollTop - physicalScrollTop,
    totalSize,
    viewportHeight,
  });

  physicalScrollTop = roundCodeScrollPixel(
    clamp(
      logicalScrollTop - scrollPageOffset,
      0,
      getCodeMaxPhysicalScrollTop({ totalSize, viewportHeight }),
    ),
  );
  scrollPageOffset = clampCodeScrollPageOffset({
    scrollPageOffset: logicalScrollTop - physicalScrollTop,
    totalSize,
    viewportHeight,
  });

  return { physicalScrollTop, scrollPageOffset };
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function roundCodeScrollPixel(value: number) {
  if (typeof window === "undefined") return Math.round(value);
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

function safeCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function safeSize(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function safePadding(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
