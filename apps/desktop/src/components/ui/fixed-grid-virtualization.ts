"use client";

import * as React from "react";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

const MINIMUM_ROW_WINDOW = 32;
const INITIAL_COLUMN_WINDOW = 8;
const MAX_VIRTUAL_ITEMS = 10_000;
const MAX_EAGER_COLUMN_ITEMS = 10_000;

export interface FixedGridColumnItem {
  index: number;
  widthPx: number;
}

export interface FixedGridVirtualItem {
  index: number;
  start: number;
  size: number;
  end: number;
}

export interface FixedGridRowPoolSlot {
  slotIndex: number;
  virtualRow: FixedGridVirtualItem | null;
  isHidden: boolean;
}

export interface FixedGridVirtualItemWindow {
  end: number;
  items: FixedGridVirtualItem[];
  size: number;
  start: number;
}

export interface FixedGridScrollTarget {
  rowIndex: number;
  columnIndex: number;
  align?: "start" | "center" | "end" | "auto";
  behavior?: ScrollBehavior;
}

export interface FixedRowScrollTarget {
  rowIndex: number;
  align?: "start" | "center" | "end" | "auto";
  behavior?: ScrollBehavior;
}

export type FixedGridJumpViewportResult = "handled" | "pass";

export interface FixedGridRowScrollStrategy {
  settleAfterMs?: number;
  handleViewport: (viewport: FixedGridViewport) => FixedGridJumpViewportResult;
}

export function useFixedRowPool({
  minimumPoolSize = 0,
  rowCount,
  virtualRows,
}: {
  minimumPoolSize?: number;
  rowCount: number;
  virtualRows: FixedGridVirtualItem[];
}): FixedGridRowPoolSlot[] {
  const poolSizeRef = React.useRef(0);
  const safeRowCount = fixedItemCount(rowCount);
  const safeMinimumPoolSize = fixedItemCount(minimumPoolSize);
  const nextPoolSize = Math.min(
    safeRowCount,
    Math.max(poolSizeRef.current, virtualRows.length, safeMinimumPoolSize),
  );
  poolSizeRef.current = nextPoolSize;

  return React.useMemo(
    () =>
      Array.from({ length: nextPoolSize }, (_, slotIndex) => {
        const virtualRow = virtualRows[slotIndex] ?? null;
        return {
          slotIndex,
          virtualRow,
          isHidden: !virtualRow,
        };
      }),
    [nextPoolSize, virtualRows],
  );
}

