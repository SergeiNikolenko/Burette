"use client";

import * as React from "react";

import type { PdfDocumentProxy } from "@/lib/pdf-document-types";
import { cn } from "@/lib/utils";

import { PdfThumbnailItem } from "./pdf-thumbnail-item";
import {
  getPdfThumbnailRenderedWindow,
  normalizeThumbnailPage,
  type PdfThumbnailLayout,
  type PdfThumbnailLayoutItem,
} from "./pdf-thumbnail-layout";
import type { PdfRenderedPageCache } from "./pdf-viewer-render-cache";

export function getPdfThumbnailItemId(pageNumber: number) {
  return `pdf-thumbnail-page-${pageNumber}`;
}

export function PdfThumbnailRailViewport({
  doc,
  documentKey,
  isRenderingSuspended = false,
  layout,
  visibleItems,
  viewportHeight,
  currentPage,
  viewportRef,
  onSelectPage,
  onPageActivate,
  onPointerEnter,
  onPointerLeave,
  onScroll,
  className,
  renderCache,
}: {
  doc: PdfDocumentProxy;
  documentKey: string;
  isRenderingSuspended?: boolean;
  layout: PdfThumbnailLayout;
  visibleItems: readonly PdfThumbnailLayoutItem[];
  viewportHeight: number;
  currentPage: number | null | undefined;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onSelectPage?: (pageNumber: number) => void;
  onPageActivate?: (pageNumber: number) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onScroll?: () => void;
  className?: string;
  renderCache?: PdfRenderedPageCache;
}) {
  const activePage = normalizeThumbnailPage(currentPage, layout.pageCount);
  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const page = activePage ?? 1;
      const nextPage = getKeyboardTargetPage({
        key: event.key,
        page,
        pageCount: layout.pageCount,
      });

      if (nextPage == null) return;
      event.preventDefault();
      onPageActivate?.(nextPage);
      onSelectPage?.(nextPage);
    },
    [activePage, layout.pageCount, onPageActivate, onSelectPage],
  );
  const handleSelectPage = React.useCallback(
    (pageNumber: number) => {
      onPageActivate?.(pageNumber);
      onSelectPage?.(pageNumber);
    },
    [onPageActivate, onSelectPage],
  );
  const renderedWindow = React.useMemo(
    () =>
      getPdfThumbnailRenderedWindow({
        layout,
        visibleItems,
        viewportHeight,
      }),
    [layout, visibleItems, viewportHeight],
  );

  return (
    <nav
      ref={viewportRef}
      data-slot="pdf-viewer-thumbnails"
      aria-label="PDF pages"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onScroll={onScroll}
      className={cn(
        "bg-sidebar text-sidebar-foreground h-full overflow-auto p-2",
        className,
      )}
      style={{ overflowAnchor: "none" }}
    >
      <div
        data-slot="pdf-thumbnail-document"
        className="relative w-full"
        style={{
          contain: "layout style",
          height: layout.totalHeight,
        }}
      >
        {renderedWindow ? (
          <>
            <div
              aria-hidden
              data-slot="pdf-thumbnail-window-before"
              style={{
                contain: "layout size",
                height: renderedWindow.beforeHeight,
              }}
            />
            <div
              data-slot="pdf-thumbnail-sticky-window"
              className="sticky w-full"
              style={{
                bottom: renderedWindow.stickyInset,
                contain: "layout style inline-size",
                height: renderedWindow.height,
                isolation: "isolate",
                top: renderedWindow.stickyInset,
              }}
            >
              <ol
                data-slot="pdf-thumbnail-window"
                className="relative w-full"
                style={{
                  contain: "layout style",
                  height: renderedWindow.height,
                }}
              >
                {renderedWindow.items.map((item) => (
                  <li
                    key={item.pageNumber}
                    data-index={item.pageIndex}
                    className="absolute top-0 left-0 flex w-full justify-center pb-2"
                    style={{
                      height: item.height,
                      transform: `translateY(${item.windowTop}px)`,
                    }}
                  >
                    <PdfThumbnailItem
                      doc={doc}
                      documentKey={documentKey}
                      item={item}
                      active={activePage === item.pageNumber}
                      isRenderingSuspended={isRenderingSuspended}
                      itemId={getPdfThumbnailItemId(item.pageNumber)}
                      onSelectPage={handleSelectPage}
                      renderCache={renderCache}
                    />
                  </li>
                ))}
              </ol>
            </div>
            <div
              aria-hidden
              data-slot="pdf-thumbnail-window-after"
              style={{
                contain: "layout size",
                height: renderedWindow.afterHeight,
              }}
            />
          </>
        ) : null}
      </div>
    </nav>
  );
}

function getKeyboardTargetPage({
  key,
  page,
  pageCount,
}: {
  key: string;
  page: number;
  pageCount: number;
}) {
  switch (key) {
    case "ArrowUp":
      return Math.max(1, page - 1);
    case "ArrowDown":
      return Math.min(pageCount, page + 1);
    case "Home":
      return 1;
    case "End":
      return pageCount;
    default:
      return null;
  }
}
