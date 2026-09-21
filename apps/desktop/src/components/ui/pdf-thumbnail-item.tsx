"use client";

import * as React from "react";

import type { PdfDocumentProxy } from "@/lib/pdf-document-types";
import { cn } from "@/lib/utils";

import {
  PdfThumbnailCanvas,
  PdfThumbnailSkeleton,
} from "./pdf-thumbnail-canvas";
import type { PdfThumbnailLayoutItem } from "./pdf-thumbnail-layout";
import type { PdfRenderedPageCache } from "./pdf-viewer-render-cache";

export function PdfThumbnailItem({
  doc,
  documentKey,
  item,
  active,
  isRenderingSuspended = false,
  itemId,
  onSelectPage,
  renderCache,
}: {
  doc: PdfDocumentProxy;
  documentKey: string;
  item: PdfThumbnailLayoutItem;
  active: boolean;
  isRenderingSuspended?: boolean;
  itemId: string;
  onSelectPage?: (pageNumber: number) => void;
  renderCache?: PdfRenderedPageCache;
}) {
  return (
    <button
      id={itemId}
      type="button"
      aria-label={`Page ${item.pageNumber}`}
      aria-current={active ? "page" : undefined}
      data-active={active}
      data-page-number={item.pageNumber}
      onClick={() => onSelectPage?.(item.pageNumber)}
      className="flex flex-shrink-0 flex-col items-center gap-1 outline-none"
    >
      <div
        className={cn(
          "overflow-hidden rounded-sm bg-white ring-2 transition-shadow",
          active ? "ring-primary" : "ring-sidebar-border",
        )}
        style={{ width: item.imageWidth, height: item.imageHeight }}
      >
        <React.Suspense fallback={<PdfThumbnailSkeleton />}>
          <PdfThumbnailCanvas
            doc={doc}
            documentKey={documentKey}
            isRenderingSuspended={isRenderingSuspended}
            pageNumber={item.pageNumber}
            renderCache={renderCache}
            width={item.imageWidth}
          />
        </React.Suspense>
      </div>
      <span
        className={cn(
          "text-[10px] tabular-nums",
          active
            ? "text-sidebar-foreground font-semibold"
            : "text-sidebar-foreground/70",
        )}
      >
        {item.pageNumber}
      </span>
    </button>
  );
}
