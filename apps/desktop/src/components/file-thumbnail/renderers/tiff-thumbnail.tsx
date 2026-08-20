"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { ViewerResource } from "@/lib/viewer-resource";
import { FileThumbnailShimmer } from "@/components/ui/file-thumbnail-frame";
import { useObjectUrl } from "@/components/file-thumbnail/renderers/use-object-url";
import {
  cachedThumbnailResource,
  createThumbnailArtifactCache,
} from "@/components/file-thumbnail/thumbnail-cache";
import { withThumbnailDecodeSlot } from "@/components/file-thumbnail/thumbnail-decode-queue";
import {
  createThumbnailImageLoadError,
  withThumbnailFormatError,
} from "@/components/file-thumbnail/thumbnail-errors";
import { TIFF_THUMBNAIL_TARGET_WIDTH } from "@/components/file-thumbnail/thumbnail-limits";
import {
  shortName,
  timedThumbnail,
} from "@/components/file-thumbnail/thumbnail-profile";
import { useThumbnailResource } from "@/components/file-thumbnail/thumbnail-resource";
import {
  thumbnailFileMeta,
  type ThumbnailBytesContent,
  type ThumbnailFileMeta,
} from "@/components/file-thumbnail/thumbnail-text";
import {
  createThumbnailWorkerClient,
  type ThumbnailWorkerMessage,
} from "@/components/file-thumbnail/thumbnail-worker-client";
import type { ThumbnailAnchor } from "@/components/file-thumbnail/types";
import { ANCHOR_CORNER } from "@/components/file-thumbnail/types";

interface TiffWorkerRequest extends ThumbnailWorkerMessage {
  buffer: ArrayBuffer;
  targetWidth: number;
}

interface TiffWorkerReply extends ThumbnailWorkerMessage {
  id: number;
  ok: boolean;
  blob?: Blob;
  error?: string;
}

const tiffWorkerClient = createThumbnailWorkerClient<
  TiffWorkerRequest,
  TiffWorkerReply
>({
  createWorker: () =>
    new Worker(new URL("../../file-thumbnail-tiff.worker", import.meta.url)),
  resolve: (response) =>
    response.ok && response.blob ? response.blob : undefined,
  reject: (response) => response.error ?? "TIFF decode failed",
});

function decodeTiffInWorker(buffer: ArrayBuffer): Promise<Blob> {
  return tiffWorkerClient.request<Blob>({
    request: { buffer, targetWidth: TIFF_THUMBNAIL_TARGET_WIDTH },
    transfer: [buffer],
  });
}

const tiffCache = createThumbnailArtifactCache<Blob>({ maxEntries: 48 });

function getTiffFirstPageBlob(
  meta: ThumbnailFileMeta,
  content: ThumbnailBytesContent,
  thumbnailKey: string,
): Promise<Blob> {
  return cachedThumbnailResource(tiffCache, thumbnailKey, () =>
    withThumbnailDecodeSlot(() =>
      withThumbnailFormatError(
        "image",
        "decode_failed",
        meta.fileName,
        "Failed to decode TIFF thumbnail",
        () =>
          timedThumbnail(`tiff:total ${shortName(meta)}`, async () => {
            const buf = await timedThumbnail("tiff:fetch", () =>
              content.readBytes(),
            );
            return timedThumbnail("tiff:worker-decode", () =>
              decodeTiffInWorker(buf),
            );
          }),
      ),
    ),
  );
}

export function TiffFirstPage({
  resource,
  thumbnailKey,
  anchor,
  onError,
}: {
  resource: ViewerResource;
  thumbnailKey: string;
  anchor: ThumbnailAnchor;
  onError: (error: unknown) => void;
}) {
  const blob = useThumbnailResource(
    getTiffFirstPageBlob(
      thumbnailFileMeta(resource),
      resource.content,
      thumbnailKey,
    ),
  );
  return <TiffBlobImage blob={blob} anchor={anchor} onError={onError} />;
}

function TiffBlobImage({
  blob,
  anchor,
  onError,
}: {
  blob: Blob;
  anchor: ThumbnailAnchor;
  onError: (error: unknown) => void;
}) {
  const url = useObjectUrl(blob);

  if (!url) return <FileThumbnailShimmer />;

  return (
    <div className="absolute inset-0 overflow-hidden bg-white">
      <img
        src={url}
        alt=""
        className={cn("absolute block w-full", ANCHOR_CORNER[anchor])}
        onError={() => onError(createThumbnailImageLoadError())}
      />
    </div>
  );
}
