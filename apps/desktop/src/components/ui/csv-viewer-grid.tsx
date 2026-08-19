"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { cn } from "@/lib/utils";

import {
  useCsvRowPatcher,
  type CsvRowPatchState,
} from "./csv-viewer-row-patcher";
import { csvCellClassName } from "./csv-viewer-cell-classes";
import type { CsvRowStore } from "./csv-row-store";
import {
  CSV_SCROLLBAR_CSS,
  HeaderAwareScrollbar,
} from "./csv-viewer-scrollbar";
import {
  sortCsvRowsInWorker,
  sortCsvRowsOnMainThread,
} from "./csv-viewer-sort-worker";
import type { CsvCellAddress } from "./csv-viewer-state";
import { CsvStyleScope } from "./csv-viewer-style-scope";
import { fixedGridColumnWidths } from "./fixed-grid-columns";
import { getFixedGridCanvasStyle } from "./fixed-grid-layout";
import {
  FixedGridNativeFindIndex,
  type FixedGridNativeFindCellAddress,
} from "./fixed-grid-native-find-index";
import { FixedGridRowWindow } from "./fixed-grid-row-window";
import { getFixedGridRowStyle } from "./fixed-grid-row-style";
import { buildVirtualGridTemplate } from "./fixed-grid-template";
import { FixedGridViewport } from "./fixed-grid-viewport";
import {
  useFixedGridVirtualization,
  useFixedRowPool,
  type FixedGridColumnItem,
  type FixedGridRowPoolSlot,
} from "./fixed-grid-virtualization";
import { joinEffectKey } from "@/lib/effect-key";

type Row = string[] | undefined;

export interface CsvGridHandle {
  scrollToCell: (
    cellAddress: CsvCellAddress,
    options?: { behavior?: ScrollBehavior },
  ) => void;
  getViewportElement: () => HTMLDivElement | null;
}

export interface CsvGridProps {
  columns: string[];
  rowStore: CsvRowStore;
  activeCell: CsvCellAddress | null;
  height: number;
  fillHeight: boolean;
  isolateStyles: boolean;
  scale: number;
  sortResetKey: unknown;
  statusNode: React.ReactNode;
}

const CSV_TABLE_LABEL = "CSV data";
const COLUMN_WIDTH = 180;
const COLUMN_OVERSCAN = 2;
const JUMP_COLUMN_OVERSCAN = 0;
const ROW_HEIGHT = 33;
const ROW_NUMBER_WIDTH = 56;
const ROW_OVERSCAN = 4;
const JUMP_ROW_OVERSCAN = 0;
const SMALL_TABLE_ROW_LIMIT = 200;
const SMALL_TABLE_COLUMN_LIMIT = 8;
const WORKER_SORT_ROW_THRESHOLD = 20_000;
const CSV_NATIVE_FIND_MAX_INDEXED_CELLS = 1_000_000;