export function useFixedGridVirtualization({
  rowCount,
  columnCount,
  rowSize,
  columnSize,
  rowOverscan,
  columnOverscan,
  jumpRowOverscan = rowOverscan,
  jumpColumnOverscan = columnOverscan,
  minimumRenderedRows = MINIMUM_ROW_WINDOW,
  rowScrollStrategy,
  scrollRef,
  scrollElement,
  virtualizeColumns = true,
}: {
  rowCount: number;
  columnCount: number;
  rowSize: number;
  columnSize: number;
  rowOverscan: number;
  columnOverscan: number;
  jumpRowOverscan?: number;
  jumpColumnOverscan?: number;
  minimumRenderedRows?: number;
  rowScrollStrategy?: FixedGridRowScrollStrategy;
  scrollRef: React.RefObject<HTMLElement | null>;
  scrollElement?: HTMLElement | null;
  virtualizeColumns?: boolean;
}) {
  const resolvedScrollElement = useResolvedScrollElement({
    scrollRef,
    scrollElement,
  });
  const viewport = useFixedGridViewport(
    resolvedScrollElement,
    rowScrollStrategy,
    {
      rowCount,
      columnCount,
      rowSize,
      columnSize,
    },
  );

  const totalRowSize = fixedTotalSize(rowCount, rowSize);
  const totalColumnSize = fixedTotalSize(columnCount, columnSize);
  const activeRowOverscan = viewport.isJumpingRows
    ? jumpRowOverscan
    : rowOverscan;
  const activeColumnOverscan =
    viewport.isJumpingColumns || viewport.isJumpingRows
      ? jumpColumnOverscan
      : columnOverscan;

  const virtualRows = React.useMemo(
    () =>
      fixedVirtualItems({
        count: rowCount,
        size: rowSize,
        scrollOffset: viewport.scrollTop,
        viewportSize: viewport.clientHeight,
        overscan: activeRowOverscan,
        minimumVisibleCount: minimumRenderedRows,
      }),
    [
      rowCount,
      rowSize,
      viewport.scrollTop,
      viewport.clientHeight,
      activeRowOverscan,
      minimumRenderedRows,
    ],
  );
  const virtualRowWindow = React.useMemo(
    () => fixedVirtualItemWindow(virtualRows),
    [virtualRows],
  );

  const columnWindow = React.useMemo<{
    columnItems: FixedGridColumnItem[];
    leftPad: number;
    rightPad: number;
  }>(() => {
    if (!virtualizeColumns) {
      const safeColumnCount = fixedItemCount(columnCount);
      const safeColumnSize = fixedItemSize(columnSize);
      if (safeColumnCount > MAX_EAGER_COLUMN_ITEMS) {
        return {
          columnItems: [],
          leftPad: 0,
          rightPad: 0,
        };
      }
      return {
        columnItems: Array.from({ length: safeColumnCount }, (_, index) => ({
          index,
          widthPx: safeColumnSize,
        })),
        leftPad: 0,
        rightPad: 0,
      };
    }

    const virtualColumns = fixedVirtualItems({
      count: columnCount,
      size: columnSize,
      scrollOffset: viewport.scrollLeft,
      viewportSize: viewport.clientWidth,
      overscan: activeColumnOverscan,
      minimumVisibleCount: INITIAL_COLUMN_WINDOW,
    });

    return {
      columnItems: virtualColumns.map((item) => ({
        index: item.index,
        widthPx: item.size,
      })),
      leftPad: virtualColumns.length ? virtualColumns[0].start : 0,
      rightPad: virtualColumns.length
        ? totalColumnSize - virtualColumns[virtualColumns.length - 1].end
        : 0,
    };
  }, [
    virtualizeColumns,
    columnCount,
    columnSize,
    viewport.scrollLeft,
    viewport.clientWidth,
    activeColumnOverscan,
    totalColumnSize,
  ]);

  const scrollToCell = React.useCallback(
    ({
      rowIndex,
      columnIndex,
      align = "center",
      behavior = "smooth",
    }: FixedGridScrollTarget) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;
      const top = fixedScrollOffset({
        index: rowIndex,
        itemSize: rowSize,
        viewportSize: scrollElement.clientHeight,
        align,
      });
      const left = fixedScrollOffset({
        index: columnIndex,
        itemSize: columnSize,
        viewportSize: scrollElement.clientWidth,
        align,
      });
      if (typeof scrollElement.scrollTo === "function") {
        scrollElement.scrollTo({ top, left, behavior });
      } else {
        scrollElement.scrollTop = top;
        scrollElement.scrollLeft = left;
      }
    },
    [columnSize, rowSize, scrollRef],
  );

  return {
    virtualRows,
    virtualRowWindow,
    totalRowSize,
    totalColumnSize,
    scrollToCell,
    isJumpingRows: viewport.isJumpingRows,
    isJumpingColumns: viewport.isJumpingColumns,
    viewportClientHeight: viewport.clientHeight,
    ...columnWindow,
  };
}

