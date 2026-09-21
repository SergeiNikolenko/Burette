"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

export interface FixedGridNativeFindCellAddress {
  rowIndex: number;
  columnIndex: number;
}

export interface FixedGridNativeFindChunk {
  startRowIndex: number;
  endRowIndex: number;
  text: string;
}

interface FixedGridNativeFindBuild {
  chunks: FixedGridNativeFindChunk[];
  indexedCellCount: number;
}

type FixedGridNativeFindIdleWindow = Window &
  typeof globalThis & {
    cancelIdleCallback?: Window["cancelIdleCallback"];
    requestIdleCallback?: Window["requestIdleCallback"];
  };

const DEFAULT_MAX_CELLS_PER_CHUNK = 512;
const DEFAULT_MAX_INDEXED_CELLS = 250_000;
const NATIVE_FIND_IDLE_TIMEOUT_MS = 400;
const NATIVE_FIND_FALLBACK_DELAY_MS = 80;

export function FixedGridNativeFindIndex({
  rowCount,
  columnCount,
  getCellText,
  onCellMatch,
  dataSlot,
  enabled = true,
  maxCellsPerChunk = DEFAULT_MAX_CELLS_PER_CHUNK,
  maxIndexedCells = DEFAULT_MAX_INDEXED_CELLS,
}: {
  rowCount: number;
  columnCount: number;
  getCellText: (rowIndex: number, columnIndex: number) => string;
  onCellMatch: (cell: FixedGridNativeFindCellAddress) => void;
  dataSlot: string;
  enabled?: boolean;
  maxCellsPerChunk?: number;
  maxIndexedCells?: number;
}) {
  const [isReady, setIsReady] = React.useState(false);

  useKeyedMountEffect(
    joinEffectKey([
      "fixed-grid-native-find-ready",
      enabled,
      rowCount,
      columnCount,
      getCellText,
      maxCellsPerChunk,
      maxIndexedCells,
    ]),
    () => {
      setIsReady(false);
      if (
        !enabled ||
        !canBuildFixedGridNativeFindIndex({
          rowCount,
          columnCount,
          maxIndexedCells,
        })
      ) {
        return;
      }
      if (typeof window === "undefined") return;

      const show = () => setIsReady(true);
      const browserWindow = window as FixedGridNativeFindIdleWindow;
      if (
        browserWindow.requestIdleCallback &&
        browserWindow.cancelIdleCallback
      ) {
        const idleId = browserWindow.requestIdleCallback(show, {
          timeout: NATIVE_FIND_IDLE_TIMEOUT_MS,
        });
        return () => browserWindow.cancelIdleCallback?.(idleId);
      }

      const timeoutId = browserWindow.setTimeout(
        show,
        NATIVE_FIND_FALLBACK_DELAY_MS,
      );
      return () => browserWindow.clearTimeout(timeoutId);
    },
  );

  const index = React.useMemo<FixedGridNativeFindBuild | null>(() => {
    if (!enabled || !isReady) return null;
    return buildFixedGridNativeFindIndex({
      rowCount,
      columnCount,
      getCellText,
      maxCellsPerChunk,
      maxIndexedCells,
    });
  }, [
    columnCount,
    enabled,
    getCellText,
    isReady,
    maxCellsPerChunk,
    maxIndexedCells,
    rowCount,
  ]);

  if (!index || index.chunks.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none h-0 w-0 overflow-hidden opacity-0"
      data-native-find-indexed-cells={index.indexedCellCount}
      data-native-find-indexed-chunks={index.chunks.length}
      data-native-find-indexed-columns={normalizeNativeFindCount(columnCount)}
      data-native-find-indexed-rows={normalizeNativeFindCount(rowCount)}
      data-slot={dataSlot}
    >
      {index.chunks.map((chunk) => (
        <FixedGridNativeFindEntry
          key={chunk.startRowIndex}
          chunk={chunk}
          columnCount={columnCount}
          getCellText={getCellText}
          onCellMatch={onCellMatch}
        />
      ))}
    </div>
  );
}

function FixedGridNativeFindEntry({
  chunk,
  columnCount,
  getCellText,
  onCellMatch,
}: {
  chunk: FixedGridNativeFindChunk;
  columnCount: number;
  getCellText: (rowIndex: number, columnIndex: number) => string;
  onCellMatch: (cell: FixedGridNativeFindCellAddress) => void;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);

  useKeyedLayoutEffect(
    joinEffectKey([
      "fixed-grid-native-find-entry",
      chunk.startRowIndex,
      chunk.endRowIndex,
      chunk.text,
      columnCount,
      getCellText,
      onCellMatch,
    ]),
    () => {
      const element = ref.current;
      if (!element) return;
      element.setAttribute("hidden", "until-found");

      const scrollToSelectedCell = () => {
        onCellMatch(
          resolveFixedGridNativeFindCell({
            chunk,
            columnCount,
            getCellText,
            offset: selectedTextOffsetIn(element),
          }),
        );
      };

      const handleBeforeMatch = () => {
        scrollToSelectedCell();
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => {
            scrollToSelectedCell();
            element.setAttribute("hidden", "until-found");
          });
          return;
        }
        element.setAttribute("hidden", "until-found");
      };

      element.addEventListener("beforematch", handleBeforeMatch);
      return () => {
        element.removeEventListener("beforematch", handleBeforeMatch);
      };
    },
  );

  return (
    <span
      ref={ref}
      className="block h-px w-px overflow-hidden whitespace-pre"
      data-native-find-end-row={chunk.endRowIndex}
      data-native-find-start-row={chunk.startRowIndex}
    >
      {chunk.text || " "}
    </span>
  );
}

