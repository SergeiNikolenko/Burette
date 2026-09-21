"use client";

import * as React from "react";

import type { CsvCellAddress } from "./csv-viewer-state";
import { csvCellClassName } from "./csv-viewer-cell-classes";
import type { CsvRowStore } from "./csv-row-store";
import { setFixedGridInverseRowWindowGeometry } from "./fixed-grid-layout";
import {
  fixedVirtualItemWindow,
  fixedVirtualItems,
  type FixedGridColumnItem,
  type FixedGridJumpViewportResult,
  type FixedGridViewport,
  type FixedGridVirtualItem,
} from "./fixed-grid-virtualization";

export interface CsvRowPatchState {
  activeCell: CsvCellAddress | null;
  columnItems: FixedGridColumnItem[];
  effectiveRowHeight: number;
  viewportHeight: number;
  rowOrder: number[] | null;
  shouldVirtualizeRows: boolean;
  rowStore: CsvRowStore;
}

export interface CsvRowPatcher {
  patch: (viewport: FixedGridViewport) => FixedGridJumpViewportResult;
  resync: (virtualRows: FixedGridVirtualItem[]) => void;
  invalidate: () => void;
}

interface CsvCellHandle {
  element: HTMLElement;
  className: string;
  textNode: Text | null;
}

interface CsvRowHandle {
  element: HTMLElement;
  rowNumberTextNode: Text | null;
  cells: CsvCellHandle[];
  isHidden: boolean;
  sourceRowIndex: number | null;
  transform: string;
}

interface CsvRowHandleCache {
  rowWindow: HTMLDivElement;
  rows: CsvRowHandle[];
}

const PATCH_ROW_OVERSCAN = 0;
const MINIMUM_PATCH_VISIBLE_ROWS = 1;
const TEXT_NODE = 3;

export function useCsvRowPatcher({
  rowOffsetRef,
  rowWindowRef,
  getState,
}: {
  rowOffsetRef: React.RefObject<HTMLDivElement | null>;
  rowWindowRef: React.RefObject<HTMLDivElement | null>;
  getState: () => CsvRowPatchState;
}): CsvRowPatcher {
  const rowHandleCacheRef = React.useRef<CsvRowHandleCache | null>(null);

  const invalidate = React.useCallback(() => {
    rowHandleCacheRef.current = null;
  }, []);

  // Re-assert the canonical (React-owned) row state onto every pooled row after
  // a canonical commit. During active scroll the imperative patcher mutates
  // each row's `hidden` attribute, transform, row number, and cell text
  // directly. When React later commits a window, its reconciler only writes a
  // DOM property whose value changed in React's *own* remembered vdom, so a
  // reused slot whose canonical value is unchanged across the commit keeps
  // whatever the patcher last wrote. That leaks two ways: a previously-hidden
  // pool row that should now be visible stays `hidden` (a blank gap at the
  // leading scroll edge), and a cyclic column (e.g. a repeating name) keeps a
  // stale value from a different row even though its id and row number are
  // correct. Re-running the canonical window through the same patch routine
  // pushes the authoritative transform, visibility, and text back onto the DOM
  // once scrolling settles. This runs only on canonical commits, not per frame.
  const resync = React.useCallback(
    (virtualRows: FixedGridVirtualItem[]) => {
      const rowWindow = rowWindowRef.current;
      if (!rowWindow) return;
      const rowOffset = rowOffsetRef.current;
      if (!rowOffset) return;
      const cache = readRowHandles(rowWindow);
      rowHandleCacheRef.current = cache;
      if (cache.rows.length === 0) return;
      const state = getState();
      const window = fixedVirtualItemWindow(virtualRows);
      setFixedGridInverseRowWindowGeometry({
        rowOffsetElement: rowOffset,
        rowWindowElement: rowWindow,
        viewportHeight: state.viewportHeight,
        window,
      });
      patchRows(cache.rows, window.items, state);
    },
    [getState, rowOffsetRef, rowWindowRef],
  );

  const patch = React.useCallback(
    (viewport: FixedGridViewport): FixedGridJumpViewportResult => {
      const state = getState();
      if (!canPatchRows(viewport, state)) return "pass";

      const rowWindow = rowWindowRef.current;
      if (!rowWindow) return "pass";
      const rowOffset = rowOffsetRef.current;
      if (!rowOffset) return "pass";

      const cache =
        rowHandleCacheRef.current?.rowWindow === rowWindow
          ? rowHandleCacheRef.current
          : readRowHandles(rowWindow);
      rowHandleCacheRef.current = cache;

      if (cache.rows.length === 0) return "pass";

      const nextRows = fixedVirtualItems({
        count: state.rowStore.rowCount,
        size: state.effectiveRowHeight,
        scrollOffset: viewport.scrollTop,
        viewportSize: viewport.clientHeight,
        overscan: PATCH_ROW_OVERSCAN,
        minimumVisibleCount: MINIMUM_PATCH_VISIBLE_ROWS,
      });
      if (nextRows.length === 0 || nextRows.length > cache.rows.length) {
        return "pass";
      }

      if (
        !canPatchRowHandles(
          cache.rows,
          nextRows.length,
          state.columnItems.length,
        )
      ) {
        return "pass";
      }

      const window = fixedVirtualItemWindow(nextRows);
      setFixedGridInverseRowWindowGeometry({
        rowOffsetElement: rowOffset,
        rowWindowElement: rowWindow,
        viewportHeight: viewport.clientHeight,
        window,
      });
      patchRows(cache.rows, window.items, state);

      return "handled";
    },
    [getState, rowOffsetRef, rowWindowRef],
  );

  return React.useMemo(
    () => ({ invalidate, patch, resync }),
    [invalidate, patch, resync],
  );
}

