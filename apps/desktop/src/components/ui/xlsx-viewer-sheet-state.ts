import * as React from "react";

import {
  resolveXlsxSheetChange,
  type XlsxSheetMeta,
  type XlsxSource,
} from "@/lib/xlsx-workbook";

export function useXlsxSheetState({
  defaultSheetIndex,
  onSheetChange,
}: {
  defaultSheetIndex: number;
  onSheetChange?: (index: number) => void;
}) {
  const [activeSheetIndex, setActiveSheetIndex] = React.useState(
    normalizeInitialSheetIndex(defaultSheetIndex),
  );
  const [sheets, setSheets] = React.useState<XlsxSheetMeta[] | null>(null);

  const reportSource = React.useCallback((source: XlsxSource) => {
    setSheets(source.sheets);
    setActiveSheetIndex((sheetIndex) =>
      clampSheetIndex(sheetIndex, source.sheets.length),
    );
  }, []);

  const selectSheet = React.useCallback(
    (sheetIndex: number) => {
      const change = resolveXlsxSheetChange({
        activeSheet: activeSheetIndex,
        requestedSheet: sheetIndex,
        sheetCount: sheets?.length,
      });
      if (!change.accepted) return false;
      if (change.changed) {
        setActiveSheetIndex(change.sheetIndex);
        onSheetChange?.(change.sheetIndex);
      }
      return true;
    },
    [activeSheetIndex, onSheetChange, sheets],
  );

  const activateSheet = React.useCallback(
    (sheetIndex: number) => {
      if (sheetIndex === activeSheetIndex) return;
      setActiveSheetIndex(sheetIndex);
      onSheetChange?.(sheetIndex);
    },
    [activeSheetIndex, onSheetChange],
  );

  return {
    activeSheetIndex,
    activeSheet: sheets?.[activeSheetIndex] ?? null,
    sheets,
    isReady: sheets != null,
    reportSource,
    selectSheet,
    activateSheet,
  };
}

export function normalizeInitialSheetIndex(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function clampSheetIndex(value: number, sheetCount: number) {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(value, Math.max(0, sheetCount - 1));
}
