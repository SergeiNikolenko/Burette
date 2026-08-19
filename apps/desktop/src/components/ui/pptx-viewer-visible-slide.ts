"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";

import {
  clamp,
  getScaledSlideSize,
  getVisibleSlideSize,
  type PptxSize,
} from "./pptx-viewer-core";
import {
  PPTX_ZOOM_INTENT_MAX_AGE_MS,
  type PptxZoomTransaction,
} from "./pptx-viewer-zoom-motion";
import type { ViewerDocumentZoomMotionController } from "./viewer-types";

export const PPTX_READING_MARKER_RATIO = 0.2;
export const PPTX_RENDER_FIT_PERFECTLY_OVERSCAN_PX = 32;
export const PPTX_RENDER_WINDOW_OVERSCAN_PX = 1000;
export const PPTX_SCROLL_REBASE_CONTAINER_PX = 12_000_000;
export const PPTX_SCROLL_REBASE_TRIGGER_PX = 1_000_000;
export const PPTX_SCROLL_REBASE_TARGET_PX = 2_000_000;
export const PPTX_SCROLL_REBASE_TARGET_BOTTOM_PX =
  PPTX_SCROLL_REBASE_CONTAINER_PX - PPTX_SCROLL_REBASE_TARGET_PX;
export const PPTX_SCROLL_REBASE_THRESHOLD_PX =
  PPTX_SCROLL_REBASE_CONTAINER_PX - PPTX_SCROLL_REBASE_TRIGGER_PX;
export const PPTX_SCROLL_POSITION_EPSILON = 1;

export interface PptxSlideLayout {
  slideCount: number;
  slideTopPadding: number;
  slideGap: number;
  slideHeight: number;
  slideWidth: number;
  slideStride: number;
  totalHeight: number;
}

export interface PptxVirtualSlide {
  height: number;
  index: number;
  key: string;
  slideNumber: number;
  top: number;
  width: number;
}

export interface PptxRenderedSlideWindow {
  afterHeight: number;
  beforeHeight: number;
  height: number;
  slides: Array<PptxVirtualSlide & { windowTop: number }>;
  stickyBottomInset: number;
  stickyTopInset: number;
}

export interface PptxRenderPixelWindow {
  bottom: number;
  top: number;
}

export interface PptxScrollMetrics {
  physicalScrollHeight: number;
  physicalScrollTop: number;
  scrollPageOffset: number;
  scrollTop: number;
  viewportHeight: number;
}

export interface PptxScrollRebasePosition {
  physicalScrollTop: number;
  scrollPageOffset: number;
}

export interface PptxSlideLayoutInput {
  baseSize: PptxSize;
  zoomScale: number;
  rotation: number;
  slideCount: number;
  slideGap: number;
  slidePadding: number;
}

export interface PptxVisibleSlideInput {
  layout: PptxSlideLayout;
  onVisibleSlideChange?: (slide: number) => void;
  onScrollProgressChange?: (progress: number) => void;
  zoomMotion?: ViewerDocumentZoomMotionController<PptxZoomTransaction>;
}

type PptxReadingAnchor =
  | {
      kind: "top";
    }
  | {
      kind: "slide";
      slideNumber: number;
      yPercent: number;
    };