function patchRows(
  rowHandles: CsvRowHandle[],
  virtualRows: ReturnType<typeof fixedVirtualItems>,
  state: CsvRowPatchState,
) {
  for (let handleIndex = 0; handleIndex < rowHandles.length; handleIndex++) {
    const rowHandle = rowHandles[handleIndex];
    const virtualRow = virtualRows[handleIndex];
    if (!virtualRow) {
      setRowHidden(rowHandle, true);
      continue;
    }

    const displayRowIndex = virtualRow.index;
    const sourceRowIndex = state.rowOrder
      ? state.rowOrder[displayRowIndex]
      : displayRowIndex;
    const sourceRow = state.rowStore.getRow(sourceRowIndex);
    const transform = `translate3d(0, ${virtualRow.start}px, 0)`;

    setRowHidden(rowHandle, false);
    setRowTransform(rowHandle, transform);

    if (rowHandle.sourceRowIndex !== sourceRowIndex) {
      rowHandle.sourceRowIndex = sourceRowIndex;
      setTextNodeValue(rowHandle.rowNumberTextNode, String(sourceRowIndex + 1));
      patchCells(rowHandle, sourceRow, sourceRowIndex, state);
    } else {
      patchCellActiveState(rowHandle, sourceRowIndex, state);
    }
  }
}

function patchCells(
  rowHandle: CsvRowHandle,
  sourceRow: string[] | undefined,
  sourceRowIndex: number,
  state: CsvRowPatchState,
) {
  for (let cellIndex = 0; cellIndex < state.columnItems.length; cellIndex++) {
    const columnIndex = state.columnItems[cellIndex]?.index;
    const text =
      typeof columnIndex === "number" ? (sourceRow?.[columnIndex] ?? "") : "";
    setTextNodeValue(rowHandle.cells[cellIndex]?.textNode ?? null, text);
    setCellActive(
      rowHandle.cells[cellIndex],
      state.activeCell?.rowIndex === sourceRowIndex &&
        state.activeCell.columnIndex === columnIndex,
    );
  }
}

function patchCellActiveState(
  rowHandle: CsvRowHandle,
  sourceRowIndex: number,
  state: CsvRowPatchState,
) {
  for (let cellIndex = 0; cellIndex < state.columnItems.length; cellIndex++) {
    const columnIndex = state.columnItems[cellIndex]?.index;
    setCellActive(
      rowHandle.cells[cellIndex],
      state.activeCell?.rowIndex === sourceRowIndex &&
        state.activeCell.columnIndex === columnIndex,
    );
  }
}

function canPatchRows(viewport: FixedGridViewport, state: CsvRowPatchState) {
  return state.shouldVirtualizeRows && !viewport.isJumpingColumns;
}

function canPatchRowHandles(
  rowHandles: CsvRowHandle[],
  visibleRowCount: number,
  cellCount: number,
) {
  for (let handleIndex = 0; handleIndex < visibleRowCount; handleIndex++) {
    const rowHandle = rowHandles[handleIndex];
    if (!rowHandle?.rowNumberTextNode) return false;
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
      if (!rowHandle.cells[cellIndex]?.textNode) return false;
    }
  }
  return true;
}

function readRowHandles(rowWindow: HTMLDivElement): CsvRowHandleCache {
  const rows = Array.from(
    rowWindow.querySelectorAll<HTMLElement>('[data-slot="csv-row"]'),
  ).map((element) => {
    const rowNumber = element.querySelector<HTMLElement>(
      '[data-slot="csv-row-number"]',
    );
    const cells = Array.from(
      element.querySelectorAll<HTMLElement>('[data-slot="csv-cell"]'),
    ).map((cell) => ({
      element: cell,
      className: cell.className,
      textNode: firstTextNode(cell.firstElementChild ?? cell),
    }));

    return {
      element,
      rowNumberTextNode: firstTextNode(rowNumber),
      cells,
      isHidden: Boolean(element.hidden),
      sourceRowIndex: null,
      transform: element.style.transform,
    };
  });

  return { rowWindow, rows };
}

function firstTextNode(element: Element | null): Text | null {
  const node = element?.firstChild;
  return node?.nodeType === TEXT_NODE ? (node as Text) : null;
}

function setTextNodeValue(textNode: Text | null, value: string) {
  if (textNode && textNode.nodeValue !== value) textNode.nodeValue = value;
}

function setCellActive(cell: CsvCellHandle | undefined, isActive: boolean) {
  if (!cell) return;
  const className = csvCellClassName(isActive);
  if (cell.className === className) return;
  cell.element.className = className;
  cell.className = className;
}

function setRowTransform(row: CsvRowHandle, transform: string) {
  if (row.transform === transform) return;
  row.element.style.transform = transform;
  row.transform = transform;
}

function setRowHidden(row: CsvRowHandle, isHidden: boolean) {
  if (row.isHidden === isHidden) return;
  row.element.hidden = isHidden;
  row.isHidden = isHidden;
}
