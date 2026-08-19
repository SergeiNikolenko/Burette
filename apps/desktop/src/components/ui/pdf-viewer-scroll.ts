import * as React from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";

import {
  findPdfPageByOffset,
  getPdfLogicalScrollTop,
  getPdfPageLayout,
  getPdfPhysicalScrollHeight,
  resolvePdfPhysicalScrollPosition,
  type PdfPageLayoutModel,
} from "./pdf-viewer-layout";
import { clamp } from "./pdf-viewer-scale";
import { createPdfZoomMotionController } from "./pdf-viewer-zoom-motion";
import type { PdfPageAreaTarget } from "./pdf-viewer-types";
import type {
  ViewerDocumentScrollMapper,
  ViewerDocumentScrollMetrics,
  ViewerDocumentScrollTargetResolver,
  ViewerDocumentLayoutModel,
  ViewerDocumentTransition,
} from "./viewer-types";
import { useViewerDocumentScroll } from "./viewer-document-scroll";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

const PDF_SCROLL_TARGET_HEADROOM = 48;
const PDF_SCROLL_TARGET_INLINE_HEADROOM = 32;
export const PDF_READING_MARKER_RATIO = 0.2;
const PDF_SCROLL_IDLE_MS = 120;

type PdfReadingAnchor =
  | {
      kind: "top";
    }
  | {
      kind: "page";
      pageNumber: number;
      yPercent: number;
    };

type PdfResolvedPageAreaTarget = {
  top: number;
  left?: number;
};

type PdfScrollMetrics = {
  physicalScrollHeight: number;
  physicalScrollTop: number;
  scrollPageOffset: number;
  scrollTop: number;
  viewportHeight: number;
};

type PdfDocumentLayoutModel = ViewerDocumentLayoutModel<PdfReadingAnchor>;

const PDF_DOCUMENT_SCROLL_MAPPER: ViewerDocumentScrollMapper = {
  getLogicalScrollTop: ({
    blockSize,
    physicalScrollTop,
    scrollPageOffset,
    viewportBlockSize,
  }) =>
    getPdfLogicalScrollTop({
      physicalScrollTop,
      scrollPageOffset,
      totalHeight: blockSize,
      viewportHeight: viewportBlockSize,
    }),
  getPhysicalScrollSize: ({ blockSize, viewportBlockSize }) =>
    getPdfPhysicalScrollHeight({
      totalHeight: blockSize,
      viewportHeight: viewportBlockSize,
    }),
  resolvePhysicalScrollPosition: ({
    blockSize,
    logicalScrollTop,
    scrollPageOffset,
    viewportBlockSize,
  }) =>
    resolvePdfPhysicalScrollPosition({
      logicalScrollTop,
      scrollPageOffset,
      totalHeight: blockSize,
      viewportHeight: viewportBlockSize,
    }),
};

export function usePdfScrollActivity() {
  const [isScrolling, setIsScrolling] = React.useState(false);
  const [scrollDirection, setScrollDirection] = React.useState(1);
  const idleTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollTopRef = React.useRef(0);

  const handleScrollActivity = React.useCallback((viewport?: HTMLElement) => {
    const scrollTop = viewport?.scrollTop ?? scrollTopRef.current;
    const previousScrollTop = scrollTopRef.current;
    if (scrollTop > previousScrollTop) {
      setScrollDirection(1);
    } else if (scrollTop < previousScrollTop) {
      setScrollDirection(-1);
    }
    scrollTopRef.current = scrollTop;

    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }

    setIsScrolling(true);
    idleTimeoutRef.current = setTimeout(() => {
      idleTimeoutRef.current = null;
      setIsScrolling(false);
    }, PDF_SCROLL_IDLE_MS);
  }, []);

  useMountEffect(() => () => {
    if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
  });

  return { isScrolling, scrollDirection, handleScrollActivity };
}

// The reading marker's block offset in document coordinates. Layout and
// scroll are committed to their settled values at slide start (commit-then-
// relax), so no settle prediction is needed — the marker is always read
// against live geometry.
export function getPdfReadingMarkerBlockOffset({
  scrollTop,
  viewportHeight,
}: {
  scrollTop: number;
  viewportHeight: number;
}) {
  const safeScrollTop = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const safeViewportHeight = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;
  return safeScrollTop + safeViewportHeight * PDF_READING_MARKER_RATIO;
}

