"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import type { XlsxSource } from "@/lib/xlsx-workbook";
import { XlsxGrid, XlsxGridSkeleton } from "@/components/ui/xlsx-grid";

import {
  resolveXlsxActiveCell,
  resolveXlsxScrollRequestForSheet,
} from "./xlsx-viewer-active-cell";
import type { XlsxCellRef } from "./xlsx-viewer-types";
import type { XlsxScrollRequest } from "./xlsx-viewer-scroll";
import { clampSheetIndex } from "./xlsx-viewer-sheet-state";
import { joinEffectKey } from "@/lib/effect-key";

export function XlsxViewerSheet({
  sourcePromise,
  activeSheetIndex,
  scale,
  onReportSource,
  activeCell,
  scrollRequest,
  isolateStyles,
  viewportRef,
}: {
  sourcePromise: Promise<XlsxSource>;
  activeSheetIndex: number;
  scale: number;
  onReportSource: (source: XlsxSource) => void;
  activeCell?: XlsxCellRef | null;
  scrollRequest?: XlsxScrollRequest | null;
  isolateStyles: boolean;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const source = React.use(sourcePromise);

  useKeyedMountEffect(
    joinEffectKey(["xlsx-report-source", source, onReportSource]),
    () => {
      onReportSource(source);
    },
  );

  const sheetIndex = clampSheetIndex(activeSheetIndex, source.sheets.length);
  const sheet = source.sheets[sheetIndex];
  const getCell = React.useCallback(
    (rowIndex: number, columnIndex: number) =>
      source.getCell(sheetIndex, rowIndex, columnIndex),
    [source, sheetIndex],
  );

  return (
    <XlsxGrid
      key={sheetIndex}
      rowCount={sheet?.rowCount ?? 0}
      columnCount={sheet?.columnCount ?? 0}
      sheetName={sheet?.name ?? `Sheet ${sheetIndex + 1}`}
      getCell={getCell}
      scale={scale}
      activeCell={resolveXlsxActiveCell(activeCell, sheetIndex)}
      scrollRequest={resolveXlsxScrollRequestForSheet(
        scrollRequest,
        sheetIndex,
      )}
      isolateStyles={isolateStyles}
      viewportRef={viewportRef}
    />
  );
}

export function XlsxViewerSheetSkeleton() {
  return <XlsxGridSkeleton />;
}
