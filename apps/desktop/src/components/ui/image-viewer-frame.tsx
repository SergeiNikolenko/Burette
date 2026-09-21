"use client";

import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  ImageSourceDisposedError,
  toImageFormatError,
  type FrameSource,
} from "@/lib/image-frame-source";
import {
  frameCssSize,
  frameIndexToNumber,
  type FrameOverlayProps,
  type QuarterTurn,
} from "@/lib/image-geometry";
import { isResourceError } from "@/lib/viewer-errors";
import {
  type ImageFrameRenderTiming,
  type ImageViewerProps,
} from "@/components/ui/image-viewer-types";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  getImageFrameLayout,
  getImagePhysicalScrollHeight,
  getImageRenderedFrameWindow,
  useImageFrameVirtualization,
  type ImageFrameLayout,
  type ImageFrameLayoutModel,
  type ImageFrameVirtualizationScrollMetrics,
  type ImageRenderedFrameLayout,
  type ImageRenderedFrameWindow,
} from "./image-viewer-virtualization";
import { joinEffectKey } from "@/lib/effect-key";

const IMAGE_SCROLL_IDLE_MS = 120;
const IMAGE_RETAINED_DECODED_PIXEL_BUDGET = 24_000_000;
const IMAGE_RETAINED_RENDERED_PIXEL_BUDGET = 32_000_000;
const IMAGE_FRAME_RENDER_CONCURRENCY = 4;
const IMAGE_LOW_PRIORITY_FRAME_RENDER_CONCURRENCY = 1;

type ImageRenderQuality = "high" | "low";

export interface ImageFrameProps {
  source: FrameSource;
  frameIndex: number;
  scale: number;
  rasterScale?: number;
  rotation: QuarterTurn;
  renderQuality?: ImageRenderQuality;
  renderOverlay?: (props: FrameOverlayProps) => React.ReactNode;
  onFrameRenderTiming?: (timing: ImageFrameRenderTiming) => void;
}

type ImageProjectionCallback = NonNullable<
  | ImageViewerProps["onFrameRenderTiming"]
  | ImageViewerProps["renderFrameOverlay"]
>;

export interface ImageFrameScrollerProps {
  source: FrameSource;
  layout: ImageFrameLayoutModel;
  scale: number;
  rasterScale?: number;
  rotation: QuarterTurn;
  documentSurfaceRef?: React.Ref<HTMLDivElement>;
  frameListRef: React.Ref<HTMLDivElement>;
  getScrollMetrics?: () => ImageFrameVirtualizationScrollMetrics;
  freezeVisibleFrameWindow?: boolean;
  /** The frames are at their fit-width scale (the shell motion's domain). */
  isFitWidth?: boolean;
  /** A toolbar zoom step's FLIP relax is in flight (image-viewer-zoom-motion). */
  isZoomTransitioning?: boolean;
  viewportRef: React.Ref<HTMLDivElement>;
  onScroll: () => void;
  renderFrameOverlay?: ImageViewerProps["renderFrameOverlay"];
  onFrameRenderTiming?: ImageViewerProps["onFrameRenderTiming"];
}

export function ImageFrame({
  source,
  frameIndex,
  scale,
  rasterScale = scale,
  rotation,
  renderQuality = "high",
  renderOverlay,
  onFrameRenderTiming,
}: ImageFrameProps) {
  const descriptor = source.frames[frameIndex];
  const frameRect = frameCssSize(descriptor.intrinsicSize, scale, rotation);
  const frameNumber = frameIndexToNumber(frameIndex);

  return (
    <div
      className="ring-border relative shadow-sm ring-1"
      style={{ width: frameRect.width, height: frameRect.height }}
      data-slot="image-frame"
      data-frame={frameNumber}
      data-frame-number={frameNumber}
    >
      <ImageFrameCanvas
        source={source}
        frameIndex={frameIndex}
        layoutScale={scale}
        rasterScale={rasterScale}
        rotation={rotation}
        renderQuality={renderQuality}
        onFrameRenderTiming={onFrameRenderTiming}
      />
      {renderOverlay ? (
        <div className="pointer-events-none absolute inset-0">
          {renderOverlay({
            frameNumber,
            frameRect,
            scale,
            rotation,
          })}
        </div>
      ) : null}
    </div>
  );
}

