export interface PageOverlayProps {
  pageNumber: number;
  /** Rendered page size in CSS pixels (post-scale, post-rotation). */
  width: number;
  height: number;
  scale: number;
  rotation: number;
}

export type PdfPageAreaTarget = {
  pageNumber: number;
  top: number;
  left?: number;
  width?: number;
  height?: number;
};

export interface PdfViewerHandle {
  scrollToPage: (pageNumber: number, options?: ScrollToOptions) => void;
  scrollToPageArea: (
    target: PdfPageAreaTarget,
    options?: ScrollToOptions,
  ) => void;
  getViewportElement: () => HTMLDivElement | null;
}

export type PdfPageSize = {
  width: number;
  height: number;
};

export type PdfPageRenderStatus = "rendered" | "cancelled" | "failed";
export type PdfPageRenderSource = "cache" | "cache-preview" | "pdfjs";

export type PdfPageRenderTiming = {
  pageNumber: number;
  scale: number;
  rotation: number;
  devicePixelRatio: number;
  status: PdfPageRenderStatus;
  source?: PdfPageRenderSource;
  durationMs: number;
};

export type PdfViewerPerformanceOptions = {
  renderedPageCache?: boolean;
  directionAwarePreRender?: boolean;
  imperativePageLayer?: boolean;
};
