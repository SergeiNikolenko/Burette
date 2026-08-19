export const CSV_CELL_CLASS =
  "flex items-center truncate border-r px-3 last:border-r-0";

export const CSV_ACTIVE_CELL_CLASS =
  "bg-primary/12 ring-1 ring-primary/50 ring-offset-0 ring-inset";

export function csvCellClassName(isActive: boolean): string {
  return isActive
    ? `${CSV_CELL_CLASS} ${CSV_ACTIVE_CELL_CLASS}`
    : CSV_CELL_CLASS;
}
