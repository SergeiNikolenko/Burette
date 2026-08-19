"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { ViewerDownloadAction } from "@/lib/viewer-download-actions";
import type { ViewerResource } from "@/lib/viewer-resource";

import type { CsvResourceState } from "./csv-viewer-state";
import { ViewerErrorState } from "./viewer-error";
import { ViewerControls } from "./viewer-controls";

export const CSV_VIEWER_BASE_FONT_SIZE = 13;

export function CsvViewerFrame({
  className,
  frame,
  fillHeight,
  zoom,
  children,
}: {
  className?: string;
  frame: boolean;
  fillHeight: boolean;
  zoom: number;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="csv-viewer"
      className={cn(
        "bg-card flex flex-col overflow-hidden",
        frame && "rounded-xl border",
        fillHeight && "h-full min-h-0 flex-1",
        className,
      )}
      style={{ fontSize: CSV_VIEWER_BASE_FONT_SIZE * zoom }}
    >
      {children}
    </div>
  );
}

export function CsvViewerHeader({
  controls,
  rowCount,
  columnCount,
  isLoading,
  zoom,
  downloadActions,
  onZoomChange,
}: {
  controls: boolean;
  rowCount: number;
  columnCount: number;
  isLoading: boolean;
  zoom: number;
  downloadActions: ViewerDownloadAction[];
  onZoomChange: (zoom: number) => void;
}) {
  const rowLabel = `${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"}`;
  const columnLabel = `${columnCount} column${columnCount === 1 ? "" : "s"}`;

  return controls ? (
    <ViewerControls
      title={isLoading ? `${rowLabel} loading` : rowLabel}
      subtitle={isLoading ? null : columnLabel}
      loading={isLoading}
      zoom={{
        scale: zoom,
        onZoomOut: () => onZoomChange(clampCsvZoom(zoom / 1.2)),
        onZoomIn: () => onZoomChange(clampCsvZoom(zoom * 1.2)),
        onFit: () => onZoomChange(1),
        fitLabel: "Reset zoom",
      }}
      downloads={downloadActions}
    />
  ) : null;
}

function clampCsvZoom(zoom: number) {
  return Math.max(0.1, Math.min(5, zoom));
}

export function csvViewerStatusNode({
  resourceState,
  resource,
  rowCount,
  showDownload,
  onRetry,
}: {
  resourceState: CsvResourceState;
  resource: ViewerResource | null;
  rowCount: number;
  showDownload: boolean;
  onRetry: () => void;
}): React.ReactNode {
  if (resourceState.status === "error") {
    return (
      <ViewerErrorState
        error={resourceState.error}
        format="csv"
        sourceKind={resource?.sourceKind}
        download={showDownload ? resource?.originalDownload : null}
        variant="inline"
        onRetry={onRetry}
      />
    );
  }

  if (rowCount === 0 && resourceState.status !== "loading") {
    return (
      <div className="text-muted-foreground flex h-24 items-center justify-center text-xs">
        No rows
      </div>
    );
  }

  return null;
}
