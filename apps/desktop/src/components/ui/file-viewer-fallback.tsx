"use client";

import * as React from "react";

import {
  fileViewerDiagnostic,
  summarizeViewerDescriptor,
  summarizeViewerError,
  summarizeViewerResource,
} from "@/lib/pdf-viewer-diagnostics";
import { cn } from "@/lib/utils";
import type { ViewerResource } from "@/lib/viewer-resource";
import { Skeleton } from "@/components/ui/skeleton";

import { CodeViewerFallback } from "./code-viewer-chrome";
import { DocxViewerFallback } from "./docx-viewer-chrome";
import {
  isProseTextDescriptor,
  type FileDescriptor,
  type FileViewerFallbackSize,
} from "./file-viewer-core";
import {
  FileViewerErrorState,
  FileViewerLoadingState,
  FileViewerUnsupportedState,
} from "./file-viewer-state";
import { ImageViewerFallback } from "./image-viewer-chrome";
import { PdfViewerFallback } from "./pdf-viewer-states";
import { PptxViewerFallback } from "./pptx-viewer-fallback";
import { TextViewerFallback } from "./text-viewer-chrome";
import { ViewerControlsSkeleton } from "./viewer-controls";
import { XlsxViewerFallback } from "./xlsx-viewer-chrome";

export function UnsupportedCard({
  resource,
  className,
  bare,
  message,
  showDownload = true,
}: {
  resource: ViewerResource;
  className?: string;
  bare?: boolean;
  message?: string;
  showDownload?: boolean;
}) {
  return (
    <FileViewerUnsupportedState
      className={cn(
        bare ? "bg-muted/20 h-full" : "bg-muted/30 min-h-64 rounded-xl border",
        className,
      )}
      description={
        message ?? `No preview is available for ${resource.fileName}.`
      }
      download={resource.originalDownload}
      fileName={resource.fileName}
      showDownload={showDownload}
    />
  );
}

export function ViewerFallback({
  resource,
  className,
  bare = false,
  controls = true,
  fallbackFrameSize,
  fallbackSlideSize,
}: {
  resource: ViewerResource;
  className?: string;
  bare?: boolean;
  controls?: boolean;
  fallbackFrameSize?: FileViewerFallbackSize;
  fallbackSlideSize?: FileViewerFallbackSize;
}) {
  const descriptor = resource.descriptor;
  const category = descriptor.category;

  // Render the exact per-type skeleton each viewer shows while it parses, so the
  // SSR + chunk-loading paint is identical to the in-viewer loading state (same
  // controls row, same body) — no controls popping in and no geometry shift as one
  // skeleton hands off to the next.
  switch (category) {
    case "pdf":
      return (
        <PdfViewerFallback
          bare={bare}
          className={className}
          controls={controls}
        />
      );
    case "docx":
      return (
        <DocxViewerFallback
          bare={bare}
          className={className}
          controls={controls}
        />
      );
    case "pptx":
      return (
        <PptxViewerFallback
          bare={bare}
          className={className}
          controls={controls}
          fallbackSlideSize={fallbackSlideSize}
        />
      );
    case "image":
      return (
        <ImageViewerFallback
          bare={bare}
          className={className}
          controls={controls}
          fallbackFrameSize={fallbackFrameSize}
        />
      );
    case "xlsx":
      return (
        <XlsxViewerFallback
          bare={bare}
          className={className}
          controls={controls}
        />
      );
    case "markdown":
      return (
        <TextViewerFallback
          bare={bare}
          className={className}
          controls={controls}
        />
      );
    case "text":
      // The "text" category fans out to a prose viewer or a code viewer; match
      // whichever the route will pick so the body skeleton (gutter vs none) lines up.
      return isProseTextDescriptor(descriptor) ? (
        <TextViewerFallback
          bare={bare}
          className={className}
          controls={controls}
        />
      ) : (
        <CodeViewerFallback
          bare={bare}
          className={className}
          controls={controls}
        />
      );
    case "csv":
      return (
        <TextFamilyFallbackFrame bare={bare} className={className}>
          {controls ? (
            <ViewerControlsSkeleton title subtitle zoom download />
          ) : null}
          <TableBodySkeleton />
        </TextFamilyFallbackFrame>
      );
    case "html":
      return (
        <TextFamilyFallbackFrame bare={bare} className={className}>
          {controls ? <ViewerControlsSkeleton zoom /> : null}
          <div className="bg-card min-h-0 flex-1 p-4">
            <Skeleton className="size-full rounded-md" />
          </div>
        </TextFamilyFallbackFrame>
      );
  }

  // Unsupported / unknown categories: a neutral page-sheet placeholder.
  return (
    <FileViewerLoadingState
      description={null}
      icon={null}
      title={null}
      className={cn(
        "flex min-h-0 flex-col items-stretch justify-start gap-0 overflow-hidden p-0 text-left",
        bare ? "bg-muted/20 h-full" : "bg-muted/20 min-h-64",
        className,
      )}
    >
      <div
        data-slot="file-viewer-document-fallback"
        className="min-h-0 flex-1 overflow-hidden"
      >
        <div className="flex flex-col items-center p-4">
          <Skeleton
            aria-hidden
            className="ring-border w-full rounded-none shadow-sm ring-1"
            style={{ aspectRatio: "8.5 / 11" }}
          />
        </div>
      </div>
    </FileViewerLoadingState>
  );
}

