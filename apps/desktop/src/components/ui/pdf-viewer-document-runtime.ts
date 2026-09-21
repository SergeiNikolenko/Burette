"use client";

import * as React from "react";

import { joinEffectKey } from "@/lib/effect-key";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useMountEffect } from "@/hooks/use-mount-effect";

import {
  findPdfPageByOffset,
  getPdfPageLayout,
  getPdfPhysicalScrollHeight,
} from "./pdf-viewer-layout";
import type { PdfDocumentLayoutState } from "./pdf-viewer-document-layout";
import type { PdfDocument } from "./pdf-viewer-document-resource";
import type { PdfDocumentPagesLayerProps } from "./pdf-viewer-pages-layer";
import {
  FILE_VIEWER_FIT_WIDTH_ANCHOR_BLOCK_PROPERTY,
  captureFileViewerFitWidthAnchorScreenOffset,
  resolveFileViewerFitWidthMotionAnchorBlock,
} from "./file-viewer-fit-width-motion";
import {
  FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
  readFileViewerBeforeLayoutMotionFrame,
} from "./file-viewer-elements";
import type { FileViewerMotionFrame } from "./file-viewer-motion-plan";
import { usePdfRenderedPageCache } from "./pdf-viewer-render-cache";
import {
  PDF_SCROLLING_PAGE_RENDER_CONCURRENCY,
  usePdfPageRenderScheduler,
} from "./pdf-viewer-render-scheduler";
import { PDF_READING_MARKER_RATIO, usePdfScroll } from "./pdf-viewer-scroll";
import {
  notePdfZoomMotionPageRender,
  PDF_ZOOM_MOTION_TOTAL_MS,
} from "./pdf-viewer-zoom-motion";
import type {
  PageOverlayProps,
  PdfPageRenderTiming,
  PdfViewerHandle,
  PdfViewerPerformanceOptions,
} from "./pdf-viewer-types";
import { usePdfViewerTelemetry } from "./pdf-viewer-telemetry";
import { usePdfPageVirtualization } from "./pdf-viewer-virtualization";

const PDF_SHELL_MOTION_RENDER_RESUME_DELAY_MS = 1400;

export type PdfDocumentRuntimeState = {
  currentPage: number;
  handle: PdfViewerHandle;
  handleViewportScroll: () => void;
  pagesLayerProps: PdfDocumentPagesLayerProps;
  setViewportElement: (element: HTMLDivElement | null) => void;
  zoomControls: {
    fitWidth: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
  };
};

