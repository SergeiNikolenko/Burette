import * as React from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";

import {
  getPdfPreloadPageNumbers,
  getPdfRenderPageNumbers,
  getPdfVisiblePageNumbers,
  PDF_RENDER_WINDOW_OVERSCAN_PX,
  type PdfPageLayoutModel,
} from "./pdf-viewer-layout";
import type { ViewerDocumentTransition } from "./viewer-types";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

export const PDF_PAGE_WINDOW_RETENTION_MS = 250;

const PDF_SHELL_MOTION_RENDER_WINDOW_VIEWPORT_MULTIPLIER = 2;
const PDF_SHELL_MOTION_RENDER_WINDOW_PAGE_OVERSCAN = 3;

type PdfPageWindow = {
  scrollPageOffset: number;
  visiblePageNumbers: readonly number[];
  renderPageNumbers: readonly number[];
  warmPageNumbers: readonly number[];
  preloadPageNumbers: readonly number[];
};

export type PdfPageVirtualizationScrollMetrics = {
  scrollPageOffset: number;
  scrollTop: number;
  viewportHeight: number;
};

export function usePdfPageVirtualization({
  getScrollMetrics,
  isLayoutTransitioning = false,
  layout,
  resetKey,
  shouldHoldPageWindow = false,
  transition,
  viewportElement,
}: {
  getScrollMetrics?: () => PdfPageVirtualizationScrollMetrics;
  isLayoutTransitioning?: boolean;
  layout: PdfPageLayoutModel;
  resetKey?: unknown;
  shouldHoldPageWindow?: boolean;
  transition?: ViewerDocumentTransition;
  viewportElement: HTMLDivElement | null;
}) {
  const measureFrameRef = React.useRef(0);
  const retentionTimeoutRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const releasedRetentionLayoutRef = React.useRef<PdfPageLayoutModel | null>(
    null,
  );
  const hasMeasuredScrollRef = React.useRef(false);
  const lastMeasuredLayoutRef = React.useRef(layout);
  const lastMeasuredResetKeyRef = React.useRef<unknown>(resetKey);
  const lastMeasuredScrollTopRef = React.useRef(0);
  const hasReleasedPageWindowRetention =
    transition?.source === "viewer-shell" &&
    transition.layoutPolicy === "target" &&
    Object.is(releasedRetentionLayoutRef.current, layout);
  const shouldRetainPreviousPageWindow =
    (shouldHoldPageWindow ||
      shouldRetainPdfPageWindow({
        isLayoutTransitioning,
        transition,
      })) &&
    (!hasReleasedPageWindowRetention || shouldHoldPageWindow);
  const renderWindowTransition =
    transition?.source === "viewer-shell" &&
    (!hasReleasedPageWindowRetention || shouldHoldPageWindow)
      ? transition
      : undefined;
  const shouldFreezePreviousPageWindow =
    shouldHoldPageWindow || renderWindowTransition?.source === "viewer-shell";
  const getCurrentScrollMetrics =
    React.useCallback((): PdfPageVirtualizationScrollMetrics => {
      return Object.is(lastMeasuredResetKeyRef.current, resetKey) &&
        getScrollMetrics
        ? getScrollMetrics()
        : {
            scrollPageOffset: 0,
            scrollTop: Object.is(lastMeasuredResetKeyRef.current, resetKey)
              ? (viewportElement?.scrollTop ?? 0)
              : 0,
            viewportHeight: viewportElement?.clientHeight ?? 0,
          };
    }, [getScrollMetrics, resetKey, viewportElement]);
  const getPageWindow = React.useCallback(
    (
      metrics: PdfPageVirtualizationScrollMetrics,
      fitPerfectly = false,
      overscanPx = getPdfRenderWindowOverscanPx({
        layout,
        transition: renderWindowTransition,
        viewportHeight: metrics.viewportHeight,
      }),
    ): PdfPageWindow => {
      const renderPageNumbers = getPdfRenderPageNumbers({
        fitPerfectly,
        layout,
        overscanPx,
        scrollTop: metrics.scrollTop,
        viewportHeight: metrics.viewportHeight,
      });

      return {
        scrollPageOffset: metrics.scrollPageOffset,
        visiblePageNumbers: getPdfVisiblePageNumbers({
          layout,
          scrollTop: metrics.scrollTop,
          viewportHeight: metrics.viewportHeight,
        }),
        renderPageNumbers,
        warmPageNumbers: renderPageNumbers,
        preloadPageNumbers: getPdfPreloadPageNumbers({
          layout,
          renderPageNumbers,
        }),
      };
    },
    [layout, renderWindowTransition],
  );
  const getCurrentVisiblePageNumbers = React.useCallback((): PdfPageWindow => {
    return getPageWindow(getCurrentScrollMetrics());
  }, [getCurrentScrollMetrics, getPageWindow]);
  const getResetPageWindow = React.useCallback(() => {
    const viewportHeight = viewportElement?.clientHeight ?? 0;
    const renderPageNumbers = getPdfRenderPageNumbers({
      layout,
      scrollTop: 0,
      viewportHeight,
    });

    return {
      scrollPageOffset: 0,
      visiblePageNumbers: getPdfVisiblePageNumbers({
        layout,
        scrollTop: 0,
        viewportHeight,
      }),
      renderPageNumbers,
      warmPageNumbers: renderPageNumbers,
      preloadPageNumbers: getPdfPreloadPageNumbers({
        layout,
        renderPageNumbers,
      }),
    };
  }, [layout, viewportElement]);
  const [state, setState] = React.useState<{
    isTransitionPageWindow: boolean;
    layout: PdfPageLayoutModel;
    resetKey: unknown;
    pageWindow: PdfPageWindow;
  }>(() => ({
    isTransitionPageWindow: false,
    layout,
    resetKey,
    pageWindow: getCurrentVisiblePageNumbers(),
  }));
  const pageWindow =
    Object.is(state.layout, layout) && Object.is(state.resetKey, resetKey)
      ? state.isTransitionPageWindow && !shouldRetainPreviousPageWindow
        ? getCurrentVisiblePageNumbers()
        : state.pageWindow
      : Object.is(state.resetKey, resetKey)
        ? createTransitionPageWindow({
            currentPageWindow: getCurrentVisiblePageNumbers(),
            layout,
            previousPageWindow: state.pageWindow,
            shouldFreezePreviousPageWindow,
            shouldRetainPreviousPageWindow,
          })
        : getResetPageWindow();
  const cancelPageWindowRetentionRelease = React.useCallback(() => {
    if (retentionTimeoutRef.current === null) return;
    clearTimeout(retentionTimeoutRef.current);
    retentionTimeoutRef.current = null;
  }, []);
  const schedulePageWindowRetentionRelease = React.useCallback(() => {
    cancelPageWindowRetentionRelease();
    retentionTimeoutRef.current = setTimeout(() => {
      retentionTimeoutRef.current = null;
      const metrics = getCurrentScrollMetrics();
      const currentPageWindow = getPageWindow(
        metrics,
        false,
        PDF_RENDER_WINDOW_OVERSCAN_PX,
      );
      releasedRetentionLayoutRef.current = layout;
      lastMeasuredLayoutRef.current = layout;
      lastMeasuredResetKeyRef.current = resetKey;
      lastMeasuredScrollTopRef.current = metrics.scrollTop;
      hasMeasuredScrollRef.current = true;
      setState((previousState) => {
        if (!Object.is(previousState.resetKey, resetKey)) {
          return previousState;
        }

        return Object.is(previousState.layout, layout) &&
          !previousState.isTransitionPageWindow &&
          arePageWindowsEqual(previousState.pageWindow, currentPageWindow)
          ? previousState
          : {
              isTransitionPageWindow: false,
              layout,
              resetKey,
              pageWindow: currentPageWindow,
            };
      });
    }, PDF_PAGE_WINDOW_RETENTION_MS);
  }, [
    cancelPageWindowRetentionRelease,
    getCurrentScrollMetrics,
    getPageWindow,
    layout,
    resetKey,
  ]);

  const measureVisiblePagesNow = React.useCallback(() => {
    measureFrameRef.current = 0;
    const metrics = getCurrentScrollMetrics();
    const renderOverscanPx = getPdfRenderWindowOverscanPx({
      layout,
      transition: renderWindowTransition,
      viewportHeight: metrics.viewportHeight,
    });
    const fitPerfectly = shouldFitPdfPerfectly({
      canFitPerfectly:
        hasMeasuredScrollRef.current &&
        Object.is(lastMeasuredLayoutRef.current, layout) &&
        Object.is(lastMeasuredResetKeyRef.current, resetKey),
      previousScrollTop: lastMeasuredScrollTopRef.current,
      renderOverscanPx,
      scrollTop: metrics.scrollTop,
      viewportHeight: metrics.viewportHeight,
    });
    const currentPageWindow = getPageWindow(metrics, fitPerfectly);
    const hasScrollMovedSinceLastMeasurement =
      Math.abs(metrics.scrollTop - lastMeasuredScrollTopRef.current) > 1;
    const shouldBreakRetentionForScroll =
      hasScrollMovedSinceLastMeasurement &&
      shouldHoldPageWindow &&
      !isLayoutTransitioning &&
      renderWindowTransition?.source !== "viewer-shell";
    const shouldRetainMeasuredPageWindow =
      shouldRetainPreviousPageWindow && !shouldBreakRetentionForScroll;
    const shouldFreezeMeasuredPageWindow =
      shouldFreezePreviousPageWindow && !shouldBreakRetentionForScroll;
    lastMeasuredLayoutRef.current = layout;
    lastMeasuredResetKeyRef.current = resetKey;
    lastMeasuredScrollTopRef.current = metrics.scrollTop;
    hasMeasuredScrollRef.current = true;
    setState((previousState) => {
      const nextPageWindow = createTransitionPageWindow({
        currentPageWindow,
        layout,
        previousPageWindow: previousState.pageWindow,
        shouldFreezePreviousPageWindow: shouldFreezeMeasuredPageWindow,
        shouldRetainPreviousPageWindow: shouldRetainMeasuredPageWindow,
      });
      const isTransitionPageWindow = shouldRetainMeasuredPageWindow;

      return Object.is(previousState.layout, layout) &&
        Object.is(previousState.resetKey, resetKey) &&
        previousState.isTransitionPageWindow === isTransitionPageWindow &&
        arePageWindowsEqual(previousState.pageWindow, nextPageWindow)
        ? previousState
        : {
            isTransitionPageWindow,
            layout,
            resetKey,
            pageWindow: nextPageWindow,
          };
    });
    if (shouldHoldPageWindow) {
      cancelPageWindowRetentionRelease();
    } else if (
      shouldReleasePdfPageWindowRetention(transition) &&
      !hasReleasedPageWindowRetention
    ) {
      schedulePageWindowRetentionRelease();
    } else if (!shouldRetainPreviousPageWindow) {
      cancelPageWindowRetentionRelease();
    }
    if (fitPerfectly && measureFrameRef.current === 0) {
      measureFrameRef.current = requestAnimationFrame(() =>
        measureVisiblePagesNowRef.current(),
      );
    }
  }, [
    getCurrentScrollMetrics,
    getPageWindow,
    layout,
    resetKey,
    cancelPageWindowRetentionRelease,
    schedulePageWindowRetentionRelease,
    hasReleasedPageWindowRetention,
    isLayoutTransitioning,
    renderWindowTransition,
    shouldHoldPageWindow,
    shouldFreezePreviousPageWindow,
    shouldRetainPreviousPageWindow,
    transition,
  ]);
  const measureVisiblePagesNowRef = React.useRef(measureVisiblePagesNow);
  useKeyedLayoutEffect(joinEffectKey([measureVisiblePagesNow]), () => {
    measureVisiblePagesNowRef.current = measureVisiblePagesNow;
  });

  const measureVisiblePages = React.useCallback(() => {
    if (measureFrameRef.current) return;
    measureFrameRef.current = requestAnimationFrame(() =>
      measureVisiblePagesNowRef.current(),
    );
  }, []);

  useKeyedMountEffect(
    joinEffectKey([
      cancelPageWindowRetentionRelease,
      schedulePageWindowRetentionRelease,
      shouldHoldPageWindow,
      shouldRetainPreviousPageWindow,
      transition?.layoutPolicy,
      transition?.source,
    ]),
    () => {
      if (shouldHoldPageWindow) {
        cancelPageWindowRetentionRelease();
      } else if (
        shouldReleasePdfPageWindowRetention(transition) &&
        !hasReleasedPageWindowRetention
      ) {
        schedulePageWindowRetentionRelease();
      } else if (!shouldRetainPreviousPageWindow) {
        cancelPageWindowRetentionRelease();
      }
    },
  );

  useKeyedMountEffect(joinEffectKey([measureVisiblePagesNow]), () => {
    if (measureFrameRef.current) {
      cancelAnimationFrame(measureFrameRef.current);
      measureFrameRef.current = 0;
    }
    measureVisiblePagesNow();
  });

  useMountEffect(() => () => {
    if (measureFrameRef.current) {
      cancelAnimationFrame(measureFrameRef.current);
    }
    cancelPageWindowRetentionRelease();
  });

  return {
    scrollPageOffset: pageWindow.scrollPageOffset,
    visiblePageNumbers: pageWindow.visiblePageNumbers,
    renderPageNumbers: pageWindow.renderPageNumbers,
    warmPageNumbers: pageWindow.warmPageNumbers,
    preloadPageNumbers: pageWindow.preloadPageNumbers,
    measureVisiblePages,
  };
}

