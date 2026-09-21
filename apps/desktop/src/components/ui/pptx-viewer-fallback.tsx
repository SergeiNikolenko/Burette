"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/retab-skeleton";

import { DEFAULT_PPTX_SLIDE_SIZE } from "./pptx-viewer-core";
import { ViewerControlsSkeleton } from "./viewer-controls";

export function PptxViewerFallback({
  className,
  bare = false,
  fallbackSlideSize = DEFAULT_PPTX_SLIDE_SIZE,
  controls = true,
}: {
  className?: string;
  bare?: boolean;
  fallbackSlideSize?: { width: number; height: number };
  controls?: boolean;
}) {
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
        <ViewerControlsSkeleton position zoom rotate download />
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col items-center p-4">
          <PptxSlideSkeleton slideSize={fallbackSlideSize} />
        </div>
      </div>
    </div>
  );
}

function PptxSlideSkeleton({
  slideSize,
}: {
  slideSize: { width: number; height: number };
}) {
  return (
    <Skeleton
      aria-hidden
      className="ring-border w-full rounded-none shadow-sm ring-1"
      data-slot="pptx-slide-skeleton"
      style={{
        aspectRatio: `${slideSize.width} / ${slideSize.height}`,
      }}
    />
  );
}