export function usePdfScroll({
  isLayoutTransitioning = false,
  pageCount,
  layout,
  transition,
  resetKey,
  onVisiblePageChange,
  onScrollProgressChange,
}: {
  isLayoutTransitioning?: boolean;
  pageCount: number;
  layout: PdfPageLayoutModel;
  transition?: ViewerDocumentTransition;
  resetKey?: unknown;
  onVisiblePageChange?: (page: number) => void;
  onScrollProgressChange?: (progress: number) => void;
}) {
  const lastReportedPageRef = React.useRef(0);
  const scrollFrameRef = React.useRef(0);
  const didMountResetEffectRef = React.useRef(false);
  const [currentPageState, setCurrentPageState] = React.useState<{
    resetKey: unknown;
    page: number;
  }>(() => ({ resetKey, page: 1 }));
  const currentPage = Object.is(currentPageState.resetKey, resetKey)
    ? currentPageState.page
    : 1;
  const documentLayout = React.useMemo(
    () =>
      createPdfDocumentLayoutModel({
        isTransitioning: isLayoutTransitioning,
        layout,
        transition,
      }),
    [isLayoutTransitioning, layout, transition],
  );
  const resolveScrollTarget = React.useCallback<
    ViewerDocumentScrollTargetResolver<PdfReadingAnchor, PdfPageAreaTarget>
  >(
    ({ scrollTop, target, viewportElement }) =>
      getPdfPageAreaScrollTarget(
        viewportElement,
        layout,
        pageCount,
        target,
        scrollTop,
      ),
    [layout, pageCount],
  );
  const zoomMotion = React.useMemo(
    () => createPdfZoomMotionController(layout),
    [layout],
  );
  const documentScroll = useViewerDocumentScroll({
    copyScrollTarget: copyPdfPageAreaTarget,
    layout: documentLayout,
    resetKey,
    resolveScrollTarget,
    scrollMapper: PDF_DOCUMENT_SCROLL_MAPPER,
    zoomMotion,
  });
  const getScrollMetrics = React.useCallback(() => {
    const metrics = documentScroll.getScrollMetrics();
    return toPdfScrollMetrics(metrics);
  }, [documentScroll]);
  const viewportElement = documentScroll.viewportElement;

  const resetCurrentPage = React.useCallback(() => {
    lastReportedPageRef.current = 0;
    setCurrentPageState((previousState) =>
      Object.is(previousState.resetKey, resetKey) && previousState.page === 1
        ? previousState
        : { resetKey, page: 1 },
    );
  }, [resetKey]);

  const measureScroll = React.useCallback(() => {
    scrollFrameRef.current = 0;
    const viewportElement = documentScroll.getViewportElement();
    if (!viewportElement) return;

    const metrics = documentScroll.syncScrollPosition();
    if (!metrics) return;
    const isRebased = metrics.physicalScrollSize < documentLayout.blockSize;
    const scrollable = isRebased
      ? documentLayout.blockSize - metrics.viewportBlockSize
      : viewportElement.scrollHeight - metrics.viewportBlockSize;
    const progress =
      scrollable > 0
        ? clamp(
            (isRebased ? metrics.scrollTop : viewportElement.scrollTop) /
              scrollable,
            0,
            1,
          )
        : 0;
    onScrollProgressChange?.(progress);

    const markerOffset = getPdfReadingMarkerBlockOffset({
      scrollTop: metrics.scrollTop,
      viewportHeight: metrics.viewportBlockSize,
    });
    const visiblePage = findPdfPageByOffset(layout, markerOffset);
    if (
      visiblePage >= 1 &&
      visiblePage <= pageCount &&
      visiblePage !== lastReportedPageRef.current
    ) {
      lastReportedPageRef.current = visiblePage;
      setCurrentPageState((previousState) =>
        Object.is(previousState.resetKey, resetKey) &&
        previousState.page === visiblePage
          ? previousState
          : { resetKey, page: visiblePage },
      );
      onVisiblePageChange?.(visiblePage);
    }
  }, [
    documentLayout,
    documentScroll,
    layout,
    onScrollProgressChange,
    onVisiblePageChange,
    pageCount,
    resetKey,
  ]);
  const measureScrollRef = React.useRef(measureScroll);
  useKeyedLayoutEffect(joinEffectKey([measureScroll]), () => {
    measureScrollRef.current = measureScroll;
  });

  const handleScroll = React.useCallback(() => {
    const result = documentScroll.handleScroll();
    if (result.source === "internal") return result;

    if (scrollFrameRef.current) return result;
    scrollFrameRef.current = requestAnimationFrame(() =>
      measureScrollRef.current(),
    );
    return result;
  }, [documentScroll]);

  useKeyedMountEffect(joinEffectKey([resetCurrentPage]), () => {
    if (!didMountResetEffectRef.current) {
      didMountResetEffectRef.current = true;
      return;
    }
    resetCurrentPage();
  });

  const scrollToPageArea = React.useCallback(
    (target: PdfPageAreaTarget, options?: ScrollToOptions) => {
      documentScroll.scrollToTarget(target, options);
    },
    [documentScroll],
  );
  const scrollToPage = React.useCallback(
    (pageNumber: number, options?: ScrollToOptions) => {
      scrollToPageArea({ pageNumber, top: 0 }, options);
    },
    [scrollToPageArea],
  );
  useKeyedMountEffect(joinEffectKey([measureScroll]), () => {
    if (scrollFrameRef.current) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = 0;
    }
  });

  useMountEffect(() => () => {
    if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
  });

  return {
    captureZoomIntent: documentScroll.captureZoomIntent,
    currentPage,
    viewportElement,
    setViewportElement: documentScroll.setViewportElement,
    measureScroll,
    handleScroll,
    getScrollMetrics,
    scrollToPage,
    scrollToPageArea,
    getViewportElement: documentScroll.getViewportElement,
  };
}