export function usePdfDocumentRuntime({
  document,
  documentKey,
  layout,
  onPageRenderTiming,
  onScrollProgressChange,
  onVisiblePageChange,
  performanceOptions,
  renderPageOverlay,
}: {
  document: PdfDocument;
  documentKey: string;
  layout: PdfDocumentLayoutState;
  onPageRenderTiming?: (timing: PdfPageRenderTiming) => void;
  onScrollProgressChange?: (progress: number) => void;
  onVisiblePageChange?: (page: number) => void;
  performanceOptions?: PdfViewerPerformanceOptions;
  renderPageOverlay?: (props: PageOverlayProps) => React.ReactNode;
}): PdfDocumentRuntimeState {
  const {
    captureZoomIntent,
    currentPage,
    viewportElement,
    setViewportElement,
    measureScroll,
    handleScroll,
    scrollToPage,
    scrollToPageArea,
    getViewportElement,
    getScrollMetrics,
  } = usePdfScroll({
    isLayoutTransitioning: layout.rendererFrame.isTransitioning,
    pageCount: document.numPages,
    layout: layout.pageLayout,
    transition: layout.transition,
    resetKey: document,
    onVisiblePageChange,
    onScrollProgressChange,
  });
  // Toolbar zoom steps re-anchor the viewport center and relax a FLIP over
  // the commit (pdf-viewer-zoom-motion). The sequence must flip in the zoom
  // gesture's own render so the visual clip is already released when the
  // enlarged opening frame paints; rapid steps re-arm the release timer.
  const [zoomMotionSequence, setZoomMotionSequence] = React.useState(0);
  const isZoomTransitioning = zoomMotionSequence > 0;
  useKeyedMountEffect(joinEffectKey([zoomMotionSequence]), () => {
    if (zoomMotionSequence === 0) return;
    const timeout = setTimeout(
      () => setZoomMotionSequence(0),
      PDF_ZOOM_MOTION_TOTAL_MS,
    );
    return () => clearTimeout(timeout);
  });
  const beginZoomMotion = React.useCallback(() => {
    captureZoomIntent();
    setZoomMotionSequence((sequence) => sequence + 1);
  }, [captureZoomIntent]);
  const layoutFitWidth = layout.fitWidth;
  const layoutZoomIn = layout.zoomIn;
  const layoutZoomOut = layout.zoomOut;
  const zoomControls = React.useMemo(
    () => ({
      fitWidth: () => {
        beginZoomMotion();
        layoutFitWidth();
      },
      zoomIn: () => {
        beginZoomMotion();
        layoutZoomIn();
      },
      zoomOut: () => {
        beginZoomMotion();
        layoutZoomOut();
      },
    }),
    [beginZoomMotion, layoutFitWidth, layoutZoomIn, layoutZoomOut],
  );
  const documentSurfaceElementRef = React.useRef<HTMLElement | null>(null);
  // The transform's anchor line, in the visual stage's own (physical scroll)
  // coordinates. The idle write is the live reading-marker offset; the
  // slide-start write derives the EXACT fixed point of the commit that just
  // ran (see writeMotionAnchorBlockOffset), so the transform's first frame
  // reproduces the pre-toggle screen even where the rebase clamped.
  const preMotionAnchorRef = React.useRef<{
    pageNumber: number;
    screenRelTop: number;
  } | null>(null);
  const motionProbePageNumber = layout.rendererFrame.isTransitioning
    ? (preMotionAnchorRef.current?.pageNumber ?? currentPage)
    : currentPage;
  const lastAnchorBlockRef = React.useRef<number | null>(null);
  const writeAnchorBlockOffsetPx = React.useCallback((anchorBlock: number) => {
    const documentSurfaceElement = documentSurfaceElementRef.current;
    if (!documentSurfaceElement) return;
    const safeAnchorBlock = Number.isFinite(anchorBlock) ? anchorBlock : 0;
    lastAnchorBlockRef.current = safeAnchorBlock;
    documentSurfaceElement.style.setProperty(
      FILE_VIEWER_FIT_WIDTH_ANCHOR_BLOCK_PROPERTY,
      `${safeAnchorBlock}px`,
    );
  }, []);
  const writeDocumentAnchorBlockOffset = React.useCallback(() => {
    const metrics = getScrollMetrics();
    writeAnchorBlockOffsetPx(
      Math.max(0, metrics.physicalScrollTop) +
        Math.max(0, metrics.viewportHeight) * PDF_READING_MARKER_RATIO,
    );
  }, [getScrollMetrics, writeAnchorBlockOffsetPx]);
  // The transform must pin the exact screen line the slide-start commit
  // preserved, or the first sliding frame drifts off the pre-toggle screen.
  // Rather than assuming anything about the rebase or the layout models,
  // measure the fixed point: capture the marker page's (transform-aware)
  // on-screen top against the OLD layout model before the commit, then solve
  // for the stage anchor that puts the same page top back on that screen line
  // under the NEW layout model at the motion's first-frame scale. Exact in
  // both direct and rebased (paged) scroll spaces, at clamps, across
  // measured/estimated page-size differences, and through mid-flight
  // retargets (the capture applies the in-flight transform it was seen under).
  const writeMotionAnchorBlockOffset = React.useCallback(() => {
    const metrics = getScrollMetrics();
    const preMotionAnchor = preMotionAnchorRef.current;
    const newPageLayout = preMotionAnchor
      ? getPdfPageLayout(layout.pageLayout, preMotionAnchor.pageNumber)
      : null;
    const logicalDelta = metrics.scrollTop - metrics.physicalScrollTop;
    const anchorBlock =
      preMotionAnchor && newPageLayout
        ? resolveFileViewerFitWidthMotionAnchorBlock({
            fromInlineSize: layout.rendererFrame.fromInlineSize,
            probeScreenOffset: preMotionAnchor.screenRelTop,
            probeStageOffset: newPageLayout.offsetTop - logicalDelta,
            scrollTop: metrics.physicalScrollTop,
            stageInlineSize: layout.pageLayout.maxPageWidth,
            // The PDF layout is proportional on both axes, so the block
            // slope IS the inline slope.
            stageBlockSlope: layout.stageInlineSlope,
            toInlineSize: layout.rendererFrame.toInlineSize,
          })
        : null;

    if (anchorBlock == null) {
      writeDocumentAnchorBlockOffset();
      return;
    }
    writeAnchorBlockOffsetPx(anchorBlock);
  }, [
    getScrollMetrics,
    layout.pageLayout,
    layout.rendererFrame.fromInlineSize,
    layout.rendererFrame.toInlineSize,
    layout.stageInlineSlope,
    writeAnchorBlockOffsetPx,
    writeDocumentAnchorBlockOffset,
  ]);
  const measureBeforeLayoutMotion = React.useCallback(
    (liveFrame: FileViewerMotionFrame | null) => {
      const metrics = getScrollMetrics();
      const markerOffset =
        metrics.scrollTop +
        Math.max(0, metrics.viewportHeight) * PDF_READING_MARKER_RATIO;
      const pageNumber = findPdfPageByOffset(layout.pageLayout, markerOffset);
      const pageLayout = getPdfPageLayout(layout.pageLayout, pageNumber);
      const logicalDelta = metrics.scrollTop - metrics.physicalScrollTop;
      preMotionAnchorRef.current = pageLayout
        ? {
            pageNumber,
            screenRelTop: captureFileViewerFitWidthAnchorScreenOffset({
              lastAnchorBlock: lastAnchorBlockRef.current,
              liveFrame,
              probeStageOffset: pageLayout.offsetTop - logicalDelta,
              scrollTop: metrics.physicalScrollTop,
              stageInlineSize: layout.pageLayout.maxPageWidth,
              stageBlockSlope: layout.stageInlineSlope,
            }),
          }
        : null;
      measureScroll();
    },
    [
      getScrollMetrics,
      layout.pageLayout,
      layout.stageInlineSlope,
      measureScroll,
    ],
  );
  const measureBeforeLayoutMotionRef = React.useRef(measureBeforeLayoutMotion);
  measureBeforeLayoutMotionRef.current = measureBeforeLayoutMotion;
  const handleBeforeLayoutMotion = React.useCallback((event: Event) => {
    measureBeforeLayoutMotionRef.current(
      readFileViewerBeforeLayoutMotionFrame(event),
    );
  }, []);
  const setDocumentSurfaceElement = React.useCallback(
    (element: HTMLElement | null) => {
      const previousElement = documentSurfaceElementRef.current;
      if (previousElement === element) return;
      previousElement?.removeEventListener(
        FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
        handleBeforeLayoutMotion,
      );
      documentSurfaceElementRef.current = element;
      if (!element) return;
      element.addEventListener(
        FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
        handleBeforeLayoutMotion,
      );
      writeDocumentAnchorBlockOffset();
    },
    [handleBeforeLayoutMotion, writeDocumentAnchorBlockOffset],
  );
  // While a zoom relax is in flight, the raster world freezes at its
  // pre-zoom settled state: renderScale holds (no page re-registers a new
  // render signature), the scheduler pauses, and the virtualized page window
  // holds. pdf.js raster work is main-thread heavy — letting it land
  // mid-flight is exactly what stutters the relax's clock. Everything
  // sharpens at settle instead (the zoom analogue of the shell motion's
  // render pause, on the relax's much shorter envelope).
  const settledZoomRenderScaleRef = React.useRef(layout.renderScale);
  if (!isZoomTransitioning) {
    settledZoomRenderScaleRef.current = layout.renderScale;
  }
  const effectiveRenderScale = isZoomTransitioning
    ? settledZoomRenderScaleRef.current
    : layout.renderScale;
  const [shouldHoldPageWindowForRaster, setShouldHoldPageWindowForRaster] =
    React.useState(false);
  const {
    scrollPageOffset,
    visiblePageNumbers,
    renderPageNumbers,
    warmPageNumbers,
    preloadPageNumbers,
    measureVisiblePages,
  } = usePdfPageVirtualization({
    getScrollMetrics,
    isLayoutTransitioning: layout.rendererFrame.isTransitioning,
    layout: layout.pageLayout,
    resetKey: document,
    shouldHoldPageWindow: shouldHoldPageWindowForRaster,
    transition: layout.transition,
    viewportElement,
  });
  const renderedPageCache = usePdfRenderedPageCache(document);
  const shouldUseRenderedPageCache =
    performanceOptions?.renderedPageCache !== false;
  const isShellMotionActive =
    layout.rendererFrame.phase !== "idle" ||
    layout.transition.source === "viewer-shell";
  const isPageRenderingPaused =
    usePdfShellMotionRenderPause(isShellMotionActive) || isZoomTransitioning;
  const {
    activePageNumbers: activeRenderPageNumbers,
    isRenderQueueIdle,
    onPageRenderTiming: handleScheduledPageRenderTiming,
  } = usePdfPageRenderScheduler({
    isPaused: isPageRenderingPaused,
    pageNumbers: visiblePageNumbers,
    warmPageNumbers:
      performanceOptions?.directionAwarePreRender === false
        ? []
        : warmPageNumbers,
    lowPriorityPageNumbers:
      performanceOptions?.directionAwarePreRender === false
        ? []
        : preloadPageNumbers,
    scale: effectiveRenderScale,
    rotation: layout.rotation,
    devicePixelRatio: layout.pageDevicePixelRatio,
    resetKey: document,
    maxRunning: PDF_SCROLLING_PAGE_RENDER_CONCURRENCY,
    maxLowPriorityRunning:
      performanceOptions?.directionAwarePreRender === false ? 0 : 1,
  });
  useKeyedMountEffect(
    joinEffectKey([isShellMotionActive, isRenderQueueIdle, isZoomTransitioning]),
    () => {
      const nextShouldHold =
        isShellMotionActive ||
        isZoomTransitioning ||
        (shouldHoldPageWindowForRaster && !isRenderQueueIdle);
      setShouldHoldPageWindowForRaster((previous) =>
        previous === nextShouldHold ? previous : nextShouldHold,
      );
    },
  );
  const handlePageRenderTiming = React.useCallback(
    (timing: PdfPageRenderTiming) => {
      // Attribute raster work to a live zoom flight — with the flight-time
      // holds above this stays at 0, and the flight recorder proves it.
      notePdfZoomMotionPageRender(timing);
      handleScheduledPageRenderTiming(timing);
      onPageRenderTiming?.(timing);
    },
    [handleScheduledPageRenderTiming, onPageRenderTiming],
  );
  const readSettleSnapshot = React.useCallback(() => {
    const metrics = getScrollMetrics();
    const viewportElement = getViewportElement();

    return [
      metrics.scrollTop,
      metrics.physicalScrollTop,
      metrics.scrollPageOffset,
      metrics.viewportHeight,
      viewportElement?.scrollHeight ?? 0,
      viewportElement?.clientHeight ?? 0,
      layout.pageLayout.totalHeight,
      layout.pageLayout.maxPageWidth,
    ];
  }, [
    getScrollMetrics,
    getViewportElement,
    layout.pageLayout.maxPageWidth,
    layout.pageLayout.totalHeight,
  ]);
  usePdfViewerTelemetry({
    activeRenderPageNumbers,
    displayScale: layout.displayScale,
    documentKey,
    getDocumentSurfaceElement: () => documentSurfaceElementRef.current,
    getScrollMetrics,
    getViewportElement,
    layout: layout.pageLayout,
    pageDevicePixelRatio: layout.pageDevicePixelRatio,
    renderPageNumbers,
    renderScale: effectiveRenderScale,
    rendererFrame: layout.rendererFrame,
    visiblePageNumbers,
  });
  const scrollInteractionElementRef = React.useRef<HTMLDivElement | null>(null);
  const setScrollInteractionElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      scrollInteractionElementRef.current = element;
    },
    [],
  );
  const suspendScrollInteractions = usePdfScrollInteractionSuspension(
    scrollInteractionElementRef,
  );

  useMountEffect(() => () => {
    documentSurfaceElementRef.current?.removeEventListener(
      FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
      handleBeforeLayoutMotion,
    );
    documentSurfaceElementRef.current = null;
  });

  // displayScale now changes at slide START (commit-then-relax), so this
  // idle re-measure must not clobber the motion's fixed-point anchor; the
  // transitioning effect below owns the anchor for the whole motion.
  useKeyedMountEffect(
    joinEffectKey([
      document.numPages,
      layout.displayScale,
      layout.rendererFrame.isTransitioning,
      layout.rotation,
      measureScroll,
      writeDocumentAnchorBlockOffset,
      viewportElement,
    ]),
    () => {
      measureScroll();
      if (layout.rendererFrame.isTransitioning) return;
      writeDocumentAnchorBlockOffset();
    },
  );

  // The before-layout-motion event fires before the layout jump and captures
  // the pre-toggle scroll; this effect runs inside the slide-start commit
  // AFTER the scroll rebase (hook order puts the scroll layout effect first),
  // so it can pin the transform to the rebase's exact fixed point before the
  // first frame paints.
  useKeyedLayoutEffect(
    joinEffectKey([
      layout.rendererFrame.documentTransition.transitionId,
      layout.rendererFrame.isTransitioning,
      writeMotionAnchorBlockOffset,
    ]),
    () => {
      if (!layout.rendererFrame.isTransitioning) return;
      writeMotionAnchorBlockOffset();
    },
  );

  const handleViewportScroll = React.useCallback(() => {
    suspendScrollInteractions();
    const result = handleScroll();
    if (result?.source === "internal") return;
    // While the shell motion is in flight the anchor is the motion's fixed
    // point; a user scroll mid-slide must not retarget it to the marker.
    if (!layout.rendererFrame.isTransitioning) {
      writeDocumentAnchorBlockOffset();
    }
    measureVisiblePages();
  }, [
    handleScroll,
    layout.rendererFrame.isTransitioning,
    measureVisiblePages,
    suspendScrollInteractions,
    writeDocumentAnchorBlockOffset,
  ]);

  const handle = React.useMemo<PdfViewerHandle>(
    () => ({
      scrollToPage,
      scrollToPageArea,
      getViewportElement,
    }),
    [getViewportElement, scrollToPage, scrollToPageArea],
  );

  return {
    currentPage,
    handle,
    handleViewportScroll,
    pagesLayerProps: {
      activeRenderPageNumbers,
      containerRef: layout.containerRef,
      devicePixelRatio: layout.pageDevicePixelRatio,
      document,
      documentAlign: layout.rendererFrame.align,
      documentKey,
      isFitWidth: layout.isFitWidth,
      isLayoutTransitioning: layout.rendererFrame.isTransitioning,
      isZoomTransitioning,
      layout: layout.pageLayout,
      motionProbePageNumber,
      onPageRenderTiming: handlePageRenderTiming,
      physicalScrollHeight: getPdfPhysicalScrollHeight({
        totalHeight: layout.pageLayout.totalHeight,
        viewportHeight: viewportElement?.clientHeight ?? 0,
      }),
      readSettleSnapshot,
      renderCache: shouldUseRenderedPageCache ? renderedPageCache : undefined,
      renderPageNumbers,
      renderPageOverlay,
      renderScale: effectiveRenderScale,
      resolveSurfaceMotionStyle: layout.resolveSurfaceMotionStyle,
      rotation: layout.rotation,
      scale: layout.displayScale,
      scrollPageOffset,
      setDocumentSurfaceElement,
      setScrollInteractionElement,
      setPageSize: layout.setPageSize,
      viewportHeight: viewportElement?.clientHeight ?? 0,
      visiblePageNumbers,
    },
    setViewportElement,
    zoomControls,
  };
}

