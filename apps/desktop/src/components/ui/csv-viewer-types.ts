import type { CsvDialect } from "@/lib/csv";

import type { CsvViewerSource } from "./csv-viewer-resource";
import type { CsvCellAddress } from "./csv-viewer-state";

export interface CsvScrollOptions {
  behavior?: ScrollBehavior;
}

export interface CsvViewerHandle {
  scrollToCell: (
    cellAddress: CsvCellAddress,
    options?: CsvScrollOptions,
  ) => void;
  getViewportElement: () => HTMLDivElement | null;
}

export interface CsvViewerProps {
  source?: CsvViewerSource;
  dialect?: CsvDialect;
  className?: string;
  controls?: boolean;
  height?: number;
  fillHeight?: boolean;
  activeCell?: CsvCellAddress | null;
  isolateStyles?: boolean;
}
