"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { joinEffectKey } from "@/lib/effect-key";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  createViewerResource,
  type ViewerResource,
} from "@/lib/viewer-resource";

import { getPptxFitScale, getPptxResetKey } from "./pptx-viewer-core";
import {
  FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
  readFileViewerBeforeLayoutMotionFrame,
} from "./file-viewer-elements";
import {
  captureFileViewerFitWidthAnchorScreenOffset,
  createFileViewerFitWidthSurfaceMotionResolver,
  FILE_VIEWER_FIT_WIDTH_ANCHOR_BLOCK_PROPERTY,
  resolveFileViewerFitWidthMotionAnchorBlock,
} from "./file-viewer-fit-width-motion";
import type { FileViewerDocumentSurfaceMotionResolver } from "./file-viewer-motion-kernel";
import type { FileViewerMotionFrame } from "./file-viewer-motion-plan";
import { resolveFileViewerRendererLayoutInlineSize } from "./file-viewer-renderer-contract";
import {
  useOptionalFileViewerRendererEnvironment,
  useOptionalFileViewerRendererFrame,
} from "./file-viewer-renderer-frame";
import { useReadingFractionRebase } from "./use-reading-fraction-rebase";
import { PptxViewerFallback } from "./pptx-viewer-fallback";
import { useRetainedPptxSource } from "./pptx-viewer-hooks";
import { preloadPptxRenderer } from "./pptx-viewer-renderer";
import { createPptxScrollActivity } from "./pptx-viewer-scroll";
import {
  PPTX_SLIDE_GAP,
  PPTX_SLIDE_PADDING,
  PptxSlideScroller,
} from "./pptx-viewer-slide";
import { evictPptxSource } from "./pptx-viewer-source";
import type { PptxViewerProps } from "./pptx-viewer-types";
import { usePptxViewportWidth } from "./pptx-viewer-viewport";
import {
  createPptxSlideLayout,
  getPptxSlideAtScrollMarker,
  getPptxSlideTop,
  PPTX_READING_MARKER_RATIO,
  usePptxVisibleSlide,
} from "./pptx-viewer-visible-slide";
import { usePptxZoom } from "./pptx-viewer-zoom";
import {
  createPptxZoomMotionController,
  PPTX_ZOOM_MOTION_TOTAL_MS,
} from "./pptx-viewer-zoom-motion";
import { useIsClient } from "./use-is-client";
import { ViewerControls } from "./viewer-controls";
import { ViewerErrorBoundary } from "./viewer-error";

export type { PptxDocumentSource, PptxViewerProps } from "./pptx-viewer-types";
export type {
  PptxSourceLoadTiming,
  PptxSlideRenderTiming,
  PptxSlideOverlayProps,
} from "./pptx-viewer-core";

export function preloadPptxViewer() {
  preloadPptxRenderer();
}

export type PptxResourceContentProps = Omit<PptxViewerProps, "source"> & {
  resource: ViewerResource;
};

export function PptxViewer(props: PptxViewerProps) {
  const { source, ...resourceProps } = props;
  const resource = React.useMemo(() => createViewerResource(source), [source]);
  return <PptxResourceContent {...resourceProps} resource={resource} />;
}

export function PptxResourceContent(props: PptxResourceContentProps) {
  const isClient = useIsClient();
  const resource = props.resource;

  if (!isClient) {
    return (
      <PptxViewerFallback
        className={props.className}
        bare={props.bare}
        fallbackSlideSize={props.fallbackSlideSize}
        controls={props.controls}
      />
    );
  }
  return (
    <ViewerErrorBoundary
      className={props.className}
      bare={props.bare}
      download={
        props.controls === false || props.download === false
          ? null
          : resource.originalDownload
      }
      format="pptx"
      resetKey={getPptxResetKey({
        resourceKey: resource.keys.resource,
        scale: props.scale,
        defaultScale: props.defaultScale,
        eager: props.eager ?? false,
      })}
      sourceKind={resource.sourceKind}
      onRetry={() => evictPptxSource(resource.content)}
    >
      <React.Suspense
        fallback={
          <PptxViewerFallback
            className={props.className}
            bare={props.bare}
            fallbackSlideSize={props.fallbackSlideSize}
            controls={props.controls}
          />
        }
      >
        <PptxViewerContent
          key={resource.keys.load}
          {...props}
          resource={resource}
        />
      </React.Suspense>
    </ViewerErrorBoundary>
  );
}