export function useFixedRowVirtualization({
  rowCount,
  rowSize,
  rowOverscan,
  jumpRowOverscan = rowOverscan,
  initialViewportHeight = 0,
  scrollRef,
  scrollElement,
}: {
  rowCount: number;
  rowSize: number;
  rowOverscan: number;
  jumpRowOverscan?: number;
  initialViewportHeight?: number;
  scrollRef: React.RefObject<HTMLElement | null>;
  scrollElement?: HTMLElement | null;
}) {
  const resolvedScrollElement = useResolvedScrollElement({
    scrollRef,
    scrollElement,
  });
  const [range, setRange] = React.useState(() =>
    initialViewportHeight > 0
      ? fixedRowRange({
          rowCount,
          rowSize,
          scrollTop: 0,
          viewportHeight: initialViewportHeight,
          rowOverscan,
        })
      : { start: 0, end: 0 },
  );
  const rangeRef = React.useRef(range);
  const rafRef = React.useRef(0);
  const totalRowSize = fixedTotalSize(rowCount, rowSize);
  const [viewportClientHeight, setViewportClientHeight] = React.useState(() =>
    fixedViewportMetric(initialViewportHeight),
  );

  const setMeasuredRange = React.useCallback((next: typeof range) => {
    const current = rangeRef.current;
    if (current.start === next.start && current.end === next.end) return;
    rangeRef.current = next;
    setRange(next);
  }, []);
  const setMeasuredViewportHeight = React.useCallback((next: number) => {
    setViewportClientHeight((current) => (current === next ? current : next));
  }, []);

  const measure = React.useCallback(() => {
    const scrollElement = resolvedScrollElement;
    const safeRowCount = fixedItemCount(rowCount);
    const safeRowSize = fixedItemSize(rowSize);
    if (!scrollElement || safeRowCount <= 0 || safeRowSize <= 0) {
      setMeasuredRange({ start: 0, end: 0 });
      return;
    }

    const scrollTop =
      Number.isFinite(scrollElement.scrollTop) && scrollElement.scrollTop > 0
        ? scrollElement.scrollTop
        : 0;
    const viewportHeight =
      Number.isFinite(scrollElement.clientHeight) &&
      scrollElement.clientHeight > 0
        ? scrollElement.clientHeight
        : fixedViewportMetric(initialViewportHeight);
    setMeasuredViewportHeight(viewportHeight);
    const firstVisibleRow = clamp(
      Math.floor(scrollTop / safeRowSize),
      0,
      safeRowCount - 1,
    );
    const visibleRowCount = Math.ceil(viewportHeight / safeRowSize);
    const previous = rangeRef.current;
    const isJumping =
      Math.abs(firstVisibleRow - previous.start) > visibleRowCount * 0.45;
    const activeOverscan = fixedOverscan(
      isJumping ? jumpRowOverscan : rowOverscan,
    );
    const uncappedStart = Math.max(0, firstVisibleRow - activeOverscan);
    const uncappedEnd = Math.min(
      safeRowCount,
      firstVisibleRow + visibleRowCount + activeOverscan,
    );
    const { start, end } = capVirtualRange({
      uncappedStart,
      uncappedEnd,
      visibleStart: firstVisibleRow,
      visibleEnd: Math.min(safeRowCount, firstVisibleRow + visibleRowCount),
      maxItems: MAX_VIRTUAL_ITEMS,
    });

    if (previous.end > safeRowCount || previous.start >= safeRowCount) {
      setMeasuredRange({ start, end });
      return;
    }

    const bufferRows = Math.max(1, Math.floor(activeOverscan / 2));
    const visibleStart = firstVisibleRow;
    const visibleEnd = Math.min(
      safeRowCount,
      firstVisibleRow + visibleRowCount,
    );
    const hasBeforeBuffer =
      previous.start === 0 || visibleStart >= previous.start + bufferRows;
    const hasAfterBuffer =
      previous.end === safeRowCount || visibleEnd <= previous.end - bufferRows;

    if (hasBeforeBuffer && hasAfterBuffer) return;
    setMeasuredRange({ start, end });
  }, [
    jumpRowOverscan,
    initialViewportHeight,
    rowCount,
    rowOverscan,
    rowSize,
    resolvedScrollElement,
    setMeasuredRange,
    setMeasuredViewportHeight,
  ]);

  useKeyedLayoutEffect(joinEffectKey([measure]), () => {
    measure();
  });

  useKeyedMountEffect(joinEffectKey([resolvedScrollElement, measure]), () => {
    const scrollElement = resolvedScrollElement;
    if (!scrollElement) return;

    const scheduleMeasure = () => {
      if (rafRef.current) return;
      let didRun = false;
      const frame = requestAnimationFrame(() => {
        didRun = true;
        rafRef.current = 0;
        measure();
      });
      rafRef.current = didRun ? 0 : frame;
    };

    scrollElement.addEventListener("scroll", scheduleMeasure, {
      passive: true,
    });
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleMeasure)
        : null;
    observer?.observe(scrollElement);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      scrollElement.removeEventListener("scroll", scheduleMeasure);
      observer?.disconnect();
    };
  });

  const virtualRows = React.useMemo(
    () =>
      Array.from({ length: range.end - range.start }, (_, offset) => {
        const index = range.start + offset;
        const size = fixedItemSize(rowSize);
        const start = index * size;
        return {
          index,
          start,
          size,
          end: start + size,
        };
      }),
    [range, rowSize],
  );
  const virtualRowWindow = React.useMemo(
    () => fixedVirtualItemWindow(virtualRows),
    [virtualRows],
  );

  const scrollToRow = React.useCallback(
    ({
      rowIndex,
      align = "center",
      behavior = "smooth",
    }: FixedRowScrollTarget) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;
      const top = fixedScrollOffset({
        index: rowIndex,
        itemSize: rowSize,
        viewportSize: scrollElement.clientHeight,
        align,
      });
      if (typeof scrollElement.scrollTo === "function") {
        scrollElement.scrollTo({ top, behavior });
      } else {
        scrollElement.scrollTop = top;
      }
    },
    [rowSize, scrollRef],
  );

  return {
    virtualRows,
    virtualRowWindow,
    totalRowSize,
    viewportClientHeight,
    scrollToRow,
  };
}