function ImageFrameCanvas({
  source,
  frameIndex,
  layoutScale,
  rasterScale,
  rotation,
  renderQuality,
  onFrameRenderTiming,
}: {
  source: FrameSource;
  frameIndex: number;
  layoutScale: number;
  rasterScale: number;
  rotation: QuarterTurn;
  renderQuality: ImageRenderQuality;
  onFrameRenderTiming?: (timing: ImageFrameRenderTiming) => void;
}) {
  const descriptor = source.frames[frameIndex];
  const dpr = getImageDevicePixelRatio();
  const layoutFrameRect = frameCssSize(
    descriptor.intrinsicSize,
    layoutScale,
    rotation,
  );
  // One resample generation: the canvas backing never exceeds the bitmap's
  // intrinsic resolution. Rastering past intrinsic only launders the same
  // pixels through a second resample, and the compositor's in-flight rescale
  // then beats against that pre-resampled texture (visible stroke shimmer).
  const rasterDeviceScale = Math.min(rasterScale * dpr, 1);
  const backingFrameRect = frameCssSize(
    descriptor.intrinsicSize,
    rasterDeviceScale,
    rotation,
  );
  const [drawError, setDrawError] = React.useState<Error | null>(null);

  if (drawError) throw drawError;

  const canvasRef = React.useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const canvasWidth = Math.max(1, Math.floor(backingFrameRect.width));
      const canvasHeight = Math.max(1, Math.floor(backingFrameRect.height));
      const cached = source.hasDecodedFrame(frameIndex);
      const previousCanvas = resizeImageCanvas(
        canvas,
        canvasWidth,
        canvasHeight,
        { preserve: !cached },
      );
      if (previousCanvas) {
        preserveCanvasImage(ctx, previousCanvas, canvasWidth, canvasHeight);
      }

      let cancelled = false;
      let settled = false;
      let reported = false;
      const startedAt = now();
      const renderScale = rasterDeviceScale;
      const report = (status: ImageFrameRenderTiming["status"]) => {
        if (reported) return;
        reported = true;
        notifyImageFrameRenderTiming(onFrameRenderTiming, {
          cached,
          durationMs: now() - startedAt,
          frameNumber: frameIndexToNumber(frameIndex),
          pixelRatio: dpr,
          renderScale,
          status,
        });
      };
      source
        .acquire(frameIndex)
        .then((bitmap) => {
          settled = true;
          if (cancelled) return;
          ctx.save();
          try {
            ctx.translate(
              backingFrameRect.width / 2,
              backingFrameRect.height / 2,
            );
            ctx.rotate((rotation * Math.PI) / 180);
            const drawWidth =
              descriptor.intrinsicSize.width * rasterDeviceScale;
            const drawHeight =
              descriptor.intrinsicSize.height * rasterDeviceScale;
            ctx.imageSmoothingQuality = renderQuality;
            ctx.drawImage(
              bitmap,
              -drawWidth / 2,
              -drawHeight / 2,
              drawWidth,
              drawHeight,
            );
            canvas.dataset.imageFrameRendered = "true";
          } finally {
            ctx.restore();
          }
          report("rendered");
        })
        .catch((error) => {
          settled = true;
          if (error instanceof ImageSourceDisposedError) return;
          if (!cancelled) {
            report("failed");
            setDrawError(
              isResourceError(error)
                ? error
                : toImageFormatError(error, {
                    kind: "decode_failed",
                    message: "Image decode failed",
                  }),
            );
          }
        });

      return () => {
        cancelled = true;
        if (!settled) report("cancelled");
        source.release(frameIndex);
      };
    },
    [
      backingFrameRect.height,
      backingFrameRect.width,
      descriptor.intrinsicSize.height,
      descriptor.intrinsicSize.width,
      frameIndex,
      onFrameRenderTiming,
      rasterDeviceScale,
      renderQuality,
      rotation,
      source,
    ],
  );

  return (
    <canvas
      ref={canvasRef}
      style={{ width: layoutFrameRect.width, height: layoutFrameRect.height }}
      className="block bg-white"
    />
  );
}

