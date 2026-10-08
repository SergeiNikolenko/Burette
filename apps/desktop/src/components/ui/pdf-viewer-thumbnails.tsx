"use client";

import * as React from "react";

import { clearPdfDocumentResource } from "@/lib/pdf-document-resource";
import { cn } from "@/lib/utils";
import type { ViewerResource } from "@/lib/viewer-resource";
import { Spinner } from "@/components/ui/spinner";

import {
  buildPdfThumbnailLayout,
  PDF_THUMBNAIL_INITIAL_VIEWPORT_HEIGHT,
  PDF_THUMBNAIL_OVERSCAN_PX,
  type PdfThumbnailShape,
} from "./pdf-thumbnail-layout";
import {
  useOptionalFileViewerSidebarMotion,
  type FileViewerSidebarMotion,
} from "./file-viewer-renderer-frame";
import { PdfThumbnailRailViewport } from "./pdf-thumbnail-rail";
import { usePdfViewerThumbnails } from "./pdf-viewer-context";
import { useIsClient } from "./use-is-client";
import { usePdfThumbnailDocument } from "./use-pdf-thumbnail-document";
import { usePdfThumbnailPageMetrics } from "./use-pdf-thumbnail-page-metrics";
import { usePdfThumbnailWindow } from "./use-pdf-thumbnail-window";
import { useThumbnailRailFollow } from "./use-thumbnail-rail-follow";
import { usePdfRenderedPageCache } from "./pdf-viewer-render-cache";
import { ViewerErrorBoundary } from "./viewer-error";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

const PDF_THUMBNAIL_RENDER_RESUME_DELAY_MS = 1400;
const PDF_THUMBNAIL_CLOSED_WARM_DELAY_MS = 2200;

export interface PdfViewerThumbnailsProps {
  /** Thumbnail image width in CSS pixels. The sidebar shell owns rail width. */
  thumbnailWidth?: number;
  /** Preserve page aspect or crop each page preview into a square frame. */
  thumbnailShape?: PdfThumbnailShape;
  className?: string;
}

export interface PdfThumbnailRailProps {
  /** Same resource object passed to PdfResourceContent. */
  resource: ViewerResource;
  /** 1-based current page; its thumbnail is highlighted. */
  currentPage?: number | null;
  /** Click a thumbnail to jump the document to that page. */
  onSelectPage?: (page: number) => void;
  /** Thumbnail image width in CSS pixels. The sidebar shell owns rail width. */
  thumbnailWidth?: number;
  /** Preserve page aspect or crop each page preview into a square frame. */
  thumbnailShape?: PdfThumbnailShape;
  className?: string;
}

export function PdfViewerThumbnails({
  className,
  thumbnailShape,
  thumbnailWidth,
}: PdfViewerThumbnailsProps) {
  const thumbnails = usePdfViewerThumbnails();
  const sidebarMotion = useOptionalFileViewerSidebarMotion();
  const isRenderingSuspended = usePdfThumbnailRenderSuspension(sidebarMotion);

  return (
    <PdfThumbnailRailShell
      className={className}
      currentPage={thumbnails.currentPage}
      isRenderingSuspended={isRenderingSuspended}
      onSelectPage={thumbnails.onSelectPage}
      resource={thumbnails.resource}
      thumbnailShape={thumbnailShape}
      thumbnailWidth={thumbnailWidth}
    />
  );
}

export function PdfThumbnailRail({
  className,
  currentPage,
  onSelectPage,
  resource,
  thumbnailShape,
  thumbnailWidth,
}: PdfThumbnailRailProps) {
  return (
    <PdfThumbnailRailShell
      className={className}
      currentPage={currentPage}
      isRenderingSuspended={false}
      onSelectPage={onSelectPage}
      resource={resource}
      thumbnailShape={thumbnailShape}
      thumbnailWidth={thumbnailWidth}
    />
  );
}

function PdfThumbnailRailShell({
  className,
  currentPage,
  isRenderingSuspended,
  onSelectPage,
  resource,
  thumbnailShape,
  thumbnailWidth,
}: PdfThumbnailRailProps & {
  isRenderingSuspended: boolean;
}) {
  const isClient = useIsClient();

  if (!isClient) {
    return <ThumbnailsFallback className={className} />;
  }

  return (
    <ViewerErrorBoundary
      className="h-full"
      download={resource.originalDownload}
      format="pdf"
      onRetry={() => clearPdfDocumentResource(resource.content)}
      resetKey={resource.keys.resource}
      sourceKind={resource.sourceKind}
      variant="inline"
    >
      <React.Suspense fallback={<ThumbnailsFallback className={className} />}>
        <PdfThumbnailRailInner
          currentPage={currentPage}
          isRenderingSuspended={isRenderingSuspended}
          onSelectPage={onSelectPage}
          resource={resource}
          thumbnailShape={thumbnailShape}
          thumbnailWidth={thumbnailWidth}
          className={cn("h-full", className)}
        />
      </React.Suspense>
    </ViewerErrorBoundary>
  );
}

