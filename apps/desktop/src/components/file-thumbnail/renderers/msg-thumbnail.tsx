"use client";

import * as React from "react";
import type MsgReader from "@kenjiuno/msgreader";
import type { FieldsData } from "@kenjiuno/msgreader";

import type {
  ViewerContentBytes,
  ViewerContentIdentity,
  ViewerResource,
} from "@/lib/viewer-resource";
import { IframeDoc } from "@/components/file-thumbnail/renderers/layout";
import {
  cachedThumbnailResource,
  createThumbnailArtifactCache,
} from "@/components/file-thumbnail/thumbnail-cache";
import { withThumbnailFormatError } from "@/components/file-thumbnail/thumbnail-errors";
import {
  TEXT_THUMBNAIL_CACHE_MAX_ENTRIES,
  TEXT_THUMBNAIL_MAX_BYTES,
} from "@/components/file-thumbnail/thumbnail-limits";
import {
  shortName,
  timedThumbnail,
} from "@/components/file-thumbnail/thumbnail-profile";
import { useThumbnailResource } from "@/components/file-thumbnail/thumbnail-resource";

type MsgReaderConstructor = new (
  arrayBuffer: ArrayBuffer | DataView,
) => MsgReader;
type MsgThumbnailContent = ViewerContentIdentity & ViewerContentBytes;

let msgReaderLib: Promise<{ default: MsgReaderConstructor }> | null = null;

const msgHtmlCache = createThumbnailArtifactCache<string>({
  maxEntries: TEXT_THUMBNAIL_CACHE_MAX_ENTRIES,
});

function loadMsgReader() {
  if (!msgReaderLib) {
    msgReaderLib = import("@kenjiuno/msgreader") as Promise<{
      default: MsgReaderConstructor;
    }>;
  }
  return msgReaderLib;
}

export function MsgEmailThumbnail({
  resource,
  thumbnailKey,
}: {
  resource: ViewerResource;
  thumbnailKey: string;
}) {
  const html = useThumbnailResource(
    getMsgThumbnailHtml(resource, resource.content, thumbnailKey),
  );

  return <IframeDoc html={html} />;
}

function getMsgThumbnailHtml(
  meta: Pick<ViewerResource, "fileName" | "sourceKind">,
  content: MsgThumbnailContent,
  thumbnailKey: string,
): Promise<string> {
  return cachedThumbnailResource(msgHtmlCache, thumbnailKey, () =>
    withThumbnailFormatError(
      "email",
      "parse_failed",
      meta.fileName,
      "Failed to parse MSG thumbnail",
      () =>
        timedThumbnail(`msg:parse ${shortName(meta)}`, async () => {
          const bytes = await content.readBytes();
          const { default: MsgReaderClass } = await loadMsgReader();
          const reader = new MsgReaderClass(bytes.slice(0));
          const fields = reader.getFileData();
          if (fields.error) throw new Error(fields.error);
          return msgFieldsToHtml(fields);
        }),
    ),
  );
}

export function msgFieldsToHtml(
  fields: Pick<FieldsData, "body" | "bodyHtml" | "html">,
) {
  const bodyHtml = cleanMsgHtml(fields.bodyHtml);
  if (bodyHtml) return bodyHtml;

  if (fields.html?.byteLength) {
    const html = cleanMsgHtml(decodeMsgHtmlBytes(fields.html));
    if (html) return html;
  }

  const body = fields.body?.trim();
  if (body) return plainTextEmailHtml(body);

  throw new Error("MSG file does not contain a previewable email body.");
}

export function decodeMsgHtmlBytes(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (looksLikeUtf16Le(bytes)) return new TextDecoder("utf-16le").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

function looksLikeUtf16Le(bytes: Uint8Array) {
  const sampleLength = Math.min(bytes.byteLength, TEXT_THUMBNAIL_MAX_BYTES);
  if (sampleLength < 4) return false;

  let oddNulls = 0;
  let evenNulls = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index % 2 === 0) evenNulls += 1;
    else oddNulls += 1;
  }

  return oddNulls > evenNulls * 4 && oddNulls > sampleLength / 8;
}

function cleanMsgHtml(html: string | null | undefined) {
  return html?.replace(/\0+$/g, "").trim() ?? "";
}

function plainTextEmailHtml(text: string) {
  return `<!doctype html><html><head><meta charset="utf-8" /></head><body><pre style="margin:0;white-space:pre-wrap;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">${escapeHtml(text)}</pre></body></html>`;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