function usePdfShellMotionRenderPause(isShellMotionActive: boolean) {
  const [isSettling, setIsSettling] = React.useState(false);

  useKeyedMountEffect(joinEffectKey([isShellMotionActive, isSettling]), () => {
    if (isShellMotionActive) {
      setIsSettling(true);
      return;
    }

    if (!isSettling) return;

    const timer = setTimeout(() => {
      setIsSettling(false);
    }, PDF_SHELL_MOTION_RENDER_RESUME_DELAY_MS);

    return () => clearTimeout(timer);
  });

  return isShellMotionActive || isSettling;
}

function usePdfScrollInteractionSuspension(
  scrollInteractionElementRef: React.RefObject<HTMLElement | null>,
) {
  const restoreTimeoutRef = React.useRef<number | null>(null);
  const scrollElementRef = React.useRef<HTMLElement | null>(null);

  const suspendScrollInteractions = React.useCallback(() => {
    const scrollElement = scrollInteractionElementRef.current;
    if (!scrollElement) return;

    if (restoreTimeoutRef.current !== null) {
      window.clearTimeout(restoreTimeoutRef.current);
    }
    scrollElementRef.current = scrollElement;
    scrollElement.style.pointerEvents = "none";
    if (isMobileSafari()) {
      scrollElement.style.overflowX = "hidden";
    }
    restoreTimeoutRef.current = window.setTimeout(() => {
      restoreTimeoutRef.current = null;
      restorePdfScrollInteractions(scrollElementRef.current);
      scrollElementRef.current = null;
    }, 120);
  }, [scrollInteractionElementRef]);

  useMountEffect(() => () => {
    if (restoreTimeoutRef.current !== null) {
      window.clearTimeout(restoreTimeoutRef.current);
      restoreTimeoutRef.current = null;
    }
    restorePdfScrollInteractions(scrollElementRef.current);
    scrollElementRef.current = null;
  });

  return suspendScrollInteractions;
}

function restorePdfScrollInteractions(element: HTMLElement | null) {
  if (!element) return;
  element.style.removeProperty("pointer-events");
  element.style.removeProperty("overflow-x");
}

function isMobileSafari() {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent;
  return (
    /Safari/i.test(userAgent) &&
    /Mobile/i.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS/i.test(userAgent)
  );
}