function createTransitionPageWindow({
  currentPageWindow,
  layout,
  previousPageWindow,
  shouldFreezePreviousPageWindow,
  shouldRetainPreviousPageWindow,
}: {
  currentPageWindow: PdfPageWindow;
  layout: PdfPageLayoutModel;
  previousPageWindow: PdfPageWindow;
  shouldFreezePreviousPageWindow: boolean;
  shouldRetainPreviousPageWindow: boolean;
}): PdfPageWindow {
  if (!shouldRetainPreviousPageWindow) return currentPageWindow;

  if (shouldFreezePreviousPageWindow) {
    return {
      scrollPageOffset: currentPageWindow.scrollPageOffset,
      visiblePageNumbers: previousPageWindow.visiblePageNumbers,
      renderPageNumbers: previousPageWindow.renderPageNumbers,
      warmPageNumbers: previousPageWindow.warmPageNumbers,
      preloadPageNumbers: previousPageWindow.preloadPageNumbers,
    };
  }

  return {
    scrollPageOffset: currentPageWindow.scrollPageOffset,
    visiblePageNumbers: mergePageNumbers(
      layout,
      previousPageWindow.visiblePageNumbers,
      currentPageWindow.visiblePageNumbers,
    ),
    renderPageNumbers: mergePageNumbers(
      layout,
      previousPageWindow.renderPageNumbers,
      currentPageWindow.renderPageNumbers,
    ),
    warmPageNumbers: mergePageNumbers(
      layout,
      previousPageWindow.warmPageNumbers,
      currentPageWindow.warmPageNumbers,
    ),
    preloadPageNumbers: mergePageNumbers(
      layout,
      previousPageWindow.preloadPageNumbers,
      currentPageWindow.preloadPageNumbers,
    ),
  };
}