function fixedRowRange({
  rowCount,
  rowSize,
  scrollTop,
  viewportHeight,
  rowOverscan,
}: {
  rowCount: number;
  rowSize: number;
  scrollTop: number;
  viewportHeight: number;
  rowOverscan: number;
}) {
  const safeRowCount = fixedItemCount(rowCount);
  const safeRowSize = fixedItemSize(rowSize);
  if (safeRowCount <= 0 || safeRowSize <= 0) return { start: 0, end: 0 };

  const safeScrollTop =
    Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const safeViewportHeight = fixedViewportMetric(viewportHeight);
  const firstVisibleRow = clamp(
    Math.floor(safeScrollTop / safeRowSize),
    0,
    safeRowCount - 1,
  );
  const visibleRowCount = Math.ceil(safeViewportHeight / safeRowSize);
  const activeOverscan = fixedOverscan(rowOverscan);
  const uncappedStart = Math.max(0, firstVisibleRow - activeOverscan);
  const uncappedEnd = Math.min(
    safeRowCount,
    firstVisibleRow + visibleRowCount + activeOverscan,
  );
  return capVirtualRange({
    uncappedStart,
    uncappedEnd,
    visibleStart: firstVisibleRow,
    visibleEnd: Math.min(safeRowCount, firstVisibleRow + visibleRowCount),
    maxItems: MAX_VIRTUAL_ITEMS,
  });
}

export interface FixedGridViewport {
  scrollTop: number;
  scrollLeft: number;
  clientHeight: number;
  clientWidth: number;
  isJumpingRows: boolean;
  isJumpingColumns: boolean;
}

interface FixedGridLayoutMetrics {
  rowCount: number;
  columnCount: number;
  rowSize: number;
  columnSize: number;
}

interface FixedGridReadingAnchor {
  rowIndex: number;
  columnIndex: number;
  rowOffsetPx: number;
  columnOffsetPx: number;
}

interface FixedVirtualWindow {
  count: number;
  size: number;
  scrollOffset: number;
  viewportSize: number;
  overscan: number;
  minimumVisibleCount?: number;
}

const emptyFixedGridViewport: FixedGridViewport = {
  scrollTop: 0,
  scrollLeft: 0,
  clientHeight: 0,
  clientWidth: 0,
  isJumpingRows: false,
  isJumpingColumns: false,
};

function useResolvedScrollElement({
  scrollRef,
  scrollElement,
}: {
  scrollRef: React.RefObject<HTMLElement | null>;
  scrollElement?: HTMLElement | null;
}) {
  const [resolvedScrollElement, setResolvedScrollElement] =
    React.useState<HTMLElement | null>(scrollElement ?? scrollRef.current);

  useKeyedLayoutEffect(
    joinEffectKey([
      scrollRef,
      scrollRef.current,
      scrollElement,
      resolvedScrollElement,
    ]),
    () => {
      const nextScrollElement = scrollElement ?? scrollRef.current;
      if (resolvedScrollElement !== nextScrollElement) {
        setResolvedScrollElement(nextScrollElement);
      }
    },
  );

  return resolvedScrollElement;
}

