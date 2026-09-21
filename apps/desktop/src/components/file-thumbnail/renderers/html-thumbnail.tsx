"use client";

import * as React from "react";

import type { ViewerResource } from "@/lib/viewer-resource";
import { IframeDoc } from "@/components/file-thumbnail/renderers/layout";
import { useThumbnailResource } from "@/components/file-thumbnail/thumbnail-resource";
import {
  getThumbnailText,
  thumbnailFileMeta,
} from "@/components/file-thumbnail/thumbnail-text";

export function HtmlFirstPage({
  resource,
  thumbnailKey,
}: {
  resource: ViewerResource;
  thumbnailKey: string;
}) {
  const html = useThumbnailResource(
    getThumbnailText(
      thumbnailFileMeta(resource),
      resource.content,
      thumbnailKey,
    ),
  );
  return <IframeDoc html={html} />;
}
