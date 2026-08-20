"use client";

import * as React from "react";

import type { ViewerResource } from "@/lib/viewer-resource";
import { formatCodeThumbnailText } from "@/components/file-thumbnail/thumbnail-code";
import { useThumbnailResource } from "@/components/file-thumbnail/thumbnail-resource";
import {
  getThumbnailText,
  thumbnailFileMeta,
} from "@/components/file-thumbnail/thumbnail-text";

const CODE_THUMBNAIL_MAX_LINES = 60;
const CODE_THUMBNAIL_FONT_SIZE = 5;
const CODE_THUMBNAIL_LINE_HEIGHT = 1.5;
const CODE_THUMBNAIL_LINE_NUMBER_WIDTH_CLASS = "w-2.5";

export function CodeThumbnail({
  resource,
  thumbnailKey,
}: {
  resource: ViewerResource;
  thumbnailKey: string;
}) {
  const raw = useThumbnailResource(
    getThumbnailText(
      thumbnailFileMeta(resource),
      resource.content,
      thumbnailKey,
    ),
  );
  const text = React.useMemo(
    () => formatCodeThumbnailText(raw, resource.fileName, resource.mimeType),
    [raw, resource.fileName, resource.mimeType],
  );
  const lines = React.useMemo(
    () =>
      text
        .replace(/\r?\n$/, "")
        .split(/\r\n?|\n/)
        .slice(0, CODE_THUMBNAIL_MAX_LINES),
    [text],
  );

  return (
    <div
      data-slot="code-thumbnail"
      className="bg-code text-code-foreground absolute inset-0 overflow-hidden"
    >
      <div
        aria-hidden
        className={`absolute inset-y-0 left-0 ${CODE_THUMBNAIL_LINE_NUMBER_WIDTH_CLASS} bg-code-highlight`}
      />
      <div
        className="relative font-mono"
        style={{
          fontSize: CODE_THUMBNAIL_FONT_SIZE,
          lineHeight: CODE_THUMBNAIL_LINE_HEIGHT,
        }}
      >
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span
              className={`${CODE_THUMBNAIL_LINE_NUMBER_WIDTH_CLASS} text-code-number shrink-0 pr-px text-right select-none`}
            >
              {i + 1}
            </span>
            <span className="pl-0.5 whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
