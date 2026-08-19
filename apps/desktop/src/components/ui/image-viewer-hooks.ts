"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { type FrameSource } from "@/lib/image-frame-source";
import { normalizeRotation, rotatedSize } from "@/lib/image-geometry";
import {
  type ImageViewerHandle,
  type ImageViewerProps,
} from "@/components/ui/image-viewer-types";

import {
  getCurrentImageFrameNumber,
  getImageFrameLayout,
  getImageLogicalScrollTop,
  getImagePhysicalScrollHeight,
  resolveImagePhysicalScrollPosition,
  type ImageFrameVirtualizationScrollMetrics,
  type ImageFrameLayoutModel,
} from "./image-viewer-virtualization";
import type {
  ViewerDocumentLayoutModel,
  ViewerDocumentScrollMapper,
  ViewerDocumentScrollMetrics,
  ViewerDocumentScrollTargetResolver,
} from "./viewer-types";
import { useViewerDocumentScroll } from "./viewer-document-scroll";
import { createImageZoomMotionController } from "./image-viewer-zoom-motion";
import { getFileViewerFitWidthScale } from "./file-viewer-fit-width-motion";
import { joinEffectKey } from "@/lib/effect-key";

const IMAGE_SCROLL_HEADROOM = 48;
export const IMAGE_READING_MARKER_RATIO = 0.2;
export const IMAGE_VIEWER_HORIZONTAL_PADDING = 32;

/** Bounds for the viewer's zoom range, shared by fit-width and the controls. */
export const MIN_VIEWER_SCALE = 0.1;
export const MAX_VIEWER_SCALE = 5;

export function useFrameListWidth({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const [frameListWidth, setFrameListWidth] = React.useState<number | null>(
    null,
  );
  const frameListRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      if (!enabled) {
        setFrameListWidth(null);
        return;
      }

      setFrameListWidth(element.clientWidth);
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setFrameListWidth((entry.target as HTMLElement).clientWidth);
        }
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
    [enabled],
  );

  return { frameListRef, frameListWidth };
}

export function useImageViewerScale(
  source: FrameSource,
  controlledScale: number | undefined,
  defaultScale: number | undefined,
  onScaleChange: ImageViewerProps["onScaleChange"],
  frameListWidth: number | null,
) {
  const isScaleControlled = controlledScale !== undefined;
  const [uncontrolledScale, setUncontrolledScale] = React.useState<
    number | null
  >(() =>
    defaultScale === undefined ? null : normalizeViewerScale(defaultScale),
  );
  const [rawRotation, setRawRotation] = React.useState(0);

  useKeyedMountEffect(
    joinEffectKey(["image-scale-reset", defaultScale, source]),
    () => {
      setRawRotation(0);
      setUncontrolledScale(
        defaultScale === undefined ? null : normalizeViewerScale(defaultScale),
      );
    },
  );

  const rotation = normalizeRotation(rawRotation);
  const widestFrameWidth = Math.max(
    1,
    ...source.frames.map(
      (frame) => rotatedSize(frame.intrinsicSize, rotation).width,
    ),
  );
  const fitWidthScale = frameListWidth
    ? getFileViewerFitWidthScale({
        availableInlineSize: frameListWidth,
        contentInlineSize: widestFrameWidth,
        stageInlinePadding: IMAGE_VIEWER_HORIZONTAL_PADDING,
      })
    : 1;
  const scale =
    controlledScale !== undefined
      ? normalizeViewerScale(controlledScale)
      : uncontrolledScale !== null
        ? normalizeViewerScale(uncontrolledScale)
        : Math.min(MAX_VIEWER_SCALE, Math.max(MIN_VIEWER_SCALE, fitWidthScale));
  const isFitWidth =
    controlledScale === undefined && uncontrolledScale === null;

  const scaleControlsDisabled = isScaleControlled && !onScaleChange;
  const setViewerScale = React.useCallback(
    (nextScale: number | null) => {
      const normalized =
        nextScale == null ? null : normalizeViewerScale(nextScale);
      if (isScaleControlled) {
        onScaleChange?.(normalized);
        return;
      }
      setUncontrolledScale(normalized);
    },
    [isScaleControlled, onScaleChange],
  );
  const rotateClockwise = React.useCallback(() => {
    setRawRotation((value) => (value + 90) % 360);
  }, []);

  return {
    isFitWidth,
    rotateClockwise,
    rotation,
    scale,
    scaleControlsDisabled,
    setViewerScale,
    widestFrameWidth,
  };
}

function normalizeViewerScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0
    ? Math.min(MAX_VIEWER_SCALE, Math.max(MIN_VIEWER_SCALE, scale))
    : MIN_VIEWER_SCALE;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeFrameAreaPercent(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

type ImageReadingAnchor =
  | {
      kind: "top";
    }
  | {
      frameNumber: number;
      kind: "frame";
      yPercent: number;
    };

type ImageFrameArea = Parameters<ImageViewerHandle["scrollToFrameArea"]>[1];

type ImageFrameAreaTarget = {
  area: ImageFrameArea;
  frameNumber: number;
};

type ImageDocumentLayoutModel = ViewerDocumentLayoutModel<ImageReadingAnchor>;

const IMAGE_DOCUMENT_SCROLL_MAPPER: ViewerDocumentScrollMapper = {
  getLogicalScrollTop: ({
    blockSize,
    physicalScrollTop,
    scrollPageOffset,
    viewportBlockSize,
  }) =>
    getImageLogicalScrollTop({
      physicalScrollTop,
      scrollPageOffset,
      totalHeight: blockSize,
      viewportHeight: viewportBlockSize,
    }),
  getPhysicalScrollSize: ({ blockSize, viewportBlockSize }) =>
    getImagePhysicalScrollHeight({
      totalHeight: blockSize,
      viewportHeight: viewportBlockSize,
    }),
  resolvePhysicalScrollPosition: ({
    blockSize,
    logicalScrollTop,
    scrollPageOffset,
    viewportBlockSize,
  }) =>
    resolveImagePhysicalScrollPosition({
      logicalScrollTop,
      scrollPageOffset,
      totalHeight: blockSize,
      viewportHeight: viewportBlockSize,
    }),
};

export function useVisibleFrame(
  layout: ImageFrameLayoutModel,
  resetKey: unknown,
  onScrollProgressChange: ImageViewerProps["onScrollProgressChange"],
  onVisibleFrameChange: ImageViewerProps["onVisibleFrameChange"],
) {
  const [currentFrameNumber, setCurrentFrameNumber] = React.useState(1);
  const lastReportedFrameNumber = React.useRef(0);
  const documentLayout = React.useMemo(
    () => createImageDocumentLayoutModel(layout),
    [layout],
  );
  const resolveScrollTarget = React.useCallback<
    ViewerDocumentScrollTargetResolver<ImageReadingAnchor, ImageFrameAreaTarget>
  >(({ target }) => getImageFrameAreaScrollTarget(layout, target), [layout]);
  const zoomMotion = React.useMemo(
    () => createImageZoomMotionController(layout),
    [layout],
  );
  const documentScroll = useViewerDocumentScroll({
    copyScrollTarget: copyImageFrameAreaTarget,
    layout: documentLayout,
    resetKey,
    resolveScrollTarget,
    scrollMapper: IMAGE_DOCUMENT_SCROLL_MAPPER,
    zoomMotion,
  });
  const getScrollMetrics = React.useCallback(
    () =>
      toImageFrameVirtualizationScrollMetrics(
        documentScroll.getScrollMetrics(),
      ),
    [documentScroll],
  );

  const handleScroll = React.useCallback(() => {
    const viewport = documentScroll.getViewportElement();
    if (!viewport) return;
    documentScroll.handleScroll();

    const metrics = documentScroll.getScrollMetrics();
    const isRebased = metrics.physicalScrollSize < documentLayout.blockSize;
    const scrollable = isRebased
      ? documentLayout.blockSize - metrics.viewportBlockSize
      : viewport.scrollHeight - metrics.viewportBlockSize;
    const progress =
      scrollable > 0
        ? clamp01(
            (isRebased ? metrics.scrollTop : viewport.scrollTop) / scrollable,
          )
        : 0;
    onScrollProgressChange?.(progress);

    const frameNumber = getCurrentImageFrameNumber({
      layout,
      scrollTop: metrics.scrollTop,
      viewportHeight: metrics.viewportBlockSize,
    });
    if (frameNumber && frameNumber !== lastReportedFrameNumber.current) {
      lastReportedFrameNumber.current = frameNumber;
      setCurrentFrameNumber(frameNumber);
      onVisibleFrameChange?.(frameNumber);
    }
  }, [
    documentLayout,
    documentScroll,
    layout,
    onScrollProgressChange,
    onVisibleFrameChange,
  ]);

  const scrollToFrameArea = React.useCallback(
    (frameNumber: number, area: ImageFrameArea, options?: ScrollToOptions) => {
      documentScroll.scrollToTarget({ area, frameNumber }, options);
    },
    [documentScroll],
  );

  useKeyedMountEffect(joinEffectKey(["image-visible-reset", resetKey]), () => {
    lastReportedFrameNumber.current = 0;
    setCurrentFrameNumber(1);
  });

  return {
    captureZoomIntent: documentScroll.captureZoomIntent,
    currentFrameNumber,
    getScrollMetrics,
    getViewportElement: documentScroll.getViewportElement,
    handleScroll,
    scrollToFrameArea,
    scrollViewportElement: documentScroll.viewportElement,
    setScrollViewportRef: documentScroll.setViewportElement,
  };
}

function captureImageReadingAnchor(
  layout: ImageFrameLayoutModel,
  {
    scrollTop,
    viewportBlockSize,
  }: {
    scrollTop: number;
    viewportBlockSize: number;
  },
): ImageReadingAnchor | null {
  if (layout.frameCount === 0) return null;
  if (scrollTop <= 0) return { kind: "top" };

  const markerOffset =
    scrollTop + viewportBlockSize * IMAGE_READING_MARKER_RATIO;
  const frameNumber = getCurrentImageFrameNumber({
    layout,
    scrollTop,
    viewportHeight: viewportBlockSize,
  });
  const frame = getImageFrameLayout(layout, frameNumber);
  if (!frame || frame.height <= 0) return null;

  return {
    frameNumber,
    kind: "frame",
    yPercent: clamp01((markerOffset - frame.offsetTop) / frame.height),
  };
}

function getImageReadingAnchorScrollTop(
  layout: ImageFrameLayoutModel,
  {
    anchor,
    viewportBlockSize,
  }: {
    anchor: ImageReadingAnchor;
    viewportBlockSize: number;
  },
): number | null {
  if (anchor.kind === "top") {
    return 0;
  }

  const frame = getImageFrameLayout(layout, anchor.frameNumber);
  if (!frame) return null;

  const targetTop =
    frame.offsetTop +
    frame.height * anchor.yPercent -
    viewportBlockSize * IMAGE_READING_MARKER_RATIO;
  const maxScrollTop = Math.max(0, layout.totalHeight - viewportBlockSize);
  return Math.min(maxScrollTop, Math.max(0, targetTop));
}

export function useImageViewerHandle(
  forwardedRef: React.ForwardedRef<ImageViewerHandle> | undefined,
  getViewportElement: () => HTMLDivElement | null,
  scrollToFrameArea: (
    frameNumber: number,
    area: ImageFrameArea,
    options?: ScrollToOptions,
  ) => void,
) {
  React.useImperativeHandle(
    forwardedRef ?? null,
    () => ({
      scrollToFrameArea,
      getViewportElement,
    }),
    [getViewportElement, scrollToFrameArea],
  );
}

function createImageDocumentLayoutModel(
  layout: ImageFrameLayoutModel,
): ImageDocumentLayoutModel {
  return {
    blockSize: layout.totalHeight,
    captureReadingAnchor: (input) => captureImageReadingAnchor(layout, input),
    getReadingAnchorScrollTop: (target) =>
      getImageReadingAnchorScrollTop(layout, target),
    inlineSize: layout.maxFrameWidth,
  };
}

function getImageFrameAreaScrollTarget(
  layout: ImageFrameLayoutModel,
  target: ImageFrameAreaTarget,
) {
  const areaTop = normalizeFrameAreaPercent(target.area.top);
  if (areaTop == null) return null;

  const frame = getImageFrameLayout(layout, target.frameNumber);
  if (!frame) return null;

  return {
    top: Math.max(
      0,
      frame.offsetTop + (areaTop / 100) * frame.height - IMAGE_SCROLL_HEADROOM,
    ),
  };
}

function copyImageFrameAreaTarget(
  target: ImageFrameAreaTarget,
): ImageFrameAreaTarget {
  return {
    frameNumber: target.frameNumber,
    area: {
      top: target.area.top,
      left: target.area.left,
      width: target.area.width,
      height: target.area.height,
    },
  };
}

function toImageFrameVirtualizationScrollMetrics(
  metrics: ViewerDocumentScrollMetrics,
): ImageFrameVirtualizationScrollMetrics {
  return {
    scrollPageOffset: metrics.scrollPageOffset,
    scrollTop: metrics.scrollTop,
    viewportHeight: metrics.viewportBlockSize,
  };
}