function useFixedGridViewport(
  scrollElement: HTMLElement | null | undefined,
  rowScrollStrategy?: FixedGridRowScrollStrategy,
  layoutMetrics?: FixedGridLayoutMetrics,
) {
  const [viewport, setViewport] = React.useState<FixedGridViewport>(
    emptyFixedGridViewport,
  );
  const committedLayoutMetricsRef = React.useRef<FixedGridLayoutMetrics | null>(
    layoutMetrics ?? null,
  );

  useKeyedLayoutEffect(
    joinEffectKey([
      scrollElement,
      rowScrollStrategy,
      layoutMetrics?.rowCount,
      layoutMetrics?.columnCount,
      layoutMetrics?.rowSize,
      layoutMetrics?.columnSize,
    ]),
    () => {
      const previousLayoutMetrics = committedLayoutMetricsRef.current;
      committedLayoutMetricsRef.current = layoutMetrics ?? null;

      if (!scrollElement) {
        setViewport((current) =>
          fixedGridViewportEqual(current, emptyFixedGridViewport)
            ? current
            : emptyFixedGridViewport,
        );
        return;
      }

      let frame = 0;
      let settleTimeout = 0;
      let lastScrollTop = scrollElement.scrollTop;
      let lastScrollLeft = scrollElement.scrollLeft;

      if (
        previousLayoutMetrics &&
        layoutMetrics &&
        didFixedGridItemSizeChange(previousLayoutMetrics, layoutMetrics)
      ) {
        const anchor = captureFixedGridReadingAnchor({
          layoutMetrics: previousLayoutMetrics,
          scrollElement,
        });
        restoreFixedGridReadingAnchor({
          anchor,
          layoutMetrics,
          scrollElement,
        });
        lastScrollTop = scrollElement.scrollTop;
        lastScrollLeft = scrollElement.scrollLeft;
      }

      const commitViewport = (next: FixedGridViewport) => {
        setViewport((current) => {
          return fixedGridViewportEqual(current, next) ? current : next;
        });
      };

      const commitSettledViewport = () => {
        commitViewport({
          scrollTop: fixedViewportMetric(scrollElement.scrollTop),
          scrollLeft: fixedViewportMetric(scrollElement.scrollLeft),
          clientHeight: fixedViewportMetric(scrollElement.clientHeight),
          clientWidth: fixedViewportMetric(scrollElement.clientWidth),
          isJumpingRows: false,
          isJumpingColumns: false,
        });
      };

      const scheduleSettledViewport = () => {
        if (settleTimeout) window.clearTimeout(settleTimeout);
        settleTimeout = window.setTimeout(() => {
          settleTimeout = 0;
          // Scrolling has quiesced: re-read the live scroll metrics so the
          // canonical React window matches where the grid actually came to rest,
          // then clear jump flags so settled windows use the full overscan.
          commitSettledViewport();
        }, rowScrollStrategy?.settleAfterMs ?? 80);
      };

      const readViewport = () => {
        frame = 0;
        const scrollTop = fixedViewportMetric(scrollElement.scrollTop);
        const scrollLeft = fixedViewportMetric(scrollElement.scrollLeft);
        const clientHeight = fixedViewportMetric(scrollElement.clientHeight);
        const clientWidth = fixedViewportMetric(scrollElement.clientWidth);
        const rowDelta = Math.abs(scrollTop - lastScrollTop);
        const columnDelta = Math.abs(scrollLeft - lastScrollLeft);
        lastScrollTop = scrollTop;
        lastScrollLeft = scrollLeft;

        const next: FixedGridViewport = {
          scrollTop,
          scrollLeft,
          clientHeight,
          clientWidth,
          isJumpingRows: rowDelta > clientHeight * 0.45,
          isJumpingColumns: columnDelta > clientWidth * 0.45,
        };

        if (
          rowDelta > 0 &&
          rowScrollStrategy?.handleViewport(next) === "handled"
        ) {
          scheduleSettledViewport();
          return;
        }

        commitViewport(next);
        if (next.isJumpingRows || next.isJumpingColumns) {
          scheduleSettledViewport();
          return;
        }
        if (settleTimeout) {
          window.clearTimeout(settleTimeout);
          settleTimeout = 0;
        }
      };

      const scheduleRead = () => {
        if (frame) return;
        let didRun = false;
        const nextFrame = requestAnimationFrame(() => {
          didRun = true;
          readViewport();
        });
        frame = didRun ? 0 : nextFrame;
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
        if (settleTimeout) window.clearTimeout(settleTimeout);
        scrollElement.removeEventListener("scroll", scheduleRead);
        observer?.disconnect();
      };
    },
  );

  return viewport;
}

