"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";
import { cn } from "@/lib/utils";

import type { FileViewerDocumentAlign } from "./file-viewer-renderer-contract";
import type {
  FileViewerDocumentSurfaceMotionResolver,
  FileViewerDocumentSurfaceSettleSnapshotReader,
} from "./file-viewer-motion-kernel";
import { useOptionalFileViewerRendererEnvironment } from "./file-viewer-renderer-frame";
import {
  getPdfRenderedPageWindow,
  type PdfPageLayoutModel,
} from "./pdf-viewer-layout";
import { PdfPage } from "./pdf-viewer-page";
import type { PdfRenderedPageCache } from "./pdf-viewer-render-cache";
import { PageSkeleton } from "./pdf-viewer-states";
import type {
  PageOverlayProps,
  PdfPageRenderTiming,
  PdfPageSize,
} from "./pdf-viewer-types";
import type { PdfDocument } from "./pdf-viewer-document-resource";
import { PDF_PAGE_HORIZONTAL_PADDING } from "./pdf-viewer-scale";

const PDF_PAGE_RING_OUTSET_PX = 1;

export type PdfDocumentPagesLayerProps = {
  activeRenderPageNumbers: readonly number[];
  containerRef: React.RefCallback<HTMLDivElement>;
  devicePixelRatio: number;
  document: PdfDocument;
  documentAlign: FileViewerDocumentAlign | null;
  documentKey: string;
  /** The pages are at their fit-width scale (the shell motion's domain). */
  isFitWidth: boolean;
  isLayoutTransitioning: boolean;
  /** A toolbar zoom step's FLIP relax is in flight (pdf-viewer-zoom-motion). */
  isZoomTransitioning: boolean;
  layout: PdfPageLayoutModel;
  /** The page the motion kernel should probe for on-screen telemetry. */
  motionProbePageNumber: number;
  onPageRenderTiming?: (timing: PdfPageRenderTiming) => void;
  physicalScrollHeight: number;
  renderCache?: PdfRenderedPageCache;
  renderPageNumbers: readonly number[];
  readSettleSnapshot: FileViewerDocumentSurfaceSettleSnapshotReader;
  renderPageOverlay?: (props: PageOverlayProps) => React.ReactNode;
  renderScale: number;
  resolveSurfaceMotionStyle: FileViewerDocumentSurfaceMotionResolver;
  rotation: number;
  scale: number;
  scrollPageOffset: number;
  setDocumentSurfaceElement: React.RefCallback<HTMLElement>;
  setScrollInteractionElement: React.RefCallback<HTMLDivElement>;
  setPageSize: (pageNumber: number, size: PdfPageSize) => void;
  viewportHeight: number;
  visiblePageNumbers: readonly number[];
};