export function createPptxSlideLayout({
  baseSize,
  zoomScale,
  rotation,
  slideCount,
  slideGap,
  slidePadding,
}: PptxSlideLayoutInput): PptxSlideLayout {
  const slideSize = getScaledSlideSize(baseSize, zoomScale);
  const visibleSize = getVisibleSlideSize(slideSize, rotation);
  const normalizedSlideCount = Number.isFinite(slideCount)
    ? Math.max(0, Math.floor(slideCount))
    : 0;
  // The gap scales with the slide, while the outer viewer inset stays fixed so
  // the first loaded slide occupies the exact p-4 skeleton frame. NOT rounded:
  // slide dimensions
  // (getScaledSlideSize) are fractional, so leaving the gap fractional too
  // keeps gap / slide height exactly constant and the layout perfectly linear.
  // (PDF rounds its gap only because its page dimensions are already
  // integer-rounded; rounding here would gain no integer offsets, just error.)
  const safeZoomScale =
    Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1;
  const normalizedSlideGap =
    Number.isFinite(slideGap) && slideGap > 0 ? slideGap * safeZoomScale : 0;
  const normalizedSlidePadding =
    Number.isFinite(slidePadding) && slidePadding > 0 ? slidePadding : 0;
  const gapCount = Math.max(0, normalizedSlideCount - 1);

  return {
    slideCount: normalizedSlideCount,
    slideTopPadding: normalizedSlidePadding,
    slideGap: normalizedSlideGap,
    slideHeight: visibleSize.height,
    slideWidth: visibleSize.width,
    slideStride: visibleSize.height + normalizedSlideGap,
    totalHeight:
      normalizedSlidePadding * 2 +
      visibleSize.height * normalizedSlideCount +
      normalizedSlideGap * gapCount,
  };
}

export function getPptxSlideAtScrollMarker(
  layout: PptxSlideLayout,
  markerScrollTop: number,
) {
  if (layout.slideCount <= 1 || layout.slideStride <= 0) return 1;

  const slideIndex = Math.floor(
    (markerScrollTop - layout.slideTopPadding) / layout.slideStride,
  );
  return clamp(slideIndex + 1, 1, layout.slideCount);
}

export function getPptxSlideTop(layout: PptxSlideLayout, slideIndex: number) {
  return layout.slideTopPadding + slideIndex * layout.slideStride;
}

export function getPptxVirtualSlides({
  layout,
  overscanSlides = 2,
  scrollTop,
  viewportHeight,
}: {
  layout: PptxSlideLayout;
  overscanSlides?: number;
  scrollTop: number;
  viewportHeight: number;
}): PptxVirtualSlide[] {
  if (layout.slideCount === 0) return [];

  const safeViewportHeight =
    Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : layout.slideHeight;
  const safeScrollTop =
    Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const safeOverscanSlides =
    Number.isFinite(overscanSlides) && overscanSlides > 0
      ? Math.floor(overscanSlides)
      : 0;
  const firstVisibleIndex =
    layout.slideStride > 0
      ? Math.floor(
          (safeScrollTop - layout.slideTopPadding) / layout.slideStride,
        )
      : 0;
  const lastVisibleIndex =
    layout.slideStride > 0
      ? Math.floor(
          (safeScrollTop + safeViewportHeight - layout.slideTopPadding) /
            layout.slideStride,
        )
      : 0;
  const firstIndex = clamp(
    firstVisibleIndex - safeOverscanSlides,
    0,
    layout.slideCount - 1,
  );
  const lastIndex = clamp(
    lastVisibleIndex + safeOverscanSlides,
    0,
    layout.slideCount - 1,
  );

  return Array.from(
    { length: lastIndex - firstIndex + 1 },
    (_, offset): PptxVirtualSlide => {
      const index = firstIndex + offset;
      const slideNumber = index + 1;
      return {
        height: layout.slideHeight,
        index,
        key: String(slideNumber),
        slideNumber,
        top: getPptxSlideTop(layout, index),
        width: layout.slideWidth,
      };
    },
  );
}

export function getPptxRenderSlides({
  fitPerfectly = false,
  fitPerfectlyOverscanPx = PPTX_RENDER_FIT_PERFECTLY_OVERSCAN_PX,
  layout,
  overscanPx = PPTX_RENDER_WINDOW_OVERSCAN_PX,
  scrollTop,
  viewportHeight,
}: {
  fitPerfectly?: boolean;
  fitPerfectlyOverscanPx?: number;
  layout: PptxSlideLayout;
  overscanPx?: number;
  scrollTop: number;
  viewportHeight: number;
}): PptxVirtualSlide[] {
  if (layout.slideCount === 0) return [];

  const window = createPptxWindowFromScrollPosition({
    fitPerfectly,
    fitPerfectlyOverscanPx,
    overscanPx,
    scrollHeight: layout.totalHeight,
    scrollTop,
    viewportHeight,
  });

  return getPptxSlidesInRange({
    layout,
    startOffset: window.top,
    endOffset: window.bottom,
  });
}

