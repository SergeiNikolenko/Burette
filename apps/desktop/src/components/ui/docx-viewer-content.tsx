"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { getDocxDocumentResource } from "@/lib/docx-document-resource";
import { isAbortError, isResourceError } from "@/lib/viewer-errors";
import { ScrollArea } from "@/components/ui/scroll-area";

import { cn } from "@/lib/utils";

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
import {
  DocxSkeleton,
  DocxViewerBody,
  DocxViewerFrame,
} from "./docx-viewer-chrome";
import { DOCX_SCOPED_STYLES, toDocxFormatError } from "./docx-viewer-core";
import { useDocxHighlight } from "./docx-viewer-highlight";
import {
  createDocxPageWindowForPage,
  createDocxPageWindowFromScroll,
  DOCX_READING_MARKER_RATIO,
  DOCX_VIEWER_PADDING_PX,
  findDocxPageByMarker,
  type DocxPageLayout,
} from "./docx-viewer-layout";
import {
  commitDocxRender,
  projectDocxPages,
  loadDocxPreview,
  renderCachedDocxPreview,
  type DocxRenderedDocument,
} from "./docx-viewer-render";
import {
  DOCX_STAGE_INLINE_PADDING_PX,
  useDocxViewerScale,
} from "./docx-viewer-scale";
import { useDocxViewerScroll } from "./docx-viewer-scroll";
import { createDocxZoomMotionController } from "./docx-viewer-zoom-motion";
import {
  buildDocxRenderIndex,
  resolveDocxTargetHit,
  type DocxRenderIndex,
} from "./docx-viewer-targets";
import type {
  DocxResourceContentProps,
  DocxViewerHandle,
} from "./docx-viewer-types";
import {
  useViewerControlsRegistration,
  ViewerControls,
  ViewerControlsSkeleton,
  type ViewerControlsState,
} from "./viewer-controls";
import { joinEffectKey } from "@/lib/effect-key";

const DOCX_TRANSITION_WINDOW_RELEASE_MS = 260;