function didFixedGridItemSizeChange(
  previous: FixedGridLayoutMetrics,
  next: FixedGridLayoutMetrics,
) {
  return (
    previous.rowSize !== next.rowSize || previous.columnSize !== next.columnSize
  );
}

function captureFixedGridReadingAnchor({
  layoutMetrics,
  scrollElement,
}: {
  layoutMetrics: FixedGridLayoutMetrics;
  scrollElement: HTMLElement;
}): FixedGridReadingAnchor {
  const rowCount = fixedItemCount(layoutMetrics.rowCount);
  const columnCount = fixedItemCount(layoutMetrics.columnCount);
  const rowSize = fixedItemSize(layoutMetrics.rowSize);
  const columnSize = fixedItemSize(layoutMetrics.columnSize);
  const scrollTop = fixedViewportMetric(scrollElement.scrollTop);
  const scrollLeft = fixedViewportMetric(scrollElement.scrollLeft);
  const rowIndex =
    rowCount > 0 && rowSize > 0
      ? clamp(Math.floor(scrollTop / rowSize), 0, rowCount - 1)
      : 0;
  const columnIndex =
    columnCount > 0 && columnSize > 0
      ? clamp(Math.floor(scrollLeft / columnSize), 0, columnCount - 1)
      : 0;

  return {
    rowIndex,
    columnIndex,
    rowOffsetPx: Math.max(0, scrollTop - rowIndex * rowSize),
    columnOffsetPx: Math.max(0, scrollLeft - columnIndex * columnSize),
  };
}

function restoreFixedGridReadingAnchor({
  anchor,
  layoutMetrics,
  scrollElement,
}: {
  anchor: FixedGridReadingAnchor;
  layoutMetrics: FixedGridLayoutMetrics;
  scrollElement: HTMLElement;
}) {
  const rowCount = fixedItemCount(layoutMetrics.rowCount);
  const columnCount = fixedItemCount(layoutMetrics.columnCount);
  const rowSize = fixedItemSize(layoutMetrics.rowSize);
  const columnSize = fixedItemSize(layoutMetrics.columnSize);
  const rowIndex = rowCount > 0 ? clamp(anchor.rowIndex, 0, rowCount - 1) : 0;
  const columnIndex =
    columnCount > 0 ? clamp(anchor.columnIndex, 0, columnCount - 1) : 0;

  scrollElement.scrollTop =
    rowIndex * rowSize + Math.min(anchor.rowOffsetPx, Math.max(0, rowSize - 1));
  scrollElement.scrollLeft =
    columnIndex * columnSize +
    Math.min(anchor.columnOffsetPx, Math.max(0, columnSize - 1));
}

export function fixedVirtualItems({
  count,
  size,
  scrollOffset,
  viewportSize,
  overscan,
  minimumVisibleCount = 1,
}: FixedVirtualWindow): FixedGridVirtualItem[] {
  if (!Number.isFinite(count) || !Number.isFinite(size)) return [];
  const itemCount = Math.floor(count);
  if (itemCount <= 0 || size <= 0) return [];
  const safeScrollOffset =
    Number.isFinite(scrollOffset) && scrollOffset > 0 ? scrollOffset : 0;
  const safeViewportSize = Number.isFinite(viewportSize) ? viewportSize : 0;
  const safeOverscan =
    Number.isFinite(overscan) && overscan > 0 ? Math.floor(overscan) : 0;
  const safeMinimumVisibleCount =
    Number.isFinite(minimumVisibleCount) && minimumVisibleCount > 0
      ? Math.ceil(minimumVisibleCount)
      : 1;
  const effectiveViewportSize = Math.max(
    safeViewportSize,
    size * safeMinimumVisibleCount,
  );
  const visibleStart = clamp(
    Math.floor(safeScrollOffset / size),
    0,
    itemCount - 1,
  );
  const visibleEnd = clamp(
    Math.ceil((safeScrollOffset + effectiveViewportSize) / size),
    visibleStart,
    itemCount - 1,
  );
  const uncappedStart = Math.max(0, visibleStart - safeOverscan);
  const uncappedEndInclusive = Math.min(
    itemCount - 1,
    visibleEnd + safeOverscan,
  );
  const { start, end } = capVirtualRange({
    uncappedStart,
    uncappedEnd: uncappedEndInclusive + 1,
    visibleStart,
    visibleEnd: visibleEnd + 1,
    maxItems: MAX_VIRTUAL_ITEMS,
  });
  return Array.from({ length: end - start }, (_, offset) => {
    const index = start + offset;
    const itemStart = index * size;
    return {
      index,
      start: itemStart,
      size,
      end: itemStart + size,
    };
  });
}