export const CsvGrid = React.forwardRef<CsvGridHandle, CsvGridProps>(
  function CsvGrid(
    {
      columns,
      rowStore,
      activeCell,
      height,
      fillHeight,
      isolateStyles,
      scale,
      sortResetKey,
      statusNode,
    },
    ref,
  ) {
    const [sort, setSort] = React.useState<{
      columnIndex: number;
      descending: boolean;
    } | null>(null);
    const columnShapeKey = React.useMemo(
      () => columns.join("\u0000"),
      [columns],
    );

    useKeyedMountEffect(
      joinEffectKey(["csv-sort-reset", columnShapeKey, sortResetKey]),
      () => {
        setSort(null);
      },
    );

    const toggleSort = React.useCallback((columnIndex: number) => {
      setSort((current) =>
        !current || current.columnIndex !== columnIndex
          ? { columnIndex, descending: false }
          : current.descending
            ? null
            : { columnIndex, descending: true },
      );
    }, []);

    const rowOrder = useCsvSortedRowOrder({ rowStore, sort });

    const displayIndexByRowIndex = React.useMemo<Map<
      number,
      number
    > | null>(() => {
      if (!rowOrder) return null;
      const map = new Map<number, number>();
      rowOrder.forEach((rowIndex, displayRowIndex) => {
        map.set(rowIndex, displayRowIndex);
      });
      return map;
    }, [rowOrder]);

    const rowAt = React.useCallback(
      (displayRowIndex: number): Row => {
        const sourceRowIndex = rowOrder?.[displayRowIndex] ?? displayRowIndex;
        return rowStore.getRow(sourceRowIndex);
      },
      [rowStore, rowOrder],
    );

    const rowIndexAt = React.useCallback(
      (displayRowIndex: number): number =>
        rowOrder?.[displayRowIndex] ?? displayRowIndex,
      [rowOrder],
    );

    const viewportRef = React.useRef<HTMLDivElement>(null);
    const rowOffsetRef = React.useRef<HTMLDivElement>(null);
    const rowWindowRef = React.useRef<HTMLDivElement>(null);
    const [viewportElement, setViewportElement] =
      React.useState<HTMLDivElement | null>(null);
    const setViewportRef = React.useCallback((node: HTMLDivElement | null) => {
      viewportRef.current = node;
      setViewportElement((current) => (current === node ? current : node));
    }, []);
    const columnCount = columns.length;
    const rowCount = rowStore.rowCount;
    const columnOffset = 1;
    const shouldVirtualizeRows = rowCount > SMALL_TABLE_ROW_LIMIT;
    const shouldVirtualizeColumns = columnCount > SMALL_TABLE_COLUMN_LIMIT;
    const effectiveRowHeight = Math.max(1, Math.round(ROW_HEIGHT * scale));
    const effectiveColumnWidth = Math.max(1, Math.round(COLUMN_WIDTH * scale));
    const effectiveRowNumberWidth = Math.round(ROW_NUMBER_WIDTH * scale);
    const columnItemsRef = React.useRef<FixedGridColumnItem[]>([]);
    const viewportClientHeightRef = React.useRef(0);
    const getRowPatchState = React.useCallback(
      (): CsvRowPatchState => ({
        activeCell: activeCell ?? null,
        columnItems: columnItemsRef.current,
        effectiveRowHeight,
        viewportHeight: viewportClientHeightRef.current,
        rowStore,
        rowOrder,
        shouldVirtualizeRows,
      }),
      [
        activeCell,
        effectiveRowHeight,
        rowStore,
        rowOrder,
        shouldVirtualizeRows,
      ],
    );
    const rowPatcher = useCsvRowPatcher({
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
      columnItems,
      virtualRowWindow,
      leftPad,
      rightPad,
      scrollToCell,
      viewportClientHeight,
    } = useFixedGridVirtualization({
      rowCount,
      columnCount,
      rowSize: effectiveRowHeight,
      columnSize: effectiveColumnWidth,
      rowOverscan: ROW_OVERSCAN,
      columnOverscan: COLUMN_OVERSCAN,
      jumpRowOverscan: JUMP_ROW_OVERSCAN,
      jumpColumnOverscan: JUMP_COLUMN_OVERSCAN,
      minimumRenderedRows: 1,
      rowScrollStrategy,
      scrollRef: viewportRef,
      scrollElement: viewportElement,
      virtualizeColumns: shouldVirtualizeColumns,
    });

    columnItemsRef.current = columnItems;
    viewportClientHeightRef.current = viewportClientHeight;

    React.useImperativeHandle(
      ref ?? null,
      () => ({
        scrollToCell: (cellAddress, options) => {
          const behavior = options?.behavior ?? "smooth";
          const displayRowIndex =
            displayIndexByRowIndex?.get(cellAddress.rowIndex) ??
            cellAddress.rowIndex;
          scrollToCell({
            rowIndex: displayRowIndex,
            columnIndex: cellAddress.columnIndex,
            behavior,
            align: "center",
          });
        },
        getViewportElement: () => viewportRef.current,
      }),
      [displayIndexByRowIndex, scrollToCell],
    );

    const gridTemplate = React.useMemo(
      () =>
        buildVirtualGridTemplate({
          leadingWidth: effectiveRowNumberWidth,
          leftPad,
          columnWidths: fixedGridColumnWidths(columnItems),
          rightPad,
        }),
      [effectiveRowNumberWidth, leftPad, columnItems, rightPad],
    );
    const totalWidth = effectiveRowNumberWidth + totalColumnSize;
    const minimumRowPoolSize =
      Math.ceil(viewportClientHeight / effectiveRowHeight) +
      ROW_OVERSCAN * 2 +
      2;
    const rowPoolSlots = useFixedRowPool({
      minimumPoolSize: minimumRowPoolSize,
      rowCount,
      virtualRows: virtualRowWindow.items,
    });
    const shouldIndexNativeFind =
      rowCount > 0 &&
      columnCount > 0 &&
      (shouldVirtualizeRows || shouldVirtualizeColumns);
    const nativeFindCellText = React.useCallback(
      (displayRowIndex: number, columnIndex: number) =>
        rowAt(displayRowIndex)?.[columnIndex] ?? "",
      [rowAt],
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
        "csv-row-patcher",
        rowPatcher,
        virtualRows,
        columnItems,
        shouldVirtualizeRows,
      ]),
      () => {
        // After React commits the canonical row window, push that window's
        // visibility, position, and text back onto the pooled DOM so any stale
        // state left by the imperative scroll patcher (a `hidden` row React's
        // reconciler never re-showed, or a cyclic-column cell it never rewrote)
        // is cleared. Falls back to a plain cache invalidation when row
        // virtualization is inactive.
        if (shouldVirtualizeRows) {
          rowPatcher.resync(virtualRows);
        } else {
          rowPatcher.invalidate();
        }
      },
    );

    return (
      <div
        data-slot="csv-grid"
        role="table"
        aria-label={CSV_TABLE_LABEL}
        aria-rowcount={rowCount + 1}
        aria-colcount={columnCount + columnOffset}
        className={cn("relative", fillHeight && "min-h-0 flex-1")}
      >
        <CsvStyleScope
          isolate={isolateStyles}
          className={cn("relative", fillHeight && "h-full min-h-0")}
          style={fillHeight ? undefined : { height, maxHeight: "100%" }}
        >
          <style>{CSV_SCROLLBAR_CSS}</style>
          <FixedGridNativeFindIndex
            rowCount={rowCount}
            columnCount={columnCount}
            getCellText={nativeFindCellText}
            onCellMatch={scrollToNativeFindCell}
            dataSlot="csv-native-find-index"
            enabled={shouldIndexNativeFind}
            maxIndexedCells={CSV_NATIVE_FIND_MAX_INDEXED_CELLS}
          />
          <FixedGridViewport
            scrollRef={setViewportRef}
            dataSlot="csv-body"
            aria-label={CSV_TABLE_LABEL}
            tabIndex={0}
          >
            <div
              style={getFixedGridCanvasStyle({
                width: totalWidth,
                contain: true,
              })}
            >
              <div
                role="row"
                aria-rowindex={1}
                data-slot="csv-header"
                className="sticky top-0 z-20 grid border-b"
                style={{
                  gridTemplateColumns: gridTemplate,
                  backgroundColor:
                    "color-mix(in oklab, var(--card) 92%, var(--foreground))",
                }}
              >
                <div
                  role="columnheader"
                  aria-colindex={1}
                  aria-label="Row number"
                  className="sticky left-0 z-10 border-r bg-[color-mix(in_oklab,var(--card)_94%,var(--foreground))]"
                  style={{ height: effectiveRowHeight }}
                />
                <Spacer width={leftPad} />
                {columnItems.map((item) => (
                  <HeaderCell
                    key={item.index}
                    name={columns[item.index] || `Column ${item.index + 1}`}
                    columnIndex={columnOffset + item.index + 1}
                    height={effectiveRowHeight}
                    sorted={
                      sort?.columnIndex === item.index
                        ? sort.descending
                          ? "desc"
                          : "asc"
                        : false
                    }
                    onToggle={() => toggleSort(item.index)}
                  />
                ))}
                <Spacer width={rightPad} />
              </div>

              {statusNode ? (
                statusNode
              ) : shouldVirtualizeRows ? (
                <FixedGridRowWindow
                  role="rowgroup"
                  rowOffsetRef={rowOffsetRef}
                  rowWindowRef={rowWindowRef}
                  totalSize={totalRowSize}
                  virtualRowWindow={virtualRowWindow}
                  viewportHeight={viewportClientHeight}
                  offsetDataSlot="csv-row-offset"
                  windowDataSlot="csv-row-window"
                >
                  {rowPoolSlots.map((slot) => (
                    <CsvRowSlot
                      key={slot.slotIndex}
                      slot={slot}
                      sourceRowCount={rowCount}
                      rowAt={rowAt}
                      rowIndexAt={rowIndexAt}
                      gridTemplate={gridTemplate}
                      rowHeight={effectiveRowHeight}
                      columnOffset={columnOffset}
                      columnItems={columnItems}
                      leftPad={leftPad}
                      rightPad={rightPad}
                      activeCell={activeCell}
                    />
                  ))}
                </FixedGridRowWindow>
              ) : (
                <div role="rowgroup">
                  {Array.from({ length: rowCount }, (_, displayRowIndex) => (
                    <CsvRow
                      key={displayRowIndex}
                      cells={rowAt(displayRowIndex)}
                      displayRowIndex={displayRowIndex}
                      rowIndex={rowIndexAt(displayRowIndex)}
                      gridTemplate={gridTemplate}
                      rowHeight={effectiveRowHeight}
                      columnOffset={columnOffset}
                      columnItems={columnItems}
                      leftPad={leftPad}
                      rightPad={rightPad}
                      activeColumnIndex={
                        activeCell?.rowIndex === rowIndexAt(displayRowIndex)
                          ? activeCell.columnIndex
                          : null
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </FixedGridViewport>
          <HeaderAwareScrollbar
            scrollRef={viewportRef}
            headerHeight={effectiveRowHeight}
          />
        </CsvStyleScope>
      </div>
    );
  },
);

function useCsvSortedRowOrder({
  rowStore,
  sort,
}: {
  rowStore: CsvRowStore;
  sort: { columnIndex: number; descending: boolean } | null;
}): number[] | null {
  const [workerRowOrder, setWorkerRowOrder] = React.useState<number[] | null>(
    null,
  );
  const sourceRows = React.useMemo(
    () => (sort ? rowStore.materializeRows() : null),
    [rowStore, sort],
  );
  const shouldUseWorker =
    !!sort &&
    !!sourceRows &&
    sourceRows.length >= WORKER_SORT_ROW_THRESHOLD &&
    typeof Worker !== "undefined";

  const workerSortKey =
    sort && sourceRows && shouldUseWorker
      ? joinEffectKey(["csv-worker-sort", shouldUseWorker, sort, sourceRows])
      : null;
  useKeyedMountEffect(workerSortKey, () => {
    if (!sort || !sourceRows || !shouldUseWorker) {
      setWorkerRowOrder(null);
      return;
    }
    setWorkerRowOrder(null);

    const controller = new AbortController();
    void sortCsvRowsInWorker({
      sourceRows,
      columnIndex: sort.columnIndex,
      descending: sort.descending,
      signal: controller.signal,
    }).then(
      (rowOrder) => setWorkerRowOrder(rowOrder),
      (error) => {
        if (controller.signal.aborted) return;
        setWorkerRowOrder(
          sortCsvRowsOnMainThread({
            sourceRows,
            columnIndex: sort.columnIndex,
            descending: sort.descending,
          }),
        );
      },
    );

    return () => controller.abort();
  });

  return React.useMemo(() => {
    if (!sort || !sourceRows) return null;
    if (shouldUseWorker) return workerRowOrder;
    return sortCsvRowsOnMainThread({
      sourceRows,
      columnIndex: sort.columnIndex,
      descending: sort.descending,
    });
  }, [shouldUseWorker, sort, sourceRows, workerRowOrder]);
}

function Spacer({ width }: { width: number }) {
  return <div role="presentation" aria-hidden style={{ width }} />;
}

function HeaderCell({
  name,
  columnIndex,
  height,
  sorted,
  onToggle,
}: {
  name: string;
  columnIndex: number;
  height: number;
  sorted: "asc" | "desc" | false;
  onToggle: () => void;
}) {
  return (
    <div
      role="columnheader"
      aria-colindex={columnIndex}
      aria-sort={
        sorted === "asc"
          ? "ascending"
          : sorted === "desc"
            ? "descending"
            : "none"
      }
      data-slot="csv-header-cell"
      className="border-r last:border-r-0"
    >
      <button
        type="button"
        onClick={onToggle}
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted flex w-full items-center gap-1 px-3 text-left font-medium transition-colors focus-visible:outline-none"
        style={{ height }}
        title={`Sort by ${name}`}
      >
        <span className="truncate">{name}</span>
        {sorted ? (
          sorted === "asc" ? (
            <ChevronUp
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden
            />
          ) : (
            <ChevronDown
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden
            />
          )
        ) : null}
      </button>
    </div>
  );
}

function CsvRowSlot({
  slot,
  sourceRowCount,
  rowAt,
  rowIndexAt,
  gridTemplate,
  rowHeight,
  columnOffset,
  columnItems,
  leftPad,
  rightPad,
  activeCell,
}: {
  slot: FixedGridRowPoolSlot;
  sourceRowCount: number;
  rowAt: (displayRowIndex: number) => Row;
  rowIndexAt: (displayRowIndex: number) => number;
  gridTemplate: string;
  rowHeight: number;
  columnOffset: number;
  columnItems: FixedGridColumnItem[];
  leftPad: number;
  rightPad: number;
  activeCell: CsvCellAddress | null;
}) {
  const fallbackDisplayRowIndex =
    sourceRowCount > 0 ? Math.min(slot.slotIndex, sourceRowCount - 1) : 0;
  const displayRowIndex = slot.virtualRow?.index ?? fallbackDisplayRowIndex;
  const rowIndex = rowIndexAt(displayRowIndex);

  return (
    <CsvRow
      cells={rowAt(displayRowIndex)}
      displayRowIndex={displayRowIndex}
      rowIndex={rowIndex}
      gridTemplate={gridTemplate}
      rowHeight={rowHeight}
      columnOffset={columnOffset}
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

const CsvRow = React.memo(function CsvRow({
  cells,
  displayRowIndex,
  rowIndex,
  gridTemplate,
  rowHeight,
  columnOffset,
  columnItems,
  leftPad,
  rightPad,
  start,
  hidden = false,
  activeColumnIndex,
}: {
  cells: Row | undefined;
  displayRowIndex: number;
  rowIndex: number;
  gridTemplate: string;
  rowHeight: number;
  columnOffset: number;
  columnItems: FixedGridColumnItem[];
  leftPad: number;
  rightPad: number;
  start?: number;
  hidden?: boolean;
  activeColumnIndex?: number | null;
}) {
  const isVirtualized = start !== undefined;
  const style: React.CSSProperties = !isVirtualized
    ? { gridTemplateColumns: gridTemplate, height: rowHeight }
    : getFixedGridRowStyle({
        gridTemplate,
        rowHeight,
        top: start,
      });
  return (
    <div
      role="row"
      aria-rowindex={displayRowIndex + 2}
      hidden={hidden}
      data-slot="csv-row"
      className={cn(
        "grid border-b",
        !isVirtualized && "group hover:bg-muted/40",
      )}
      style={style}
    >
      <div
        role="rowheader"
        aria-colindex={1}
        data-slot="csv-row-number"
        className={cn(
          "bg-card text-muted-foreground sticky left-0 z-[1] flex items-center justify-end border-r px-2 tabular-nums",
          !isVirtualized &&
            "group-hover:bg-[color-mix(in_oklab,var(--card)_97%,var(--foreground))]",
        )}
      >
        {rowIndex + 1}
      </div>
      <Spacer width={leftPad} />
      {columnItems.map((item) => {
        const text = cells?.[item.index] ?? "";
        const isActive = activeColumnIndex === item.index;
        return (
          <div
            key={item.index}
            role="cell"
            aria-colindex={columnOffset + item.index + 1}
            data-slot="csv-cell"
            className={csvCellClassName(isActive)}
            title={isVirtualized ? undefined : text}
          >
            <span className="truncate">{text}</span>
          </div>
        );
      })}
      <Spacer width={rightPad} />
    </div>
  );
});
