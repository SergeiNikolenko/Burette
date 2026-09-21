"use client";

import * as React from "react";

import type { ViewerErrorInfo } from "@/lib/viewer-errors";
import { createViewerResource } from "@/lib/viewer-resource";
import type { FileCategory, ViewerSource } from "@/lib/viewer-source";
import {
  FileThumbnailFrame,
  type FileThumbnailFrameProps,
} from "@/components/ui/file-thumbnail-frame";

import { resolveThumbnailDescriptor } from "./descriptor";
import { getThumbnailKey, getThumbnailRenderKey } from "./keys";
import { ThumbnailClientPreview } from "./thumbnail-client-preview";
import {
  DirectImageThumbnail,
  isDirectImageThumbnail,
} from "./thumbnail-direct-image";
import {
  createThumbnailErrorState,
  type ThumbnailErrorState,
} from "./thumbnail-error-state";
import { getThumbnailOptions } from "./thumbnail-options";
import type { ThumbnailAnchor } from "./types";

export interface GeneratedFileThumbnailProps
  extends Omit<FileThumbnailFrameProps, "file" | "onError"> {
  source: ViewerSource;
  as?: FileCategory;
  anchor: ThumbnailAnchor;
  retryKey?: React.Key;
  onError?: (error: unknown, info: ViewerErrorInfo) => void;
}

export function GeneratedFileThumbnail({
  source,
  as,
  className,
  previewAspectRatio,
  anchor,
  retryKey,
  onError,
  ...props
}: GeneratedFileThumbnailProps) {
  const descriptor = resolveThumbnailDescriptor({ source, as });
  const resource = React.useMemo(() => createViewerResource(source), [source]);
  const thumbnailKey = getThumbnailKey({
    resource,
    descriptor,
    options: getThumbnailOptions(descriptor),
  });
  const renderKey = getThumbnailRenderKey({
    thumbnailKey,
    anchor,
    retryKey: retryKey ?? null,
  });
  const [errorState, setErrorState] =
    React.useState<ThumbnailErrorState | null>(null);
  const currentErrorState =
    errorState?.renderKey === renderKey ? errorState : null;
  const directUrl = resource.content.directUrl;

  if (descriptor.category === "unsupported") {
    return (
      <FileThumbnailFrame
        {...props}
        file={{ name: descriptor.displayName, type: descriptor.mimeType ?? "" }}
        previewAspectRatio={previewAspectRatio}
        className={className}
      />
    );
  }

  if (isDirectImageThumbnail({ descriptor, directUrl })) {
    return (
      <DirectImageThumbnail
        descriptor={descriptor}
        resource={resource}
        directUrl={directUrl!}
        previewAspectRatio={previewAspectRatio}
        className={className}
        anchor={anchor}
        renderKey={renderKey}
        errorState={currentErrorState}
        thumbnailProps={props}
        onError={(error, nextErrorState) => {
          setErrorState(nextErrorState);
          onError?.(error, nextErrorState.info);
        }}
      />
    );
  }

  return (
    <FileThumbnailFrame
      {...props}
      file={{ name: descriptor.displayName, type: descriptor.mimeType ?? "" }}
      previewAspectRatio={previewAspectRatio}
      className={className}
      state={currentErrorState ? "error" : "loaded"}
      aria-label={currentErrorState?.info.userMessage}
      title={currentErrorState?.info.userMessage}
      data-error-domain={currentErrorState?.info.domain}
      data-error-format={currentErrorState?.info.format}
      data-error-kind={currentErrorState?.info.kind}
      data-error-message={currentErrorState?.info.message}
      previewContent={
        <ThumbnailClientPreview
          key={renderKey}
          resource={resource}
          descriptor={descriptor}
          thumbnailKey={thumbnailKey}
          anchor={anchor}
          onError={(error) => {
            const nextErrorState = createThumbnailErrorState({
              renderKey,
              error,
              resource,
              descriptor,
            });
            setErrorState(nextErrorState);
            onError?.(error, nextErrorState.info);
          }}
        />
      }
    />
  );
}
