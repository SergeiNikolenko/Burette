"use client";

import * as React from "react";

import type { ViewerResource } from "@/lib/viewer-resource";
import type { FileCategory, ViewerDescriptor } from "@/lib/viewer-source";

import { isTiffDescriptor } from "./descriptor";
import { CodeThumbnail } from "./renderers/code-thumbnail";
import { CsvFirstRows } from "./renderers/csv-thumbnail";
import { DocxFirstPage } from "./renderers/docx-thumbnail";
import { HtmlFirstPage } from "./renderers/html-thumbnail";
import { ImageFirstFrame } from "./renderers/image-thumbnail";
import { MarkdownFirstPage } from "./renderers/markdown-thumbnail";
import { MsgEmailThumbnail } from "./renderers/msg-thumbnail";
import { PdfFirstPage } from "./renderers/pdf-thumbnail";
import { PptxFirstSlide } from "./renderers/pptx-thumbnail";
import { TextThumbnail } from "./renderers/text-thumbnail";
import { TiffFirstPage } from "./renderers/tiff-thumbnail";
import { XlsxFirstSheet } from "./renderers/xlsx-thumbnail";
import { isCodeThumbnailDescriptor } from "./thumbnail-code";
import type { ThumbnailAnchor } from "./types";

type DocumentRenderer = (props: {
  resource: ViewerResource;
  descriptor: ViewerDescriptor;
  thumbnailKey: string;
  anchor: ThumbnailAnchor;
  onError: (error: unknown) => void;
}) => React.ReactNode;

const DOCUMENT_RENDERERS: Record<
  Exclude<FileCategory, "unsupported">,
  DocumentRenderer
> = {
  pdf: ({ resource, anchor }) => (
    <PdfFirstPage resource={resource} anchor={anchor} />
  ),
  xlsx: ({ resource, thumbnailKey }) => (
    <XlsxFirstSheet resource={resource} thumbnailKey={thumbnailKey} />
  ),
  pptx: ({ resource, thumbnailKey, anchor }) => (
    <PptxFirstSlide
      resource={resource}
      thumbnailKey={thumbnailKey}
      anchor={anchor}
    />
  ),
  docx: ({ resource }) => <DocxFirstPage resource={resource} />,
  image: ({ resource, descriptor, thumbnailKey, anchor, onError }) =>
    isTiffDescriptor(descriptor) ? (
      <TiffFirstPage
        resource={resource}
        thumbnailKey={thumbnailKey}
        anchor={anchor}
        onError={onError}
      />
    ) : (
      <ImageFirstFrame resource={resource} anchor={anchor} onError={onError} />
    ),
  csv: ({ resource, thumbnailKey }) => (
    <CsvFirstRows resource={resource} thumbnailKey={thumbnailKey} />
  ),
  markdown: ({ resource, thumbnailKey }) => (
    <MarkdownFirstPage resource={resource} thumbnailKey={thumbnailKey} />
  ),
  html: ({ resource, thumbnailKey }) => (
    <HtmlFirstPage resource={resource} thumbnailKey={thumbnailKey} />
  ),
  email: ({ resource, thumbnailKey }) => (
    <MsgEmailThumbnail resource={resource} thumbnailKey={thumbnailKey} />
  ),
  text: ({ resource, descriptor, thumbnailKey }) =>
    isCodeThumbnailDescriptor(descriptor) ? (
      <CodeThumbnail resource={resource} thumbnailKey={thumbnailKey} />
    ) : (
      <TextThumbnail resource={resource} thumbnailKey={thumbnailKey} />
    ),
};

export function FirstThumbnailUnit({
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
  if (descriptor.category === "unsupported") return null;
  const render = DOCUMENT_RENDERERS[descriptor.category];
  return render({ resource, descriptor, thumbnailKey, anchor, onError });
}