export function getPptxRenderedSlideWindow({
  layout,
  physicalScrollHeight = layout.totalHeight,
  scrollPageOffset = 0,
  slides,
  viewportHeight,
}: {
  layout: PptxSlideLayout;
  physicalScrollHeight?: number;
  scrollPageOffset?: number;
  slides: readonly PptxVirtualSlide[];
  viewportHeight: number;
}): PptxRenderedSlideWindow | null {
  const renderedSlides = [...slides].sort((a, b) => a.index - b.index);
  if (renderedSlides.length === 0) return null;

  const logicalBeforeHeight = renderedSlides[0]?.top ?? 0;
  const windowBottom = Math.max(
    ...renderedSlides.map((slide) => slide.top + slide.height),
  );
  const height = Math.max(0, windowBottom - logicalBeforeHeight);
  const beforeHeight = getPptxPagedLayoutTop({
    logicalTop: logicalBeforeHeight,
    scrollPageOffset,
    totalHeight: layout.totalHeight,
    viewportHeight,
  });
  const safeViewportHeight =
    Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : layout.slideHeight > 0
        ? layout.slideHeight
        : 0;
  const stickyCoverInset =
    safeViewportHeight > 0 ? -Math.max(0, height - safeViewportHeight) : 0;
  const afterHeight = Math.max(
    0,
    safeSize(physicalScrollHeight) - beforeHeight - height,
  );
  // The sticky cover clamp only ever needs to slide the window over CONTENT
  // the viewport can reach. When the window already holds the document's
  // first/last slide, the spacer beyond it is pure edge padding — relax that
  // side's inset by the spacer so the settled window keeps its flow position
  // at the scroll extremes. Without the relaxation the clamp drags the window
  // over the edge padding at scroll 0/max, and the settled layout stops being
  // a single linear function of scale (which the reading-fraction rebase
  // depends on to restore the reading line exactly across a re-fit).
  const includesFirstSlide = renderedSlides[0].index === 0;
  const includesLastSlide =
    renderedSlides[renderedSlides.length - 1].index === layout.slideCount - 1;

  return {
    afterHeight,
    beforeHeight,
    height,
    slides: renderedSlides.map((slide) => ({
      ...slide,
      windowTop: slide.top - logicalBeforeHeight,
    })),
    stickyBottomInset:
      stickyCoverInset - (includesFirstSlide ? beforeHeight : 0),
    stickyTopInset: stickyCoverInset - (includesLastSlide ? afterHeight : 0),
  };
}

export function createPptxWindowFromScrollPosition({
  fitPerfectly = false,
  fitPerfectlyOverscanPx = 0,
  overscanPx,
  scrollHeight,
  scrollTop,
  viewportHeight,
}: {
  fitPerfectly?: boolean;
  fitPerfectlyOverscanPx?: number;
  overscanPx: number;
  scrollHeight: number;
  scrollTop: number;
  viewportHeight: number;
}): PptxRenderPixelWindow {
  const safeOverscanPx = safePadding(overscanPx);
  const safeScrollHeight = safeSize(scrollHeight);
  const safeScrollTop = Math.max(0, finiteNumber(scrollTop));
  const safeViewportHeight = Math.max(0, finiteNumber(viewportHeight));
  const windowHeight = safeViewportHeight + safeOverscanPx * 2;
  const fitPerfectlyOverscan = safePadding(fitPerfectlyOverscanPx);
  const effectiveHeight = fitPerfectly
    ? safeViewportHeight + fitPerfectlyOverscan * 2
    : windowHeight;

  if (windowHeight >= safeScrollHeight || fitPerfectly) {
    const fitScrollTop = Math.min(safeScrollTop, safeScrollHeight);
    const top = Math.max(fitScrollTop - fitPerfectlyOverscan, 0);
    const bottom = Math.min(fitScrollTop + effectiveHeight, safeScrollHeight);
    return {
      bottom: Math.ceil(Math.max(bottom, top)),
      top: Math.floor(Math.max(0, top)),
    };
  }

  const scrollCenter = safeScrollTop + safeViewportHeight / 2;
  let top = scrollCenter - windowHeight / 2;
  let bottom = top + windowHeight;

  if (top < 0) {
    top = 0;
    bottom = windowHeight;
  }
  if (bottom > safeScrollHeight) {
    bottom = safeScrollHeight;
    top = safeScrollHeight - windowHeight;
  }

  return {
    bottom: Math.ceil(Math.max(bottom, top)),
    top: Math.floor(Math.max(0, top)),
  };
}

