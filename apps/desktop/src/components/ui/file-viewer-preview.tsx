"use client";

import { cn } from "@/lib/utils";

import {
  FileViewerContent,
  FileViewerInset,
  FileViewerViewport,
} from "./file-viewer-layout";
import { FileViewerDocument } from "./file-viewer-document";
import { FileViewer } from "./file-viewer-shell";
import { FileViewerProvider } from "./file-viewer-provider";
import { type FileViewerResourceOptions } from "./file-viewer-resource-state";

export type FileViewerPreviewProps = FileViewerResourceOptions & {
  className?: string;
};

export function FileViewerPreview({
  category,
  className,
  fallbackFrameSize,
  fallbackSlideSize,
  isolateStyles,
  source,
}: FileViewerPreviewProps) {
  return (
    <FileViewerProvider
      category={category}
      fallbackFrameSize={fallbackFrameSize}
      fallbackSlideSize={fallbackSlideSize}
      isolateStyles={isolateStyles}
      source={source}
    >
      <FileViewer
        data-file-viewer-mode="preview"
        className={cn("h-full min-h-0", className)}
      >
        <FileViewerContent>
          <FileViewerInset>
            <FileViewerViewport>
              <FileViewerDocument controls />
            </FileViewerViewport>
          </FileViewerInset>
        </FileViewerContent>
      </FileViewer>
    </FileViewerProvider>
  );
}
