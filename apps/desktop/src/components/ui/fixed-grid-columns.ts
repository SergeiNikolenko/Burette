export interface FixedGridColumn<Metadata = unknown> {
  key: string;
  widthPx: number;
  metadata?: Metadata;
}

export function buildFixedGridColumns<Item, Metadata = unknown>({
  items,
  getKey,
  getWidthPx,
  getMetadata,
}: {
  items: readonly Item[];
  getKey: (item: Item, index: number) => string;
  getWidthPx: (item: Item, index: number) => number;
  getMetadata?: (item: Item, index: number) => Metadata | undefined;
}): FixedGridColumn<Metadata>[] {
  return items.map((item, index) => {
    const metadata = getMetadata?.(item, index);
    const widthPx = normalizeFixedGridColumnWidth(getWidthPx(item, index));
    return metadata === undefined
      ? {
          key: getKey(item, index),
          widthPx,
        }
      : {
          key: getKey(item, index),
          widthPx,
          metadata,
        };
  });
}

export function fixedGridColumnWidths(
  columns: readonly Pick<FixedGridColumn, "widthPx">[],
) {
  return columns.map((column) => normalizeFixedGridColumnWidth(column.widthPx));
}

function normalizeFixedGridColumnWidth(widthPx: number) {
  return Number.isFinite(widthPx) && widthPx > 0 ? widthPx : 0;
}