function PdfThumbnailRailInner({
  resource,
  currentPage,
  isRenderingSuspended,
  onSelectPage,
  thumbnailShape = "page",
  thumbnailWidth = 120,
  className,
}: PdfThumbnailRailProps & {
  isRenderingSuspended: boolean;
}) {
  const doc = usePdfThumbnailDocument(resource);
  const renderCache = usePdfRenderedPageCache(doc);
  const pageMetrics = usePdfThumbnailPageMetrics(doc, doc);
  const { metricByPageNumber, pageCount, requestPageMetrics } = pageMetrics;
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const activeCurrentPage = isRenderingSuspended ? null : currentPage;

  const layout = React.useMemo(
    () =>
      buildPdfThumbnailLayout({
        pageCount,
        width: thumbnailWidth,
        shape: thumbnailShape,
        metricByPageNumber,
      }),
    [metricByPageNumber, pageCount, thumbnailShape, thumbnailWidth],
  );
  const thumbnailWindow = usePdfThumbnailWindow({
    layout,
    viewportRef,
    overscanPx: PDF_THUMBNAIL_OVERSCAN_PX,
    initialViewportHeight: PDF_THUMBNAIL_INITIAL_VIEWPORT_HEIGHT,
  });
  const follow = useThumbnailRailFollow({
    currentPage: activeCurrentPage,
    layout,
    viewportRef,
    resetKey: doc,
  });
  useKeyedMountEffect(
    joinEffectKey([
      activeCurrentPage,
      isRenderingSuspended,
      layout.pageCount,
      requestPageMetrics,
      thumbnailWindow.visibleItems,
    ]),
    () => {
      if (isRenderingSuspended) return;
      requestPageMetrics(
        getRequestedThumbnailMetricPages({
          currentPage: activeCurrentPage,
          pageCount: layout.pageCount,
          visibleItems: thumbnailWindow.visibleItems,
        }),
      );
    },
  );

  return (
    <PdfThumbnailRailViewport
      doc={doc}
      documentKey={resource.content.key}
      isRenderingSuspended={isRenderingSuspended}
      layout={layout}
      visibleItems={thumbnailWindow.visibleItems}
      viewportHeight={thumbnailWindow.viewportHeight}
      currentPage={activeCurrentPage}
      viewportRef={viewportRef}
      onSelectPage={onSelectPage}
      onPageActivate={follow.onPageActivate}
      onPointerEnter={follow.onPointerEnter}
      onPointerLeave={follow.onPointerLeave}
      onScroll={follow.onScroll}
      className={className}
      renderCache={renderCache}
    />
  );
}

function usePdfThumbnailRenderSuspension(
  sidebarMotion: FileViewerSidebarMotion | null,
) {
  const isMotionManaged = sidebarMotion?.isMotionManaged === true;
  const isSidebarOpen = sidebarMotion?.isSidebarOpen === true;
  const isSidebarInteractive = sidebarMotion?.isSidebarInteractive === true;
  const isSidebarTransitioning = sidebarMotion?.isSidebarTransitioning === true;
  const [isOpenSettling, setIsOpenSettling] = React.useState(false);
  const [isClosedWarmReleased, setIsClosedWarmReleased] = React.useState(false);

  useKeyedMountEffect(
    joinEffectKey([
      isMotionManaged,
      isOpenSettling,
      isSidebarInteractive,
      isSidebarOpen,
      isSidebarTransitioning,
    ]),
    () => {
      if (!isMotionManaged) {
        setIsOpenSettling(false);
        setIsClosedWarmReleased(false);
        return;
      }

      if (!isSidebarOpen) {
        setIsOpenSettling(false);
        setIsClosedWarmReleased(false);
        if (isSidebarTransitioning) return;

        const timer = window.setTimeout(() => {
          setIsClosedWarmReleased(true);
        }, PDF_THUMBNAIL_CLOSED_WARM_DELAY_MS);

        return () => window.clearTimeout(timer);
      }

      setIsClosedWarmReleased(false);

      if (isSidebarTransitioning || !isSidebarInteractive) {
        setIsOpenSettling(true);
        return;
      }

      if (!isOpenSettling) return;

      const timer = window.setTimeout(() => {
        setIsOpenSettling(false);
      }, PDF_THUMBNAIL_RENDER_RESUME_DELAY_MS);

      return () => window.clearTimeout(timer);
    },
  );

  if (!isMotionManaged) return false;
  if (!isSidebarOpen) return !isClosedWarmReleased;
  if (isSidebarTransitioning || !isSidebarInteractive) return true;
  return isOpenSettling;
}

function getRequestedThumbnailMetricPages({
  currentPage,
  pageCount,
  visibleItems,
}: {
  currentPage: number | null | undefined;
  pageCount: number;
  visibleItems: readonly { pageNumber: number }[];
}) {
  const pageNumbers = new Set<number>();
  for (const item of visibleItems) pageNumbers.add(item.pageNumber);
  if (
    currentPage != null &&
    Number.isInteger(currentPage) &&
    currentPage >= 1 &&
    currentPage <= pageCount
  ) {
    pageNumbers.add(currentPage);
  }

  return pageNumbers;
}

function ThumbnailsFallback({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-muted/30 flex h-full items-center justify-center",
        className,
      )}
    >
      <Spinner className="text-muted-foreground size-4" />
    </div>
  );
}
