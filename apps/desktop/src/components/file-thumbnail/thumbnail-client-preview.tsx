"use client";

import * as React from "react";

import type { ViewerResource } from "@/lib/viewer-resource";
import type { ViewerDescriptor } from "@/lib/viewer-source";
import { FileThumbnailShimmer } from "@/components/ui/file-thumbnail-frame";
import { useIsClient } from "@/components/ui/use-is-client";

import { ThumbnailErrorBoundary } from "./errors";
import { FirstThumbnailUnit } from "./renderer-registry";
import { useThumbnailInView } from "./thumbnail-in-view";
import type { ThumbnailAnchor } from "./types";

export function ThumbnailClientPreview({
  resource,
  descriptor,
  thumbnailKey,
  anchor,
  onError,
}: {
  resource: ViewerResource;
  descriptor: ViewerDescriptor;
  thumbnailKey: string;
  anchor: ThumbnailAnchor;
  onError: (error: unknown) => void;
}) {
  const isClient = useIsClient();
  const { ref: inViewRef, seen: isSeen } = useThumbnailInView();

  return (
    <div ref={inViewRef} className="absolute inset-0">
      {isClient && isSeen ? (
        <ThumbnailErrorBoundary fallback={null} onError={onError}>
          <React.Suspense fallback={<FileThumbnailShimmer />}>
            <FirstThumbnailUnit
              resource={resource}
              descriptor={descriptor}
              thumbnailKey={thumbnailKey}
              anchor={anchor}
              onError={onError}
            />
          </React.Suspense>
        </ThumbnailErrorBoundary>
      ) : (
        <FileThumbnailShimmer />
      )}
    </div>
  );
}
