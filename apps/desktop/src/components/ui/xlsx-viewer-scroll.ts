import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import {
  resolveXlsxSheetChange,
  type XlsxSheetMeta,
} from "@/lib/xlsx-workbook";

import { joinEffectKey } from "@/lib/effect-key";

export interface PublicXlsxCellRef {
  sheet: number;
  row: number;
  col: number;
}

export interface InternalXlsxCellRef {
  sheetIndex: number;
  rowIndex: number;
  columnIndex: number;
}

export type PendingXlsxScrollTarget = InternalXlsxCellRef & {
  behavior: ScrollBehavior;
};

export type XlsxScrollRequest = PendingXlsxScrollTarget & {
  nonce: number;
};

export interface ResolvedXlsxScrollTarget {
  sheetIndex: number;
  request: PendingXlsxScrollTarget;
  changed: boolean;
}

export function toInternalCellRef(
  cellRef: PublicXlsxCellRef | null | undefined,
): InternalXlsxCellRef | null {
  if (!isValidPublicCellRef(cellRef)) return null;
  return {
    sheetIndex: cellRef.sheet,
    rowIndex: cellRef.row,
    columnIndex: cellRef.col,
  };
}

export function isValidPublicCellRef(
  cellRef: PublicXlsxCellRef | null | undefined,
): cellRef is PublicXlsxCellRef {
  return (
    cellRef != null &&
    Number.isSafeInteger(cellRef.sheet) &&
    Number.isSafeInteger(cellRef.row) &&
    Number.isSafeInteger(cellRef.col) &&
    cellRef.sheet >= 0 &&
    cellRef.row >= 0 &&
    cellRef.col >= 0
  );
}

export function isValidLoadedScrollTarget(
  target: InternalXlsxCellRef,
  sheets: XlsxSheetMeta[],
): boolean {
  const sheet = sheets[target.sheetIndex];
  const rowCount = normalizeSheetDimension(sheet?.rowCount);
  const columnCount = normalizeSheetDimension(sheet?.columnCount);
  return (
    !!sheet &&
    Number.isSafeInteger(target.rowIndex) &&
    Number.isSafeInteger(target.columnIndex) &&
    target.rowIndex >= 0 &&
    target.columnIndex >= 0 &&
    target.rowIndex < rowCount &&
    target.columnIndex < columnCount
  );
}

export function resolveLoadedScrollTarget({
  activeSheetIndex,
  target,
  sheets,
}: {
  activeSheetIndex: number;
  target: PendingXlsxScrollTarget;
  sheets: XlsxSheetMeta[];
}): ResolvedXlsxScrollTarget | null {
  if (!isValidLoadedScrollTarget(target, sheets)) return null;

  const change = resolveXlsxSheetChange({
    activeSheet: activeSheetIndex,
    requestedSheet: target.sheetIndex,
    sheetCount: sheets.length,
  });
  if (!change.accepted) return null;

  return {
    sheetIndex: change.sheetIndex,
    request: target,
    changed: change.changed,
  };
}

export function useXlsxScrollController({
  activeSheetIndex,
  sheets,
  activateSheet,
}: {
  activeSheetIndex: number;
  sheets: XlsxSheetMeta[] | null;
  activateSheet: (sheetIndex: number) => void;
}) {
  const [scrollRequest, setScrollRequest] =
    React.useState<XlsxScrollRequest | null>(null);
  const [pendingScrollTarget, setPendingScrollTarget] =
    React.useState<PendingXlsxScrollTarget | null>(null);
  const scrollNonce = React.useRef(0);

  const issueLoadedScrollTarget = React.useCallback(
    (target: PendingXlsxScrollTarget) => {
      if (!sheets) return false;

      const resolved = resolveLoadedScrollTarget({
        activeSheetIndex,
        target,
        sheets,
      });
      if (!resolved) return false;

      if (resolved.changed) {
        activateSheet(resolved.sheetIndex);
      }

      scrollNonce.current += 1;
      setScrollRequest({
        ...resolved.request,
        nonce: scrollNonce.current,
      });
      return true;
    },
    [activateSheet, activeSheetIndex, sheets],
  );

  const pendingScrollKey =
    pendingScrollTarget && sheets
      ? joinEffectKey([
          "xlsx-pending-scroll",
          issueLoadedScrollTarget,
          pendingScrollTarget,
          sheets,
        ])
      : null;
  useKeyedMountEffect(pendingScrollKey, () => {
    if (!pendingScrollTarget || !sheets) return;
    setPendingScrollTarget(null);
    issueLoadedScrollTarget(pendingScrollTarget);
  });

  const scrollToCell = React.useCallback(
    (
      sheet: number,
      row: number,
      col: number,
      options?: { behavior?: ScrollBehavior },
    ) => {
      const target = toInternalCellRef({ sheet, row, col });
      if (!target) return;

      const pendingTarget = {
        ...target,
        behavior: options?.behavior ?? "smooth",
      };
      if (!sheets) {
        setPendingScrollTarget(pendingTarget);
        return;
      }

      issueLoadedScrollTarget(pendingTarget);
    },
    [issueLoadedScrollTarget, sheets],
  );

  return {
    scrollRequest,
    scrollToCell,
  };
}

function normalizeSheetDimension(value: number | undefined) {
  return value != null && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}
