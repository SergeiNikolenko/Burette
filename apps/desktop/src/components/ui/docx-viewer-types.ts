import type { ViewerResource } from "@/lib/viewer-resource";
import type { BlobViewerSource, UrlViewerSource } from "@/lib/viewer-source";

export type DocxDocumentSource = UrlViewerSource | BlobViewerSource;

export type DocxTarget =
  | { kind: "text"; text: string }
  | { kind: "cell"; table: number; row: number; column: number };

export interface DocxViewerHandle {
  scrollToTarget: (target: DocxTarget, options?: ScrollIntoViewOptions) => void;
  getViewportElement: () => HTMLDivElement | null;
}

export interface DocxViewerProps {
  source: DocxDocumentSource;
  className?: string;
  scale?: number;
  defaultScale?: number;
  onScaleChange?: (scale: number | null) => void;
  controls?: boolean;
  /** Show download actions in this viewer's controls/error state. */
  download?: boolean;
  highlight?: DocxTarget | null;
  onVisiblePageChange?: (page: number) => void;
  onScrollProgressChange?: (progress: number) => void;
  bare?: boolean;
}

export type DocxResourceContentProps = Omit<DocxViewerProps, "source"> & {
  resource: ViewerResource;
};