export function DocxViewerContent({
  bare = false,
  className,
  defaultScale,
  download = true,
  forwardedRef,
  highlight,
  onScaleChange,
  onScrollProgressChange,
  onVisiblePageChange,
  resource,
  scale: controlledScale,
  controls = true,
}: DocxResourceContentProps & {
  forwardedRef?: React.ForwardedRef<DocxViewerHandle>;
}) {
  const docxPreviewPromise = loadDocxPreview();
  void docxPreviewPromise.catch(() => undefined);
  const buffer = React.use(
    getDocxDocumentResource(resource.content, { retainRejected: true }),
  );
  const renderCacheKey = resource.content.key;
  const { registerDocumentSurface, usesShellGeometry } =
    useOptionalFileViewerRendererEnvironment();
  const { containerRef, containerWidth } = useMeasuredDocxContainerInlineSize({
    enabled: !usesShellGeometry,
  });
  const rendererFrame = useOptionalFileViewerRendererFrame({
    fallbackInlineSize: containerWidth,
  });
  const layoutInlineSize = resolveFileViewerRendererLayoutInlineSize({
    fallbackInlineSize: containerWidth,
    rendererFrame,
  });
  const [numPages, setNumPages] = React.useState(0);
  const [pageWidth, setPageWidth] = React.useState<number | null>(null);
  const [renderIndex, setRenderIndex] = React.useState<DocxRenderIndex | null>(
    null,
  );
  const [pageLayout, setPageLayout] = React.useState<DocxPageLayout | null>(
    null,
  );
  const [ready, setReady] = React.useState(false);
  const [renderError, setRenderError] = React.useState<Error | null>(null);
  if (renderError) throw renderError;

  const { fitWidth, isFitWidth, scale, zoomIn, zoomOut } = useDocxViewerScale({
    defaultScale,
    layoutInlineSize,
    onScaleChange,
    pageWidth,
    resetKey: resource.keys.resource,
    scale: controlledScale,
  });
  const zoomMotion = React.useMemo(
    () => createDocxZoomMotionController({ layout: pageLayout, scale }),
    [pageLayout, scale],
  );
  const {
    captureZoomIntent,
    currentPage,
    handleScroll,
    measureScroll,
    resetScroll,
    scrollViewportRef,
  } = useDocxViewerScroll({
    layoutKey: scale,
    pageLayout,
    onScrollProgressChange,
    onVisiblePageChange,
    ready,
    scale,
    zoomMotion,
  });
  const isDocumentTransitioning = rendererFrame.phase !== "idle";
  const beginZoomMotion = React.useCallback(() => {
    // A zoom step mid shell-slide keeps the shell's own anchor solve in
    // charge; the centered relax only owns quiet-state zooms.
    if (isDocumentTransitioning) return;
    captureZoomIntent();
  }, [captureZoomIntent, isDocumentTransitioning]);
  const zoomInCentered = React.useCallback(() => {
    beginZoomMotion();
    zoomIn();
  }, [beginZoomMotion, zoomIn]);
  const zoomOutCentered = React.useCallback(() => {
    beginZoomMotion();
    zoomOut();
  }, [beginZoomMotion, zoomOut]);
  const fitWidthCentered = React.useCallback(() => {
    beginZoomMotion();
    fitWidth();
  }, [beginZoomMotion, fitWidth]);
  const scaleRef = React.useRef(scale);
  scaleRef.current = scale;

  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const renderIndexRef = React.useRef<DocxRenderIndex | null>(null);
  const virtualDocumentRef = React.useRef<DocxRenderedDocument | null>(null);
  const projectVisiblePagesRef = React.useRef<() => void>(() => {});
  const measureScrollRef = React.useRef(measureScroll);
  measureScrollRef.current = measureScroll;
  const transitionWindowReleaseTimerRef = React.useRef<number | null>(null);
  const shouldReleaseTransitionProjectionRef = React.useRef(false);
  const projectVisiblePages = React.useCallback(() => {
    const virtualDocument = virtualDocumentRef.current;
    const viewport = scrollViewportRef.current;
    if (!virtualDocument || !viewport) return;
    projectDocxPages(
      virtualDocument,
      createDocxPageWindowFromScroll({
        layout: virtualDocument.pageLayout,
        scale: scaleRef.current,
        scrollTop: viewport.scrollTop,
        viewportHeight: viewport.clientHeight,
      }),
    );
  }, [scrollViewportRef]);
  useKeyedLayoutEffect(joinEffectKey([projectVisiblePages]), () => {
    projectVisiblePagesRef.current = projectVisiblePages;
  });
  const clearTransitionWindowReleaseTimer = React.useCallback(() => {
    if (transitionWindowReleaseTimerRef.current === null) return;
    window.clearTimeout(transitionWindowReleaseTimerRef.current);
    transitionWindowReleaseTimerRef.current = null;
  }, []);
  const projectTargetPage = React.useCallback(
    (pageNumber: number) => {
      const virtualDocument = virtualDocumentRef.current;
      const viewport = scrollViewportRef.current;
      if (!virtualDocument || !viewport) return;
      projectDocxPages(
        virtualDocument,
        createDocxPageWindowForPage({
          layout: virtualDocument.pageLayout,
          pageIndex: pageNumber - 1,
          scale: scaleRef.current,
          viewportHeight: viewport.clientHeight,
        }),
      );
    },
    [scrollViewportRef],
  );
  const handleViewportScroll = React.useCallback(() => {
    if (!isDocumentTransitioning) projectVisiblePages();
    handleScroll();
  }, [handleScroll, isDocumentTransitioning, projectVisiblePages]);
  // The settled stage box (page + its own p-4 padding). In fit-width this is
  // exactly the layout width, so the fit-width resolver's affine unit-slope
  // reprojection hides the slide-start re-fit behind one uniform transform.
  const stageInlineSize =
    pageWidth != null ? pageWidth * scale + DOCX_STAGE_INLINE_PADDING_PX : null;
  const resolveSurfaceMotionStyle =
    React.useMemo<FileViewerDocumentSurfaceMotionResolver>(
      () =>
        createFileViewerFitWidthSurfaceMotionResolver({
          // The stage centres with auto margins whatever the renderer frame's
          // align is (a zoomed-out document splits its leftover space evenly),
          // so the margin model must say "center" too.
          align: "center",
          direction: rendererFrame.direction,
          isFitWidth,
          stageInlineSize: stageInlineSize ?? 0,
          stageInlinePadding: DOCX_STAGE_INLINE_PADDING_PX,
        }),
      [isFitWidth, rendererFrame.direction, stageInlineSize],
    );
  const documentSurfaceRef = React.useRef<HTMLDivElement | null>(null);
  const [documentSurfaceElement, setDocumentSurfaceElementState] =
    React.useState<HTMLDivElement | null>(null);
  const preMotionAnchorRef = React.useRef<{
    pageNumber: number;
    screenRelTop: number;
  } | null>(null);
  const lastAnchorBlockRef = React.useRef<number | null>(null);
  const writeDocxAnchorBlockOffsetPx = React.useCallback(
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
  const writeDocxDocumentAnchorBlockOffset = React.useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    writeDocxAnchorBlockOffsetPx(
      Math.max(0, viewport.scrollTop) +
        Math.max(0, viewport.clientHeight) * DOCX_READING_MARKER_RATIO,
    );
  }, [scrollViewportRef, writeDocxAnchorBlockOffsetPx]);
  // The transform must pin the exact screen line the slide-start commit
  // preserved. Measured against the page layout models (intrinsic page tops ×
  // the old scale at capture, × the new scale at solve), which is exact
  // across the constant page gap and padding, rebase clamps, and mid-flight
  // retargets (the capture applies the in-flight transform it was seen under).
  const writeDocxMotionAnchorBlockOffset = React.useCallback(() => {
    const viewport = scrollViewportRef.current;
    const preMotionAnchor = preMotionAnchorRef.current;
    const page =
      preMotionAnchor && pageLayout
        ? (pageLayout.pages[preMotionAnchor.pageNumber - 1] ?? null)
        : null;
    const anchorBlock =
      viewport && preMotionAnchor && page && stageInlineSize != null
        ? resolveFileViewerFitWidthMotionAnchorBlock({
            fromInlineSize: rendererFrame.fromInlineSize,
            probeScreenOffset: preMotionAnchor.screenRelTop,
            probeStageOffset: DOCX_VIEWER_PADDING_PX + page.top * scale,
            scrollTop: viewport.scrollTop,
            stageInlineSize,
            stageInlinePadding: DOCX_STAGE_INLINE_PADDING_PX,
            toInlineSize: rendererFrame.toInlineSize,
          })
        : null;

    if (anchorBlock == null) {
      writeDocxDocumentAnchorBlockOffset();
      return;
    }
    writeDocxAnchorBlockOffsetPx(anchorBlock);
  }, [
    pageLayout,
    rendererFrame.fromInlineSize,
    rendererFrame.toInlineSize,
    scale,
    scrollViewportRef,
    stageInlineSize,
    writeDocxAnchorBlockOffsetPx,
    writeDocxDocumentAnchorBlockOffset,
  ]);
  const measureBeforeLayoutMotionRef = React.useRef(
    (_liveFrame: FileViewerMotionFrame | null) => {},
  );
  measureBeforeLayoutMotionRef.current = (liveFrame) => {
    const viewport = scrollViewportRef.current;
    const page =
      viewport && pageLayout
        ? findDocxPageByMarker({
            layout: pageLayout,
            scale,
            scrollTop: viewport.scrollTop,
            viewportHeight: viewport.clientHeight,
          })
        : null;
    preMotionAnchorRef.current =
      viewport && page && stageInlineSize != null
        ? {
            pageNumber: page.pageNumber,
            screenRelTop: captureFileViewerFitWidthAnchorScreenOffset({
              lastAnchorBlock: lastAnchorBlockRef.current,
              liveFrame,
              probeStageOffset: DOCX_VIEWER_PADDING_PX + page.top * scale,
              scrollTop: viewport.scrollTop,
              stageInlineSize,
              stageInlinePadding: DOCX_STAGE_INLINE_PADDING_PX,
            }),
          }
        : null;
    measureScroll();
  };
  const handleBeforeLayoutMotion = React.useCallback((event: Event) => {
    measureBeforeLayoutMotionRef.current(
      readFileViewerBeforeLayoutMotionFrame(event),
    );
  }, []);
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
      writeDocxDocumentAnchorBlockOffset();
    },
    [handleBeforeLayoutMotion, writeDocxDocumentAnchorBlockOffset],
  );
  const motionProbePageNumberRef = React.useRef(currentPage);
  motionProbePageNumberRef.current = currentPage;
  const getDocxMotionProbeElement = React.useCallback(() => {
    const surface = documentSurfaceRef.current;
    if (!surface) return null;
    const pageNumber =
      preMotionAnchorRef.current?.pageNumber ??
      motionProbePageNumberRef.current;
    return (
      surface.querySelector<HTMLElement>(
        `.docx-wrapper > section.docx[data-page-number="${pageNumber}"]`,
      ) ?? surface.querySelector<HTMLElement>(".docx-wrapper > section.docx")
    );
  }, []);
  const documentSurfaceKey = documentSurfaceElement
    ? joinEffectKey([
        "docx-document-surface",
        documentSurfaceElement,
        registerDocumentSurface,
        resolveSurfaceMotionStyle,
      ])
    : null;
  useKeyedLayoutEffect(documentSurfaceKey, () => {
    if (!documentSurfaceElement) return;
    return registerDocumentSurface({
      element: documentSurfaceElement,
      getMotionProbeElement: getDocxMotionProbeElement,
      resolveMotionStyle: resolveSurfaceMotionStyle,
    });
  });
  // Runs inside the slide-start commit after useDocxViewerScroll's layout
  // effect has restored the reading anchor onto the target layout, pinning
  // the transform before the first frame paints. Keyed on the transition id
  // so a mid-flight retarget (same isTransitioning) re-solves against the
  // new motion.
  useKeyedLayoutEffect(
    joinEffectKey([
      "docx-anchor-rebase",
      rendererFrame.documentTransition.transitionId,
      rendererFrame.isTransitioning,
      writeDocxMotionAnchorBlockOffset,
    ]),
    () => {
      if (!rendererFrame.isTransitioning) return;
      writeDocxMotionAnchorBlockOffset();
    },
  );

  useKeyedLayoutEffect(
    joinEffectKey(["docx-transition", isDocumentTransitioning, ready]),
    () => {
      clearTransitionWindowReleaseTimer();
      if (!ready) return;

      if (isDocumentTransitioning) {
        shouldReleaseTransitionProjectionRef.current = true;
        return;
      }

      if (!shouldReleaseTransitionProjectionRef.current) return;
      transitionWindowReleaseTimerRef.current = window.setTimeout(() => {
        transitionWindowReleaseTimerRef.current = null;
        shouldReleaseTransitionProjectionRef.current = false;
        projectVisiblePagesRef.current();
        measureScrollRef.current();
      }, DOCX_TRANSITION_WINDOW_RELEASE_MS);
    },
  );

  useKeyedMountEffect(
    joinEffectKey([
      "docx-render",
      buffer,
      docxPreviewPromise,
      renderCacheKey,
      resetScroll,
    ]),
    () => {
      const host = hostRef.current;
      if (!host) return;
      let cancelled = false;
      setReady(false);
      setNumPages(0);
      setRenderIndex(null);
      setPageLayout(null);
      renderIndexRef.current = null;
      virtualDocumentRef.current = null;
      resetScroll();
      host.replaceChildren();
      renderCachedDocxPreview({
        buffer,
        cacheKey: renderCacheKey,
        docxPreviewPromise,
        getScale: () => scaleRef.current,
      })
        .then(({ pageSizes, renderHost }) => {
          if (cancelled) return;
          const result = commitDocxRender({
            host,
            pageSizes,
            renderHost,
            scale: scaleRef.current,
          });
          virtualDocumentRef.current = result.virtualDocument;
          projectVisiblePages();
          const nextRenderIndex = buildDocxRenderIndex(
            host,
            result.virtualDocument.pages,
          );
          renderIndexRef.current = nextRenderIndex;
          setRenderIndex(nextRenderIndex);
          setNumPages(result.numPages);
          setPageWidth(result.pageWidth);
          setPageLayout(result.pageLayout);
          setReady(true);
        })
        .catch((err) => {
          if (!cancelled) {
            setRenderError(
              isResourceError(err) || isAbortError(err)
                ? err
                : toDocxFormatError(err, {
                    kind: "render_failed",
                    message: "Failed to render DOCX.",
                  }),
            );
          }
        });
      return () => {
        cancelled = true;
      };
    },
  );

  useKeyedMountEffect(
    joinEffectKey([
      "docx-content-measure",
      isDocumentTransitioning,
      measureScroll,
      ready,
      scale,
    ]),
    () => {
      if (!ready) return;
      if (
        isDocumentTransitioning ||
        shouldReleaseTransitionProjectionRef.current
      ) {
        return;
      }
      projectVisiblePages();
      measureScroll();
    },
  );

  useMountEffect(() => () => {
    clearTransitionWindowReleaseTimer();
  });

  renderIndexRef.current = renderIndex;

  const highlightName = useDocxHighlight({
    highlight,
    renderIndex,
    ready,
  });
  useDocxControlsRegistration({
    currentPage,
    download,
    downloadAction: resource.originalDownload,
    fitWidth: fitWidthCentered,
    numPages,
    ready,
    scale,
    zoomIn: zoomInCentered,
    zoomOut: zoomOutCentered,
  });

  React.useImperativeHandle(
    forwardedRef ?? null,
    () => ({
      scrollToTarget: (target, options) => {
        const index = renderIndexRef.current;
        if (!index) return;
        const hit = resolveDocxTargetHit(index, target);
        if (!hit) return;
        projectTargetPage(hit.pageNumber);
        const node = hit.startContainer;
        const el =
          node?.nodeType === Node.ELEMENT_NODE
            ? (node as HTMLElement)
            : (node?.parentElement ?? null);
        el?.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: options?.behavior ?? "smooth",
          ...options,
        });
      },
      getViewportElement: () => scrollViewportRef.current,
    }),
    [projectTargetPage, scrollViewportRef],
  );

  return (
    <DocxViewerFrame bare={bare} className={className}>
      <style>{DOCX_SCOPED_STYLES}</style>
      <style>{`::highlight(${highlightName}){background-color:color-mix(in oklab, var(--primary) 22%, transparent);}`}</style>
      {controls ? (
        ready ? (
          <ViewerControls
            position={{
              kind: "page",
              current: currentPage,
              total: numPages,
            }}
            zoom={{
              scale,
              onZoomOut: zoomOutCentered,
              onZoomIn: zoomInCentered,
              onFit: fitWidthCentered,
            }}
            downloads={
              download && resource.originalDownload
                ? [resource.originalDownload]
                : []
            }
          />
        ) : (
          <ViewerControlsSkeleton position zoom download={download} />
        )
      ) : null}
      <DocxViewerBody>
        <ScrollArea
          className="min-h-0 flex-1"
          viewportRef={scrollViewportRef}
          viewportProps={{ onScroll: handleViewportScroll }}
        >
          {/* The clip exists for ONE state: a fit-width shell slide, where
              the kernel's counter-transform paints the surface past its
              committed box, and that visual overflow would otherwise inflate
              the scroller's scrollHeight and drag a max-clamped scroll
              position down frame by frame as the transform relaxes (a 300px
              in-flight swing at the document end). Every other state must
              NOT clip: a zoomed-in surface's inline overflow IS the
              horizontal scroll range (an unconditional clip froze
              scrollWidth at the viewport width and made zoomed documents
              horizontally unscrollable), and a zoom relax's enlarged opening
              frame must not be cut at the committed box. At fit-width the
              surface fits the layout width, so the active clip can never
              eat scrollable overflow. */}
          <div
            ref={containerRef}
            className={cn(
              // Flex column so the stage's block-axis auto margin has free
              // space to split once a zoomed-out document is shorter than the
              // pane; a block container would give it none.
              "flex min-h-full flex-col",
              isDocumentTransitioning && isFitWidth
                ? "overflow-clip"
                : "overflow-visible",
            )}
          >
            {!ready ? (
              <div className="p-4">
                <DocxSkeleton />
              </div>
            ) : null}
            {/* The registered document surface is the shrink-wrapped stage box
                (page + its own padding) so the kernel's fit-width transform
                scales it about its own laid-out origin. It is a camera view:
                auto margins split the leftover space evenly on both axes when
                the zoomed-out page is smaller than the pane, and collapse to 0
                once it overflows — mirroring the resolver's "center" margin
                model. */}
            <div
              ref={setDocumentSurfaceElement}
              className={cn(
                "mx-auto shrink-0 p-4 transition-opacity duration-200",
                // Block-axis centring only outside fit-width: at fit-width a
                // pane resize re-fits the page, and half of that height delta
                // is motion the shell transform does not model. Zoomed, that
                // transform is identity and the height is pane-independent.
                !isFitWidth && "my-auto",
                ready ? "opacity-100" : "opacity-0",
              )}
              style={{ width: stageInlineSize ?? undefined }}
            >
              {/* The zoom stage shrink-wraps the page box (width = pageWidth
                  × scale, exactly linear in scale): it is the inline-anchor
                  ruler AND the FLIP layer for toolbar zoom steps
                  (docx-viewer-zoom-motion). The relax transform must not
                  share an element with the CSS `zoom` below (their coordinate
                  spaces disagree) nor with the kernel-owned surface above. */}
              <div data-slot="docx-viewer-zoom-stage">
                <div ref={hostRef} style={{ zoom: scale }} />
              </div>
            </div>
          </div>
        </ScrollArea>
      </DocxViewerBody>
    </DocxViewerFrame>
  );
}