export function ImageFrameScroller({
  source,
  layout,
  scale,
  rasterScale = scale,
  rotation,
  documentSurfaceRef,
  frameListRef,
  getScrollMetrics,
  freezeVisibleFrameWindow = false,
  isFitWidth = true,
  isZoomTransitioning = false,
  viewportRef,
  onScroll,
  renderFrameOverlay,
  onFrameRenderTiming,
}: ImageFrameScrollerProps) {
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const projectionFrameRef = React.useRef<number | null>(null);
  const idleTimerRef = React.useRef<number | null>(null);
  const viewportElementRef = React.useRef<HTMLDivElement | null>(null);
  const [viewportElement, setViewportElement] =
    React.useState<HTMLDivElement | null>(null);
  const projectionCacheRef = React.useRef<ImageFrameProjectionCache>({
    clock: 0,
    frames: new Map(),
    resetKey: "",
  });
  const scrollStateRef = React.useRef({
    isScrolling: false,
  });
  const sourceKey = getImageProjectionSourceKey(source);
  const layoutResetKey = [
    sourceKey,
    layout.frameCount,
    layout.maxFrameWidth,
    layout.totalHeight,
    scale,
    rotation,
  ].join("\u0000");
  const projectionResetKey = String(sourceKey);
  const {
    scrollPageOffset,
    visibleFrameNumbers,
    renderFrameNumbers,
    preloadFrameNumbers,
    measureVisibleFrames,
  } = useImageFrameVirtualization({
    freezeWindow: freezeVisibleFrameWindow,
    getScrollMetrics,
    layout,
    resetKey: layoutResetKey,
    sourceResetKey: projectionResetKey,
    viewportElement,
  });
  const viewportHeight = viewportElement?.clientHeight ?? 0;
  const physicalScrollHeight = getImagePhysicalScrollHeight({
    totalHeight: layout.totalHeight,
    viewportHeight,
  });
  const documentInlineSize = layout.maxFrameWidth + layout.padding * 2;
  const renderedWindow = React.useMemo(
    () =>
      getImageRenderedFrameWindow({
        frameNumbers: renderFrameNumbers,
        layout,
        physicalScrollHeight,
        scrollPageOffset,
        viewportHeight,
      }),
    [
      layout,
      physicalScrollHeight,
      renderFrameNumbers,
      scrollPageOffset,
      viewportHeight,
    ],
  );
  const imageDevicePixelRatio = getImageDevicePixelRatio();
  const lowPriorityFrameNumbers = React.useMemo(
    () => [...renderFrameNumbers, ...preloadFrameNumbers],
    [preloadFrameNumbers, renderFrameNumbers],
  );
  const {
    activeFrameNumbers,
    onFrameRenderTiming: handleScheduledFrameRenderTiming,
  } = useImageFrameRenderScheduler({
    frameNumbers: visibleFrameNumbers,
    lowPriorityFrameNumbers,
    rasterScale,
    rotation,
    pixelRatio: imageDevicePixelRatio,
    resetKey: layoutResetKey,
    maxRunning: IMAGE_FRAME_RENDER_CONCURRENCY,
    maxLowPriorityRunning: IMAGE_LOW_PRIORITY_FRAME_RENDER_CONCURRENCY,
  });
  const handleFrameRenderTiming = React.useCallback(
    (timing: ImageFrameRenderTiming) => {
      handleScheduledFrameRenderTiming(timing);
      onFrameRenderTiming?.(timing);
    },
    [handleScheduledFrameRenderTiming, onFrameRenderTiming],
  );

  const projectFrames = React.useCallback(() => {
    projectionFrameRef.current = null;
    projectImageFrames({
      activeFrameNumbers,
      cache: projectionCacheRef.current,
      canvas: canvasRef.current,
      layout,
      onFrameRenderTiming: handleFrameRenderTiming,
      preloadFrameNumbers,
      renderFrameOverlay,
      renderQuality: scrollStateRef.current.isScrolling ? "low" : "high",
      renderedWindow,
      renderFrameNumbers,
      resetKey: projectionResetKey,
      rotation,
      rasterScale,
      scale,
      source,
      sourceKey,
      visibleFrameNumbers,
    });
  }, [
    activeFrameNumbers,
    handleFrameRenderTiming,
    layout,
    preloadFrameNumbers,
    projectionResetKey,
    renderFrameOverlay,
    renderedWindow,
    renderFrameNumbers,
    rotation,
    rasterScale,
    scale,
    freezeVisibleFrameWindow,
    source,
    sourceKey,
    visibleFrameNumbers,
  ]);
  const projectFramesRef = React.useRef(projectFrames);
  useKeyedLayoutEffect(joinEffectKey([projectFrames]), () => {
    projectFramesRef.current = projectFrames;
  });

  const scheduleProjectFrames = React.useCallback(() => {
    if (projectionFrameRef.current !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      projectFramesRef.current();
      return;
    }
    projectionFrameRef.current = requestAnimationFrame(() => {
      projectFramesRef.current();
    });
  }, []);

  useKeyedMountEffect(joinEffectKey(["image-project", projectFrames]), () => {
    projectFrames();
  });

  // Commit-then-relax: a re-fit commit (scale/layout/rotation change) must
  // project the frame boxes BEFORE paint — the shell motion transform is
  // computed for the settled layout, so stale boxes under it would paint one
  // mismatched frame. Scroll-driven window updates keep the deferred (rAF)
  // projection above.
  useKeyedLayoutEffect(
    joinEffectKey(["image-project-refit", layoutResetKey]),
    () => {
      projectFramesRef.current();
    },
  );

  useMountEffect(() => {
    return () => {
      if (
        projectionFrameRef.current !== null &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(projectionFrameRef.current);
      }
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
      disposeImageFrameProjectionCache(projectionCacheRef.current);
    };
  });

  const setViewportRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      viewportElementRef.current = element;
      setViewportElement(element);
      assignImageRef(viewportRef, element);
    },
    [viewportRef],
  );

  const setCanvasRef = React.useCallback((element: HTMLDivElement | null) => {
    canvasRef.current = element;
  }, []);

  const handleScroll = React.useCallback(() => {
    onScroll();
    measureVisibleFrames();
    scrollStateRef.current.isScrolling = true;

    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      scrollStateRef.current.isScrolling = false;
      scheduleProjectFrames();
    }, IMAGE_SCROLL_IDLE_MS);
  }, [measureVisibleFrames, onScroll, scheduleProjectFrames]);

  return (
    <ScrollArea
      className="min-h-0 flex-1"
      viewportRef={setViewportRef}
      viewportProps={{
        onScroll: handleScroll,
        style: { overflowAnchor: "none" },
      }}
    >
      {/* The outer clip exists for ONE state: a fit-width shell slide, where
          the kernel's counter-transform paints the stage past its committed
          box, and that visual overflow would otherwise inflate the scroller's
          scrollable area and drag a max-clamped scroll position mid-flight.
          Every other state must NOT clip: a zoomed-in stage's inline overflow
          IS the horizontal scroll range (an unconditional clip froze
          scrollWidth at the viewport width and made zoomed images
          horizontally unscrollable), and a zoom relax's enlarged opening
          frame must not be cut at the committed box. At fit-width the stage
          fits the layout width, so the active clip can never eat scrollable
          overflow. */}
      <div
        ref={frameListRef}
        className={`relative flex min-h-full w-full flex-col ${
          freezeVisibleFrameWindow && isFitWidth
            ? "overflow-clip"
            : "overflow-visible"
        }`}
        data-slot="image-viewer-fit-width-measure"
      >
        {/* The stage is a CAMERA view: a zoom step shrinks it about the
            viewport centre, so leftover space splits evenly. Auto margins do
            that and collapse to 0 once the stage overflows, keeping the scroll
            origin (and every pixel) reachable — and the fit-width motion
            resolver is handed the matching "center" margin model, since a
            mismatch there leaves the auto-margin re-centering uncompensated
            mid-slide. The BLOCK axis centres only outside fit-width: at
            fit-width a pane resize re-fits the frames, and half of that height
            delta is motion the shell transform does not model (measured as a
            4.4px hop). Zoomed, that transform is identity and the height is
            pane-independent, so the centring is inert during a slide. The flex
            column exists only to give those margins free space to split. */}
        <div
          data-slot="image-viewer-scroll-range"
          className={`relative mx-auto shrink-0 ${isFitWidth ? "" : "my-auto"}`}
          style={{
            contain: "layout size style",
            height: physicalScrollHeight,
            minWidth: documentInlineSize,
            width: documentInlineSize,
          }}
        >
          {/* Shell motion counter-transforms the document surface; a zoom
              step relaxes a FLIP on the visual clip itself. Either way the
              in-flight paint is larger than the committed box on at least one
              leg, so the clip must let go for the duration. Identity fits the
              clip again at settle, so restoring it cannot move a pixel. */}
          <div
            data-slot="image-viewer-visual-clip"
            className="absolute inset-0"
            style={{
              contain:
                freezeVisibleFrameWindow || isZoomTransitioning
                  ? "style"
                  : "paint style",
              overflow:
                freezeVisibleFrameWindow || isZoomTransitioning
                  ? "visible"
                  : "clip",
            }}
          >
            <div
              ref={documentSurfaceRef}
              className="relative"
              data-slot="image-viewer-document"
              style={{
                contain: "layout style",
                height: physicalScrollHeight,
                minWidth: documentInlineSize,
                width: documentInlineSize,
              }}
            >
              {renderedWindow ? (
                <>
                  <div
                    aria-hidden
                    data-slot="image-frame-window-before"
                    style={{
                      contain: "layout size",
                      height: renderedWindow.beforeHeight,
                    }}
                  />
                  <div
                    className="sticky"
                    data-slot="image-frame-sticky-window"
                    style={{
                      bottom: renderedWindow.stickyBottomInset,
                      contain: "layout style inline-size",
                      height: renderedWindow.height,
                      isolation: "isolate",
                      top: renderedWindow.stickyTopInset,
                    }}
                  >
                    <div
                      ref={setCanvasRef}
                      className="relative mx-auto h-full w-full"
                      data-slot="image-frame-virtual-canvas"
                      style={{
                        contain: "layout style",
                        height: renderedWindow.height,
                        minWidth: documentInlineSize,
                        width: documentInlineSize,
                      }}
                    />
                  </div>
                  <div
                    aria-hidden
                    data-slot="image-frame-window-after"
                    style={{
                      contain: "layout size",
                      height: renderedWindow.afterHeight,
                    }}
                  />
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

type ImageFrameProjectionCache = {
  clock: number;
  frames: Map<number, ProjectedImageFrame>;
  resetKey: string;
};

type ProjectedImageFrame = {
  decodedPixels: number;
  isLive: boolean;
  lastSeen: number;
  renderedPixels: number;
  renderKey: string;
  root: Root;
  shell: HTMLElement;
};

const imageProjectionSourceKeys = new WeakMap<FrameSource, number>();
const imageProjectionCallbackKeys = new WeakMap<
  ImageProjectionCallback,
  number
>();
let nextImageProjectionSourceKey = 1;
let nextImageProjectionCallbackKey = 1;

type ImageFrameRenderRequest = {
  frameNumber: number;
  pixelRatio: number;
  renderScale: number;
  rotation: QuarterTurn;
};

function useImageFrameRenderScheduler({
  frameNumbers,
  lowPriorityFrameNumbers = [],
  rasterScale,
  rotation,
  pixelRatio,
  resetKey,
  maxRunning = IMAGE_FRAME_RENDER_CONCURRENCY,
  maxLowPriorityRunning = IMAGE_LOW_PRIORITY_FRAME_RENDER_CONCURRENCY,
}: {
  frameNumbers: readonly number[];
  lowPriorityFrameNumbers?: readonly number[];
  rasterScale: number;
  rotation: QuarterTurn;
  pixelRatio: number;
  resetKey: unknown;
  maxRunning?: number;
  maxLowPriorityRunning?: number;
}) {
  const renderScale = Math.min(rasterScale * pixelRatio, 1);
  const requestedRenders = React.useMemo<ImageFrameRenderRequest[]>(
    () =>
      mergeImageFrameNumbers(frameNumbers).map((frameNumber) => ({
        frameNumber,
        pixelRatio,
        renderScale,
        rotation,
      })),
    [frameNumbers, pixelRatio, renderScale, rotation],
  );
  const lowPriorityRequestedRenders = React.useMemo<
    ImageFrameRenderRequest[]
  >(() => {
    const primaryFrameNumberSet = new Set(frameNumbers);
    return mergeImageFrameNumbers(lowPriorityFrameNumbers)
      .filter((frameNumber) => !primaryFrameNumberSet.has(frameNumber))
      .map((frameNumber) => ({
        frameNumber,
        pixelRatio,
        renderScale,
        rotation,
      }));
  }, [
    frameNumbers,
    lowPriorityFrameNumbers,
    pixelRatio,
    renderScale,
    rotation,
  ]);
  const allRequestedRenders = React.useMemo(
    () => [...requestedRenders, ...lowPriorityRequestedRenders],
    [lowPriorityRequestedRenders, requestedRenders],
  );
  const requestedRendersRef = React.useRef(allRequestedRenders);
  const resetKeyRef = React.useRef(resetKey);
  const renderContextRef = React.useRef({ rotation });
  useKeyedLayoutEffect(
    joinEffectKey([allRequestedRenders, resetKey, rotation]),
    () => {
      requestedRendersRef.current = allRequestedRenders;
      resetKeyRef.current = resetKey;
      renderContextRef.current = { rotation };
    },
  );

  const [state, setState] = React.useState<{
    renderedByKey: ReadonlyMap<string, ImageFrameRenderRequest>;
    resetKey: unknown;
  }>(() => ({ renderedByKey: new Map(), resetKey }));
  const emptyRenderedByKey = React.useMemo<
    ReadonlyMap<string, ImageFrameRenderRequest>
  >(() => new Map(), []);
  const renderedByKey = Object.is(state.resetKey, resetKey)
    ? state.renderedByKey
    : emptyRenderedByKey;

  useKeyedMountEffect(joinEffectKey([allRequestedRenders, resetKey]), () => {
    setState((previousState) => {
      if (!Object.is(previousState.resetKey, resetKey)) {
        return { renderedByKey: new Map(), resetKey };
      }

      const renderedByKey = new Map<string, ImageFrameRenderRequest>();
      for (const [key, rendered] of previousState.renderedByKey) {
        if (
          allRequestedRenders.some((request) =>
            doesRenderedImageFrameSatisfyRequest(rendered, request),
          )
        ) {
          renderedByKey.set(key, rendered);
        }
      }

      return areImageRenderMapsEqual(previousState.renderedByKey, renderedByKey)
        ? previousState
        : { renderedByKey, resetKey };
    });
  });

  const activeFrameNumbers = React.useMemo(() => {
    const renderedFrameNumbers: number[] = [];
    const pendingFrameNumbers: number[] = [];
    const lowPriorityRenderedFrameNumbers: number[] = [];
    const lowPriorityPendingFrameNumbers: number[] = [];

    for (const request of requestedRenders) {
      if (isImageRenderRequestSatisfied(request, renderedByKey)) {
        renderedFrameNumbers.push(request.frameNumber);
      } else {
        pendingFrameNumbers.push(request.frameNumber);
      }
    }
    for (const request of lowPriorityRequestedRenders) {
      if (isImageRenderRequestSatisfied(request, renderedByKey)) {
        lowPriorityRenderedFrameNumbers.push(request.frameNumber);
      } else {
        lowPriorityPendingFrameNumbers.push(request.frameNumber);
      }
    }

    const activePrimaryFrameNumbers = [
      ...renderedFrameNumbers,
      ...pendingFrameNumbers.slice(0, Math.max(1, maxRunning)),
    ];
    const activeLowPriorityFrameNumbers =
      pendingFrameNumbers.length > 0
        ? lowPriorityRenderedFrameNumbers
        : [
            ...lowPriorityRenderedFrameNumbers,
            ...lowPriorityPendingFrameNumbers.slice(
              0,
              Math.max(0, maxLowPriorityRunning),
            ),
          ];

    return mergeImageFrameNumbers([
      ...activePrimaryFrameNumbers,
      ...activeLowPriorityFrameNumbers,
    ]);
  }, [
    lowPriorityRequestedRenders,
    maxLowPriorityRunning,
    maxRunning,
    renderedByKey,
    requestedRenders,
  ]);

  const onFrameRenderTiming = React.useCallback(
    (timing: ImageFrameRenderTiming) => {
      const rendered: ImageFrameRenderRequest = {
        frameNumber: timing.frameNumber,
        pixelRatio: timing.pixelRatio,
        renderScale: timing.renderScale,
        rotation: renderContextRef.current.rotation,
      };
      const key = getImageFrameRenderKey(rendered);

      setState((previousState) => {
        const resetKey = resetKeyRef.current;
        const previousRenderedByKey = Object.is(
          previousState.resetKey,
          resetKey,
        )
          ? previousState.renderedByKey
          : new Map<string, ImageFrameRenderRequest>();
        const nextRenderedByKey = new Map(previousRenderedByKey);

        if (
          timing.status === "rendered" &&
          requestedRendersRef.current.some((request) =>
            doesRenderedImageFrameSatisfyRequest(rendered, request),
          )
        ) {
          nextRenderedByKey.set(key, rendered);
        } else {
          nextRenderedByKey.delete(key);
        }

        return areImageRenderMapsEqual(previousRenderedByKey, nextRenderedByKey)
          ? previousState
          : { renderedByKey: nextRenderedByKey, resetKey };
      });
    },
    [],
  );

  return { activeFrameNumbers, onFrameRenderTiming };
}

function mergeImageFrameNumbers(frameNumbers: readonly number[]) {
  return [...new Set(frameNumbers)].sort((left, right) => left - right);
}

function getImageFrameRenderKey({
  frameNumber,
  pixelRatio,
  renderScale,
  rotation,
}: ImageFrameRenderRequest) {
  return `${frameNumber}:${renderScale}:${rotation}:${pixelRatio}`;
}

function isImageRenderRequestSatisfied(
  request: ImageFrameRenderRequest,
  renderedByKey: ReadonlyMap<string, ImageFrameRenderRequest>,
) {
  for (const rendered of renderedByKey.values()) {
    if (doesRenderedImageFrameSatisfyRequest(rendered, request)) return true;
  }
  return false;
}

function doesRenderedImageFrameSatisfyRequest(
  rendered: ImageFrameRenderRequest,
  request: ImageFrameRenderRequest,
) {
  return (
    rendered.frameNumber === request.frameNumber &&
    rendered.renderScale === request.renderScale &&
    rendered.rotation === request.rotation &&
    rendered.pixelRatio >= request.pixelRatio
  );
}

function areImageRenderMapsEqual(
  left: ReadonlyMap<string, ImageFrameRenderRequest>,
  right: ReadonlyMap<string, ImageFrameRenderRequest>,
) {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function projectImageFrames({
  activeFrameNumbers,
  cache,
  canvas,
  layout,
  onFrameRenderTiming,
  preloadFrameNumbers,
  renderFrameOverlay,
  renderQuality,
  renderedWindow,
  renderFrameNumbers,
  resetKey,
  rotation,
  rasterScale,
  scale,
  source,
  sourceKey,
  visibleFrameNumbers,
}: {
  activeFrameNumbers: readonly number[];
  cache: ImageFrameProjectionCache;
  canvas: HTMLDivElement | null;
  layout: ImageFrameLayoutModel;
  onFrameRenderTiming?: ImageViewerProps["onFrameRenderTiming"];
  preloadFrameNumbers: readonly number[];
  renderFrameOverlay?: ImageViewerProps["renderFrameOverlay"];
  renderQuality: ImageRenderQuality;
  renderedWindow: ImageRenderedFrameWindow | null;
  renderFrameNumbers: readonly number[];
  resetKey: string;
  rotation: QuarterTurn;
  rasterScale: number;
  scale: number;
  source: FrameSource;
  sourceKey: number;
  visibleFrameNumbers: readonly number[];
}) {
  if (cache.resetKey !== resetKey) {
    disposeImageFrameProjectionCache(cache);
    cache.resetKey = resetKey;
  }
  if (!canvas || !renderedWindow) return;

  cache.clock += 1;
  const activeFrameNumberSet = new Set(activeFrameNumbers);
  const renderedFrameNumberSet = new Set(renderFrameNumbers);
  const visibleFrameNumberSet = new Set(visibleFrameNumbers);
  const activePreloadFrameNumbers = activeFrameNumbers.filter(
    (frameNumber) => !renderedFrameNumberSet.has(frameNumber),
  );
  const retainedFrameIndexes = new Set<number>();

  let previousShell: HTMLElement | null = null;
  for (const frame of renderedWindow.frames) {
    retainedFrameIndexes.add(frame.frameIndex);
    const existingFrame = cache.frames.get(frame.frameIndex);
    if (!existingFrame && !activeFrameNumberSet.has(frame.frameNumber))
      continue;
    const projectedFrame = existingFrame ?? createProjectedImageFrame(frame);
    projectedFrame.lastSeen = cache.clock;
    projectedFrame.decodedPixels = frameDecodedPixels(source, frame.frameIndex);
    projectedFrame.renderedPixels = frameRenderedPixels(frame);
    patchProjectedImageFrame({
      frame,
      isVisible: visibleFrameNumberSet.has(frame.frameNumber),
      shell: projectedFrame.shell,
    });
    if (activeFrameNumberSet.has(frame.frameNumber)) {
      // The raster is prepared for the widest shell layout before motion.
      // Sidebar toggles then change only its CSS box and the shell transform:
      // the backing store never resizes (or sharpens) inside the flight.
      renderProjectedImageFrame({
        frame,
        onFrameRenderTiming,
        projectedFrame,
        renderFrameOverlay,
        renderQuality,
        rasterScale,
        rotation,
        scale,
        source,
        sourceKey,
      });
    }
    cache.frames.set(frame.frameIndex, projectedFrame);
    placeProjectedImageFrame(canvas, projectedFrame.shell, previousShell);
    previousShell = projectedFrame.shell;
  }

  detachUnrenderedImageFrames(cache, retainedFrameIndexes);
  schedulePrefetchImageFrames({
    frameNumbers: activePreloadFrameNumbers,
    layout,
    source,
  });
  evictImageFrameProjectionCache(cache, retainedFrameIndexes);
}

function createProjectedImageFrame(
  frame: ImageRenderedFrameLayout,
): ProjectedImageFrame {
  const shell = document.createElement("div");
  shell.className = "absolute top-0 left-1/2";
  shell.dataset.slot = "image-frame-slot";
  shell.dataset.virtualFrameNumber = String(frame.frameNumber);

  return {
    decodedPixels: 0,
    isLive: true,
    lastSeen: 0,
    renderedPixels: 0,
    renderKey: "",
    root: createRoot(shell),
    shell,
  };
}

function patchProjectedImageFrame({
  frame,
  isVisible,
  shell,
}: {
  frame: ImageRenderedFrameLayout;
  isVisible: boolean;
  shell: HTMLElement;
}) {
  shell.dataset.virtualFrameNumber = String(frame.frameNumber);
  if (isVisible) {
    shell.dataset.visible = "";
  } else {
    delete shell.dataset.visible;
  }
  setImageStyle(shell, "transform", `translate(-50%, ${frame.windowTop}px)`);
  setImagePixelStyle(shell, "width", frame.width);
  setImagePixelStyle(shell, "height", frame.height);
}

function renderProjectedImageFrame({
  frame,
  onFrameRenderTiming,
  projectedFrame,
  renderFrameOverlay,
  renderQuality,
  rasterScale,
  rotation,
  scale,
  source,
  sourceKey,
}: {
  frame: ImageRenderedFrameLayout;
  onFrameRenderTiming?: ImageViewerProps["onFrameRenderTiming"];
  projectedFrame: ProjectedImageFrame;
  renderFrameOverlay?: ImageViewerProps["renderFrameOverlay"];
  renderQuality: ImageRenderQuality;
  rasterScale: number;
  rotation: QuarterTurn;
  scale: number;
  source: FrameSource;
  sourceKey: number;
}) {
  const renderKey = [
    frame.frameIndex,
    sourceKey,
    frame.width,
    frame.height,
    scale,
    rasterScale,
    rotation,
    renderQuality,
    getImageProjectionCallbackKey(renderFrameOverlay),
    getImageProjectionCallbackKey(onFrameRenderTiming),
    getImageDevicePixelRatio(),
  ].join("\u0000");

  if (projectedFrame.renderKey === renderKey) return;
  projectedFrame.renderKey = renderKey;
  projectedFrame.root.render(
    <ImageFrame
      source={source}
      frameIndex={frame.frameIndex}
      scale={scale}
      rasterScale={rasterScale}
      rotation={rotation}
      renderQuality={renderQuality}
      onFrameRenderTiming={onFrameRenderTiming}
      renderOverlay={
        renderFrameOverlay
          ? ({ frameNumber, frameRect, scale, rotation }) =>
              renderFrameOverlay({
                frameNumber,
                width: frameRect.width,
                height: frameRect.height,
                scale,
                rotation,
              })
          : undefined
      }
    />,
  );
}

function placeProjectedImageFrame(
  canvas: HTMLElement,
  shell: HTMLElement,
  previousShell: HTMLElement | null,
) {
  const nextSibling = previousShell
    ? previousShell.nextSibling
    : canvas.firstChild;
  if (shell === nextSibling) return;
  canvas.insertBefore(shell, nextSibling);
}

function detachUnrenderedImageFrames(
  cache: ImageFrameProjectionCache,
  retainedFrameIndexes: ReadonlySet<number>,
) {
  for (const [frameIndex, frame] of cache.frames) {
    if (retainedFrameIndexes.has(frameIndex)) continue;
    frame.shell.remove();
  }
}

function evictImageFrameProjectionCache(
  cache: ImageFrameProjectionCache,
  visibleFrameIndexes: ReadonlySet<number>,
) {
  let decodedPixels = 0;
  let renderedPixels = 0;

  for (const frame of cache.frames.values()) {
    decodedPixels += frame.decodedPixels;
    renderedPixels += frame.renderedPixels;
  }

  if (
    decodedPixels <= IMAGE_RETAINED_DECODED_PIXEL_BUDGET &&
    renderedPixels <= IMAGE_RETAINED_RENDERED_PIXEL_BUDGET
  ) {
    return;
  }

  const evictableFrames = [...cache.frames.entries()]
    .filter(([frameIndex]) => !visibleFrameIndexes.has(frameIndex))
    .sort(([, a], [, b]) => a.lastSeen - b.lastSeen);

  for (const [frameIndex, frame] of evictableFrames) {
    if (
      decodedPixels <= IMAGE_RETAINED_DECODED_PIXEL_BUDGET &&
      renderedPixels <= IMAGE_RETAINED_RENDERED_PIXEL_BUDGET
    ) {
      return;
    }
    decodedPixels -= frame.decodedPixels;
    renderedPixels -= frame.renderedPixels;
    disposeProjectedImageFrame(frame);
    cache.frames.delete(frameIndex);
  }
}

type ImageFramePrefetchInput = {
  frameNumbers: readonly number[];
  layout: ImageFrameLayoutModel;
  source: FrameSource;
};

function schedulePrefetchImageFrames(input: ImageFramePrefetchInput) {
  if (input.frameNumbers.length === 0) return;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => prefetchImageFrames(input));
    return;
  }
  window.setTimeout(() => prefetchImageFrames(input), 0);
}

function prefetchImageFrames({
  frameNumbers,
  layout,
  source,
}: ImageFramePrefetchInput) {
  if (frameNumbers.length === 0) return;
  source.prefetch(
    frameNumbers.flatMap((frameNumber) => {
      const frame = getImageFrameLayout(layout, frameNumber);
      return frame ? [frame.frameIndex] : [];
    }),
  );
}

function frameDecodedPixels(source: FrameSource, frameIndex: number) {
  const size = source.frames[frameIndex]?.intrinsicSize;
  return size ? size.width * size.height : 0;
}

function frameRenderedPixels(frame: ImageFrameLayout) {
  const dpr = getImageDevicePixelRatio();
  return (
    Math.max(1, Math.floor(frame.width * dpr)) *
    Math.max(1, Math.floor(frame.height * dpr))
  );
}

function disposeImageFrameProjectionCache(cache: ImageFrameProjectionCache) {
  for (const projectedFrame of cache.frames.values()) {
    disposeProjectedImageFrame(projectedFrame);
  }
  cache.frames.clear();
}

function disposeProjectedImageFrame(projectedFrame: ProjectedImageFrame) {
  if (!projectedFrame.isLive) return;
  projectedFrame.isLive = false;
  deferImageRootUnmount(projectedFrame.root);
  projectedFrame.shell.remove();
}

function deferImageRootUnmount(root: Root) {
  const unmount = () => root.unmount();
  if (typeof queueMicrotask === "function") {
    queueMicrotask(unmount);
    return;
  }
  window.setTimeout(unmount, 0);
}

function getImageProjectionSourceKey(source: FrameSource) {
  const cached = imageProjectionSourceKeys.get(source);
  if (cached) return cached;
  const key = nextImageProjectionSourceKey;
  nextImageProjectionSourceKey += 1;
  imageProjectionSourceKeys.set(source, key);
  return key;
}

function getImageProjectionCallbackKey(
  callback: ImageProjectionCallback | undefined,
) {
  if (!callback) return 0;
  const cached = imageProjectionCallbackKeys.get(callback);
  if (cached) return cached;
  const key = nextImageProjectionCallbackKey;
  nextImageProjectionCallbackKey += 1;
  imageProjectionCallbackKeys.set(callback, key);
  return key;
}

function resizeImageCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  { preserve }: { preserve: boolean },
) {
  if (canvas.width === width && canvas.height === height) return null;
  const shouldPreserve =
    preserve && canvas.dataset.imageFrameRendered === "true";
  const previousCanvas =
    shouldPreserve && canvas.width > 0 && canvas.height > 0
      ? copyCanvasContents(canvas)
      : null;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return previousCanvas;
}

function copyCanvasContents(canvas: HTMLCanvasElement) {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(canvas, 0, 0);
  } catch {
    return null;
  }
  return copy;
}

function preserveCanvasImage(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
) {
  try {
    context.drawImage(source, 0, 0, width, height);
  } catch {
    /* Best-effort preservation must not fail the real frame render. */
  }
}

function getImageDevicePixelRatio() {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

function setImagePixelStyle(
  element: HTMLElement,
  property: "height" | "width",
  value: number,
) {
  setImageStyle(element, property, `${value}px`);
}

function setImageStyle(
  element: HTMLElement,
  property: "height" | "transform" | "width",
  value: string,
) {
  if (element.style.getPropertyValue(property) === value) return;
  element.style.setProperty(property, value);
}

function assignImageRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  ref.current = value;
}

function notifyImageFrameRenderTiming(
  callback: ((timing: ImageFrameRenderTiming) => void) | undefined,
  timing: ImageFrameRenderTiming,
) {
  try {
    callback?.(timing);
  } catch {
    /* Instrumentation callbacks must not affect frame rendering. */
  }
}

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