export function PdfDocumentPagesLayer({
  activeRenderPageNumbers,
  containerRef,
  devicePixelRatio,
  document,
  documentAlign,
  documentKey,
  isFitWidth,
  isLayoutTransitioning,
  isZoomTransitioning,
  layout,
  motionProbePageNumber,
  onPageRenderTiming,
  physicalScrollHeight,
  renderCache,
  renderPageNumbers,
  readSettleSnapshot,
  renderPageOverlay,
  renderScale,
  resolveSurfaceMotionStyle,
  rotation,
  scale,
  scrollPageOffset,
  setDocumentSurfaceElement,
  setScrollInteractionElement,
  setPageSize,
  viewportHeight,
  visiblePageNumbers,
}: PdfDocumentPagesLayerProps) {
  const visiblePageNumberSet = React.useMemo(
    () => new Set(visiblePageNumbers),
    [visiblePageNumbers],
  );
  const { registerDocumentSurface } =
    useOptionalFileViewerRendererEnvironment();
  const [visualStageElement, setVisualStageElementState] =
    React.useState<HTMLElement | null>(null);
  const setVisualStageElement = React.useCallback(
    (element: HTMLElement | null) => {
      setVisualStageElementState((previousElement) =>
        previousElement === element ? previousElement : element,
      );
      setDocumentSurfaceElement(element);
    },
    [setDocumentSurfaceElement],
  );
  const motionProbePageNumberRef = React.useRef(motionProbePageNumber);
  motionProbePageNumberRef.current = motionProbePageNumber;
  // Probe the marker page's element; while a motion is in flight the marker
  // page may sit outside the rendered window, so fall back to any visible
  // page, then any rendered page.
  const getMotionProbeElement = React.useCallback(() => {
    if (!visualStageElement) return null;
    const pageNumber = motionProbePageNumberRef.current;
    return (
      visualStageElement.querySelector<HTMLElement>(
        `[data-slot="pdf-page"][data-page="${pageNumber}"]`,
      ) ??
      visualStageElement.querySelector<HTMLElement>(
        '[data-slot="pdf-page-slot"][data-visible] [data-slot="pdf-page"]',
      ) ??
      visualStageElement.querySelector<HTMLElement>('[data-slot="pdf-page"]')
    );
  }, [visualStageElement]);
  const documentSurfaceKey = visualStageElement
    ? joinEffectKey([
        registerDocumentSurface,
        getMotionProbeElement,
        readSettleSnapshot,
        resolveSurfaceMotionStyle,
        visualStageElement,
      ])
    : null;
  useKeyedLayoutEffect(documentSurfaceKey, () => {
    if (!visualStageElement) return;
    return registerDocumentSurface({
      element: visualStageElement,
      getMotionProbeElement,
      readSettleSnapshot,
      resolveMotionStyle: resolveSurfaceMotionStyle,
    });
  });
  const activeRenderPageNumberSet = React.useMemo(
    () => new Set(activeRenderPageNumbers),
    [activeRenderPageNumbers],
  );
  const renderedWindow = React.useMemo(
    () =>
      getPdfRenderedPageWindow({
        layout,
        pageNumbers: renderPageNumbers,
        physicalScrollHeight,
        scrollPageOffset,
        viewportHeight,
      }),
    [
      layout,
      physicalScrollHeight,
      renderPageNumbers,
      scrollPageOffset,
      viewportHeight,
    ],
  );
  const isInsideDocumentFrame = documentAlign !== null;
  // Shell motion counter-transforms the visual stage; a zoom step relaxes a
  // FLIP on the visual clip itself. Either way the in-flight paint is larger
  // than the committed box on at least one leg, so the clip must let go for
  // the duration.
  const isVisualClipReleased = isLayoutTransitioning || isZoomTransitioning;
  const scrollRangeStyle = {
    contain: "layout size style",
    height: physicalScrollHeight,
    minWidth: layout.maxPageWidth,
    width: layout.maxPageWidth,
  } satisfies React.CSSProperties;
  const visualClipStyle = {
    // The motion surface commits the target page width before the first
    // paint, then counter-scales back to the previous width. A target-sized
    // paint clip would cut off that enlarged opening frame even though the
    // page geometry itself is continuous. Relinquish paint containment only
    // while the counter-transform is active; identity fits the clip again at
    // settle, so restoring it cannot move a pixel.
    contain: isVisualClipReleased ? "style" : "paint style",
    left: -PDF_PAGE_RING_OUTSET_PX,
    overflow: isVisualClipReleased ? "visible" : "clip",
    paddingInline: PDF_PAGE_RING_OUTSET_PX,
    right: -PDF_PAGE_RING_OUTSET_PX,
  } satisfies React.CSSProperties;
  const visualStageStyle = {
    height: physicalScrollHeight,
    minWidth: layout.maxPageWidth,
    width: layout.maxPageWidth,
  } satisfies React.CSSProperties;

  const documentContent = (
    <div
      data-slot="pdf-viewer-scroll-range"
      // The document surface is a CAMERA view, not a laid-out column: a zoom
      // step shrinks it about the viewport centre, so whenever it is smaller
      // than the pane the leftover space splits evenly. Auto margins (never
      // justify/align-content) do exactly that and collapse to 0 once the
      // surface overflows, so an overflowing document still starts at the
      // scroll origin and every pixel of it stays reachable. The inset's
      // `align` keeps governing the FRAME, not this surface.
      //
      // The BLOCK axis centres only outside fit-width. At fit-width a pane
      // resize re-fits the document, which would move a block-centred surface
      // by half the height delta — motion the shell's fit-width transform does
      // not model, so it would land as a hop mid-slide. Zoomed, that transform
      // is identity and the document's height is pane-independent, so the
      // centring is inert during a slide; the fit↔zoom switch itself rides the
      // zoom FLIP, which measures painted rects and absorbs the margin change.
      className={cn("relative mx-auto shrink-0", !isFitWidth && "my-auto")}
      style={scrollRangeStyle}
    >
      <div
        data-slot="pdf-viewer-visual-clip"
        data-layout-transitioning={isLayoutTransitioning ? "" : undefined}
        className="absolute inset-0"
        style={visualClipStyle}
      >
        <div
          ref={setVisualStageElement}
          data-slot="pdf-viewer-visual-stage"
          className="relative"
          style={visualStageStyle}
        >
          {renderedWindow ? (
            <div
              ref={setScrollInteractionElement}
              data-slot="pdf-page-window"
              className="absolute inset-0"
              style={{
                contain: "layout style",
                isolation: "isolate",
              }}
            >
              {/* Pages sit at their settled layout positions for the whole
                  motion (commit-then-relax); the kernel's single surface
                  transform on the visual stage is the only in-flight style. */}
              {renderedWindow.pages.map((page) => (
                <div
                  key={page.pageNumber}
                  className="absolute left-1/2 flex -translate-x-1/2 items-start justify-center"
                  data-layout-transitioning={
                    isLayoutTransitioning ? "" : undefined
                  }
                  data-slot="pdf-page-slot"
                  data-page-number={page.pageNumber}
                  data-visible={
                    visiblePageNumberSet.has(page.pageNumber) ? "" : undefined
                  }
                  style={{
                    top: renderedWindow.beforeHeight + page.windowTop,
                    width: page.width,
                    height: page.height,
                  }}
                >
                  {activeRenderPageNumberSet.has(page.pageNumber) ? (
                    <React.Suspense fallback={<PageSkeleton />}>
                      <PdfPage
                        document={document}
                        documentKey={documentKey}
                        pageNumber={page.pageNumber}
                        scale={scale}
                        renderScale={renderScale}
                        isLayoutTransitioning={isLayoutTransitioning}
                        rotation={rotation}
                        devicePixelRatio={devicePixelRatio}
                        renderCache={renderCache}
                        renderOverlay={renderPageOverlay}
                        onRenderTiming={onPageRenderTiming}
                        onSize={setPageSize}
                      />
                    </React.Suspense>
                  ) : (
                    <PageSkeleton />
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <div
      ref={containerRef}
      data-slot="pdf-viewer-fit-width-measure"
      // Flex column purely so the surface's block-axis auto margins have free
      // space to split: a block container gives its child no block centring.
      className={cn(
        "relative flex min-w-0 flex-col",
        isInsideDocumentFrame && "h-full w-full",
      )}
      style={{ paddingInline: PDF_PAGE_HORIZONTAL_PADDING / 2 }}
    >
      {documentContent}
    </div>
  );
}
