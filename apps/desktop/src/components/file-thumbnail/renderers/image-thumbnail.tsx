"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { ViewerContentBlob, ViewerResource } from "@/lib/viewer-resource";
import { FileThumbnailShimmer } from "@/components/ui/file-thumbnail-frame";
import { useObjectUrl } from "@/components/file-thumbnail/renderers/use-object-url";
import {
  cachedThumbnailResource,
  createThumbnailArtifactCache,
} from "@/components/file-thumbnail/thumbnail-cache";
import { createThumbnailImageLoadError } from "@/components/file-thumbnail/thumbnail-errors";
import { useThumbnailResource } from "@/components/file-thumbnail/thumbnail-resource";
import type { ThumbnailAnchor } from "@/components/file-thumbnail/types";
import { ANCHOR_CORNER } from "@/components/file-thumbnail/types";

const IMAGE_BLOB_THUMBNAIL_CACHE_MAX_ENTRIES = 96;

const imageBlobCache = createThumbnailArtifactCache<Blob>({
  maxEntries: IMAGE_BLOB_THUMBNAIL_CACHE_MAX_ENTRIES,
});

function getImageBlob(content: ViewerContentBlob): Promise<Blob> {
  return cachedThumbnailResource(imageBlobCache, content.key, () =>
    content.readBlob(),
  );
}

export function ImageFirstFrame({
  resource,
  anchor,
  onError,
}: {
  resource: ViewerResource;
  anchor: ThumbnailAnchor;
  onError: (error: unknown) => void;
}) {
  const directUrl = resource.content.directUrl;
  if (directUrl) {
    return (
      <ImageUrlPreview url={directUrl} anchor={anchor} onError={onError} />
    );
  }

  return (
    <ImageBlobPreview
      content={resource.content}
      anchor={anchor}
      onError={onError}
    />
  );
}

function ImageUrlPreview({
  url,
  anchor,
  onError,
}: {
  url: string;
  anchor: ThumbnailAnchor;
  onError: (error: unknown) => void;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-white">
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn("absolute block w-full", ANCHOR_CORNER[anchor])}
        onError={() => onError(createThumbnailImageLoadError())}
      />
    </div>
  );
}

function ImageBlobPreview({
  content,
  anchor,
  onError,
}: {
  content: ViewerContentBlob;
  anchor: ThumbnailAnchor;
  onError: (error: unknown) => void;
}) {
  const blob = useThumbnailResource(getImageBlob(content));
  const url = useObjectUrl(blob);

  if (!url) return <FileThumbnailShimmer />;

  return <ImageUrlPreview url={url} anchor={anchor} onError={onError} />;
}
