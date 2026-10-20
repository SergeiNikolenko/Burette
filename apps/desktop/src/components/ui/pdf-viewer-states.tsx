import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewerControlsSkeleton } from "@/components/ui/viewer-controls";
import type { PdfPageSize } from "./pdf-viewer-types";

const DEFAULT_PDF_FALLBACK_PAGE_SIZE: PdfPageSize = {
  width: 8.5,
  height: 11,
};

export function PdfViewerFallback({
  className,
  bare = false,
  controls = true,
  fallbackPageSize,
}: {
  className?: string;
  bare?: boolean;
  controls?: boolean;
  fallbackPageSize?: PdfPageSize;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        bare ? "bg-muted/20 h-full" : "bg-muted/30 rounded-xl border",
        className,
      )}
      data-slot="pdf-viewer"
    >
      {controls ? (
        <ViewerControlsSkeleton position zoom rotate download />
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col items-center p-4">
          <PageAspectSkeleton pageSize={fallbackPageSize} />
        </div>
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div
      aria-hidden
      className="ring-border size-full rounded-none bg-white shadow-sm ring-1"
      data-slot="pdf-page-skeleton"
    />
  );
}

function PageAspectSkeleton({ pageSize }: { pageSize?: PdfPageSize }) {
  const resolvedPageSize =
    pageSize &&
    Number.isFinite(pageSize.width) &&
    pageSize.width > 0 &&
    Number.isFinite(pageSize.height) &&
    pageSize.height > 0
      ? pageSize
      : DEFAULT_PDF_FALLBACK_PAGE_SIZE;

  return (
    <Skeleton
      aria-hidden
      className="ring-border w-full rounded-none shadow-sm ring-1"
      data-slot="pdf-page-skeleton"
      style={{
        aspectRatio: `${resolvedPageSize.width} / ${resolvedPageSize.height}`,
      }}
    />
  );
}