export function getPptxPhysicalScrollHeight({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  const safeTotalHeight = safeSize(totalHeight);
  return shouldRebasePptxScroll({
    totalHeight: safeTotalHeight,
    viewportHeight,
  })
    ? Math.min(safeTotalHeight, PPTX_SCROLL_REBASE_CONTAINER_PX)
    : safeTotalHeight;
}

export function getPptxLogicalScrollTop({
  physicalScrollTop,
  scrollPageOffset,
  totalHeight,
  viewportHeight,
}: {
  physicalScrollTop: number;
  scrollPageOffset: number;
  totalHeight: number;
  viewportHeight: number;
}) {
  return clamp(
    finiteNumber(physicalScrollTop) + safePadding(scrollPageOffset),
    0,
    getPptxMaxLogicalScrollTop({ totalHeight, viewportHeight }),
  );
}

export function resolvePptxPhysicalScrollPosition({
  logicalScrollTop,
  scrollPageOffset,
  totalHeight,
  viewportHeight,
}: {
  logicalScrollTop: number;
  scrollPageOffset: number;
  totalHeight: number;
  viewportHeight: number;
}): PptxScrollRebasePosition {
  const safeLogicalScrollTop = clamp(
    finiteNumber(logicalScrollTop),
    0,
    getPptxMaxLogicalScrollTop({ totalHeight, viewportHeight }),
  );

  if (!shouldRebasePptxScroll({ totalHeight, viewportHeight })) {
    return {
      physicalScrollTop: clamp(
        safeLogicalScrollTop,
        0,
        getPptxMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
      ),
      scrollPageOffset: 0,
    };
  }

  const currentPageOffset = clampPptxScrollPageOffset({
    scrollPageOffset,
    totalHeight,
    viewportHeight,
  });
  const physicalScrollTop = safeLogicalScrollTop - currentPageOffset;
  const maxPhysicalScrollTop = getPptxMaxPhysicalScrollTop({
    totalHeight,
    viewportHeight,
  });
  const maxPageOffset = getPptxMaxScrollPageOffset({
    totalHeight,
    viewportHeight,
  });
  const shouldMoveDown =
    physicalScrollTop > PPTX_SCROLL_REBASE_THRESHOLD_PX &&
    currentPageOffset < maxPageOffset;
  const shouldMoveUp =
    physicalScrollTop < PPTX_SCROLL_REBASE_TRIGGER_PX && currentPageOffset > 0;

  if (
    physicalScrollTop < 0 ||
    physicalScrollTop > maxPhysicalScrollTop ||
    shouldMoveDown ||
    shouldMoveUp
  ) {
    return resolvePptxScrollPageWindow({
      logicalScrollTop: safeLogicalScrollTop,
      preferredPhysicalScrollTop: shouldMoveUp
        ? Math.min(PPTX_SCROLL_REBASE_TARGET_BOTTOM_PX, maxPhysicalScrollTop)
        : PPTX_SCROLL_REBASE_TARGET_PX,
      totalHeight,
      viewportHeight,
    });
  }

  return {
    physicalScrollTop: roundPptxScrollPixel(
      clamp(physicalScrollTop, 0, maxPhysicalScrollTop),
    ),
    scrollPageOffset: currentPageOffset,
  };
}

export function getPptxPagedLayoutTop({
  logicalTop,
  scrollPageOffset,
  totalHeight,
  viewportHeight,
}: {
  logicalTop: number;
  scrollPageOffset: number;
  totalHeight: number;
  viewportHeight: number;
}) {
  if (!shouldRebasePptxScroll({ totalHeight, viewportHeight })) {
    return finiteNumber(logicalTop);
  }
  return Math.max(0, finiteNumber(logicalTop) - safePadding(scrollPageOffset));
}

export function readPptxScrollMetrics({
  scrollPageOffset,
  totalHeight,
  viewportElement,
}: {
  scrollPageOffset: number;
  totalHeight: number;
  viewportElement: HTMLDivElement | null;
}): PptxScrollMetrics {
  const viewportHeight = viewportElement?.clientHeight ?? 0;
  const physicalScrollTop = viewportElement?.scrollTop ?? 0;
  const physicalScrollHeight = getPptxPhysicalScrollHeight({
    totalHeight,
    viewportHeight,
  });
  const isRebased = physicalScrollHeight < totalHeight;

  return {
    physicalScrollHeight,
    physicalScrollTop,
    scrollPageOffset: isRebased ? scrollPageOffset : 0,
    scrollTop: isRebased
      ? getPptxLogicalScrollTop({
          physicalScrollTop,
          scrollPageOffset,
          totalHeight,
          viewportHeight,
        })
      : Math.max(0, physicalScrollTop),
    viewportHeight,
  };
}

export function usePptxVisibleSlide({
  layout,
  onVisibleSlideChange,
  onScrollProgressChange,
  zoomMotion,
}: PptxVisibleSlideInput) {
  const [currentSlide, setCurrentSlide] = React.useState(1);
  const scrollViewportRef = React.useRef<HTMLDivElement | null>(null);
  const lastReportedSlide = React.useRef(0);
  const lastVisibleSlideCallback = React.useRef(onVisibleSlideChange);
  const committedLayoutRef = React.useRef(layout);
  const scrollPageOffsetRef = React.useRef(0);
  const pendingZoomIntentRef = React.useRef<{
    capturedAt: number;
    transaction: PptxZoomTransaction;
  } | null>(null);
  const activeZoomMotionCancelRef = React.useRef<(() => void) | null>(null);
  const layoutEffectKey = getPptxSlideLayoutKey(layout);

  // Interrupting a zoom relax snaps to its committed endpoint: the layout and
  // scroll landed in the zoom's own commit, so clearing the transform is
  // always safe and never moves the settled geometry.
  const cancelZoomMotion = React.useCallback(() => {
    pendingZoomIntentRef.current = null;
    const cancelActiveZoomMotion = activeZoomMotionCancelRef.current;
    activeZoomMotionCancelRef.current = null;
    cancelActiveZoomMotion?.();
  }, []);

  if (lastVisibleSlideCallback.current !== onVisibleSlideChange) {
    lastVisibleSlideCallback.current = onVisibleSlideChange;
    lastReportedSlide.current = 0;
  }

  const getScrollMetrics = React.useCallback(
    () =>
      readPptxScrollMetrics({
        scrollPageOffset: scrollPageOffsetRef.current,
        totalHeight: layout.totalHeight,
        viewportElement: scrollViewportRef.current,
      }),
    [layout.totalHeight],
  );

  // Called in the zoom gesture's own task, against the pre-zoom layout and
  // painted DOM; the layout commit the gesture causes consumes the intent.
  const captureZoomIntent = React.useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || !zoomMotion) {
      pendingZoomIntentRef.current = null;
      return;
    }
    const metrics = readPptxScrollMetrics({
      scrollPageOffset: scrollPageOffsetRef.current,
      totalHeight: layout.totalHeight,
      viewportElement: viewport,
    });
    const transaction = zoomMotion.capture({
      scrollTop: metrics.scrollTop,
      viewportElement: viewport,
    });
    pendingZoomIntentRef.current =
      transaction == null
        ? null
        : { capturedAt: readPptxZoomNow(), transaction };
  }, [layout.totalHeight, zoomMotion]);

  const syncPhysicalScrollPosition = React.useCallback(
    (viewport: HTMLDivElement) => {
      const metrics = readPptxScrollMetrics({
        scrollPageOffset: scrollPageOffsetRef.current,
        totalHeight: layout.totalHeight,
        viewportElement: viewport,
      });
      if (metrics.physicalScrollHeight >= layout.totalHeight) {
        scrollPageOffsetRef.current = 0;
        return {
          ...metrics,
          scrollPageOffset: 0,
        };
      }

      const position = resolvePptxPhysicalScrollPosition({
        logicalScrollTop: metrics.scrollTop,
        scrollPageOffset: metrics.scrollPageOffset,
        totalHeight: layout.totalHeight,
        viewportHeight: metrics.viewportHeight,
      });
      scrollPageOffsetRef.current = position.scrollPageOffset;
      setViewportPhysicalScrollTop(viewport, position.physicalScrollTop);

      return {
        ...metrics,
        physicalScrollTop: position.physicalScrollTop,
        scrollPageOffset: position.scrollPageOffset,
      };
    },
    [layout.totalHeight],
  );

  const scrollViewportToLogicalTop = React.useCallback(
    (viewport: HTMLDivElement, targetTop: number) => {
      const position = resolvePptxPhysicalScrollPosition({
        logicalScrollTop: targetTop,
        scrollPageOffset: scrollPageOffsetRef.current,
        totalHeight: layout.totalHeight,
        viewportHeight: viewport.clientHeight,
      });
      scrollPageOffsetRef.current = position.scrollPageOffset;
      setViewportPhysicalScrollTop(viewport, position.physicalScrollTop);
    },
    [layout.totalHeight],
  );

  useKeyedLayoutEffect(layoutEffectKey, () => {
    const previousLayout = committedLayoutRef.current;
    committedLayoutRef.current = layout;

    if (arePptxSlideLayoutsEqual(previousLayout, layout)) return;

    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    // A fresh layout commit owns the visual layer; an in-flight zoom relax
    // against the previous layout can no longer settle correctly.
    const pendingZoomIntent = pendingZoomIntentRef.current;
    pendingZoomIntentRef.current = null;
    cancelZoomMotion();

    if (
      pendingZoomIntent &&
      zoomMotion &&
      readPptxZoomNow() - pendingZoomIntent.capturedAt <=
        PPTX_ZOOM_INTENT_MAX_AGE_MS
    ) {
      const zoomTarget = zoomMotion.resolveScrollTarget({
        transaction: pendingZoomIntent.transaction,
        viewportElement: viewport,
      });
      if (zoomTarget) {
        // Commit-then-relax: land the centered scroll inside this commit
        // (through the paged-scroll mapping), then relax the painted FLIP
        // over it. Raw scrollLeft assignment on purpose — the browser clamps
        // to the live scrollable range, including RTL's negative space.
        scrollViewportToLogicalTop(viewport, zoomTarget.top);
        if (zoomTarget.left != null && Number.isFinite(zoomTarget.left)) {
          viewport.scrollLeft = zoomTarget.left;
        }
        activeZoomMotionCancelRef.current = zoomMotion.play({
          transaction: pendingZoomIntent.transaction,
          viewportElement: viewport,
        });
        return;
      }
    }

    const previousLogicalScrollTop = getPptxLogicalScrollTop({
      physicalScrollTop: viewport.scrollTop,
      scrollPageOffset: scrollPageOffsetRef.current,
      totalHeight: previousLayout.totalHeight,
      viewportHeight: viewport.clientHeight,
    });
    const anchor = capturePptxReadingAnchor(
      previousLayout,
      viewport,
      previousLogicalScrollTop,
    );
    if (!anchor) return;

    const targetTop = getPptxReadingAnchorScrollTop(layout, viewport, anchor);
    if (targetTop != null) scrollViewportToLogicalTop(viewport, targetTop);
  });

  const handleScroll = React.useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const metrics = syncPhysicalScrollPosition(viewport);
    const isRebased = metrics.physicalScrollHeight < layout.totalHeight;
    const scrollable = isRebased
      ? layout.totalHeight - metrics.viewportHeight
      : viewport.scrollHeight - metrics.viewportHeight;
    onScrollProgressChange?.(
      scrollable > 0
        ? clamp(
            (isRebased ? metrics.scrollTop : viewport.scrollTop) / scrollable,
            0,
            1,
          )
        : 0,
    );

    const markerScrollTop =
      metrics.scrollTop + metrics.viewportHeight * PPTX_READING_MARKER_RATIO;
    const visibleSlide = getPptxSlideAtScrollMarker(layout, markerScrollTop);

    if (visibleSlide && visibleSlide !== lastReportedSlide.current) {
      lastReportedSlide.current = visibleSlide;
      setCurrentSlide(visibleSlide);
      onVisibleSlideChange?.(visibleSlide);
    }
  }, [
    layout,
    onScrollProgressChange,
    onVisibleSlideChange,
    syncPhysicalScrollPosition,
  ]);

  return {
    captureZoomIntent,
    currentSlide,
    getScrollMetrics,
    handleScroll,
    scrollViewportRef,
  };
}

