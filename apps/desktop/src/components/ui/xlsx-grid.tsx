"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { xlsxColumnLabel, type XlsxCell } from "@/lib/xlsx-workbook";
import { fixedGridColumnWidths } from "@/components/ui/fixed-grid-columns";
import { getFixedGridCanvasStyle } from "@/components/ui/fixed-grid-layout";
import {
  FixedGridNativeFindIndex,
  type FixedGridNativeFindCellAddress,
} from "@/components/ui/fixed-grid-native-find-index";
import { FixedGridRowWindow } from "@/components/ui/fixed-grid-row-window";
import type { GridCellCoordinate } from "@/components/ui/fixed-grid-selection";
import { buildVirtualGridTemplate } from "@/components/ui/fixed-grid-template";
import { FixedGridViewport } from "@/components/ui/fixed-grid-viewport";
import {
  useFixedGridVirtualization,
  useFixedRowPool,
  type FixedGridRowPoolSlot,
} from "@/components/ui/fixed-grid-virtualization";
import { HeaderAwareScrollbar } from "@/components/ui/header-aware-scrollbar";
import {
  XLSX_BASE_COLUMN_WIDTH,
  XLSX_BASE_FONT_SIZE,
  XLSX_BASE_GUTTER_WIDTH,
  XLSX_BASE_ROW_HEIGHT,
} from "@/components/ui/xlsx-grid-constants";
import {
  Spacer,
  XlsxGridRow,
  type XlsxGridColumnItem,
} from "@/components/ui/xlsx-grid-row";
import { XLSX_SCROLLBAR_CSS } from "@/components/ui/xlsx-grid-scrollbar";
import { ScrollerShell } from "@/components/ui/xlsx-shadow-scope";
import {
  useXlsxRowPatcher,
  type XlsxRowPatchState,
} from "@/components/ui/xlsx-viewer-row-patcher";

import { joinEffectKey } from "@/lib/effect-key";

export { XlsxGridSkeleton } from "@/components/ui/xlsx-grid-skeleton";

const ROW_OVERSCAN = 4;
const JUMP_ROW_OVERSCAN = 0;
const COLUMN_OVERSCAN = 2;
const JUMP_COLUMN_OVERSCAN = 0;
const XLSX_NATIVE_FIND_MAX_INDEXED_CELLS = 250_000;

export interface XlsxScrollRequest {
  sheetIndex: number;
  rowIndex: number;
  columnIndex: number;
  behavior: ScrollBehavior;
  nonce: number;
}

type XlsxGridCellRef = GridCellCoordinate;

