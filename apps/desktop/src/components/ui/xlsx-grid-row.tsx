"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { XlsxCell } from "@/lib/xlsx-workbook";
import type { FixedGridColumn } from "@/components/ui/fixed-grid-columns";
import { getFixedGridRowStyle } from "@/components/ui/fixed-grid-row-style";
import type { GridCellCoordinate } from "@/components/ui/fixed-grid-selection";

export type XlsxGridColumnItem = FixedGridColumn<{ columnIndex: number }> & {
  metadata: { columnIndex: number };
};

export const XlsxGridRow = React.memo(function XlsxGridRow({
  rowIndex,
  getCell,
  gridTemplate,
  rowHeight,
  columnItems,
  leftPad,
  rightPad,
  start,
  hidden = false,
  activeColumnIndex,
}: {
  rowIndex: number;
  getCell: (rowIndex: number, columnIndex: number) => XlsxCell;
  gridTemplate: string;
  rowHeight: number;
  columnItems: XlsxGridColumnItem[];
  leftPad: number;
  rightPad: number;
  start: number;
  hidden?: boolean;
  activeColumnIndex?: GridCellCoordinate["columnIndex"] | null;
}) {
  const style = getFixedGridRowStyle({
    gridTemplate,
    rowHeight,
    top: start,
  });
  return (
    <div
      className="group hover:bg-muted/40 grid"
      style={style}
      role="row"
      aria-rowindex={rowIndex + 1}
      hidden={hidden}
      data-slot="xlsx-row"
    >
      <div
        aria-hidden
        data-slot="xlsx-row-number"
        className="bg-card text-muted-foreground sticky left-0 z-[1] flex items-center justify-end border-r border-b px-2 tabular-nums group-hover:bg-[color-mix(in_oklab,var(--card)_97%,var(--foreground))]"
      >
        {rowIndex + 1}
      </div>
      <Spacer width={leftPad} className="border-b" />
      {columnItems.map((item) => {
        const columnIndex = item.metadata.columnIndex;
        const cell = getCell(rowIndex, columnIndex);
        const isActive = activeColumnIndex === columnIndex;
        return (
          <div
            key={item.key}
            role="gridcell"
            aria-colindex={columnIndex + 1}
            data-slot="xlsx-cell"
            className={cn(
              "flex items-center truncate border-r border-b px-2",
              cell.numeric ? "justify-end tabular-nums" : "justify-start",
              isActive && "bg-primary/12 ring-primary/50 ring-1 ring-inset",
            )}
          >
            <span className="truncate">{cell.text}</span>
          </div>
        );
      })}
      <Spacer width={rightPad} className="border-b" />
    </div>
  );
});

export function Spacer({ width, className }: { width: number; className?: string }) {
  return <div aria-hidden className={className} style={{ width }} />;
}