function useMeasuredDocxContainerInlineSize({ enabled }: { enabled: boolean }) {
  const [containerElement, setContainerElement] =
    React.useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = React.useState<number | null>(
    null,
  );

  useKeyedLayoutEffect(joinEffectKey([containerElement, enabled]), () => {
    if (!enabled || !containerElement) {
      if (!enabled) {
        setContainerWidth((current) => (current == null ? current : null));
      }
      return;
    }

    let frame = 0;
    let latest = resolveDocxMeasuredInlineSize(containerElement.clientWidth);
    setContainerWidth(latest);
    if (typeof ResizeObserver === "undefined") return;

    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          latest = resolveDocxMeasuredInlineSize(
            (entry.target as HTMLElement).clientWidth,
          );
        }
        if (frame) return;
        frame = -1;
        const requestedFrame = requestAnimationFrame(() => {
          frame = 0;
          setContainerWidth((current) =>
            current === latest ? current : latest,
          );
        });
        if (frame === -1) frame = requestedFrame;
      });
      observer.observe(containerElement);
    } catch {
      if (frame > 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      return;
    }

    return () => {
      if (frame > 0) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  });

  return {
    containerRef: setContainerElement,
    containerWidth,
  };
}

function resolveDocxMeasuredInlineSize(value: number) {
  return Number.isFinite(value) && value > 0 ? value : null;
}