function getPdfPageAreaScrollTarget(
  viewportElement: HTMLDivElement,
  layout: PdfPageLayoutModel,
  pageCount: number,
  target: PdfPageAreaTarget,
  scrollTop: number,
): PdfResolvedPageAreaTarget | null {
  const pageNumber = target.pageNumber;
  if (pageNumber < 1 || pageNumber > pageCount) return null;

  const pageLayout = getPdfPageLayout(layout, pageNumber);
  if (!pageLayout) return null;

  const requestedTop = Number.isNaN(target.top) ? 0 : target.top;
  const targetTopPercent = clamp(requestedTop, 0, 100);
  const targetHeightPercent = normalizeOptionalPercent(target.height);
  const areaTop =
    pageLayout.offsetTop + (targetTopPercent / 100) * pageLayout.height;
  const areaBottom =
    areaTop + ((targetHeightPercent ?? 0) / 100) * pageLayout.height;
  const visibleTop = scrollTop + PDF_SCROLL_TARGET_HEADROOM;
  const visibleBottom =
    scrollTop + viewportElement.clientHeight - PDF_SCROLL_TARGET_HEADROOM;
  let targetTop = areaTop - PDF_SCROLL_TARGET_HEADROOM;

  if (targetHeightPercent != null && areaTop >= visibleTop) {
    targetTop =
      areaBottom > visibleBottom
        ? areaBottom - viewportElement.clientHeight + PDF_SCROLL_TARGET_HEADROOM
        : scrollTop;
  }

  const targetLeft = getPdfPageAreaScrollLeft(viewportElement, layout, {
    pageLayout,
    left: target.left,
    width: target.width,
  });

  return {
    top: Math.max(0, targetTop),
    ...(targetLeft == null ? null : { left: targetLeft }),
  };
}

function copyPdfPageAreaTarget(target: PdfPageAreaTarget): PdfPageAreaTarget {
  return {
    pageNumber: target.pageNumber,
    top: target.top,
    left: target.left,
    width: target.width,
    height: target.height,
  };
}

function getPdfPageAreaScrollLeft(
  viewportElement: HTMLDivElement,
  layout: PdfPageLayoutModel,
  target: {
    pageLayout: NonNullable<ReturnType<typeof getPdfPageLayout>>;
    left?: number;
    width?: number;
  },
) {
  const targetLeftPercent = normalizeOptionalPercent(target.left);
  const targetWidthPercent = normalizeOptionalPercent(target.width);
  if (targetLeftPercent == null || targetWidthPercent == null) return undefined;

  const documentInlineOffset = Math.max(
    0,
    (viewportElement.clientWidth - layout.maxPageWidth) / 2,
  );
  const pageInlineOffset =
    documentInlineOffset + (layout.maxPageWidth - target.pageLayout.width) / 2;
  const areaLeft =
    pageInlineOffset + (targetLeftPercent / 100) * target.pageLayout.width;
  const areaRight =
    areaLeft + (targetWidthPercent / 100) * target.pageLayout.width;
  const visibleLeft =
    viewportElement.scrollLeft + PDF_SCROLL_TARGET_INLINE_HEADROOM;
  const visibleRight =
    viewportElement.scrollLeft +
    viewportElement.clientWidth -
    PDF_SCROLL_TARGET_INLINE_HEADROOM;

  if (areaLeft < visibleLeft) {
    return Math.max(0, areaLeft - PDF_SCROLL_TARGET_INLINE_HEADROOM);
  }
  if (areaRight > visibleRight) {
    return Math.max(
      0,
      areaRight -
        viewportElement.clientWidth +
        PDF_SCROLL_TARGET_INLINE_HEADROOM,
    );
  }
  return viewportElement.scrollLeft;
}