export function XlsxGrid({
  rowCount,
  columnCount,
  getCell,
  sheetName,
  scale,
  activeCell,
  scrollRequest,
  isolateStyles,
  viewportRef,
}: {
  rowCount: number;
  columnCount: number;
  sheetName: string;
  getCell: (rowIndex: number, columnIndex: number) => XlsxCell;
  scale: number;
  activeCell?: XlsxGridCellRef | null;
  scrollRequest?: XlsxScrollRequest | null;
  isolateStyles: boolean;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const safeRowCount = normalizeGridCount(rowCount);
  const safeColumnCount = normalizeGridCount(columnCount);
  const safeScale = normalizeGridScale(scale);
  const rowHeight = Math.round(XLSX_BASE_ROW_HEIGHT * safeScale);
  const columnWidth = Math.round(XLSX_BASE_COLUMN_WIDTH * safeScale);
  const gutterWidth = Math.round(XLSX_BASE_GUTTER_WIDTH * safeScale);
  const fontSize = XLSX_BASE_FONT_SIZE * safeScale;

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rowOffsetRef = React.useRef<HTMLDivElement>(null);
  const rowWindowRef = React.useRef<HTMLDivElement>(null);
  const viewportClientHeightRef = React.useRef(0);
  const setScrollElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      scrollRef.current = element;
      if (viewportRef) viewportRef.current = element;
    },
    [viewportRef],
  );
  const columnItemsRef = React.useRef<XlsxGridColumnItem[]>([]);
  const getRowPatchState = React.useCallback(
    (): XlsxRowPatchState => ({
      activeCell: activeCell ?? null,
      columnCount: safeColumnCount,
      columnItems: columnItemsRef.current,
      getCell,
      rowCount: safeRowCount,
      rowHeight,
      sheetName,
      viewportHeight: viewportClientHeightRef.current,
    }),
    [activeCell, getCell, rowHeight, safeColumnCount, safeRowCount, sheetName],
  );
  const rowPatcher = useXlsxRowPatcher({
    rowOffsetRef,
    rowWindowRef,
    getState: getRowPatchState,
  });
  const rowScrollStrategy = React.useMemo(
    () => ({ handleViewport: rowPatcher.patch }),
    [rowPatcher],
  );

  const {
    virtualRows,
    totalRowSize,
    totalColumnSize,
    columnItems: virtualColumnItems,
    virtualRowWindow,
    leftPad,
    rightPad,
    scrollToCell,
    viewportClientHeight,
  } = useFixedGridVirtualization({
    rowCount: safeRowCount,
    columnCount: safeColumnCount,
    rowSize: rowHeight,
    columnSize: columnWidth,
    rowOverscan: ROW_OVERSCAN,
    columnOverscan: COLUMN_OVERSCAN,
    jumpRowOverscan: JUMP_ROW_OVERSCAN,
    jumpColumnOverscan: JUMP_COLUMN_OVERSCAN,
    minimumRenderedRows: 1,
    rowScrollStrategy,
    scrollRef,
  });
  viewportClientHeightRef.current = viewportClientHeight;

  const requestNonce = scrollRequest?.nonce;
  useKeyedMountEffect(
    scrollRequest ? joinEffectKey(["xlsx-scroll-request", requestNonce]) : null,
    () => {
      if (!scrollRequest) return;
      scrollToCell({
        rowIndex: scrollRequest.rowIndex,
        columnIndex: scrollRequest.columnIndex,
        behavior: scrollRequest.behavior,
        align: "center",
      });
    },
  );

  const columnItems = React.useMemo(
    () =>
      virtualColumnItems.map((item) => ({
        key: String(item.index),
        widthPx: item.widthPx,
        metadata: { columnIndex: item.index },
      })) satisfies XlsxGridColumnItem[],
    [virtualColumnItems],
  );

  columnItemsRef.current = columnItems;

  const gridTemplate = React.useMemo(
    () =>
      buildVirtualGridTemplate({
        leadingWidth: gutterWidth,
        leftPad,
        columnWidths: fixedGridColumnWidths(columnItems),
        rightPad,
      }),
    [gutterWidth, leftPad, columnItems, rightPad],
  );
  const totalWidth = gutterWidth + totalColumnSize;
  const minimumRowPoolSize =
    Math.ceil(viewportClientHeight / rowHeight) + ROW_OVERSCAN * 2 + 2;
  const rowPoolSlots = useFixedRowPool({
    minimumPoolSize: minimumRowPoolSize,
    rowCount: safeRowCount,
    virtualRows: virtualRowWindow.items,
  });
  const nativeFindCellText = React.useCallback(
    (rowIndex: number, columnIndex: number) =>
      getCell(rowIndex, columnIndex).text,
    [getCell],
  );
  const scrollToNativeFindCell = React.useCallback(
    ({ rowIndex, columnIndex }: FixedGridNativeFindCellAddress) => {
      scrollToCell({
        rowIndex,
        columnIndex,
        behavior: "auto",
        align: "center",
      });
    },
    [scrollToCell],
  );

  useKeyedMountEffect(
    joinEffectKey([
      "xlsx-row-patcher",
      rowPatcher,
      virtualRows,
      columnItems,
      rowHeight,
      safeRowCount,
      safeColumnCount,
      sheetName,
      getCell,
      activeCell,
    ]),
    () => {
      rowPatcher.resync(virtualRows);
    },
  );

  if (safeRowCount === 0 || safeColumnCount === 0) {
    return (
      <div
        className="bg-card text-muted-foreground flex flex-1 items-center justify-center text-xs"
        role="status"
        aria-label={`${sheetName} is empty`}
      >
        Empty sheet
      </div>
    );
  }

  return (
    <div
      className="bg-card flex min-h-0 flex-1 flex-col"
      style={{ fontSize }}
      data-slot="xlsx-grid"
    >
      <ScrollerShell
        isolate={isolateStyles}
        className="relative min-h-0 flex-1"
      >
        <style>{XLSX_SCROLLBAR_CSS}</style>
        <FixedGridNativeFindIndex
          rowCount={safeRowCount}
          columnCount={safeColumnCount}
          getCellText={nativeFindCellText}
          onCellMatch={scrollToNativeFindCell}
          dataSlot="xlsx-native-find-index"
          maxIndexedCells={XLSX_NATIVE_FIND_MAX_INDEXED_CELLS}
        />
        <FixedGridViewport
          scrollRef={setScrollElement}
          dataSlot="xlsx-body"
          role="grid"
          aria-label={sheetName}
          aria-rowcount={safeRowCount}
          aria-colcount={safeColumnCount}
          tabIndex={0}
        >
          <div
            style={getFixedGridCanvasStyle({
              width: totalWidth,
              contain: true,
            })}
          >
            <div
              className="sticky top-0 z-20 grid border-b"
              style={{
                gridTemplateColumns: gridTemplate,
                height: rowHeight,
                backgroundColor:
                  "color-mix(in oklab, var(--card) 92%, var(--foreground))",
              }}
              aria-hidden
            >
              <div
                className="sticky left-0 z-10 border-r bg-[color-mix(in_oklab,var(--card)_94%,var(--foreground))]"
                style={{ height: rowHeight }}
              />
              <Spacer width={leftPad} />
              {columnItems.map((item) => (
                <div
                  key={item.key}
                  className="text-muted-foreground flex items-center justify-center border-r font-medium last:border-r-0"
                >
                  {xlsxColumnLabel(item.metadata.columnIndex)}
                </div>
              ))}
              <Spacer width={rightPad} />
            </div>

            <FixedGridRowWindow
              rowOffsetRef={rowOffsetRef}
              rowWindowRef={rowWindowRef}
              totalSize={totalRowSize}
              virtualRowWindow={virtualRowWindow}
              viewportHeight={viewportClientHeight}
              offsetDataSlot="xlsx-row-offset"
              windowDataSlot="xlsx-row-window"
            >
              {rowPoolSlots.map((slot) => (
                <XlsxGridRowSlot
                  key={slot.slotIndex}
                  slot={slot}
                  rowCount={safeRowCount}
                  getCell={getCell}
                  gridTemplate={gridTemplate}
                  rowHeight={rowHeight}
                  columnItems={columnItems}
                  leftPad={leftPad}
                  rightPad={rightPad}
                  activeCell={activeCell ?? null}
                />
              ))}
            </FixedGridRowWindow>
          </div>
        </FixedGridViewport>
        <HeaderAwareScrollbar scrollRef={scrollRef} headerHeight={rowHeight} />
      </ScrollerShell>
    </div>
  );
}

