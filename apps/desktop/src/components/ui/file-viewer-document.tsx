"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { FileErrorBoundary, ViewerFallback } from "./file-viewer-fallback";
import { useFileViewerRequiredResourceState } from "./file-viewer-resource-state";
import { FileViewerRoute } from "./file-viewer-route";
import { useIsInsideFileViewerViewport } from "./file-viewer-layout";

export type FileViewerDocumentProps = {
  className?: string;
  controls?: boolean;
};

export function FileViewerDocument({
  className,
  controls = false,
}: FileViewerDocumentProps) {
  const isInsideViewport = useIsInsideFileViewerViewport();

  if (process.env.NODE_ENV !== "production" && !isInsideViewport) {
    throw new Error(
      "FileViewerDocument must be rendered inside FileViewerViewport.",
    );
  }

  return (
    <FileViewerDocumentContent
      className={cn("h-full", className)}
      controls={controls}
    />
  );
}

function FileViewerDocumentContent({
  className,
  controls,
}: Required<Pick<FileViewerDocumentProps, "controls">> &
  Pick<FileViewerDocumentProps, "className">) {
  const {
    descriptor,
    descriptorKey,
    descriptorSignal,
    fallbackFrameSize,
    fallbackSlideSize,
    isClient,
    isolateStyles,
    resource,
  } = useFileViewerRequiredResourceState();
  const fallback = (
    <ViewerFallback
      resource={resource}
      className={className}
      bare
      controls={controls}
      fallbackFrameSize={fallbackFrameSize}
      fallbackSlideSize={fallbackSlideSize}
    />
  );

  if (!isClient) return fallback;

  return (
    <FileErrorBoundary
      key={descriptorKey}
      descriptor={descriptor}
      resource={resource}
      className={className}
      resetKey={descriptorKey}
      showDownload={controls}
    >
      <React.Suspense fallback={fallback}>
        <FileViewerRoute
          className={className}
          controls={controls}
          descriptor={descriptor}
          descriptorSignal={descriptorSignal}
          fallbackFrameSize={fallbackFrameSize}
          fallbackSlideSize={fallbackSlideSize}
          frame="none"
          isolateStyles={isolateStyles}
          resource={resource}
        />
      </React.Suspense>
    </FileErrorBoundary>
  );
}