export function buildFixedGridNativeFindIndex({
  rowCount,
  columnCount,
  getCellText,
  maxCellsPerChunk = DEFAULT_MAX_CELLS_PER_CHUNK,
  maxIndexedCells = DEFAULT_MAX_INDEXED_CELLS,
}: {
  rowCount: number;
  columnCount: number;
  getCellText: (rowIndex: number, columnIndex: number) => string;
  maxCellsPerChunk?: number;
  maxIndexedCells?: number;
}): FixedGridNativeFindBuild | null {
  const safeRowCount = normalizeNativeFindCount(rowCount);
  const safeColumnCount = normalizeNativeFindCount(columnCount);
  if (safeRowCount === 0 || safeColumnCount === 0) {
    return { chunks: [], indexedCellCount: 0 };
  }

  const indexedCellCount = safeRowCount * safeColumnCount;
  if (!isNativeFindIndexedCellCountAllowed(indexedCellCount, maxIndexedCells)) {
    return null;
  }

  const rowsPerChunk = nativeFindRowsPerChunk({
    columnCount: safeColumnCount,
    maxCellsPerChunk,
  });
  const chunks: FixedGridNativeFindChunk[] = [];
  for (
    let startRowIndex = 0;
    startRowIndex < safeRowCount;
    startRowIndex += rowsPerChunk
  ) {
    const endRowIndex = Math.min(safeRowCount, startRowIndex + rowsPerChunk);
    chunks.push({
      startRowIndex,
      endRowIndex,
      text: fixedGridNativeFindChunkText({
        startRowIndex,
        endRowIndex,
        columnCount: safeColumnCount,
        getCellText,
      }),
    });
  }

  return { chunks, indexedCellCount };
}

function canBuildFixedGridNativeFindIndex({
  rowCount,
  columnCount,
  maxIndexedCells,
}: {
  rowCount: number;
  columnCount: number;
  maxIndexedCells: number;
}) {
  const safeRowCount = normalizeNativeFindCount(rowCount);
  const safeColumnCount = normalizeNativeFindCount(columnCount);
  if (safeRowCount === 0 || safeColumnCount === 0) return false;
  return isNativeFindIndexedCellCountAllowed(
    safeRowCount * safeColumnCount,
    maxIndexedCells,
  );
}

function isNativeFindIndexedCellCountAllowed(
  indexedCellCount: number,
  maxIndexedCells: number,
) {
  return (
    Number.isSafeInteger(indexedCellCount) &&
    indexedCellCount <= normalizeNativeFindCellLimit(maxIndexedCells)
  );
}

function fixedGridNativeFindChunkText({
  startRowIndex,
  endRowIndex,
  columnCount,
  getCellText,
}: {
  startRowIndex: number;
  endRowIndex: number;
  columnCount: number;
  getCellText: (rowIndex: number, columnIndex: number) => string;
}) {
  const parts: string[] = [];
  for (let rowIndex = startRowIndex; rowIndex < endRowIndex; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      if (parts.length > 0) parts.push(columnIndex === 0 ? "\n" : "\t");
      parts.push(getCellText(rowIndex, columnIndex));
    }
  }
  return parts.join("");
}

function resolveFixedGridNativeFindCell({
  chunk,
  columnCount,
  getCellText,
  offset,
}: {
  chunk: FixedGridNativeFindChunk;
  columnCount: number;
  getCellText: (rowIndex: number, columnIndex: number) => string;
  offset: number | null;
}): FixedGridNativeFindCellAddress {
  if (offset == null || offset < 0) {
    return { rowIndex: chunk.startRowIndex, columnIndex: 0 };
  }

  let cursor = 0;
  for (
    let rowIndex = chunk.startRowIndex;
    rowIndex < chunk.endRowIndex;
    rowIndex += 1
  ) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      if (cursor > 0) cursor += 1;
      const text = getCellText(rowIndex, columnIndex);
      const cellStart = cursor;
      const cellEnd = cellStart + text.length;
      if (text.length > 0 && offset >= cellStart && offset <= cellEnd) {
        return { rowIndex, columnIndex };
      }
      cursor = cellEnd;
    }
  }

  return { rowIndex: chunk.startRowIndex, columnIndex: 0 };
}

function selectedTextOffsetIn(element: HTMLElement): number | null {
  const selection =
    element.ownerDocument.getSelection?.() ??
    (typeof window === "undefined" ? null : window.getSelection());
  if (!selection || selection.rangeCount === 0) return null;

  const selectedRange = selection.getRangeAt(0);
  if (!element.contains(selectedRange.startContainer)) return null;

  const prefixRange = element.ownerDocument.createRange();
  try {
    prefixRange.selectNodeContents(element);
    prefixRange.setEnd(selectedRange.startContainer, selectedRange.startOffset);
    return prefixRange.toString().length;
  } finally {
    prefixRange.detach();
  }
}

function nativeFindRowsPerChunk({
  columnCount,
  maxCellsPerChunk,
}: {
  columnCount: number;
  maxCellsPerChunk: number;
}) {
  const safeCellLimit = Math.max(
    1,
    normalizeNativeFindCellLimit(maxCellsPerChunk),
  );
  return Math.max(1, Math.min(128, Math.floor(safeCellLimit / columnCount)));
}

function normalizeNativeFindCount(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeNativeFindCellLimit(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? Math.floor(value) : 0;
}
