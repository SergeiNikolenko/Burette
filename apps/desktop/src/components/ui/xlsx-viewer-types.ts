import type { ViewerResource } from "@/lib/viewer-resource";
import type { BlobViewerSource, UrlViewerSource } from "@/lib/viewer-source";

import type { PublicXlsxCellRef } from "./xlsx-viewer-scroll";

export type XlsxDocumentSource = UrlViewerSource | BlobViewerSource;

export interface XlsxViewerProps {
  /** Canonical spreadsheet source. */
  source: XlsxDocumentSource;
  className?: string;
  controls?: boolean;
  /** Show download actions in this viewer's controls/error state. */
  download?: boolean;
  /** Sheet shown first. Defaults to 0. */
  defaultSheetIndex?: number;
  /** Fired with the active sheet index on tab switch and imperative sheet changes. */
  onSheetChange?: (index: number) => void;
  /** Reserve the workbook tab bar while metadata loads. Use for known multi-sheet files. */
  fallbackSheetTabs?: boolean;
  /** Drop the outer border/rounded/background so the viewer fills its container. */
  bare?: boolean;
  /** Public compatibility coordinates: 0-based row + column on `sheet`. */
  activeCell?: XlsxCellRef | null;
  /**
   * Render the scrolling grid inside a shadow root, isolating it from host page
   * style invalidation while preserving inherited theme variables.
   */
  isolateStyles?: boolean;
}

export type XlsxResourceContentProps = Omit<XlsxViewerProps, "source"> & {
  resource: ViewerResource;
};

export type XlsxCellRef = PublicXlsxCellRef;

export interface XlsxViewerHandle {
  scrollToCell: (
    sheet: number,
    row: number,
    col: number,
    options?: { behavior?: ScrollBehavior },
  ) => void;
  getViewportElement: () => HTMLDivElement | null;
}