function TextFamilyFallbackFrame({
  bare,
  className,
  children,
}: {
  bare?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="file-viewer-document-fallback"
      className={cn(
        "bg-card flex min-h-0 flex-1 flex-col overflow-hidden",
        bare ? "h-full" : "min-h-64",
        className,
      )}
    >
      {children}
    </div>
  );
}

function TableBodySkeleton() {
  const gutter = 52;
  const colWidth = 150;
  const cols = 6;
  const rows = 14;
  const widths = [70, 45, 88, 56, 62, 78];
  return (
    <div
      aria-hidden
      className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden text-sm"
    >
      <div className="bg-muted/60 flex border-b">
        <div
          className="shrink-0 border-r"
          style={{ width: gutter, height: 33 }}
        />
        {Array.from({ length: cols }, (_, c) => (
          <div
            key={c}
            className="flex shrink-0 items-center border-r px-3"
            style={{ width: colWidth, height: 33 }}
          >
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex border-b" style={{ height: 33 }}>
            <div
              className="flex shrink-0 items-center justify-end border-r px-2"
              style={{ width: gutter }}
            >
              <Skeleton className="h-3 w-4" />
            </div>
            {Array.from({ length: cols }, (_, c) => (
              <div
                key={c}
                className="flex shrink-0 items-center border-r px-3"
                style={{ width: colWidth }}
              >
                <Skeleton
                  className="h-3"
                  style={{ width: `${widths[(r + c) % widths.length]}%` }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export class FileErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    descriptor: FileDescriptor;
    resource: ViewerResource;
    className?: string;
    resetKey?: unknown;
    showDownload?: boolean;
  },
  { error: unknown | null }
> {
  state: Readonly<{ error: unknown | null }> = { error: null };

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      fileViewerDiagnostic("debug", "file_viewer_error_boundary_reset", {
        descriptor: summarizeViewerDescriptor(this.props.descriptor),
        resource: summarizeViewerResource(this.props.resource),
      });
      this.setState({ error: null });
    }
  }

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    fileViewerDiagnostic("error", "file_viewer_error_boundary_caught", {
      descriptor: summarizeViewerDescriptor(this.props.descriptor),
      resource: summarizeViewerResource(this.props.resource),
      error: summarizeViewerError(error),
    });
  }

  render() {
    if (this.state.error != null) {
      return (
        <FileViewerErrorState
          error={this.state.error}
          format="file"
          sourceKind={this.props.resource.sourceKind}
          download={
            this.props.showDownload === false
              ? null
              : this.props.resource.originalDownload
          }
          className={this.props.className}
        />
      );
    }
    return this.props.children;
  }
}