function readPptxZoomNow() {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function getPptxSlideLayoutKey(layout: PptxSlideLayout) {
  return [
    layout.slideCount,
    layout.slideTopPadding,
    layout.slideGap,
    layout.slideHeight,
    layout.slideWidth,
    layout.slideStride,
    layout.totalHeight,
  ].join("\u0000");
}

function capturePptxReadingAnchor(
  layout: PptxSlideLayout,
  viewport: HTMLDivElement,
  scrollTop: number,
): PptxReadingAnchor | null {
  if (layout.slideCount === 0) return null;
  if (scrollTop <= 0) return { kind: "top" };

  const markerScrollTop =
    scrollTop + viewport.clientHeight * PPTX_READING_MARKER_RATIO;
  const slideNumber = getPptxSlideAtScrollMarker(layout, markerScrollTop);
  const slideTop = getPptxSlideTop(layout, slideNumber - 1);
  if (layout.slideHeight <= 0) return null;

  return {
    kind: "slide",
    slideNumber,
    yPercent: clamp((markerScrollTop - slideTop) / layout.slideHeight, 0, 1),
  };
}

function getPptxReadingAnchorScrollTop(
  layout: PptxSlideLayout,
  viewport: HTMLDivElement,
  anchor: PptxReadingAnchor,
) {
  if (anchor.kind === "top") {
    return 0;
  }

  if (anchor.slideNumber < 1 || anchor.slideNumber > layout.slideCount) {
    return null;
  }

  const slideTop = getPptxSlideTop(layout, anchor.slideNumber - 1);
  const targetTop =
    slideTop +
    layout.slideHeight * anchor.yPercent -
    viewport.clientHeight * PPTX_READING_MARKER_RATIO;
  const maxScrollTop = Math.max(0, layout.totalHeight - viewport.clientHeight);
  return clamp(targetTop, 0, maxScrollTop);
}

function arePptxSlideLayoutsEqual(
  previousLayout: PptxSlideLayout,
  nextLayout: PptxSlideLayout,
) {
  return (
    previousLayout.slideCount === nextLayout.slideCount &&
    previousLayout.slideTopPadding === nextLayout.slideTopPadding &&
    previousLayout.slideGap === nextLayout.slideGap &&
    previousLayout.slideHeight === nextLayout.slideHeight &&
    previousLayout.slideWidth === nextLayout.slideWidth &&
    previousLayout.slideStride === nextLayout.slideStride &&
    previousLayout.totalHeight === nextLayout.totalHeight
  );
}

function getPptxSlidesInRange({
  layout,
  startOffset,
  endOffset,
}: {
  layout: PptxSlideLayout;
  startOffset: number;
  endOffset: number;
}) {
  const safeStartOffset = Math.max(0, finiteNumber(startOffset));
  const safeEndOffset = Math.max(safeStartOffset, finiteNumber(endOffset));
  const firstIndex = getPptxSlideIndexAtOffset(layout, safeStartOffset);
  const lastIndex = getPptxSlideIndexAtOffset(layout, safeEndOffset);

  return createPptxSlideRange(layout, firstIndex, lastIndex);
}

function createPptxSlideRange(
  layout: PptxSlideLayout,
  firstIndex: number,
  lastIndex: number,
) {
  if (layout.slideCount === 0 || lastIndex < firstIndex) return [];

  return Array.from(
    { length: lastIndex - firstIndex + 1 },
    (_, offset): PptxVirtualSlide => {
      const index = firstIndex + offset;
      const slideNumber = index + 1;
      return {
        height: layout.slideHeight,
        index,
        key: String(slideNumber),
        slideNumber,
        top: getPptxSlideTop(layout, index),
        width: layout.slideWidth,
      };
    },
  );
}

function getPptxSlideIndexAtOffset(layout: PptxSlideLayout, offset: number) {
  if (layout.slideCount === 0 || layout.slideStride <= 0) return 0;

  return clamp(
    Math.floor(
      (finiteNumber(offset) - layout.slideTopPadding) / layout.slideStride,
    ),
    0,
    layout.slideCount - 1,
  );
}

function shouldRebasePptxScroll({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return (
    getPptxMaxLogicalScrollTop({ totalHeight, viewportHeight }) >
    PPTX_SCROLL_REBASE_THRESHOLD_PX
  );
}

function getPptxMaxLogicalScrollTop({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return Math.max(
    safeSize(totalHeight) - Math.max(0, finiteNumber(viewportHeight)),
    0,
  );
}

function getPptxMaxPhysicalScrollTop({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return Math.max(
    getPptxPhysicalScrollHeight({ totalHeight, viewportHeight }) -
      Math.max(0, finiteNumber(viewportHeight)),
    0,
  );
}

function getPptxMaxScrollPageOffset({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return Math.max(
    getPptxMaxLogicalScrollTop({ totalHeight, viewportHeight }) -
      getPptxMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
    0,
  );
}

function clampPptxScrollPageOffset({
  scrollPageOffset,
  totalHeight,
  viewportHeight,
}: {
  scrollPageOffset: number;
  totalHeight: number;
  viewportHeight: number;
}) {
  return clamp(
    safePadding(scrollPageOffset),
    0,
    getPptxMaxScrollPageOffset({ totalHeight, viewportHeight }),
  );
}

function resolvePptxScrollPageWindow({
  logicalScrollTop,
  preferredPhysicalScrollTop,
  totalHeight,
  viewportHeight,
}: {
  logicalScrollTop: number;
  preferredPhysicalScrollTop: number;
  totalHeight: number;
  viewportHeight: number;
}): PptxScrollRebasePosition {
  let physicalScrollTop = roundPptxScrollPixel(
    clamp(
      finiteNumber(preferredPhysicalScrollTop),
      0,
      getPptxMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
    ),
  );
  let scrollPageOffset = clampPptxScrollPageOffset({
    scrollPageOffset: logicalScrollTop - physicalScrollTop,
    totalHeight,
    viewportHeight,
  });

  physicalScrollTop = roundPptxScrollPixel(
    clamp(
      logicalScrollTop - scrollPageOffset,
      0,
      getPptxMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
    ),
  );
  scrollPageOffset = clampPptxScrollPageOffset({
    scrollPageOffset: logicalScrollTop - physicalScrollTop,
    totalHeight,
    viewportHeight,
  });

  return { physicalScrollTop, scrollPageOffset };
}

function setViewportPhysicalScrollTop(
  viewport: HTMLDivElement,
  targetTop: number,
) {
  if (
    Math.abs(viewport.scrollTop - targetTop) <= PPTX_SCROLL_POSITION_EPSILON
  ) {
    return;
  }
  viewport.scrollTop = targetTop;
}

function roundPptxScrollPixel(value: number) {
  return Math.round(value);
}

function safeSize(value: number) {
  return Math.max(0, finiteNumber(value));
}

function safePadding(value: number) {
  return Math.max(0, finiteNumber(value));
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}
