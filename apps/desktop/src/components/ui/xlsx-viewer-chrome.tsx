"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/retab-skeleton";
import {
  VIEWER_CONTROLS_HEIGHT_PX,
  ViewerControlsSkeleton,
} from "@/components/ui/viewer-controls";
import { XlsxGridSkeleton } from "@/components/ui/xlsx-grid-skeleton";
import { XLSX_SHEET_TABS_HEIGHT_PX } from "@/components/ui/xlsx-sheet-tabs";

export function XlsxViewerFrame({
  className,
  bare,
  children,
}: {
  className?: string;
  bare: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        bare ? "bg-muted/20 h-full" : "bg-muted/30 rounded-xl border",
        className,
      )}
      data-slot="xlsx-viewer"
    >
      {children}
    </div>
  );
}

export function XlsxViewerBody({
  children,
  fallbackSheetTabs,
  controls,
}: {
  children: React.ReactNode;
  fallbackSheetTabs: boolean;
  controls: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-0",
        fallbackSheetTabs ? "flex-none" : "flex-1",
      )}
      style={
        fallbackSheetTabs
          ? {
              height: `calc(100% - ${
                XLSX_SHEET_TABS_HEIGHT_PX +
                (controls ? VIEWER_CONTROLS_HEIGHT_PX : 0)
              }px)`,
            }
          : undefined
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export function XlsxGridColumn({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>;
}

export function XlsxViewerFallback({
  className,
  fallbackSheetTabs = false,
  controls = true,
  bare = false,
}: {
  className?: string;
  fallbackSheetTabs?: boolean;
  controls?: boolean;
  bare?: boolean;
}) {
  return (
    <XlsxViewerFrame className={className} bare={bare}>
      {controls ? (
        <ViewerControlsSkeleton title subtitle zoom download />
      ) : null}
      <XlsxViewerBody controls={controls} fallbackSheetTabs={fallbackSheetTabs}>
        <XlsxGridSkeleton />
      </XlsxViewerBody>
      {fallbackSheetTabs ? <XlsxSheetTabsSkeleton /> : null}
    </XlsxViewerFrame>
  );
}

export function XlsxSheetTabsSkeleton() {
  return (
    <div
      aria-hidden
      className="bg-card flex flex-shrink-0 items-stretch gap-0.5 overflow-hidden border-t px-1.5 py-1"
      data-slot="xlsx-viewer-tabs-skeleton"
      style={{ height: XLSX_SHEET_TABS_HEIGHT_PX }}
    >
      {[96, 144, 136, 128].map((width, index) => (
        <div
          key={index}
          className="flex h-[24px] flex-shrink-0 items-center rounded-md px-2.5"
          style={{ width }}
        >
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}
