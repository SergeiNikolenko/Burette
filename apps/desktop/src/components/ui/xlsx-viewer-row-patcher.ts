"use client";

import * as React from "react";

import type { XlsxCell } from "@/lib/xlsx-workbook";
import { setFixedGridInverseRowWindowGeometry } from "@/components/ui/fixed-grid-layout";
import type { GridCellCoordinate } from "@/components/ui/fixed-grid-selection";
import {
  fixedVirtualItemWindow,
  fixedVirtualItems,
} from "@/components/ui/fixed-grid-virtualization";
import type {
  FixedGridJumpViewportResult,
  FixedGridViewport,
  FixedGridVirtualItem,
} from "@/components/ui/fixed-grid-virtualization";
import type { XlsxGridColumnItem } from "@/components/ui/xlsx-grid-row";

export interface XlsxRowPatchState {
  activeCell: GridCellCoordinate | null;
  columnCount: number;
  columnItems: XlsxGridColumnItem[];
  getCell: (rowIndex: number, columnIndex: number) => XlsxCell;
  rowCount: number;
  rowHeight: number;
  sheetName: string;
  viewportHeight: number;
}

export interface XlsxRowPatcher {
  patch: (viewport: FixedGridViewport) => FixedGridJumpViewportResult;
  resync: (virtualRows: FixedGridVirtualItem[]) => void;
  invalidate: () => void;
}

interface XlsxCellHandle {
  element: HTMLElement;
  textNode: Text | null;
  columnIndex: number | null;
  isNumeric: boolean;
  isActive: boolean;
}

interface XlsxRowHandle {
  element: HTMLElement;
  rowNumberTextNode: Text | null;
  cells: XlsxCellHandle[];
  isHidden: boolean;
  rowIndex: number | null;
  transform: string;
}

interface XlsxRowHandleCache {
  rowWindow: HTMLDivElement;
  rows: XlsxRowHandle[];
  activeCellKey: string;
  columnCount: number;
  columnKey: string;
  getCell: XlsxRowPatchState["getCell"];
  rowCount: number;
  rowHeight: number;
  scrollLeft: number;
  sheetName: string;
}

const PATCH_ROW_OVERSCAN = 0;
const MINIMUM_PATCH_VISIBLE_ROWS = 1;
const TEXT_NODE = 3;

const ACTIVE_CLASSES = [
  "bg-primary/12",
  "ring-1",
  "ring-primary/50",
  "ring-inset",
];

