"use client";

import { Skeleton } from "@/components/ui/retab-skeleton";
import {
  XLSX_BASE_COLUMN_WIDTH,
  XLSX_BASE_GUTTER_WIDTH,
  XLSX_BASE_ROW_HEIGHT,
} from "@/components/ui/xlsx-grid-constants";

export function XlsxGridSkeleton() {
  const skeletonColumnCount = 6;
  const skeletonRowCount = 18;
  const widths = [70, 45, 88, 56, 62, 78];
  return (
    <div
      className="bg-card flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden"
      data-slot="xlsx-grid"
      aria-hidden
    >
      <div className="bg-muted/60 flex border-b">
        <div
          className="shrink-0 border-r"
          style={{
            width: XLSX_BASE_GUTTER_WIDTH,
            height: XLSX_BASE_ROW_HEIGHT,
          }}
        />
        {Array.from({ length: skeletonColumnCount }, (_, columnIndex) => (
          <div
            key={columnIndex}
            className="flex shrink-0 items-center justify-center border-r"
            style={{
              width: XLSX_BASE_COLUMN_WIDTH,
              height: XLSX_BASE_ROW_HEIGHT,
            }}
          >
            <Skeleton className="h-3 w-6" />
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {Array.from({ length: skeletonRowCount }, (_, rowIndex) => (
          <div
            key={rowIndex}
            className="flex border-b"
            style={{ height: XLSX_BASE_ROW_HEIGHT }}
          >
            <div
              className="flex shrink-0 items-center justify-end border-r px-2"
              style={{ width: XLSX_BASE_GUTTER_WIDTH }}
            >
              <Skeleton className="h-3 w-4" />
            </div>
            {Array.from({ length: skeletonColumnCount }, (_, columnIndex) => (
              <div
                key={columnIndex}
                className="flex shrink-0 items-center border-r px-2"
                style={{ width: XLSX_BASE_COLUMN_WIDTH }}
              >
                <Skeleton
                  className="h-3"
                  style={{
                    width: `${widths[(rowIndex + columnIndex) % widths.length]}%`,
                  }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