function mergePageNumbers(
  layout: PdfPageLayoutModel,
  previousPageNumbers: readonly number[],
  currentPageNumbers: readonly number[],
) {
  return Array.from(new Set([...previousPageNumbers, ...currentPageNumbers]))
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= layout.pageCount)
    .sort((a, b) => a - b);
}

function arePageWindowsEqual(
  previousPageWindow: PdfPageWindow,
  nextPageWindow: PdfPageWindow,
) {
  return (
    previousPageWindow.scrollPageOffset === nextPageWindow.scrollPageOffset &&
    arePageNumbersEqual(
      previousPageWindow.visiblePageNumbers,
      nextPageWindow.visiblePageNumbers,
    ) &&
    arePageNumbersEqual(
      previousPageWindow.renderPageNumbers,
      nextPageWindow.renderPageNumbers,
    ) &&
    arePageNumbersEqual(
      previousPageWindow.warmPageNumbers,
      nextPageWindow.warmPageNumbers,
    ) &&
    arePageNumbersEqual(
      previousPageWindow.preloadPageNumbers,
      nextPageWindow.preloadPageNumbers,
    )
  );
}

function arePageNumbersEqual(
  previousPageNumbers: readonly number[],
  nextPageNumbers: readonly number[],
) {
  if (previousPageNumbers.length !== nextPageNumbers.length) return false;
  return previousPageNumbers.every(
    (pageNumber, index) => pageNumber === nextPageNumbers[index],
  );
}

