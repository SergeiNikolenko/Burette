"use client";

import * as React from "react";

import { logicalFrameSize } from "@/lib/image-geometry";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/retab-skeleton";
import { ViewerControlsSkeleton } from "@/components/ui/viewer-controls";

export function ImageViewerFallback({
  className,
  bare = false,
  fallbackFrameSize,
  scale,
  controls = true,
}: {
  className?: string;
  bare?: boolean;
  fallbackFrameSize?: { width: number; height: number };
  scale?: number;
  controls?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        bare ? "bg-muted/20 h-full" : "bg-muted/30 rounded-xl border",
        className,
      )}
      data-slot="image-viewer"
    >
      {controls ? (
        <ViewerControlsSkeleton position zoom rotate download />
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col items-center p-4">
          <ImageFrameSkeleton frameSize={fallbackFrameSize} scale={scale} />
        </div>
      </div>
    </div>
  );
}

function ImageFrameSkeleton({
  frameSize,
  scale,
}: {
  frameSize?: { width: number; height: number };
  scale?: number;
}) {
  const normalizedScale =
    scale !== undefined && Number.isFinite(scale) && scale > 0
      ? Math.min(5, Math.max(0.1, scale))
      : null;
  // The scale counts logical pixels (image-viewer-hooks), so the reserved
  // box is the frame's CSS size at 100% times the scale.
  const logicalSize = frameSize
    ? logicalFrameSize(
        frameSize,
        typeof window === "undefined" ? 1 : window.devicePixelRatio,
      )
    : null;
  const style: React.CSSProperties | undefined = logicalSize
    ? normalizedScale !== null
      ? {
          width: logicalSize.width * normalizedScale,
          height: logicalSize.height * normalizedScale,
        }
      : {
          aspectRatio: `${logicalSize.width} / ${logicalSize.height}`,
          minWidth: logicalSize.width * 0.1,
        }
    : { aspectRatio: "4 / 3" };

  return (
    <Skeleton
      aria-hidden
      className="ring-border w-full rounded-none shadow-sm ring-1"
      data-slot="image-frame-skeleton"
      style={style}
    />
  );
}
