"use client";

import * as React from "react";

import { type ViewerDownloadAction } from "@/lib/viewer-download-actions";

import { Skeleton } from "./retab-skeleton";
import { TextCodeViewerFrame } from "./text-code-viewer-chrome";
import {
  ViewerControls,
  ViewerControlsSkeleton,
  type ViewerControlsState,
} from "./viewer-controls";

export function CodeViewerFrame({
  className,
  bare,
  children,
}: {
  className?: string;
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <TextCodeViewerFrame
      bare={bare}
      bareClassName="h-full bg-muted/20"
      className={className}
      dataSlot="code-viewer"
      framedClassName="rounded-xl border bg-muted/30"
    >
      {children}
    </TextCodeViewerFrame>
  );
}

export function CodeViewerControls({
  lineCount,
  fontScale,
  downloadAction,
  onZoomOut,
  onZoomIn,
  onResetZoom,
}: {
  lineCount: number;
  fontScale: number;
  downloadAction?: ViewerDownloadAction | null;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetZoom: () => void;
}) {
  const controlsState = codeViewerControlsState({
    lineCount,
    fontScale,
    downloadAction,
    onZoomOut,
    onZoomIn,
    onResetZoom,
  });

  return (
    <ViewerControls
      title={controlsState.title}
      zoom={controlsState.zoom}
      downloads={controlsState.downloads}
    />
  );
}

export function codeViewerControlsState({
  lineCount,
  fontScale,
  downloadAction,
  onZoomOut,
  onZoomIn,
  onResetZoom,
}: {
  lineCount: number;
  fontScale: number;
  downloadAction?: ViewerDownloadAction | null;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetZoom: () => void;
}): ViewerControlsState {
  return {
    title: `${lineCount} line${lineCount === 1 ? "" : "s"}`,
    zoom: {
      scale: fontScale,
      onZoomOut,
      onZoomIn,
      onFit: onResetZoom,
      fitLabel: "Reset zoom",
    },
    downloads: downloadAction ? [downloadAction] : [],
  };
}

export function CodeViewerFallback({
  className,
  controls = true,
  download = true,
  bare,
}: {
  className?: string;
  controls?: boolean;
  download?: boolean;
  bare?: boolean;
}) {
  return (
    <CodeViewerFrame className={className} bare={bare}>
      {controls ? (
        <ViewerControlsSkeleton title zoom download={download} />
      ) : null}
      <div
        className="min-h-0 flex-1 space-y-2 overflow-hidden p-4"
        data-slot="code-body-skeleton"
      >
        {Array.from({ length: 12 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-4"
            style={{ width: `${40 + ((index * 13) % 55)}%` }}
          />
        ))}
      </div>
    </CodeViewerFrame>
  );
}
