"use client";

import type { ViewerSource } from "@/lib/viewer-source";
import { GeneratedFileThumbnail } from "@/components/file-thumbnail/generated-preview";

import {
  FileThumbnailFrame,
  FileThumbnailShimmer,
  hasRenderablePreviewContent,
  resolveFileThumbnailState,
} from "./file-thumbnail-frame";
import type {
  FileThumbnailFrameProps,
  FileThumbnailProps,
  FileThumbnailShape,
  FileThumbnailSize,
  FileThumbnailSource,
  FileThumbnailState,
  ThumbnailFile,
} from "./file-thumbnail-types";

export {
  FileThumbnailFrame,
  FileThumbnailShimmer,
  hasRenderablePreviewContent,
  resolveFileThumbnailState,
};
export type {
  FileThumbnailFrameProps,
  FileThumbnailProps,
  FileThumbnailShape,
  FileThumbnailSize,
  FileThumbnailSource,
  FileThumbnailState,
  ThumbnailFile,
};

/**
 * Render a complete file thumbnail from a browser File, a viewer source, an
 * externally generated image, custom preview content, or plain file metadata.
 */
export function FileThumbnail({
  source,
  file,
  as,
  anchor,
  presentation = "document",
  retryKey,
  onError,
  ...frameProps
}: FileThumbnailProps) {
  const resolvedSource = resolveFileThumbnailSource(source, file);
  const accessibilityProps =
    presentation === "decorative"
      ? ({
          "aria-hidden": true,
          role: "presentation",
        } as const)
      : {};
  const {
    previewClassName: _previewClassName,
    previewContent: _previewContent,
    previewImageUrl: _previewImageUrl,
    onPreviewError: _onPreviewError,
    state: _state,
    ...thumbnailProps
  } = frameProps;

  if (shouldUseFrame(frameProps) || !resolvedSource) {
    return (
      <FileThumbnailFrame
        {...frameProps}
        {...accessibilityProps}
        file={file ?? fileFromSource(resolvedSource)}
      />
    );
  }

  return (
    <GeneratedFileThumbnail
      {...thumbnailProps}
      {...accessibilityProps}
      source={resolvedSource}
      as={as}
      anchor={anchor ?? "top-left"}
      retryKey={retryKey}
      onError={onError}
    />
  );
}

function shouldUseFrame({
  previewContent,
  previewImageUrl,
  state,
}: Pick<
  FileThumbnailProps,
  "previewContent" | "previewImageUrl" | "state"
>): boolean {
  return (
    hasRenderablePreviewContent(previewContent) ||
    Boolean(previewImageUrl) ||
    state !== undefined
  );
}

function resolveFileThumbnailSource(
  source: FileThumbnailProps["source"],
  file: FileThumbnailProps["file"],
): ViewerSource | null {
  if (isFile(source)) return fileSource(source);
  if (source) return source;
  if (isFile(file)) return fileSource(file);
  return null;
}

function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function fileSource(file: File): ViewerSource {
  return {
    kind: "blob",
    blob: file,
    identityKey: `${file.name}-${file.size}-${file.lastModified}`,
    fileName: file.name,
    mimeType: file.type,
  };
}

function fileFromSource(source: ViewerSource | null): ThumbnailFile {
  if (!source) return { name: "file", type: "" };
  return {
    name: source.fileName ?? "file",
    type: source.mimeType ?? "",
  };
}
