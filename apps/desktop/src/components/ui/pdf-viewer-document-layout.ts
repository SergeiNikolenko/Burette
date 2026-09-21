"use client";

import * as React from "react";

import {
  useOptionalFileViewerRendererEnvironment,
  useOptionalFileViewerRendererFrame,
} from "./file-viewer-renderer-frame";
import type { FileViewerDocumentSurfaceMotionResolver } from "./file-viewer-motion-kernel";
import {
  resolveFileViewerRendererLayoutInlineSize,
  type FileViewerRendererFrame,
} from "./file-viewer-renderer-contract";
import { createFileViewerFitWidthSurfaceMotionResolver } from "./file-viewer-fit-width-motion";
import {
  createPdfPageLayout,
  type PdfPageLayoutModel,
} from "./pdf-viewer-layout";
import { usePdfPageSizes } from "./pdf-viewer-page-sizes";
import {
  getPdfFitWidthScale,
  getPdfPageDevicePixelRatio,
  PDF_PAGE_HORIZONTAL_PADDING,
  useMeasuredElementWidth,
  usePdfScale,
} from "./pdf-viewer-scale";
import {
  usePdfDocumentRotation,
  usePdfFirstPageSize,
  type PdfDocument,
} from "./pdf-viewer-document-resource";
import type { PdfPageSize } from "./pdf-viewer-types";
import type { ViewerDocumentTransition } from "./viewer-types";

export type PdfDocumentLayoutState = {
  containerRef: React.RefCallback<HTMLDivElement>;
  displayScale: number;
  firstPageSize: PdfPageSize;
  fitWidth: () => void;
  isFitWidth: boolean;
  pageDevicePixelRatio: number;
  pageLayout: PdfPageLayoutModel;
  renderScale: number;
  resolvedScale: number;
  rotateClockwise: () => void;
  rotation: number;
  resolveSurfaceMotionStyle: FileViewerDocumentSurfaceMotionResolver;
  /**
   * Stage pixels the settled stage grows per pane pixel. Fit-width fits the
   * FIRST page while the stage spans the WIDEST page, so a mixed-width
   * document grows its stage faster than the pane (maxBase / fitBase > 1);
   * the fit-width motion model needs this slope or its first frame lands at
   * a fractionally wrong scale.
   */
  stageInlineSlope: number;
  setPageSize: ReturnType<typeof usePdfPageSizes>["setPageSize"];
  transition: ViewerDocumentTransition;
  rendererFrame: FileViewerRendererFrame;
  zoomIn: () => void;
  zoomOut: () => void;
};

