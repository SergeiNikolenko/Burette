import type {
  BlobViewerSource,
  TextSource,
  UrlViewerSource,
} from "@/lib/viewer-source";

import type { TextViewerMode } from "./text-viewer-layout";
import type { TextLineRange } from "./text-viewer-ranges";
import type { TextViewerBounds } from "./text-viewer-resource";

export type { TextLineRange };

export interface TextViewerHandle {
  scrollToLineRange: (range: TextLineRange, options?: ScrollToOptions) => void;
  getViewportElement: () => HTMLDivElement | null;
}

export type TextDocumentSource =
  | UrlViewerSource
  | BlobViewerSource
  | TextSource;

export interface TextViewerProps extends TextViewerBounds {
  source: TextDocumentSource;
  className?: string;
  controls?: boolean;
  download?: boolean;
  /** 1-based inclusive line range to highlight, or null. */
  highlight?: TextLineRange | null;
  /** Drop the outer border/rounded/background so the viewer fills its container. */
  bare?: boolean;
  /** Explicitly select text or markdown when the caller has already classified the source. */
  mode?: TextViewerMode;
}