function XlsxGridRowSlot({
  slot,
  rowCount,
  getCell,
  gridTemplate,
  rowHeight,
  columnItems,
  leftPad,
  rightPad,
  activeCell,
}: {
  slot: FixedGridRowPoolSlot;
  rowCount: number;
  getCell: (rowIndex: number, columnIndex: number) => XlsxCell;
  gridTemplate: string;
  rowHeight: number;
  columnItems: XlsxGridColumnItem[];
  leftPad: number;
  rightPad: number;
  activeCell: XlsxGridCellRef | null;
}) {
  const fallbackRowIndex =
    rowCount > 0 ? Math.min(slot.slotIndex, rowCount - 1) : 0;
  const rowIndex = slot.virtualRow?.index ?? fallbackRowIndex;

  return (
    <XlsxGridRow
      rowIndex={rowIndex}
      getCell={getCell}
      gridTemplate={gridTemplate}
      rowHeight={rowHeight}
      columnItems={columnItems}
      leftPad={leftPad}
      rightPad={rightPad}
      start={slot.virtualRow?.start ?? 0}
      hidden={slot.isHidden}
      activeColumnIndex={
        slot.virtualRow && activeCell?.rowIndex === rowIndex
          ? activeCell.columnIndex
          : null
      }
    />
  );
}

function normalizeGridCount(value: number) {
  return Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
    ? Math.floor(value)
    : 0;
}

function normalizeGridScale(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(5, Math.max(0.1, value));
}