export function usePdfDocumentLayout({
  controlledScale,
  defaultScale,
  document,
  onScaleChange,
}: {
  controlledScale?: number;
  defaultScale?: number;
  document: PdfDocument;
  onScaleChange?: (scale: number | null) => void;
}): PdfDocumentLayoutState {
  const firstPageSize = usePdfFirstPageSize(document);
  const rendererEnvironment = useOptionalFileViewerRendererEnvironment();
  const { ref: containerRef, width: containerWidth } = useMeasuredElementWidth({
    enabled: !rendererEnvironment.usesShellGeometry,
  });
  const rendererFrame = useOptionalFileViewerRendererFrame({
    fallbackInlineSize: containerWidth,
  });
  const { rotation, rotateClockwise } = usePdfDocumentRotation(document);
  const fitPageWidth =
    rotation % 180 === 0 ? firstPageSize.width : firstPageSize.height;
  const logicalInlineSize = resolveFileViewerRendererLayoutInlineSize({
    fallbackInlineSize: containerWidth,
    rendererFrame,
  });
  const { resolvedScale, isFitWidth, zoomIn, zoomOut, fitWidth } = usePdfScale({
    controlledScale,
    defaultScale,
    onScaleChange,
    containerWidth: logicalInlineSize,
    pageWidth: fitPageWidth,
    resetKey: document,
  });
  const fitWidthDisplayScale = isFitWidth
    ? getPdfFitWidthScale(logicalInlineSize, fitPageWidth)
    : resolvedScale;
  const displayScale = isFitWidth ? fitWidthDisplayScale : resolvedScale;
  const renderScale = getPdfPreparedFitWidthRenderScale({
    enabled: isFitWidth,
    fallbackScale: resolvedScale,
    pageWidth: fitPageWidth,
    rasterInlineSize: getPdfPreparedFitWidthRasterInlineSize(rendererFrame),
  });
  const transition = React.useMemo(
    () =>
      getPdfDocumentTransition({
        isFitWidth,
        rendererTransition: rendererFrame.documentTransition,
      }),
    [isFitWidth, rendererFrame.documentTransition],
  );
  const { pageSizeByNumber, setPageSize } = usePdfPageSizes(document);
  const pageLayout = React.useMemo(
    () =>
      createPdfPageLayout({
        pageCount: document.numPages,
        defaultPageSize: firstPageSize,
        pageSizeByNumber,
        scale: displayScale,
        rotation,
      }),
    [
      document.numPages,
      displayScale,
      firstPageSize,
      pageSizeByNumber,
      rotation,
    ],
  );
  const pageDevicePixelRatio = getPdfPageDevicePixelRatio({
    devicePixelRatio:
      (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1,
    mode: "settled",
  });
  // The page layout is already at the motion's target width (commit-then-
  // relax), so the resolver reprojects that settled stage to the in-flight
  // visual width with one uniform transform.
  const stageInlineSlope =
    isFitWidth && displayScale > 0 && fitPageWidth > 0
      ? pageLayout.maxPageWidth / displayScale / fitPageWidth
      : 1;
  const resolveSurfaceMotionStyle =
    React.useMemo<FileViewerDocumentSurfaceMotionResolver>(
      () =>
        createFileViewerFitWidthSurfaceMotionResolver({
          // The pages layer centres the surface with auto margins whatever the
          // frame's align is (a camera view splits leftover space evenly), so
          // the margin model must say "center" too — an align-derived model
          // over a centred surface is exactly the mismatch that pops the
          // narrowing leg.
          align: "center",
          direction: rendererFrame.direction,
          isFitWidth,
          stageInlineSize: pageLayout.maxPageWidth,
          stageOuterInlinePadding: PDF_PAGE_HORIZONTAL_PADDING,
          stageInlineSlope,
        }),
      [
        isFitWidth,
        pageLayout.maxPageWidth,
        rendererFrame.direction,
        stageInlineSlope,
      ],
    );

  return {
    containerRef,
    displayScale,
    firstPageSize,
    fitWidth,
    isFitWidth,
    pageDevicePixelRatio,
    pageLayout,
    renderScale,
    resolvedScale,
    rotateClockwise,
    rotation,
    resolveSurfaceMotionStyle,
    setPageSize,
    stageInlineSlope,
    transition,
    rendererFrame,
    zoomIn,
    zoomOut,
  };
}

function getPdfDocumentTransition({
  isFitWidth,
  rendererTransition,
}: {
  isFitWidth: boolean;
  rendererTransition: ViewerDocumentTransition;
}): ViewerDocumentTransition {
  if (isFitWidth && rendererTransition.source === "viewer-shell") {
    return rendererTransition;
  }

  return {
    layoutPolicy: "live",
    scrollPolicy: "preserve",
    source: "none",
    transitionId: null,
    visualPolicy: "none",
  };
}

function getPdfPreparedFitWidthRenderScale({
  enabled,
  fallbackScale,
  pageWidth,
  rasterInlineSize,
}: {
  enabled: boolean;
  fallbackScale: number;
  pageWidth: number;
  rasterInlineSize: number | null;
}) {
  if (!enabled || rasterInlineSize == null) return fallbackScale;

  // Layout commits the target width at slide start; this prepares the
  // backing canvas for the largest width the motion touches so the already-
  // rendered bitmap only ever CSS-rescales — never blanks — while the
  // target-resolution render is pending.
  return getPdfFitWidthScale(rasterInlineSize, pageWidth);
}

function getPdfPreparedFitWidthRasterInlineSize(
  rendererFrame: FileViewerRendererFrame,
) {
  if (!rendererFrame.canToggleSidebar) return rendererFrame.rasterInlineSize;

  const inlineSize = Math.max(
    rendererFrame.rasterInlineSize ?? 0,
    rendererFrame.shellInlineSize ?? 0,
  );

  return inlineSize > 0 ? inlineSize : null;
}