export function useXlsxRowPatcher({
  rowOffsetRef,
  rowWindowRef,
  getState,
}: {
  rowOffsetRef: React.RefObject<HTMLDivElement | null>;
  rowWindowRef: React.RefObject<HTMLDivElement | null>;
  getState: () => XlsxRowPatchState;
}): XlsxRowPatcher {
  const rowHandleCacheRef = React.useRef<XlsxRowHandleCache | null>(null);

  const invalidate = React.useCallback(() => {
    rowHandleCacheRef.current = null;
  }, []);

  const resync = React.useCallback(
    (virtualRows: FixedGridVirtualItem[]) => {
      const rowWindow = rowWindowRef.current;
      if (!rowWindow) return;
      const rowOffset = rowOffsetRef.current;
      if (!rowOffset) return;
      const state = getState();
      const cache = readRowHandles(rowWindow, state, {
        scrollLeft: 0,
      });
      const window = fixedVirtualItemWindow(virtualRows);
      if (cache.rows.length > 0) {
        setFixedGridInverseRowWindowGeometry({
          rowOffsetElement: rowOffset,
          rowWindowElement: rowWindow,
          viewportHeight: state.viewportHeight,
          window,
        });
        patchRows(cache.rows, window.items, state);
      }
      rowHandleCacheRef.current = null;
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
          : readRowHandles(rowWindow, state, viewport);
      rowHandleCacheRef.current = cache;

      if (!canUseCache(cache, state, viewport)) return "pass";
      if (cache.rows.length === 0) return "pass";

      const nextRows = fixedVirtualItems({
        count: state.rowCount,
        size: state.rowHeight,
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
  rowHandles: XlsxRowHandle[],
  virtualRows: ReturnType<typeof fixedVirtualItems>,
  state: XlsxRowPatchState,
) {
  for (let handleIndex = 0; handleIndex < rowHandles.length; handleIndex++) {
    const rowHandle = rowHandles[handleIndex];
    const virtualRow = virtualRows[handleIndex];
    if (!virtualRow) {
      setRowHidden(rowHandle, true);
      continue;
    }

    const rowIndex = virtualRow.index;
    const transform = `translate3d(0, ${virtualRow.start}px, 0)`;

    setRowHidden(rowHandle, false);
    setRowTransform(rowHandle, transform);

    if (rowHandle.rowIndex !== rowIndex) {
      rowHandle.rowIndex = rowIndex;
      rowHandle.element.setAttribute("aria-rowindex", String(rowIndex + 1));
      setTextNodeValue(rowHandle.rowNumberTextNode, String(rowIndex + 1));
    }

    patchCells(rowHandle, rowIndex, state);
  }
}

function patchCells(
  rowHandle: XlsxRowHandle,
  rowIndex: number,
  state: XlsxRowPatchState,
) {
  for (let cellIndex = 0; cellIndex < state.columnItems.length; cellIndex++) {
    const cellHandle = rowHandle.cells[cellIndex];
    const columnIndex = state.columnItems[cellIndex]?.metadata.columnIndex;
    if (!cellHandle || typeof columnIndex !== "number") continue;

    const cell = state.getCell(rowIndex, columnIndex);
    const isActive =
      state.activeCell?.rowIndex === rowIndex &&
      state.activeCell.columnIndex === columnIndex;

    setTextNodeValue(cellHandle.textNode, cell.text);
    if (cellHandle.columnIndex !== columnIndex) {
      cellHandle.columnIndex = columnIndex;
      cellHandle.element.setAttribute("aria-colindex", String(columnIndex + 1));
    }
    setCellNumeric(cellHandle, cell.numeric);
    setCellActive(cellHandle, isActive);
  }
}

function canPatchRows(viewport: FixedGridViewport, state: XlsxRowPatchState) {
  return (
    state.rowCount > 0 &&
    state.rowHeight > 0 &&
    state.columnItems.length > 0 &&
    !viewport.isJumpingColumns
  );
}

function canUseCache(
  cache: XlsxRowHandleCache,
  state: XlsxRowPatchState,
  viewport: FixedGridViewport,
) {
  return (
    cache.activeCellKey === activeCellKey(state.activeCell) &&
    cache.columnCount === state.columnCount &&
    cache.columnKey === columnKey(state.columnItems) &&
    cache.getCell === state.getCell &&
    cache.rowCount === state.rowCount &&
    cache.rowHeight === state.rowHeight &&
    cache.scrollLeft === viewport.scrollLeft &&
    cache.sheetName === state.sheetName
  );
}

function canPatchRowHandles(
  rowHandles: XlsxRowHandle[],
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

function readRowHandles(
  rowWindow: HTMLDivElement,
  state: XlsxRowPatchState,
  viewport: Pick<FixedGridViewport, "scrollLeft">,
): XlsxRowHandleCache {
  const rows = Array.from(
    rowWindow.querySelectorAll<HTMLElement>('[data-slot="xlsx-row"]'),
  ).map((element) => {
    const rowNumber = element.querySelector<HTMLElement>(
      '[data-slot="xlsx-row-number"]',
    );
    const cells = Array.from(
      element.querySelectorAll<HTMLElement>('[data-slot="xlsx-cell"]'),
    ).map((cell) => ({
      element: cell,
      textNode: firstTextNode(cell.firstElementChild ?? cell),
      columnIndex: numberAttribute(cell, "aria-colindex", -1),
      isNumeric: cell.classList.contains("tabular-nums"),
      isActive: cell.classList.contains("ring-primary/50"),
    }));

    return {
      element,
      rowNumberTextNode: firstTextNode(rowNumber),
      cells,
      isHidden: Boolean(element.hidden),
      rowIndex: numberAttribute(element, "aria-rowindex", -1),
      transform: element.style.transform,
    };
  });

  return {
    rowWindow,
    rows,
    activeCellKey: activeCellKey(state.activeCell),
    columnCount: state.columnCount,
    columnKey: columnKey(state.columnItems),
    getCell: state.getCell,
    rowCount: state.rowCount,
    rowHeight: state.rowHeight,
    scrollLeft: viewport.scrollLeft,
    sheetName: state.sheetName,
  };
}

function firstTextNode(element: Element | null): Text | null {
  const node = element?.firstChild;
  return node?.nodeType === TEXT_NODE ? (node as Text) : null;
}

function numberAttribute(
  element: HTMLElement,
  attribute: string,
  offset: number,
) {
  const value = Number(element.getAttribute(attribute));
  return Number.isFinite(value) ? value + offset : null;
}

function activeCellKey(activeCell: GridCellCoordinate | null) {
  return activeCell ? `${activeCell.rowIndex}:${activeCell.columnIndex}` : "";
}

function columnKey(columnItems: XlsxGridColumnItem[]) {
  return columnItems
    .map((item) => `${item.metadata.columnIndex}:${item.widthPx}`)
    .join("|");
}

function setTextNodeValue(textNode: Text | null, value: string) {
  if (textNode && textNode.nodeValue !== value) textNode.nodeValue = value;
}

function setRowTransform(row: XlsxRowHandle, transform: string) {
  if (row.transform === transform) return;
  row.element.style.transform = transform;
  row.transform = transform;
}

function setRowHidden(row: XlsxRowHandle, isHidden: boolean) {
  if (row.isHidden === isHidden) return;
  row.element.hidden = isHidden;
  row.isHidden = isHidden;
}

function setCellNumeric(cell: XlsxCellHandle, isNumeric: boolean) {
  if (cell.isNumeric === isNumeric) return;
  cell.element.classList.toggle("justify-end", isNumeric);
  cell.element.classList.toggle("tabular-nums", isNumeric);
  cell.element.classList.toggle("justify-start", !isNumeric);
  cell.isNumeric = isNumeric;
}

function setCellActive(cell: XlsxCellHandle, isActive: boolean) {
  if (cell.isActive === isActive) return;
  for (const className of ACTIVE_CLASSES) {
    cell.element.classList.toggle(className, isActive);
  }
  cell.isActive = isActive;
}