export function fixedVirtualItemWindow(
  items: readonly FixedGridVirtualItem[],
): FixedGridVirtualItemWindow {
  const start = items[0]?.start ?? 0;
  const end = items.length ? items[items.length - 1]!.end : start;

  return {
    end,
    items: items.map((item) => ({
      ...item,
      start: item.start - start,
      end: item.end - start,
    })),
    size: Math.max(0, end - start),
    start,
  };
}

function capVirtualRange({
  uncappedStart,
  uncappedEnd,
  visibleStart,
  visibleEnd,
  maxItems,
}: {
  uncappedStart: number;
  uncappedEnd: number;
  visibleStart: number;
  visibleEnd: number;
  maxItems: number;
}) {
  const length = uncappedEnd - uncappedStart;
  if (length <= maxItems) return { start: uncappedStart, end: uncappedEnd };

  const visibleLength = Math.max(0, visibleEnd - visibleStart);
  if (visibleLength >= maxItems) {
    return {
      start: visibleStart,
      end: visibleStart + maxItems,
    };
  }

  const remaining = maxItems - visibleLength;
  const before = Math.min(
    visibleStart - uncappedStart,
    Math.floor(remaining / 2),
  );
  let start = visibleStart - before;
  let end = start + maxItems;

  if (end > uncappedEnd) {
    end = uncappedEnd;
    start = Math.max(uncappedStart, end - maxItems);
  }

  return { start, end };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fixedTotalSize(count: number, size: number) {
  if (
    !Number.isFinite(count) ||
    !Number.isFinite(size) ||
    count <= 0 ||
    size <= 0
  ) {
    return 0;
  }
  const totalSize = Math.floor(count) * size;
  return Number.isFinite(totalSize) ? totalSize : 0;
}

function fixedItemCount(count: number) {
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function fixedItemSize(size: number) {
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function fixedOverscan(overscan: number) {
  return Number.isFinite(overscan) && overscan > 0 ? Math.floor(overscan) : 0;
}

function fixedViewportMetric(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function fixedScrollOffset({
  index,
  itemSize,
  viewportSize,
  align,
}: {
  index: number;
  itemSize: number;
  viewportSize: number;
  align: NonNullable<FixedGridScrollTarget["align"]>;
}) {
  if (
    !Number.isSafeInteger(index) ||
    !Number.isFinite(itemSize) ||
    !Number.isFinite(viewportSize) ||
    index < 0 ||
    itemSize <= 0 ||
    viewportSize < 0
  ) {
    return 0;
  }
  const start = index * itemSize;
  if (align === "end") return Math.max(0, start - viewportSize + itemSize);
  if (align === "center") {
    return Math.max(0, start - viewportSize / 2 + itemSize / 2);
  }
  return Math.max(0, start);
}

function fixedGridViewportEqual(
  left: FixedGridViewport,
  right: FixedGridViewport,
) {
  return (
    left.scrollTop === right.scrollTop &&
    left.scrollLeft === right.scrollLeft &&
    left.clientHeight === right.clientHeight &&
    left.clientWidth === right.clientWidth &&
    left.isJumpingRows === right.isJumpingRows &&
    left.isJumpingColumns === right.isJumpingColumns
  );
}
