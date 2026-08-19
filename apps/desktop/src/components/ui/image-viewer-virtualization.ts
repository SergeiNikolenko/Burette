"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { type FrameDescriptor } from "@/lib/image-frame-source";
import {
  frameCssSize,
  frameIndexToNumber,
  type QuarterTurn,
} from "@/lib/image-geometry";

import { joinEffectKey } from "@/lib/effect-key";

export const IMAGE_FRAME_GAP = 16;
export const IMAGE_FRAME_PADDING = 16;
export const IMAGE_RENDER_FIT_PERFECTLY_OVERSCAN_PX =
  IMAGE_FRAME_GAP + IMAGE_FRAME_PADDING;
export const IMAGE_RENDER_WINDOW_OVERSCAN_PX = 1000;
export const IMAGE_VISIBLE_FRAME_OVERSCAN = 2;
export const IMAGE_PRELOAD_FRAME_OVERSCAN = 4;
export const IMAGE_SCROLL_REBASE_CONTAINER_PX = 12_000_000;
export const IMAGE_SCROLL_REBASE_TRIGGER_PX = 1_000_000;
export const IMAGE_SCROLL_REBASE_TARGET_PX = 2_000_000;
export const IMAGE_SCROLL_REBASE_TARGET_BOTTOM_PX =
  IMAGE_SCROLL_REBASE_CONTAINER_PX - IMAGE_SCROLL_REBASE_TARGET_PX;
export const IMAGE_SCROLL_REBASE_THRESHOLD_PX =
  IMAGE_SCROLL_REBASE_CONTAINER_PX - IMAGE_SCROLL_REBASE_TRIGGER_PX;

export type ImageFrameLayout = {
  frameIndex: number;
  frameNumber: number;
  width: number;
  height: number;
  offsetTop: number;
};

export type ImageFrameLayoutModel = {
  frameCount: number;
  gap: number;
  padding: number;
  totalHeight: number;
  maxFrameWidth: number;
  frames: readonly ImageFrameLayout[];
};

export type ImageRenderedFrameLayout = ImageFrameLayout & {
  windowTop: number;
};

export type ImageRenderedFrameWindow = {
  afterHeight: number;
  beforeHeight: number;
  frames: readonly ImageRenderedFrameLayout[];
  height: number;
  stickyBottomInset: number;
  stickyTopInset: number;
};

export type ImageRenderPixelWindow = {
  bottom: number;
  top: number;
};

export type ImageScrollRebasePosition = {
  physicalScrollTop: number;
  scrollPageOffset: number;
};

export type ImageFrameVirtualizationScrollMetrics = {
  scrollPageOffset: number;
  scrollTop: number;
  viewportHeight: number;
};

type ImageFrameWindow = {
  scrollPageOffset: number;
  visibleFrameNumbers: readonly number[];
  renderFrameNumbers: readonly number[];
  preloadFrameNumbers: readonly number[];
};

export function createImageFrameLayout({
  frames,
  scale,
  rotation,
  gap = IMAGE_FRAME_GAP,
  padding = IMAGE_FRAME_PADDING,
}: {
  frames: readonly FrameDescriptor[];
  scale: number;
  rotation: QuarterTurn;
  gap?: number;
  padding?: number;
}): ImageFrameLayoutModel {
  // Inter-frame spacing scales with the image so gap / frame height stays
  // constant through fit-width motion. The outer frame inset stays fixed on
  // both axes: it is viewer chrome, and must exactly match the p-4 skeleton
  // before and after the source loads.
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const blockGap = gap * safeScale;
  const blockPadding = padding;
  let offsetTop = blockPadding;
  let maxFrameWidth = 0;
  const frameLayouts = frames.map((frame, frameIndex) => {
    const frameRect = frameCssSize(frame.intrinsicSize, scale, rotation);
    const layout = {
      frameIndex,
      frameNumber: frameIndexToNumber(frameIndex),
      width: frameRect.width,
      height: frameRect.height,
      offsetTop,
    };
    offsetTop += frameRect.height + blockGap;
    maxFrameWidth = Math.max(maxFrameWidth, frameRect.width);
    return layout;
  });

  return {
    frameCount: frames.length,
    gap: blockGap,
    padding,
    totalHeight: frames.length === 0 ? 0 : offsetTop - blockGap + blockPadding,
    maxFrameWidth,
    frames: frameLayouts,
  };
}