function shouldFitPdfPerfectly({
  canFitPerfectly,
  previousScrollTop,
  renderOverscanPx,
  scrollTop,
  viewportHeight,
}: {
  canFitPerfectly: boolean;
  previousScrollTop: number;
  renderOverscanPx: number;
  scrollTop: number;
  viewportHeight: number;
}) {
  return (
    canFitPerfectly &&
    viewportHeight > 0 &&
    Math.abs(scrollTop - previousScrollTop) >
      viewportHeight + renderOverscanPx * 2
  );
}

function getPdfRenderWindowOverscanPx({
  layout,
  transition,
  viewportHeight,
}: {
  layout: PdfPageLayoutModel;
  transition?: ViewerDocumentTransition;
  viewportHeight: number;
}) {
  if (transition?.source !== "viewer-shell") {
    return PDF_RENDER_WINDOW_OVERSCAN_PX;
  }

  return Math.max(
    PDF_RENDER_WINDOW_OVERSCAN_PX,
    getSafePositiveNumber(viewportHeight) *
      PDF_SHELL_MOTION_RENDER_WINDOW_VIEWPORT_MULTIPLIER,
    getSafePositiveNumber(layout.estimatedHeight) *
      PDF_SHELL_MOTION_RENDER_WINDOW_PAGE_OVERSCAN,
  );
}

function shouldRetainPdfPageWindow({
  isLayoutTransitioning,
  transition,
}: {
  isLayoutTransitioning: boolean;
  transition?: ViewerDocumentTransition;
}) {
  return (
    isLayoutTransitioning ||
    (transition?.source === "viewer-shell" &&
      transition.layoutPolicy === "target")
  );
}

function shouldReleasePdfPageWindowRetention(
  transition?: ViewerDocumentTransition,
) {
  return (
    transition?.source === "viewer-shell" &&
    transition.layoutPolicy === "target"
  );
}

function getSafePositiveNumber(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
