"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

import { ViewerControlsSkeleton } from "./viewer-controls";

export function DocxViewerFrame({
  bare = false,
  children,
  className,
}: {
  bare?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        bare ? "bg-muted/20 h-full" : "bg-muted/30 rounded-xl border",
        className,
      )}
      data-slot="docx-viewer"
    >
      {children}
    </div>
  );
}

export function DocxViewerBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export function DocxViewerFallback({
  bare = false,
  className,
  controls = true,
}: {
  bare?: boolean;
  className?: string;
  controls?: boolean;
}) {
  return (
    <DocxViewerFrame bare={bare} className={className}>
      {controls ? <ViewerControlsSkeleton position zoom download /> : null}
      <DocxViewerBody>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex flex-col items-center p-4">
            <DocxSkeleton />
          </div>
        </div>
      </DocxViewerBody>
    </DocxViewerFrame>
  );
}

export function DocxSkeleton() {
  return (
    <Skeleton
      aria-hidden
      className="ring-border w-full rounded-none shadow-sm ring-1"
      data-slot="docx-page-skeleton"
      style={{ aspectRatio: "8.5 / 11" }}
    />
  );
}
