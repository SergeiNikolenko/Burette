"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { type FrameSource } from "@/lib/image-frame-source";
import {
  imageFrameSourceManager,
  type FrameSourceLease,
  type ImageSourceContent,
} from "@/lib/image-source-cache";
import { cn } from "@/lib/utils";
import {
  type ViewerContentIdentity,
  type ViewerResource,
} from "@/lib/viewer-resource";
import { ImageFrameScroller } from "@/components/ui/image-viewer-frame";
import {
  IMAGE_READING_MARKER_RATIO,
  IMAGE_VIEWER_HORIZONTAL_PADDING,
  MAX_VIEWER_SCALE,
  MIN_VIEWER_SCALE,
  useFrameListWidth,
  useImageViewerHandle,
  useImageViewerScale,
  useVisibleFrame,
} from "@/components/ui/image-viewer-hooks";
import {
  type ImageViewerHandle,
  type ImageViewerProps,
} from "@/components/ui/image-viewer-types";
import {
  useViewerControlsRegistration,
  ViewerControls,
  type ViewerControlsState,
} from "@/components/ui/viewer-controls";

import {
  FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
  readFileViewerBeforeLayoutMotionFrame,
} from "./file-viewer-elements";
import type { FileViewerMotionFrame } from "./file-viewer-motion-plan";
import {
  captureFileViewerFitWidthAnchorScreenOffset,
  createFileViewerFitWidthSurfaceMotionResolver,
  FILE_VIEWER_FIT_WIDTH_ANCHOR_BLOCK_PROPERTY,
  getFileViewerFitWidthScale,
  resolveFileViewerFitWidthMotionAnchorBlock,
} from "./file-viewer-fit-width-motion";
import type { FileViewerDocumentSurfaceMotionResolver } from "./file-viewer-motion-kernel";
import { resolveFileViewerRendererLayoutInlineSize } from "./file-viewer-renderer-contract";
import {
  useOptionalFileViewerRendererEnvironment,
  useOptionalFileViewerRendererFrame,
} from "./file-viewer-renderer-frame";
import { useReadingFractionRebase } from "./use-reading-fraction-rebase";
import {
  createImageFrameLayout,
  getCurrentImageFrameNumber,
  getImageFrameLayout,
} from "./image-viewer-virtualization";
import { IMAGE_ZOOM_MOTION_TOTAL_MS } from "./image-viewer-zoom-motion";
import { joinEffectKey } from "@/lib/effect-key";