export function getImageFrameLayout(
  layout: ImageFrameLayoutModel,
  frameNumber: number,
): ImageFrameLayout | undefined {
  if (!Number.isInteger(frameNumber)) return undefined;
  return layout.frames[frameNumber - 1];
}

export function findImageFrameByOffset(
  layout: ImageFrameLayoutModel,
  offset: number,
): number {
  if (layout.frameCount === 0) return 1;

  let low = 0;
  let high = layout.frames.length - 1;
  let match = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (layout.frames[mid].offsetTop <= offset) {
      match = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return layout.frames[match].frameNumber;
}

export function getVisibleImageFrameNumbers({
  layout,
  scrollTop,
  viewportHeight,
  overscanFrames = IMAGE_VISIBLE_FRAME_OVERSCAN,
}: {
  layout: ImageFrameLayoutModel;
  scrollTop: number;
  viewportHeight: number;
  overscanFrames?: number;
}): readonly number[] {
  if (layout.frameCount === 0) return [];

  const measurementHeight = Math.max(1, viewportHeight);
  return getImageFrameNumbersInRange({
    layout,
    startOffset: Math.max(0, scrollTop - measurementHeight),
    endOffset: scrollTop + measurementHeight * 2,
    overscanFrames,
  });
}

export function getImageRenderFrameNumbers({
  fitPerfectly = false,
  fitPerfectlyOverscanPx = IMAGE_RENDER_FIT_PERFECTLY_OVERSCAN_PX,
  layout,
  overscanPx = IMAGE_RENDER_WINDOW_OVERSCAN_PX,
  scrollTop,
  viewportHeight,
}: {
  fitPerfectly?: boolean;
  fitPerfectlyOverscanPx?: number;
  layout: ImageFrameLayoutModel;
  overscanPx?: number;
  scrollTop: number;
  viewportHeight: number;
}): readonly number[] {
  if (layout.frameCount === 0) return [];

  const window = createImageWindowFromScrollPosition({
    fitPerfectly,
    fitPerfectlyOverscanPx,
    overscanPx,
    scrollHeight: layout.totalHeight,
    scrollTop,
    viewportHeight,
  });

  return getImageFrameNumbersInRange({
    layout,
    startOffset: window.top,
    endOffset: window.bottom,
    overscanFrames: 0,
  });
}

export function getImagePreloadFrameNumbers({
  layout,
  renderFrameNumbers,
  overscanFrames = IMAGE_PRELOAD_FRAME_OVERSCAN,
}: {
  layout: ImageFrameLayoutModel;
  renderFrameNumbers: readonly number[];
  overscanFrames?: number;
}): readonly number[] {
  if (layout.frameCount === 0 || renderFrameNumbers.length === 0) return [];

  const firstRenderFrame = renderFrameNumbers[0];
  const lastRenderFrame = renderFrameNumbers[renderFrameNumbers.length - 1];
  return createFrameNumberRange(
    Math.max(1, firstRenderFrame - overscanFrames),
    Math.min(layout.frameCount, lastRenderFrame + overscanFrames),
  );
}

export function getImageRenderedFrameWindow({
  frameNumbers,
  layout,
  physicalScrollHeight = layout.totalHeight,
  scrollPageOffset = 0,
  viewportHeight,
}: {
  frameNumbers: readonly number[];
  layout: ImageFrameLayoutModel;
  physicalScrollHeight?: number;
  scrollPageOffset?: number;
  viewportHeight: number;
}): ImageRenderedFrameWindow | null {
  const frames = frameNumbers
    .map((frameNumber) => getImageFrameLayout(layout, frameNumber))
    .filter((frame): frame is ImageFrameLayout => Boolean(frame))
    .sort((left, right) => left.frameNumber - right.frameNumber);

  if (frames.length === 0) return null;

  const logicalBeforeHeight = frames[0].offsetTop;
  const windowBottom = Math.max(
    ...frames.map((frame) => frame.offsetTop + frame.height),
  );
  const height = Math.max(0, windowBottom - logicalBeforeHeight);
  const beforeHeight = getImagePagedLayoutTop({
    logicalTop: logicalBeforeHeight,
    scrollPageOffset,
    totalHeight: layout.totalHeight,
    viewportHeight,
  });
  const safeViewportHeight =
    Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  const safePhysicalScrollHeight = Math.max(
    0,
    finiteNumber(physicalScrollHeight),
  );
  const afterHeight = Math.max(
    0,
    safePhysicalScrollHeight - beforeHeight - height,
  );
  const stickyCoverInset =
    safeViewportHeight > 0 ? -Math.max(0, height - safeViewportHeight) : 0;
  // The sticky cover clamp only ever needs to slide the window over CONTENT
  // the viewport can reach. When the window already holds the document's
  // first/last frame, the spacer beyond it is pure edge padding — relax that
  // side's inset by the spacer so the settled window keeps its flow position
  // at the scroll extremes. Without the relaxation the clamp drags the window
  // over the edge padding at scroll 0/max, and the settled layout stops being
  // a single linear function of scale (which the reading-fraction rebase
  // depends on to restore the reading line exactly across a re-fit).
  const includesFirstFrame = frames[0].frameNumber === 1;
  const includesLastFrame =
    frames[frames.length - 1].frameNumber === layout.frameCount;

  return {
    afterHeight,
    beforeHeight,
    frames: frames.map((frame) => ({
      ...frame,
      windowTop: frame.offsetTop - logicalBeforeHeight,
    })),
    height,
    stickyBottomInset:
      stickyCoverInset - (includesFirstFrame ? beforeHeight : 0),
    stickyTopInset: stickyCoverInset - (includesLastFrame ? afterHeight : 0),
  };
}

export function createImageWindowFromScrollPosition({
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
}): ImageRenderPixelWindow {
  const safeOverscanPx = safePadding(overscanPx);
  const safeScrollHeight = Math.max(0, finiteNumber(scrollHeight));
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

export function getImagePhysicalScrollHeight({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  const safeTotalHeight = safeSize(totalHeight);
  return shouldRebaseImageScroll({
    totalHeight: safeTotalHeight,
    viewportHeight,
  })
    ? Math.min(safeTotalHeight, IMAGE_SCROLL_REBASE_CONTAINER_PX)
    : safeTotalHeight;
}

export function getImageLogicalScrollTop({
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
    getImageMaxLogicalScrollTop({ totalHeight, viewportHeight }),
  );
}

export function resolveImagePhysicalScrollPosition({
  logicalScrollTop,
  scrollPageOffset,
  totalHeight,
  viewportHeight,
}: {
  logicalScrollTop: number;
  scrollPageOffset: number;
  totalHeight: number;
  viewportHeight: number;
}): ImageScrollRebasePosition {
  const safeLogicalScrollTop = clamp(
    finiteNumber(logicalScrollTop),
    0,
    getImageMaxLogicalScrollTop({ totalHeight, viewportHeight }),
  );

  if (!shouldRebaseImageScroll({ totalHeight, viewportHeight })) {
    return {
      physicalScrollTop: clamp(
        safeLogicalScrollTop,
        0,
        getImageMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
      ),
      scrollPageOffset: 0,
    };
  }

  const currentPageOffset = clampImageScrollPageOffset({
    scrollPageOffset,
    totalHeight,
    viewportHeight,
  });
  const physicalScrollTop = safeLogicalScrollTop - currentPageOffset;
  const maxPhysicalScrollTop = getImageMaxPhysicalScrollTop({
    totalHeight,
    viewportHeight,
  });
  const maxPageOffset = getImageMaxScrollPageOffset({
    totalHeight,
    viewportHeight,
  });
  const shouldMoveDown =
    physicalScrollTop > IMAGE_SCROLL_REBASE_THRESHOLD_PX &&
    currentPageOffset < maxPageOffset;
  const shouldMoveUp =
    physicalScrollTop < IMAGE_SCROLL_REBASE_TRIGGER_PX && currentPageOffset > 0;

  if (
    physicalScrollTop < 0 ||
    physicalScrollTop > maxPhysicalScrollTop ||
    shouldMoveDown ||
    shouldMoveUp
  ) {
    return resolveImageScrollPageWindow({
      logicalScrollTop: safeLogicalScrollTop,
      preferredPhysicalScrollTop: shouldMoveUp
        ? Math.min(IMAGE_SCROLL_REBASE_TARGET_BOTTOM_PX, maxPhysicalScrollTop)
        : IMAGE_SCROLL_REBASE_TARGET_PX,
      totalHeight,
      viewportHeight,
    });
  }

  return {
    physicalScrollTop: roundImageScrollPixel(
      clamp(physicalScrollTop, 0, maxPhysicalScrollTop),
    ),
    scrollPageOffset: currentPageOffset,
  };
}

export function getImagePagedLayoutTop({
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
  if (!shouldRebaseImageScroll({ totalHeight, viewportHeight })) {
    return finiteNumber(logicalTop);
  }
  return Math.max(0, finiteNumber(logicalTop) - safePadding(scrollPageOffset));
}

export function getCurrentImageFrameNumber({
  layout,
  scrollTop,
  viewportHeight,
}: {
  layout: ImageFrameLayoutModel;
  scrollTop: number;
  viewportHeight: number;
}): number {
  return findImageFrameByOffset(layout, scrollTop + viewportHeight * 0.2);
}

export function useImageFrameVirtualization({
  freezeWindow = false,
  getScrollMetrics,
  layout,
  resetKey,
  sourceResetKey,
  viewportElement,
}: {
  freezeWindow?: boolean;
  getScrollMetrics?: () => ImageFrameVirtualizationScrollMetrics;
  layout: ImageFrameLayoutModel;
  resetKey?: unknown;
  // Identity of the underlying source. `resetKey` changes on every re-fit
  // (scale), but only a `sourceResetKey` change is a genuine new document that
  // should snap the window back to the top; a re-fit preserves the reading
  // position, so its window is re-derived from the live scroll instead.
  sourceResetKey?: unknown;
  viewportElement: HTMLDivElement | null;
}) {
  const resolvedSourceResetKey =
    sourceResetKey === undefined ? resetKey : sourceResetKey;
  const measureFrameRef = React.useRef(0);
  const hasMeasuredScrollRef = React.useRef(false);
  const lastMeasuredSourceResetKeyRef = React.useRef<unknown>(
    resolvedSourceResetKey,
  );
  const lastMeasuredScrollTopRef = React.useRef(0);
  const getCurrentScrollMetrics =
    React.useCallback((): ImageFrameVirtualizationScrollMetrics => {
      const sourceMatches = Object.is(
        lastMeasuredSourceResetKeyRef.current,
        resolvedSourceResetKey,
      );
      const metrics =
        sourceMatches && getScrollMetrics
          ? getScrollMetrics()
          : {
              scrollPageOffset: 0,
              scrollTop: sourceMatches ? (viewportElement?.scrollTop ?? 0) : 0,
              viewportHeight: viewportElement?.clientHeight ?? 0,
            };
      return reconcileImageScrollMetricsWithViewport(metrics, viewportElement);
    }, [getScrollMetrics, resolvedSourceResetKey, viewportElement]);
  const getFrameWindow = React.useCallback(
    (
      metrics: ImageFrameVirtualizationScrollMetrics,
      fitPerfectly = false,
    ): ImageFrameWindow => {
      const renderFrameNumbers = getImageRenderFrameNumbers({
        fitPerfectly,
        layout,
        scrollTop: metrics.scrollTop,
        viewportHeight: metrics.viewportHeight,
      });

      return {
        scrollPageOffset: metrics.scrollPageOffset,
        visibleFrameNumbers: getVisibleImageFrameNumbers({
          layout,
          scrollTop: metrics.scrollTop,
          viewportHeight: metrics.viewportHeight,
        }),
        renderFrameNumbers,
        preloadFrameNumbers: getImagePreloadFrameNumbers({
          layout,
          renderFrameNumbers,
        }),
      };
    },
    [layout],
  );
  const getCurrentVisibleFrameNumbers =
    React.useCallback((): ImageFrameWindow => {
      return getFrameWindow(getCurrentScrollMetrics());
    }, [getCurrentScrollMetrics, getFrameWindow]);
  const getResetFrameWindow = React.useCallback(() => {
    const viewportHeight = viewportElement?.clientHeight ?? 0;
    const renderFrameNumbers = getImageRenderFrameNumbers({
      layout,
      scrollTop: 0,
      viewportHeight,
    });

    return {
      scrollPageOffset: 0,
      visibleFrameNumbers: getVisibleImageFrameNumbers({
        layout,
        scrollTop: 0,
        viewportHeight,
      }),
      renderFrameNumbers,
      preloadFrameNumbers: getImagePreloadFrameNumbers({
        layout,
        renderFrameNumbers,
      }),
    };
  }, [layout, viewportElement]);
  const [state, setState] = React.useState<{
    layout: ImageFrameLayoutModel;
    resetKey: unknown;
    sourceResetKey: unknown;
    frameWindow: ImageFrameWindow;
  }>(() => ({
    layout,
    resetKey,
    sourceResetKey: resolvedSourceResetKey,
    frameWindow: getCurrentVisibleFrameNumbers(),
  }));
  const frameWindow =
    // While frozen (sidebar transition), keep the last committed window even
    // when the re-fit changes the layout/resetKey, so the same reading frames
    // stay mounted through the slide and settle rather than re-deriving from
    // the transient top-of-document scroll position.
    freezeWindow ||
    (Object.is(state.layout, layout) && Object.is(state.resetKey, resetKey))
      ? state.frameWindow
      : // Snap to the top only for a genuine new document; a re-fit (same
        // source, changed layout) preserves the reading position, so re-derive
        // its window from the live scroll rather than resetting to the top.
        Object.is(state.sourceResetKey, resolvedSourceResetKey)
        ? getCurrentVisibleFrameNumbers()
        : getResetFrameWindow();

  const measureVisibleFramesNow = React.useCallback(() => {
    measureFrameRef.current = 0;
    // While the sidebar slide freezes the layout, the scroll container reports
    // a transient top-of-document position, so re-deriving the visible-frame
    // window here would window to the top and rebase the reading frame at
    // settle. Hold the pre-slide window until the transition is idle again.
    if (freezeWindow) return;
    const metrics = getCurrentScrollMetrics();
    const fitPerfectly = shouldFitImagePerfectly({
      canFitPerfectly:
        hasMeasuredScrollRef.current &&
        Object.is(
          lastMeasuredSourceResetKeyRef.current,
          resolvedSourceResetKey,
        ),
      previousScrollTop: lastMeasuredScrollTopRef.current,
      scrollTop: metrics.scrollTop,
      viewportHeight: metrics.viewportHeight,
    });
    const nextFrameWindow = getFrameWindow(metrics, fitPerfectly);
    lastMeasuredSourceResetKeyRef.current = resolvedSourceResetKey;
    lastMeasuredScrollTopRef.current = metrics.scrollTop;
    hasMeasuredScrollRef.current = true;
    setState((previousState) =>
      Object.is(previousState.layout, layout) &&
      Object.is(previousState.resetKey, resetKey) &&
      areFrameWindowsEqual(previousState.frameWindow, nextFrameWindow)
        ? previousState
        : {
            layout,
            resetKey,
            sourceResetKey: resolvedSourceResetKey,
            frameWindow: nextFrameWindow,
          },
    );
    if (fitPerfectly && measureFrameRef.current === 0) {
      measureFrameRef.current = requestAnimationFrame(() =>
        measureVisibleFramesNowRef.current(),
      );
    }
  }, [
    freezeWindow,
    getCurrentScrollMetrics,
    getFrameWindow,
    layout,
    resetKey,
    resolvedSourceResetKey,
  ]);
  const measureVisibleFramesNowRef = React.useRef(measureVisibleFramesNow);
  useKeyedLayoutEffect(joinEffectKey([measureVisibleFramesNow]), () => {
    measureVisibleFramesNowRef.current = measureVisibleFramesNow;
  });

  const measureVisibleFrames = React.useCallback(() => {
    if (measureFrameRef.current) return;
    measureFrameRef.current = requestAnimationFrame(() =>
      measureVisibleFramesNowRef.current(),
    );
  }, []);

  useKeyedMountEffect(
    joinEffectKey(["image-virtualization-measure", measureVisibleFramesNow]),
    () => {
      if (measureFrameRef.current) {
        cancelAnimationFrame(measureFrameRef.current);
        measureFrameRef.current = 0;
      }
      measureVisibleFramesNow();
    },
  );

  // When the sidebar transition finishes and the freeze lifts, the reading
  // position has just been rebased by a settle scroll that may not have landed
  // in the same commit as this idle edge. Schedule a deferred re-measure so the
  // held window collapses back to the clean live window off the settled scroll;
  // without this the post-cycle mounted-frame set can differ from the pre-cycle
  // set (cycle-invariance "changed").
  const wasFrozenRef = React.useRef(freezeWindow);
  useKeyedLayoutEffect(joinEffectKey(["image-freeze-edge", freezeWindow]), () => {
    const wasFrozen = wasFrozenRef.current;
    wasFrozenRef.current = freezeWindow;
    if (wasFrozen && !freezeWindow) {
      measureVisibleFrames();
    }
  });

  useMountEffect(() => {
    return () => {
      if (measureFrameRef.current) {
        cancelAnimationFrame(measureFrameRef.current);
      }
    };
  });

  return {
    scrollPageOffset: frameWindow.scrollPageOffset,
    visibleFrameNumbers: frameWindow.visibleFrameNumbers,
    renderFrameNumbers: frameWindow.renderFrameNumbers,
    preloadFrameNumbers: frameWindow.preloadFrameNumbers,
    measureVisibleFrames,
  };
}

// On the cold path the document scroll model can momentarily report a
// top-of-document scrollTop while the viewport is actually scrolled deep, which
// would clobber the reading-frame window with the top window and then sit there
// (a stable-but-wrong state the benchmark's stability wait accepts). When the
// scroll is not page-rebased (no page offset) the logical scrollTop must equal
// the live DOM scrollTop, so trust the viewport if the metrics disagree at top.
function reconcileImageScrollMetricsWithViewport(
  metrics: ImageFrameVirtualizationScrollMetrics,
  viewportElement: HTMLDivElement | null,
): ImageFrameVirtualizationScrollMetrics {
  if (!viewportElement || metrics.scrollPageOffset !== 0) return metrics;
  const domScrollTop = viewportElement.scrollTop;
  if (domScrollTop > metrics.scrollTop + 1) {
    return { ...metrics, scrollTop: domScrollTop };
  }
  return metrics;
}

function getImageFrameNumbersInRange({
  layout,
  startOffset,
  endOffset,
  overscanFrames,
}: {
  layout: ImageFrameLayoutModel;
  startOffset: number;
  endOffset: number;
  overscanFrames: number;
}) {
  const safeStartOffset = Math.max(0, startOffset);
  const safeEndOffset = Math.max(safeStartOffset, endOffset);
  const firstVisibleFrame = findImageFrameByOffset(layout, safeStartOffset);
  const lastVisibleFrame = findImageFrameByOffset(layout, safeEndOffset);
  const firstFrame = Math.max(1, firstVisibleFrame - overscanFrames);
  const lastFrame = Math.min(
    layout.frameCount,
    lastVisibleFrame + overscanFrames,
  );

  return createFrameNumberRange(firstFrame, lastFrame);
}

function createFrameNumberRange(firstFrame: number, lastFrame: number) {
  if (lastFrame < firstFrame) return [];

  return Array.from(
    { length: lastFrame - firstFrame + 1 },
    (_, index) => firstFrame + index,
  );
}

function shouldRebaseImageScroll({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return (
    getImageMaxLogicalScrollTop({ totalHeight, viewportHeight }) >
    IMAGE_SCROLL_REBASE_THRESHOLD_PX
  );
}

function getImageMaxLogicalScrollTop({
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

function getImageMaxPhysicalScrollTop({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return Math.max(
    getImagePhysicalScrollHeight({ totalHeight, viewportHeight }) -
      Math.max(0, finiteNumber(viewportHeight)),
    0,
  );
}

function getImageMaxScrollPageOffset({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return Math.max(
    getImageMaxLogicalScrollTop({ totalHeight, viewportHeight }) -
      getImageMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
    0,
  );
}

function clampImageScrollPageOffset({
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
    getImageMaxScrollPageOffset({ totalHeight, viewportHeight }),
  );
}

function resolveImageScrollPageWindow({
  logicalScrollTop,
  preferredPhysicalScrollTop,
  totalHeight,
  viewportHeight,
}: {
  logicalScrollTop: number;
  preferredPhysicalScrollTop: number;
  totalHeight: number;
  viewportHeight: number;
}): ImageScrollRebasePosition {
  let physicalScrollTop = roundImageScrollPixel(
    clamp(
      finiteNumber(preferredPhysicalScrollTop),
      0,
      getImageMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
    ),
  );
  let scrollPageOffset = clampImageScrollPageOffset({
    scrollPageOffset: logicalScrollTop - physicalScrollTop,
    totalHeight,
    viewportHeight,
  });

  physicalScrollTop = roundImageScrollPixel(
    clamp(
      logicalScrollTop - scrollPageOffset,
      0,
      getImageMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
    ),
  );
  scrollPageOffset = clampImageScrollPageOffset({
    scrollPageOffset: logicalScrollTop - physicalScrollTop,
    totalHeight,
    viewportHeight,
  });

  return { physicalScrollTop, scrollPageOffset };
}

function shouldFitImagePerfectly({
  canFitPerfectly,
  previousScrollTop,
  scrollTop,
  viewportHeight,
}: {
  canFitPerfectly: boolean;
  previousScrollTop: number;
  scrollTop: number;
  viewportHeight: number;
}) {
  return (
    canFitPerfectly &&
    viewportHeight > 0 &&
    Math.abs(scrollTop - previousScrollTop) >
      viewportHeight + IMAGE_RENDER_WINDOW_OVERSCAN_PX * 2
  );
}

function areFrameWindowsEqual(
  previousFrameWindow: ImageFrameWindow,
  nextFrameWindow: ImageFrameWindow,
): boolean {
  return (
    previousFrameWindow.scrollPageOffset === nextFrameWindow.scrollPageOffset &&
    areFrameNumbersEqual(
      previousFrameWindow.visibleFrameNumbers,
      nextFrameWindow.visibleFrameNumbers,
    ) &&
    areFrameNumbersEqual(
      previousFrameWindow.renderFrameNumbers,
      nextFrameWindow.renderFrameNumbers,
    ) &&
    areFrameNumbersEqual(
      previousFrameWindow.preloadFrameNumbers,
      nextFrameWindow.preloadFrameNumbers,
    )
  );
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function roundImageScrollPixel(value: number) {
  if (typeof window === "undefined") return Math.round(value);
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

function safePadding(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeSize(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function areFrameNumbersEqual(
  previousFrameNumbers: readonly number[],
  nextFrameNumbers: readonly number[],
): boolean {
  if (previousFrameNumbers.length !== nextFrameNumbers.length) return false;
  return previousFrameNumbers.every(
    (frameNumber, index) => frameNumber === nextFrameNumbers[index],
  );
}