function PptxViewerContent({
  resource,
  className,
  scale: controlledScale,
  defaultScale,
  download = true,
  onScaleChange,
  controls = true,
  renderSlideOverlay,
  onSlideRenderTiming,
  onSourceLoadTiming,
  onVisibleSlideChange,
  onScrollProgressChange,
  bare = false,
  eager = false,
}: Omit<PptxViewerProps, "source"> & { resource: ViewerResource }) {
  const source = useRetainedPptxSource(resource.content, onSourceLoadTiming);
  const downloadAction = download ? resource.originalDownload : null;

  const [rotation, setRotation] = React.useState(0);
  const scrollActivity = React.useMemo(() => createPptxScrollActivity(), []);
  const { registerDocumentSurface, usesShellGeometry } =
    useOptionalFileViewerRendererEnvironment();
  const { containerRef, viewportWidth } = usePptxViewportWidth({
    enabled: !usesShellGeometry,
  });
  const rendererFrame = useOptionalFileViewerRendererFrame({
    fallbackInlineSize: viewportWidth,
  });
  const layoutInlineSize = resolveFileViewerRendererLayoutInlineSize({
    fallbackInlineSize: viewportWidth,
    rendererFrame,
  });
  const fitScale = getPptxFitScale(layoutInlineSize, source.baseSize.width);
  const { isFitWidth, scaleControlsDisabled, setViewerScale, zoomScale } =
    usePptxZoom({
      controlledScale,
      defaultScale,
      fitScale,
      onScaleChange,
    });
  const slideLayout = React.useMemo(
    () =>
      createPptxSlideLayout({
        baseSize: source.baseSize,
        zoomScale,
        rotation,
        slideCount: source.slideCount,
        slideGap: PPTX_SLIDE_GAP,
        slidePadding: PPTX_SLIDE_PADDING,
      }),
    [source.baseSize, source.slideCount, zoomScale, rotation],
  );
  const zoomMotion = React.useMemo(
    () => createPptxZoomMotionController(slideLayout),
    [slideLayout],
  );
  const {
    captureZoomIntent,
    currentSlide,
    getScrollMetrics,
    handleScroll,
    scrollViewportRef,
  } = usePptxVisibleSlide({
    layout: slideLayout,
    onScrollProgressChange,
    onVisibleSlideChange,
    zoomMotion,
  });
  const isDocumentTransitioning = rendererFrame.phase !== "idle";
  // Toolbar zoom steps re-anchor the viewport center and relax a FLIP over
  // the commit (pptx-viewer-zoom-motion). The sequence must flip in the zoom
  // gesture's own render so the visual clip is already released when the
  // enlarged opening frame paints; rapid steps re-arm the release timer.
  const [zoomMotionSequence, setZoomMotionSequence] = React.useState(0);
  const isZoomTransitioning = zoomMotionSequence > 0;
  useKeyedMountEffect(joinEffectKey([zoomMotionSequence]), () => {
    if (zoomMotionSequence === 0) return;
    const timeout = setTimeout(
      () => setZoomMotionSequence(0),
      PPTX_ZOOM_MOTION_TOTAL_MS,
    );
    return () => clearTimeout(timeout);
  });
  const beginZoomMotion = React.useCallback(() => {
    // A zoom step mid shell-slide keeps the shell's own anchor solve in
    // charge; the centered relax only owns quiet-state zooms.
    if (isDocumentTransitioning) return;
    captureZoomIntent();
    setZoomMotionSequence((sequence) => sequence + 1);
  }, [captureZoomIntent, isDocumentTransitioning]);
  // Preserve the reading position when the slide surface re-fits to a new width
  // (the sidebar toggle). The fit-driven zoom scale is the layout key. A
  // toolbar zoom step must NOT take this path: its layout commit already
  // restored the viewport-CENTER anchor (pptx-viewer-zoom-motion), and the
  // fraction restore would overwrite that scroll in the same commit. The
  // sequence flips in the zoom gesture's own render, so the zoom's re-fit
  // lands with the rebase disabled while the key still advances.
  const { captureReadingFraction } = useReadingFractionRebase({
    scrollerRef: scrollViewportRef,
    layoutKey: zoomScale,
    enabled: usesShellGeometry && !isZoomTransitioning,
  });
  const scrollInteractionRestoreRef = React.useRef<number | null>(null);
  const scrollInteractionElementRef = React.useRef<HTMLElement | null>(null);
  const documentSurfaceRef = React.useRef<HTMLDivElement | null>(null);
  const [documentSurfaceElement, setDocumentSurfaceElementState] =
    React.useState<HTMLDivElement | null>(null);
  const resolveSurfaceMotionStyle =
    React.useMemo<FileViewerDocumentSurfaceMotionResolver>(
      () =>
        createFileViewerFitWidthSurfaceMotionResolver({
          // The slide surface centres with auto margins whatever the renderer
          // frame's align is (a zoomed-out deck splits its leftover space
          // evenly), so the margin model must say "center" too — modelling
          // "start" over an mx-auto surface leaves the auto-margin
          // re-centering uncompensated mid-slide.
          align: "center",
          direction: rendererFrame.direction,
          isFitWidth,
          stageInlineSize: slideLayout.slideWidth,
        }),
      [isFitWidth, rendererFrame.direction, slideLayout.slideWidth],
    );
  const preMotionAnchorRef = React.useRef<{
    screenRelTop: number;
    slideNumber: number;
  } | null>(null);
  const lastAnchorBlockRef = React.useRef<number | null>(null);
  const writePptxAnchorBlockOffsetPx = React.useCallback(
    (anchorBlock: number) => {
      const element = documentSurfaceRef.current;
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
  const writePptxDocumentAnchorBlockOffset = React.useCallback(() => {
    const metrics = getScrollMetrics();
    // Stage (physical) coordinates: the transform scales the stage, so the
    // marker offset is anchored to the live DOM scroll position.
    writePptxAnchorBlockOffsetPx(
      Math.max(0, metrics.physicalScrollTop) +
        Math.max(0, metrics.viewportHeight) * PPTX_READING_MARKER_RATIO,
    );
  }, [getScrollMetrics, writePptxAnchorBlockOffsetPx]);
  // The transform must pin the exact screen line the slide-start commit
  // preserved. Measured against the slide layout models (old model at
  // capture, new model at solve), which is exact across the constant slide
  // gap and padding, rebase clamps, and mid-flight retargets (the capture
  // applies the in-flight transform it was seen under).
  const writePptxMotionAnchorBlockOffset = React.useCallback(() => {
    const metrics = getScrollMetrics();
    // Slide offsets are logical; map through the paged-scroll delta into the
    // stage's physical coordinates (the space the transform scales).
    const logicalDelta = metrics.scrollTop - metrics.physicalScrollTop;
    const preMotionAnchor = preMotionAnchorRef.current;
    const anchorBlock = preMotionAnchor
      ? resolveFileViewerFitWidthMotionAnchorBlock({
          fromInlineSize: rendererFrame.fromInlineSize,
          probeScreenOffset: preMotionAnchor.screenRelTop,
          probeStageOffset:
            getPptxSlideTop(slideLayout, preMotionAnchor.slideNumber - 1) -
            logicalDelta,
          scrollTop: metrics.physicalScrollTop,
          stageInlineSize: slideLayout.slideWidth,
          toInlineSize: rendererFrame.toInlineSize,
        })
      : null;

    if (anchorBlock == null) {
      writePptxDocumentAnchorBlockOffset();
      return;
    }
    writePptxAnchorBlockOffsetPx(anchorBlock);
  }, [
    getScrollMetrics,
    rendererFrame.fromInlineSize,
    rendererFrame.toInlineSize,
    slideLayout,
    writePptxAnchorBlockOffsetPx,
    writePptxDocumentAnchorBlockOffset,
  ]);

  const suspendScrollInteractions = React.useCallback(() => {
    const scrollElement = scrollViewportRef.current?.querySelector<HTMLElement>(
      '[data-slot="pptx-slide-sticky-window"]',
    );
    if (!scrollElement) return;

    if (scrollInteractionRestoreRef.current !== null) {
      window.clearTimeout(scrollInteractionRestoreRef.current);
    }
    scrollInteractionElementRef.current = scrollElement;
    scrollElement.style.pointerEvents = "none";
    if (isMobileSafari()) {
      scrollElement.style.overflowX = "hidden";
    }
    scrollInteractionRestoreRef.current = window.setTimeout(() => {
      scrollInteractionRestoreRef.current = null;
      restorePptxScrollInteractions(scrollInteractionElementRef.current);
      scrollInteractionElementRef.current = null;
    }, 120);
  }, [scrollViewportRef]);

  useMountEffect(() => () => {
    if (scrollInteractionRestoreRef.current !== null) {
      window.clearTimeout(scrollInteractionRestoreRef.current);
      scrollInteractionRestoreRef.current = null;
    }
    restorePptxScrollInteractions(scrollInteractionElementRef.current);
    scrollInteractionElementRef.current = null;
  });

  const handleViewportScroll = React.useCallback(() => {
    captureReadingFraction();
    scrollActivity.handleScroll();
    suspendScrollInteractions();
    handleScroll();
  }, [
    captureReadingFraction,
    handleScroll,
    scrollActivity,
    suspendScrollInteractions,
  ]);
  // Held through the whole motion (see isDocumentTransitioning above): layout
  // and scroll commit at slide start (commit-then-relax), but the union in
  // the scroller still keeps the pre-motion slides mounted until the motion
  // idles as re-render insurance.
  const measureBeforeLayoutMotionRef = React.useRef(
    (_liveFrame: FileViewerMotionFrame | null) => {},
  );
  measureBeforeLayoutMotionRef.current = (liveFrame) => {
    const metrics = getScrollMetrics();
    const logicalDelta = metrics.scrollTop - metrics.physicalScrollTop;
    const slideNumber = getPptxSlideAtScrollMarker(
      slideLayout,
      Math.max(0, metrics.scrollTop) +
        Math.max(0, metrics.viewportHeight) * PPTX_READING_MARKER_RATIO,
    );
    preMotionAnchorRef.current = {
      screenRelTop: captureFileViewerFitWidthAnchorScreenOffset({
        lastAnchorBlock: lastAnchorBlockRef.current,
        liveFrame,
        probeStageOffset:
          getPptxSlideTop(slideLayout, slideNumber - 1) - logicalDelta,
        scrollTop: metrics.physicalScrollTop,
        stageInlineSize: slideLayout.slideWidth,
      }),
      slideNumber,
    };
    handleScroll();
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
  const isPptxShellTransitioning = rendererFrame.isTransitioning;
  const writePptxMotionAnchorBlockOffsetRef = React.useRef(
    writePptxMotionAnchorBlockOffset,
  );
  writePptxMotionAnchorBlockOffsetRef.current =
    writePptxMotionAnchorBlockOffset;
  useKeyedLayoutEffect(
    joinEffectKey([
      "pptx-motion-anchor",
      isPptxShellTransitioning,
      rendererFrame.documentTransition.transitionId,
      writePptxMotionAnchorBlockOffset,
    ]),
    () => {
      if (!isPptxShellTransitioning) return;
      writePptxMotionAnchorBlockOffsetRef.current();
    },
  );
  const setDocumentSurfaceElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      const previousElement = documentSurfaceRef.current;
      if (previousElement === element) return;
      previousElement?.removeEventListener(
        FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
        handleBeforeLayoutMotion,
      );
      documentSurfaceRef.current = element;
      setDocumentSurfaceElementState((previous) =>
        previous === element ? previous : element,
      );
      if (!element) return;
      element.addEventListener(
        FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
        handleBeforeLayoutMotion,
      );
      writePptxDocumentAnchorBlockOffset();
    },
    [handleBeforeLayoutMotion, writePptxDocumentAnchorBlockOffset],
  );
  const documentSurfaceKey = documentSurfaceElement
    ? joinEffectKey([
        "pptx-document-surface",
        documentSurfaceElement,
        registerDocumentSurface,
        resolveSurfaceMotionStyle,
      ])
    : null;
  useKeyedLayoutEffect(documentSurfaceKey, () => {
    if (!documentSurfaceElement) return;
    return registerDocumentSurface({
      element: documentSurfaceElement,
      resolveMotionStyle: resolveSurfaceMotionStyle,
    });
  });

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        bare ? "bg-muted/20 h-full" : "bg-muted/30 rounded-xl border",
        className,
      )}
      data-slot="pptx-viewer"
    >
      {controls ? (
        <ViewerControls
          position={{
            kind: "slide",
            current: currentSlide,
            total: source.slideCount,
          }}
          zoom={{
            scale: zoomScale,
            onZoomOut: () => {
              beginZoomMotion();
              setViewerScale(zoomScale / 1.2);
            },
            onZoomIn: () => {
              beginZoomMotion();
              setViewerScale(zoomScale * 1.2);
            },
            onFit: () => {
              beginZoomMotion();
              setViewerScale(null);
            },
            isDisabled: scaleControlsDisabled,
          }}
          rotate={{
            onRotate: () => setRotation((value) => (value + 90) % 360),
          }}
          downloads={downloadAction ? [downloadAction] : []}
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <PptxSlideScroller
              source={source}
              zoomScale={zoomScale}
              rotation={rotation}
              layout={slideLayout}
              eager={eager}
              activity={scrollActivity}
              renderSlideOverlay={renderSlideOverlay}
              onSlideRenderTiming={onSlideRenderTiming}
              containerRef={containerRef}
              documentSurfaceRef={setDocumentSurfaceElement}
              viewportRef={scrollViewportRef}
              getScrollMetrics={getScrollMetrics}
              isFitWidth={isFitWidth}
              isTransitioning={isDocumentTransitioning}
              onScroll={handleViewportScroll}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function restorePptxScrollInteractions(element: HTMLElement | null) {
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
