"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import {
  FileViewer,
  FileViewerContent,
  FileViewerHeader,
  FileViewerControls,
  FileViewerTitle,
  FileViewerInset,
  FileViewerProvider,
  FileViewerViewport,
} from "./file-viewer";
import {
  PdfResourceContent,
  type PdfResourceContentProps,
  type PdfViewerContentProps,
} from "./pdf-viewer-content";
import {
  PdfViewerPages,
  PdfViewerProvider,
  type PdfDocumentSource,
} from "./pdf-viewer-context";
import type { PdfViewerHandle } from "./pdf-viewer-types";

export type {
  PageOverlayProps,
  PdfPageAreaTarget,
  PdfPageRenderSource,
  PdfPageRenderStatus,
  PdfPageRenderTiming,
  PdfViewerHandle,
  PdfViewerPerformanceOptions,
} from "./pdf-viewer-types";
export {
  PdfViewerPages,
  PdfViewerProvider,
  usePdfViewerThumbnails,
  type PdfDocumentSource,
} from "./pdf-viewer-context";
export {
  PdfResourceContent,
  type PdfResourceContentProps,
  type PdfViewerContentProps,
} from "./pdf-viewer-content";
export {
  PdfThumbnailRail,
  PdfViewerThumbnails,
  type PdfThumbnailRailProps,
  type PdfViewerThumbnailsProps,
} from "./pdf-viewer-thumbnails";

export interface PdfHighlightProps extends React.ComponentProps<"div"> {
  /** Normalized box, each field a percentage [0, 100] of the page. */
  area: { left: number; top: number; width: number; height: number };
}

export function PdfHighlight({
  area,
  className,
  style,
  ...props
}: PdfHighlightProps) {
  return (
    <div
      data-slot="pdf-highlight"
      className={cn(
        "border-primary/70 bg-primary/12 pointer-events-none absolute z-10 rounded-[2px] border shadow-[0_4px_16px_rgb(0_0_0_/_8%)]",
        className,
      )}
      style={{
        left: `${area.left}%`,
        top: `${area.top}%`,
        width: `${area.width}%`,
        height: `${area.height}%`,
        ...style,
      }}
      {...props}
    />
  );
}

export interface PdfViewerProps extends PdfViewerContentProps {
  /** Canonical PDF source. URL sources preserve PDF.js range-loading behavior. */
  source: PdfDocumentSource;
}

export const PdfViewer = React.forwardRef<PdfViewerHandle, PdfViewerProps>(
  function PdfViewer(props, ref) {
    const {
      source,
      className,
      bare = false,
      controls = true,
      download = true,
      ...pagesProps
    } = props;
    return (
      <FileViewerProvider source={source}>
        <FileViewer
          className={cn(
            "h-full",
            bare && "rounded-none border-0 bg-transparent",
            className,
          )}
        >
          <PdfViewerProvider>
            <FileViewerHeader>
              <FileViewerTitle className="flex-1" />
              {controls ? <FileViewerControls className="ms-auto" /> : null}
            </FileViewerHeader>
            <FileViewerContent>
              <FileViewerInset>
                <FileViewerViewport>
                  <PdfViewerPages
                    {...pagesProps}
                    bare
                    className="h-full"
                    download={download}
                    ref={ref}
                  />
                </FileViewerViewport>
              </FileViewerInset>
            </FileViewerContent>
          </PdfViewerProvider>
        </FileViewer>
      </FileViewerProvider>
    );
  },
);
