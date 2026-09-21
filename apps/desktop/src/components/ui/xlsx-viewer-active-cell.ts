import type {
  PublicXlsxCellRef,
  XlsxScrollRequest,
} from "./xlsx-viewer-scroll";
import { toInternalCellRef } from "./xlsx-viewer-scroll";

export interface XlsxGridCellRef {
  rowIndex: number;
  columnIndex: number;
}

export function resolveXlsxActiveCell(
  activeCell: PublicXlsxCellRef | null | undefined,
  sheetIndex: number,
): XlsxGridCellRef | null {
  const target = toInternalCellRef(activeCell);
  if (!target || target.sheetIndex !== sheetIndex) return null;
  return {
    rowIndex: target.rowIndex,
    columnIndex: target.columnIndex,
  };
}

export function resolveXlsxScrollRequestForSheet(
  scrollRequest: XlsxScrollRequest | null | undefined,
  sheetIndex: number,
) {
  return scrollRequest?.sheetIndex === sheetIndex ? scrollRequest : null;
}