function useDocxControlsRegistration({
  currentPage,
  download,
  downloadAction,
  fitWidth,
  numPages,
  ready,
  scale,
  zoomIn,
  zoomOut,
}: {
  currentPage: number;
  download: boolean;
  downloadAction: NonNullable<ViewerControlsState["downloads"]>[number];
  fitWidth: () => void;
  numPages: number;
  ready: boolean;
  scale: number;
  zoomIn: () => void;
  zoomOut: () => void;
}) {
  const onControlsChange = useViewerControlsRegistration();
  const controlsState = React.useMemo<ViewerControlsState>(
    () => ({
      loading: !ready,
      position: ready
        ? {
            kind: "page",
            current: currentPage,
            total: numPages,
          }
        : null,
      zoom: ready
        ? {
            scale,
            onZoomOut: zoomOut,
            onZoomIn: zoomIn,
            onFit: fitWidth,
          }
        : null,
      downloads: download && downloadAction ? [downloadAction] : [],
    }),
    [
      currentPage,
      download,
      downloadAction,
      fitWidth,
      numPages,
      ready,
      scale,
      zoomIn,
      zoomOut,
    ],
  );

  useKeyedMountEffect(
    joinEffectKey(["docx-controls", onControlsChange, controlsState]),
    () => {
      if (!onControlsChange) return;
      onControlsChange(controlsState);
      return () => onControlsChange(null);
    },
  );
}
