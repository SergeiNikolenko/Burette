"use client";

import * as React from "react";

import { clearPdfDocumentResource } from "@/lib/pdf-document-resource";
import { cn } from "@/lib/utils";
import type { ViewerResource } from "@/lib/viewer-resource";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  usePdfDocumentControlsRegistration,
  usePdfDocumentControlsState,
} from "./pdf-viewer-document-controls";
import { usePdfDocumentLayout } from "./pdf-viewer-document-layout";
import { usePdfDocumentResource } from "./pdf-viewer-document-resource";
import { usePdfDocumentRuntime } from "./pdf-viewer-document-runtime";
import { PdfDocumentPagesLayer } from "./pdf-viewer-pages-layer";
import { PdfViewerFallback } from "./pdf-viewer-states";
import type {
  PageOverlayProps,
  PdfPageSize,
  PdfPageRenderTiming,
  PdfViewerHandle,
  PdfViewerPerformanceOptions,
} from "./pdf-viewer-types";
import { useIsClient } from "./use-is-client";
import { ViewerControls } from "./viewer-controls";
import { ViewerErrorBoundary } from "./viewer-error";

export type PdfViewerContentProps = {
  className?: string;
  /** Controlled rendered scale; when omitted the viewer fits page width until manually zoomed. */
  scale?: number;
  /** Initial uncontrolled scale. Leave unset for fit-to-width. */
  defaultScale?: number;
  /** Page geometry used by the loading skeleton before PDF metadata resolves. */
  fallbackPageSize?: PdfPageSize;
  /** Called when controls request a scale change. `null` means fit width. */
  onScaleChange?: (scale: number | null) => void;
  controls?: boolean;
  /** Show download actions in this viewer's controls/error state. */
  download?: boolean;
  /** Render absolutely-positioned overlays (e.g. bbox citations) on each page. */
  renderPageOverlay?: (props: PageOverlayProps) => React.ReactNode;
  /** Fired with the 1-based page nearest the top of the viewport as you scroll. */
  onVisiblePageChange?: (page: number) => void;
  /** Fired with scroll progress in [0, 1] (for a fine-grained scroll cursor). */
  onScrollProgressChange?: (progress: number) => void;
  /** Reports page render work for profiling and benchmark surfaces. */
  onPageRenderTiming?: (timing: PdfPageRenderTiming) => void;
  /** Retained for callers that still pass benchmark switches; the simple renderer ignores them. */
  performanceOptions?: PdfViewerPerformanceOptions;
  /** Drop the outer border/rounded/background so the viewer fills its container. */
  bare?: boolean;
};

export type PdfResourceContentProps = PdfViewerContentProps & {
  resource: ViewerResource;
};

export const PdfResourceContent = React.forwardRef<
  PdfViewerHandle,
  PdfResourceContentProps
>(function PdfResourceContent(props, ref) {
  const resource = props.resource;
  const isClient = useIsClient();

  if (!isClient) {
    return (
      <PdfViewerFallback
        className={props.className}
        bare={props.bare}
        controls={props.controls}
        fallbackPageSize={props.fallbackPageSize}
      />
    );
  }

  return (
    <ViewerErrorBoundary
      className={props.className}
      download={
        props.controls === false || props.download === false
          ? null
          : resource.originalDownload
      }
      format="pdf"
      onRetry={() => clearPdfDocumentResource(resource.content)}
      resetKey={resource.keys.resource}
      sourceKind={resource.sourceKind}
    >
      <React.Suspense
        fallback={
          <PdfViewerFallback
            className={props.className}
            bare={props.bare}
            controls={props.controls}
            fallbackPageSize={props.fallbackPageSize}
          />
        }
      >
        <PdfViewerInner {...props} forwardedRef={ref} resource={resource} />
      </React.Suspense>
    </ViewerErrorBoundary>
  );
});

function PdfViewerInner({
  resource,
  className,
  scale: controlledScale,
  defaultScale,
  onScaleChange,
  controls = true,
  download = true,
  renderPageOverlay,
  onVisiblePageChange,
  onScrollProgressChange,
  onPageRenderTiming,
  performanceOptions,
  bare = false,
  forwardedRef,
}: PdfResourceContentProps & {
  forwardedRef?: React.ForwardedRef<PdfViewerHandle>;
}) {
  const content = resource.content;
  const document = usePdfDocumentResource(content);
  const layout = usePdfDocumentLayout({
    controlledScale,
    defaultScale,
    document,
    onScaleChange,
  });
  const runtime = usePdfDocumentRuntime({
    document,
    documentKey: content.key,
    layout,
    onPageRenderTiming,
    onScrollProgressChange,
    onVisiblePageChange,
    performanceOptions,
    renderPageOverlay,
  });
  const controlsState = usePdfDocumentControlsState({
    currentPage: runtime.currentPage,
    download,
    downloadAction: resource.originalDownload,
    fitWidth: runtime.zoomControls.fitWidth,
    pageCount: document.numPages,
    resolvedScale: layout.resolvedScale,
    rotateClockwise: layout.rotateClockwise,
    zoomIn: runtime.zoomControls.zoomIn,
    zoomOut: runtime.zoomControls.zoomOut,
  });

  usePdfDocumentControlsRegistration(controlsState);
  React.useImperativeHandle(
    forwardedRef ?? null,
    () => runtime.handle,
    [runtime.handle],
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        bare ? "bg-muted/20 h-full" : "bg-muted/30 rounded-xl border",
        className,
      )}
      data-slot="pdf-viewer"
    >
      {controls ? <ViewerControls {...controlsState} /> : null}

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <ScrollArea
              className="min-h-0 flex-1"
              viewportRef={runtime.setViewportElement}
              viewportProps={{
                onScroll: runtime.handleViewportScroll,
                style: { overflowAnchor: "none" },
              }}
            >
              <PdfDocumentPagesLayer {...runtime.pagesLayerProps} />
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}
