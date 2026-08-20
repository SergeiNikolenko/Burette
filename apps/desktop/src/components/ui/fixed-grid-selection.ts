export interface GridCellCoordinate {
  rowIndex: number;
  columnIndex: number;
}

export function isSameGridCell(
  left: GridCellCoordinate | null | undefined,
  right: GridCellCoordinate | null | undefined,
) {
  return (
    isValidGridCellCoordinate(left) &&
    isValidGridCellCoordinate(right) &&
    left.rowIndex === right.rowIndex &&
    left.columnIndex === right.columnIndex
  );
}

export function gridCellKey({ rowIndex, columnIndex }: GridCellCoordinate) {
  if (!isValidGridCellCoordinate({ rowIndex, columnIndex })) return null;
  return `${rowIndex}:${columnIndex}`;
}

export function parseGridCellKey(key: string): GridCellCoordinate | null {
  const [rowIndexText, columnIndexText, extra] = key.split(":");
  if (extra !== undefined) return null;
  if (!rowIndexText || !columnIndexText) return null;
  if (
    !isUnsignedIntegerText(rowIndexText) ||
    !isUnsignedIntegerText(columnIndexText)
  ) {
    return null;
  }

  const rowIndex = Number(rowIndexText);
  const columnIndex = Number(columnIndexText);
  if (!isValidGridCellCoordinate({ rowIndex, columnIndex })) {
    return null;
  }

  return { rowIndex, columnIndex };
}

function isUnsignedIntegerText(value: string) {
  return /^(0|[1-9]\d*)$/.test(value);
}

function isValidGridCellCoordinate(
  coordinate: GridCellCoordinate | null | undefined,
): coordinate is GridCellCoordinate {
  return (
    !!coordinate &&
    Number.isSafeInteger(coordinate.rowIndex) &&
    Number.isSafeInteger(coordinate.columnIndex) &&
    coordinate.rowIndex >= 0 &&
    coordinate.columnIndex >= 0
  );
}