function normalizeOptionalPercent(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return undefined;
  return clamp(value, 0, 100);
}

function createPdfDocumentLayoutModel({
  isTransitioning,
  layout,
  transition,
}: {
  isTransitioning: boolean;
  layout: PdfPageLayoutModel;
  transition?: ViewerDocumentTransition;
}): PdfDocumentLayoutModel {
  const documentTransition: ViewerDocumentTransition =
    transition ??
    (isTransitioning
      ? {
          layoutPolicy: "live",
          scrollPolicy: "preserve",
          source: "document-layout",
          transitionId: null,
          visualPolicy: "document-flip",
        }
      : {
          layoutPolicy: "live",
          scrollPolicy: "preserve",
          source: "none",
          transitionId: null,
          visualPolicy: "none",
        });

  return {
    blockSize: layout.totalHeight,
    captureReadingAnchor: (input) => capturePdfReadingAnchor(layout, input),
    getReadingAnchorScrollTop: (target) =>
      getPdfReadingAnchorScrollTop(layout, target),
    inlineSize: layout.maxPageWidth,
    isTransitioning,
    transition: documentTransition,
  };
}

function capturePdfReadingAnchor(
  layout: PdfPageLayoutModel,
  {
    scrollTop,
    viewportBlockSize,
  }: {
    scrollTop: number;
    viewportBlockSize: number;
  },
): PdfReadingAnchor | null {
  if (layout.pageCount === 0) return null;
  if (scrollTop <= 0) return { kind: "top" };

  const anchorOffset = scrollTop + getPdfReadingAnchorOffset(viewportBlockSize);
  const pageNumber = findPdfPageByOffset(layout, anchorOffset);
  const pageLayout = getPdfPageLayout(layout, pageNumber);
  if (!pageLayout || pageLayout.height <= 0) return null;

  // yPercent is deliberately unclamped: the layout is a single linear
  // function of scale (gaps and padding included), so a marker sitting in the
  // top padding (< 0) or an inter-page gap (> 1) restores exactly by the same
  // page-relative fraction. Clamping — or pinning a nearby page edge in
  // viewport pixels — breaks the reading marker across a re-fit, because the
  // marker offset is viewport-relative and does not scale with the document.
  return {
    kind: "page",
    pageNumber,
    yPercent: (anchorOffset - pageLayout.offsetTop) / pageLayout.height,
  };
}

function getPdfReadingAnchorScrollTop(
  layout: PdfPageLayoutModel,
  {
    anchor,
    viewportBlockSize,
  }: {
    anchor: PdfReadingAnchor;
    viewportBlockSize: number;
  },
) {
  if (anchor.kind === "top") {
    return 0;
  }

  const pageLayout = getPdfPageLayout(layout, anchor.pageNumber);
  if (!pageLayout) return null;

  const maxScrollTop = Math.max(0, layout.totalHeight - viewportBlockSize);
  const targetTop =
    pageLayout.offsetTop +
    pageLayout.height * anchor.yPercent -
    getPdfReadingAnchorOffset(viewportBlockSize);
  return clamp(targetTop, 0, maxScrollTop);
}

function getPdfReadingAnchorOffset(viewportBlockSize: number) {
  return Math.max(0, viewportBlockSize * PDF_READING_MARKER_RATIO);
}

function toPdfScrollMetrics(
  metrics: ViewerDocumentScrollMetrics,
): PdfScrollMetrics {
  return {
    physicalScrollHeight: metrics.physicalScrollSize,
    physicalScrollTop: metrics.physicalScrollTop,
    scrollPageOffset: metrics.scrollPageOffset,
    scrollTop: metrics.scrollTop,
    viewportHeight: metrics.viewportBlockSize,
  };
}