export function ImageViewerContent({
  resource,
  className,
  scale: controlledScale,
  defaultScale,
  download = true,
  onScaleChange,
  controls = true,
  renderFrameOverlay,
  onFrameRenderTiming,
  onVisibleFrameChange,
  onScrollProgressChange,
  bare = false,
  forwardedRef,
}: Omit<ImageViewerProps, "source"> & {
  forwardedRef?: React.ForwardedRef<ImageViewerHandle>;
  resource: ViewerResource;
}) {
  const frameSource = React.use(getImageSource(resource.content));
  const sourceLeaseRef = useFrameSourceLease(resource.content, frameSource);
  const rendererEnvironment = useOptionalFileViewerRendererEnvironment();
  const { frameListRef, frameListWidth } = useFrameListWidth({
    enabled: !rendererEnvironment.usesShellGeometry,
  });
  const rendererFrame = useOptionalFileViewerRendererFrame({
    fallbackInlineSize: frameListWidth,
  });
  const frameListLayoutWidth = resolveFileViewerRendererLayoutInlineSize({
    fallbackInlineSize: frameListWidth,
    rendererFrame,
  });
  // While the sidebar transition is running, hold the virtualization's
  // mounted-frame window so the reading frames stay mounted through the
  // slide-start commit and the brief settle hold; re-derive the window
  // normally once the transition is idle again.
  const freezeVisibleFrameWindow = rendererFrame.phase !== "idle";
  const {
    isFitWidth,
    rotateClockwise,
    rotation,
    scale,
    scaleControlsDisabled,
    setViewerScale,
    widestFrameWidth,
  } = useImageViewerScale(
    frameSource,
    controlledScale,
    defaultScale,
    onScaleChange,
    frameListLayoutWidth,
  );
  const rasterInlineSize =
    rendererFrame.shellInlineSize ??
    rendererFrame.rasterInlineSize ??
    frameListLayoutWidth;
  const rasterScale = isFitWidth
    ? clamp(
        getFileViewerFitWidthScale({
          availableInlineSize: rasterInlineSize ?? frameListLayoutWidth ?? 0,
          contentInlineSize: widestFrameWidth,
          stageInlinePadding: IMAGE_VIEWER_HORIZONTAL_PADDING,
        }),
        MIN_VIEWER_SCALE,
        MAX_VIEWER_SCALE,
      )
    : scale;
  const frameLayout = React.useMemo(
    () =>
      createImageFrameLayout({
        frames: frameSource.frames,
        scale,
        rotation,
      }),
    [frameSource.frames, rotation, scale],
  );
  const {
    captureZoomIntent,
    currentFrameNumber,
    getScrollMetrics,
    getViewportElement,
    handleScroll,
    scrollToFrameArea,
    setScrollViewportRef,
  } = useVisibleFrame(
    frameLayout,
    frameSource,
    onScrollProgressChange,
    onVisibleFrameChange,
  );
  useImageViewerHandle(forwardedRef, getViewportElement, scrollToFrameArea);

  // Toolbar zoom steps re-anchor the viewport center and relax a FLIP over
  // the commit (image-viewer-zoom-motion). The sequence must flip in the zoom
  // gesture's own render so the visual clip is already released when the
  // enlarged opening frame paints; rapid steps re-arm the release timer.
  const [zoomMotionSequence, setZoomMotionSequence] = React.useState(0);
  const isZoomTransitioning = zoomMotionSequence > 0;
  useKeyedMountEffect(joinEffectKey([zoomMotionSequence]), () => {
    if (zoomMotionSequence === 0) return;
    const timeout = setTimeout(
      () => setZoomMotionSequence(0),
      IMAGE_ZOOM_MOTION_TOTAL_MS,
    );
    return () => clearTimeout(timeout);
  });
  const beginZoomMotion = React.useCallback(() => {
    captureZoomIntent();
    setZoomMotionSequence((sequence) => sequence + 1);
  }, [captureZoomIntent]);

  // Preserve the reading position when the image re-fits to a new width (the
  // sidebar toggle). The fit scale is the layout key; capture the fraction on
  // scroll and restore it the instant the scale changes. A toolbar zoom step
  // must NOT take this path: its geometry commit already restored the
  // viewport-CENTER anchor (image-viewer-zoom-motion), and the fraction
  // restore would overwrite that scroll in the same commit. The sequence
  // flips in the zoom gesture's own render, so the zoom's re-fit lands with
  // the rebase disabled while the key still advances.
  const scrollerRef = React.useRef<HTMLElement | null>(null);
  const { captureReadingFraction } = useReadingFractionRebase({
    scrollerRef,
    layoutKey: scale,
    enabled: rendererEnvironment.usesShellGeometry && !isZoomTransitioning,
  });
  const imageDocumentSurfaceRef = React.useRef<HTMLDivElement | null>(null);
  const [imageDocumentSurfaceElement, setImageDocumentSurfaceElement] =
    React.useState<HTMLDivElement | null>(null);
  const resolveSurfaceMotionStyle =
    React.useMemo<FileViewerDocumentSurfaceMotionResolver>(
      () =>
        createFileViewerFitWidthSurfaceMotionResolver({
          // The frame centres the stage with auto margins whatever the
          // renderer frame's align is (a zoomed-out document splits its
          // leftover space evenly), so the margin model must say "center" too.
          align: "center",
          direction: rendererFrame.direction,
          isFitWidth,
          stageInlineSize: frameLayout.maxFrameWidth + frameLayout.padding * 2,
          stageInlinePadding: IMAGE_VIEWER_HORIZONTAL_PADDING,
          stageInlineSlope: 1,
          stageBlockSlope: 1,
        }),
      [
        frameLayout.maxFrameWidth,
        frameLayout.padding,
        isFitWidth,
        rendererFrame.direction,
      ],
    );
  const imageStageInlineSize =
    frameLayout.maxFrameWidth + frameLayout.padding * 2;
  const preMotionAnchorRef = React.useRef<{
    frameNumber: number;
    screenRelTop: number;
  } | null>(null);
  const lastAnchorBlockRef = React.useRef<number | null>(null);
  const writeImageAnchorBlockOffsetPx = React.useCallback(
    (anchorBlock: number) => {
      const element = imageDocumentSurfaceRef.current;
      if (!element) return;
      const safeAnchorBlock = Number.isFinite(anchorBlock) ? anchorBlock : 0;
      lastAnchorBlockRef.current = safeAnchorBlock;
      element.style.setProperty(
        FILE_VIEWER_FIT_WIDTH_ANCHOR_BLOCK_PROPERTY,
        `${safeAnchorBlock}px`,
      );
    },
    [],
  );
  const writeImageDocumentAnchorBlockOffset = React.useCallback(() => {
    const metrics = getScrollMetrics();
    // Stage (physical) coordinates: the transform scales the stage, so the
    // marker offset is anchored to the live DOM scroll position.
    const physicalScrollTop = scrollerRef.current?.scrollTop ?? 0;
    writeImageAnchorBlockOffsetPx(
      Math.max(0, physicalScrollTop) +
        Math.max(0, metrics.viewportHeight) * IMAGE_READING_MARKER_RATIO,
    );
  }, [getScrollMetrics, writeImageAnchorBlockOffsetPx]);
  // The transform must pin the exact screen line the slide-start commit
  // preserved. Measured against the frame layout models (old model at
  // capture, new model at solve) in the stage's PHYSICAL coordinates — the
  // frame offsets are logical, so they are mapped through the paged-scroll
  // delta (logical − physical) like the PDF runtime does. Exact across
  // constant gaps and padding, rebase clamps, paged scroll spaces, and
  // mid-flight retargets (the capture applies the in-flight transform it was
  // seen under).
  const writeImageMotionAnchorBlockOffset = React.useCallback(() => {
    const metrics = getScrollMetrics();
    const physicalScrollTop = scrollerRef.current?.scrollTop ?? 0;
    const logicalDelta = metrics.scrollTop - physicalScrollTop;
    const preMotionAnchor = preMotionAnchorRef.current;
    const newFrameLayout = preMotionAnchor
      ? getImageFrameLayout(frameLayout, preMotionAnchor.frameNumber)
      : null;
    const anchorBlock =
      preMotionAnchor && newFrameLayout
        ? resolveFileViewerFitWidthMotionAnchorBlock({
            fromInlineSize: rendererFrame.fromInlineSize,
            probeScreenOffset: preMotionAnchor.screenRelTop,
            probeStageOffset: newFrameLayout.offsetTop - logicalDelta,
            scrollTop: physicalScrollTop,
            stageInlineSize: imageStageInlineSize,
            stageInlinePadding: IMAGE_VIEWER_HORIZONTAL_PADDING,
            stageBlockSlope: 1,
            toInlineSize: rendererFrame.toInlineSize,
          })
        : null;

    if (anchorBlock == null) {
      writeImageDocumentAnchorBlockOffset();
      return;
    }
    writeImageAnchorBlockOffsetPx(anchorBlock);
  }, [
    frameLayout,
    getScrollMetrics,
    imageStageInlineSize,
    rendererFrame.fromInlineSize,
    rendererFrame.toInlineSize,
    writeImageAnchorBlockOffsetPx,
    writeImageDocumentAnchorBlockOffset,
  ]);
  const measureBeforeLayoutMotionRef = React.useRef(
    (_liveFrame: FileViewerMotionFrame | null) => {},
  );
  measureBeforeLayoutMotionRef.current = (liveFrame) => {
    const metrics = getScrollMetrics();
    const physicalScrollTop = scrollerRef.current?.scrollTop ?? 0;
    const logicalDelta = metrics.scrollTop - physicalScrollTop;
    const frameNumber = getCurrentImageFrameNumber({
      layout: frameLayout,
      scrollTop: metrics.scrollTop,
      viewportHeight: metrics.viewportHeight,
    });
    const frame = getImageFrameLayout(frameLayout, frameNumber);
    preMotionAnchorRef.current = frame
      ? {
          frameNumber,
          screenRelTop: captureFileViewerFitWidthAnchorScreenOffset({
            lastAnchorBlock: lastAnchorBlockRef.current,
            liveFrame,
            probeStageOffset: frame.offsetTop - logicalDelta,
            scrollTop: physicalScrollTop,
            stageInlineSize: imageStageInlineSize,
            stageInlinePadding: IMAGE_VIEWER_HORIZONTAL_PADDING,
            stageBlockSlope: 1,
          }),
        }
      : null;
  };
  const handleBeforeLayoutMotion = React.useCallback(
    (event: Event) => {
      captureReadingFraction();
      measureBeforeLayoutMotionRef.current(
        readFileViewerBeforeLayoutMotionFrame(event),
      );
    },
    [captureReadingFraction],
  );
  // Runs inside the slide-start commit after the fraction rebase (hook order
  // puts the rebase's layout effect first), pinning the transform before the
  // first frame paints. Keyed on the transition id so a mid-flight retarget
  // (same isTransitioning) re-solves against the new motion.
  const isImageShellTransitioning = rendererFrame.isTransitioning;
  const writeImageMotionAnchorBlockOffsetRef = React.useRef(
    writeImageMotionAnchorBlockOffset,
  );
  writeImageMotionAnchorBlockOffsetRef.current =
    writeImageMotionAnchorBlockOffset;
  useKeyedLayoutEffect(
    joinEffectKey([
      "image-motion-anchor",
      isImageShellTransitioning,
      rendererFrame.documentTransition.transitionId,
      writeImageMotionAnchorBlockOffset,
    ]),
    () => {
      if (!isImageShellTransitioning) return;
      writeImageMotionAnchorBlockOffsetRef.current();
    },
  );
  const setImageDocumentSurfaceRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      const previousElement = imageDocumentSurfaceRef.current;
      if (previousElement === element) return;
      previousElement?.removeEventListener(
        FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
        handleBeforeLayoutMotion,
      );
      imageDocumentSurfaceRef.current = element;
      setImageDocumentSurfaceElement((previous) =>
        previous === element ? previous : element,
      );
      if (!element) return;
      element.addEventListener(
        FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
        handleBeforeLayoutMotion,
      );
      writeImageDocumentAnchorBlockOffset();
    },
    [handleBeforeLayoutMotion, writeImageDocumentAnchorBlockOffset],
  );
  const motionProbeFrameNumberRef = React.useRef(currentFrameNumber);
  motionProbeFrameNumberRef.current = currentFrameNumber;
  const getImageMotionProbeElement = React.useCallback(() => {
    const surface = imageDocumentSurfaceRef.current;
    if (!surface) return null;
    const frameNumber =
      preMotionAnchorRef.current?.frameNumber ??
      motionProbeFrameNumberRef.current;
    return (
      surface.querySelector<HTMLElement>(
        `[data-slot="image-frame"][data-frame-number="${frameNumber}"]`,
      ) ??
      surface.querySelector<HTMLElement>(
        '[data-slot="image-frame-slot"][data-visible] [data-slot="image-frame"]',
      ) ??
      surface.querySelector<HTMLElement>('[data-slot="image-frame"]')
    );
  }, []);
  const documentSurfaceKey = imageDocumentSurfaceElement
    ? joinEffectKey([
        "image-document-surface",
        imageDocumentSurfaceElement,
        rendererEnvironment.registerDocumentSurface,
        resolveSurfaceMotionStyle,
      ])
    : null;
  useKeyedLayoutEffect(documentSurfaceKey, () => {
    if (!imageDocumentSurfaceElement) return;
    return rendererEnvironment.registerDocumentSurface({
      element: imageDocumentSurfaceElement,
      getMotionProbeElement: getImageMotionProbeElement,
      resolveMotionStyle: resolveSurfaceMotionStyle,
    });
  });
  const setScrollViewportRefWithRebase = React.useCallback(
    (element: HTMLDivElement | null) => {
      scrollerRef.current = element;
      setScrollViewportRef(element);
    },
    [setScrollViewportRef],
  );
  const handleScrollWithRebase = React.useCallback(() => {
    captureReadingFraction();
    handleScroll();
  }, [captureReadingFraction, handleScroll]);

  const frameCount = frameSource.frames.length;
  const countLabel =
    frameSource.kind === "tiff"
      ? `Page ${Math.min(currentFrameNumber, frameCount)} of ${frameCount}`
      : `${frameCount} image${frameCount === 1 ? "" : "s"}`;
  const zoomOut = React.useCallback(() => {
    beginZoomMotion();
    setViewerScale(clamp(scale / 1.2, MIN_VIEWER_SCALE, MAX_VIEWER_SCALE));
  }, [beginZoomMotion, scale, setViewerScale]);
  const zoomIn = React.useCallback(() => {
    beginZoomMotion();
    setViewerScale(clamp(scale * 1.2, MIN_VIEWER_SCALE, MAX_VIEWER_SCALE));
  }, [beginZoomMotion, scale, setViewerScale]);
  const fitWidth = React.useCallback(() => {
    beginZoomMotion();
    setViewerScale(null);
  }, [beginZoomMotion, setViewerScale]);
  useImageControlsRegistration({
    countLabel,
    download,
    downloadAction: resource.originalDownload,
    fitWidth,
    rotateClockwise,
    scale,
    scaleControlsDisabled,
    zoomIn,
    zoomOut,
  });

  return (
    <div
      ref={sourceLeaseRef}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        bare ? "bg-muted/20 h-full" : "bg-muted/30 rounded-xl border",
        className,
      )}
      data-slot="image-viewer"
    >
      {controls ? (
        <ViewerControls
          position={{ label: countLabel }}
          zoom={{
            scale,
            onZoomOut: zoomOut,
            onZoomIn: zoomIn,
            onFit: fitWidth,
            isDisabled: scaleControlsDisabled,
          }}
          rotate={{ onRotate: rotateClockwise }}
          downloads={download ? [resource.originalDownload] : []}
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <ImageFrameScroller
              source={frameSource}
              layout={frameLayout}
              scale={scale}
              rotation={rotation}
              rasterScale={rasterScale}
              documentSurfaceRef={setImageDocumentSurfaceRef}
              frameListRef={frameListRef}
              getScrollMetrics={getScrollMetrics}
              freezeVisibleFrameWindow={freezeVisibleFrameWindow}
              isFitWidth={isFitWidth}
              isZoomTransitioning={isZoomTransitioning}
              viewportRef={setScrollViewportRefWithRebase}
              onScroll={handleScrollWithRebase}
              renderFrameOverlay={renderFrameOverlay}
              onFrameRenderTiming={onFrameRenderTiming}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function useImageControlsRegistration({
  countLabel,
  download,
  downloadAction,
  fitWidth,
  rotateClockwise,
  scale,
  scaleControlsDisabled,
  zoomIn,
  zoomOut,
}: {
  countLabel: string;
  download: boolean;
  downloadAction: ViewerResource["originalDownload"];
  fitWidth: () => void;
  rotateClockwise: () => void;
  scale: number;
  scaleControlsDisabled: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
}) {
  const onControlsChange = useViewerControlsRegistration();
  const controlsState = React.useMemo<ViewerControlsState>(
    () => ({
      position: { label: countLabel },
      zoom: {
        scale,
        onZoomOut: zoomOut,
        onZoomIn: zoomIn,
        onFit: fitWidth,
        isDisabled: scaleControlsDisabled,
      },
      rotate: { onRotate: rotateClockwise },
      downloads: download ? [downloadAction] : [],
    }),
    [
      countLabel,
      download,
      downloadAction,
      fitWidth,
      rotateClockwise,
      scale,
      scaleControlsDisabled,
      zoomIn,
      zoomOut,
    ],
  );

  useKeyedMountEffect(
    joinEffectKey(["image-controls", onControlsChange, controlsState]),
    () => {
      if (!onControlsChange) return;
      onControlsChange(controlsState);
      return () => onControlsChange(null);
    },
  );
}

export function getImageSource(
  content: ImageSourceContent,
): Promise<FrameSource> {
  return imageFrameSourceManager.load(content, createTiffWorker);
}

export function resetImageSourceCacheForTests() {
  imageFrameSourceManager.clear();
}

function useFrameSourceLease(
  content: ViewerContentIdentity,
  source: FrameSource,
): React.RefCallback<HTMLDivElement> {
  return React.useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const lease = retainImageSource(content, source);
      return () => lease?.release();
    },
    [content, source],
  );
}

function retainImageSource(
  content: ViewerContentIdentity,
  source: FrameSource,
): FrameSourceLease | null {
  return imageFrameSourceManager.retain(content, source);
}

function createTiffWorker() {
  return new Worker(new URL("./image-viewer.worker", import.meta.url), {
    type: "module",
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
