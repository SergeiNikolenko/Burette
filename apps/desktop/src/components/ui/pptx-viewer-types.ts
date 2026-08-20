import type * as React from "react";

import type { BlobViewerSource, UrlViewerSource } from "@/lib/viewer-source";

import type {
  PptxSlideOverlayProps,
  PptxSlideRenderTiming,
  PptxSourceLoadTiming,
} from "./pptx-viewer-core";

export type PptxDocumentSource = UrlViewerSource | BlobViewerSource;

export interface PptxViewerProps {
  /** Canonical presentation source. */
  source: PptxDocumentSource;
  className?: string;
  /** Controlled scale. When omitted, the viewer owns zoom state. */
  scale?: number;
  /** Initial uncontrolled scale. When omitted, uncontrolled mode starts fit-width. */
  defaultScale?: number;
  /** Intrinsic slide size used to reserve the first slide while metadata loads. */
  fallbackSlideSize?: { width: number; height: number };
  /** Called by zoom controls. `null` means return to fit-width mode. */
  onScaleChange?: (scale: number | null) => void;
  controls?: boolean;
  /** Show download actions in this viewer's controls/error state. */
  download?: boolean;
  /** Render absolutely-positioned overlays, such as bbox citations, on each slide. */
  renderSlideOverlay?: (props: PptxSlideOverlayProps) => React.ReactNode;
  /** Reports measured canvas render work for benchmark and profiling surfaces. */
  onSlideRenderTiming?: (timing: PptxSlideRenderTiming) => void;
  /** Reports measured presentation fetch/parse/load work for benchmark surfaces. */
  onSourceLoadTiming?: (timing: PptxSourceLoadTiming) => void;
  /** Fired with the 1-based slide nearest the top of the viewport as you scroll. */
  onVisibleSlideChange?: (slide: number) => void;
  /** Fired with scroll progress in [0, 1]. */
  onScrollProgressChange?: (progress: number) => void;
  /** Drop the outer border/rounded/background so the viewer fills its container. */
  bare?: boolean;
  /** Render slides as soon as they near the viewport, even mid-scroll. */
  eager?: boolean;
}
