"use client";

import * as React from "react";

import type { ViewerResource } from "@/lib/viewer-resource";
import { GridTable } from "@/components/file-thumbnail/renderers/layout";
import {
  cachedThumbnailResource,
  createThumbnailArtifactCache,
} from "@/components/file-thumbnail/thumbnail-cache";
import { withThumbnailDecodeSlot } from "@/components/file-thumbnail/thumbnail-decode-queue";
import { withThumbnailFormatError } from "@/components/file-thumbnail/thumbnail-errors";
import {
  XLSX_THUMBNAIL_MAX_COLUMNS,
  XLSX_THUMBNAIL_MAX_ROWS,
} from "@/components/file-thumbnail/thumbnail-limits";
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

interface XlsxPreview {
  rows: string[][];
}

interface XlsxWorkerRequest extends ThumbnailWorkerMessage {
  buffer: ArrayBuffer;
  maxRows: number;
  maxCols: number;
}

interface XlsxWorkerReply extends ThumbnailWorkerMessage {
  id: number;
  ok: boolean;
  rows?: string[][];
  error?: string;
}

const xlsxWorkerClient = createThumbnailWorkerClient<
  XlsxWorkerRequest,
  XlsxWorkerReply
>({
  createWorker: () =>
    new Worker(new URL("../../file-thumbnail-xlsx.worker", import.meta.url)),
  resolve: (response) =>
    response.ok && response.rows ? response.rows : undefined,
  reject: (response) => response.error ?? "XLSX parse failed",
});

function parseXlsxInWorker(buffer: ArrayBuffer): Promise<string[][]> {
  return xlsxWorkerClient.request<string[][]>({
    request: {
      buffer,
      maxRows: XLSX_THUMBNAIL_MAX_ROWS,
      maxCols: XLSX_THUMBNAIL_MAX_COLUMNS,
    },
    transfer: [buffer],
  });
}

const xlsxCache = createThumbnailArtifactCache<XlsxPreview>({
  maxEntries: 64,
});

function getXlsxPreview(
  meta: ThumbnailFileMeta,
  content: ThumbnailBytesContent,
  thumbnailKey: string,
): Promise<XlsxPreview> {
  return cachedThumbnailResource(xlsxCache, thumbnailKey, () =>
    withThumbnailDecodeSlot(() =>
      timedThumbnail(`xlsx:total ${shortName(meta)}`, async () => {
        const rows = await withThumbnailFormatError(
          "xlsx",
          "parse_failed",
          meta.fileName,
          "Failed to parse spreadsheet thumbnail",
          async () => {
            const buf = await content.readBytes();
            return timedThumbnail("xlsx:worker-parse", () =>
              parseXlsxInWorker(buf),
            );
          },
        );
        return { rows };
      }),
    ),
  );
}

export function XlsxFirstSheet({
  resource,
  thumbnailKey,
}: {
  resource: ViewerResource;
  thumbnailKey: string;
}) {
  const { rows } = useThumbnailResource(
    getXlsxPreview(thumbnailFileMeta(resource), resource.content, thumbnailKey),
  );
  return <GridTable rows={rows} />;
}
