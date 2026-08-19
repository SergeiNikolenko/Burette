"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";

import { getFileThumbnailExtension } from "./file-thumbnail-extension";
import { FileThumbnailFallback } from "./file-thumbnail-fallback";
import type {
  FileThumbnailFrameProps,
  FileThumbnailShape,
  FileThumbnailSize,
  FileThumbnailState,
} from "./file-thumbnail-frame-types";
import { FileThumbnailImage } from "./file-thumbnail-image";
import { FileThumbnailShimmer } from "./file-thumbnail-shimmer";

export { FileThumbnailShimmer };
export type {
  FileThumbnailFrameProps,
  FileThumbnailShape,
  FileThumbnailSize,
  FileThumbnailState,
};

const FILE_THUMBNAIL_SIZE_CLASS_NAME: Record<FileThumbnailSize, string> = {
  xs: "w-9",
  sm: "w-10",
  md: "w-12",
  lg: "w-16",
  xl: "w-20",
};

const FILE_THUMBNAIL_SHAPE_ASPECT_RATIO: Record<FileThumbnailShape, string> = {
  document: "3 / 4",
  square: "1 / 1",
};

/**
 * The dependency-free thumbnail frame: loading shimmer, image fade-in,
 * custom-rendered preview slot, and extension fallback.
 */
export function FileThumbnailFrame({
  file,
  className,
  previewAspectRatio,
  previewClassName,
  previewContent,
  previewImageUrl,
  thumbnailShape,
  thumbnailSize,
  onPreviewError,
  state,
  style,
  ...props
}: FileThumbnailFrameProps) {
  const extension = getFileThumbnailExtension(file);
  const resolvedShape =
    thumbnailShape ?? (previewAspectRatio === 1 ? "square" : "document");
  const hasRenderableContent = hasRenderablePreviewContent(previewContent);
  const resolvedState = resolveFileThumbnailState({
    explicitState: state,
    hasPreview: hasRenderableContent || Boolean(previewImageUrl),
  });

  return (
    <div
      {...props}
      data-slot="file-thumbnail"
      data-thumbnail-shape={resolvedShape}
      data-thumbnail-size={thumbnailSize}
      className={cn(
        "bg-muted text-muted-foreground relative overflow-hidden rounded-md border",
        thumbnailSize
          ? FILE_THUMBNAIL_SIZE_CLASS_NAME[thumbnailSize]
          : undefined,
        className,
      )}
      style={{
        ...style,
        aspectRatio:
          style?.aspectRatio ??
          (previewAspectRatio
            ? formatFileThumbnailAspectRatio(previewAspectRatio)
            : FILE_THUMBNAIL_SHAPE_ASPECT_RATIO[resolvedShape]),
      }}
    >
      {resolvedState === "loading" ? (
        <FileThumbnailShimmer />
      ) : resolvedState === "error" ? (
        <FileThumbnailFallback extension={extension} />
      ) : hasRenderableContent ? (
        <div className={cn("absolute inset-0", previewClassName)}>
          {previewContent}
        </div>
      ) : previewImageUrl ? (
        <FileThumbnailImage
          key={previewImageUrl}
          url={previewImageUrl}
          alt={file.name}
          className={previewClassName}
          fallback={<FileThumbnailFallback extension={extension} />}
          onError={onPreviewError}
        />
      ) : (
        <FileThumbnailFallback extension={extension} />
      )}
    </div>
  );
}

function formatFileThumbnailAspectRatio(value: number) {
  return value === 1 ? "1 / 1" : String(value);
}

export function resolveFileThumbnailState({
  explicitState,
  hasPreview,
}: {
  explicitState?: FileThumbnailState;
  hasPreview: boolean;
}): FileThumbnailState {
  if (explicitState) return explicitState;
  return hasPreview ? "loaded" : "error";
}

export function hasRenderablePreviewContent(value: React.ReactNode): boolean {
  return value !== null && value !== undefined && value !== false;
}
