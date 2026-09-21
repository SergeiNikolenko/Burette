"use client";

import * as React from "react";

import { getDocxDocumentResource } from "@/lib/docx-document-resource";
import type { ViewerResource } from "@/lib/viewer-resource";
import { renderCachedDocxPreview } from "@/components/ui/docx-viewer-render";
import {
  Surface,
  useElementWidth,
} from "@/components/file-thumbnail/renderers/layout";
import { withThumbnailDecodeSlot } from "@/components/file-thumbnail/thumbnail-decode-queue";
import { withThumbnailFormatError } from "@/components/file-thumbnail/thumbnail-errors";
import {
  shortName,
  timedThumbnail,
} from "@/components/file-thumbnail/thumbnail-profile";
import { useThumbnailResource } from "@/components/file-thumbnail/thumbnail-resource";

const DOCX_PAGE_W = 816; // US Letter at 96dpi
const DOCX_THUMBNAIL_PAGE_STYLE = {
  backgroundColor: "white",
  color: "black",
  colorScheme: "light",
} satisfies React.CSSProperties;

export function DocxFirstPage({ resource }: { resource: ViewerResource }) {
  const bytes = useThumbnailResource(getDocxDocumentResource(resource.content));
  const { ref: frameRef, width: frameWidth } = useElementWidth();
  const [renderError, setRenderError] = React.useState<unknown>(null);

  const renderRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      let active = true;
      void withThumbnailDecodeSlot(() =>
        withThumbnailFormatError(
          "docx",
          "render_failed",
          resource.fileName,
          "Failed to render DOCX thumbnail",
          () =>
            timedThumbnail(`docx:render ${shortName(resource)}`, async () => {
              if (!active) return;
              const { renderHost } = await renderCachedDocxPreview({
                buffer: () => bytes.slice(0),
                cacheKey: resource.content.key,
                getScale: () => 1,
              });
              if (!active) return;
              commitDocxThumbnailRender(el, renderHost);
            }),
        ),
      ).catch((error) => {
        if (active) setRenderError(error);
      });
      return () => {
        active = false;
      };
    },
    [bytes, resource],
  );

  const scale = frameWidth ? frameWidth / DOCX_PAGE_W : null;

  if (renderError) throw renderError;

  return (
    <Surface>
      <div ref={frameRef} className="absolute inset-0 overflow-hidden bg-white">
        <div
          className="absolute top-0 left-0 origin-top-left [&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0 [&_section.docx]:!mb-0 [&_section.docx]:!bg-white [&_section.docx]:!text-black [&_section.docx]:!shadow-none"
          style={{
            ...DOCX_THUMBNAIL_PAGE_STYLE,
            width: DOCX_PAGE_W,
            transform: scale ? `scale(${scale})` : undefined,
            visibility: scale ? "visible" : "hidden",
          }}
        >
          <div ref={renderRef} />
        </div>
      </div>
    </Surface>
  );
}

function commitDocxThumbnailRender(host: HTMLElement, renderHost: HTMLElement) {
  const wrapper = renderHost.querySelector<HTMLElement>(".docx-wrapper");
  const firstPage = renderHost.querySelector<HTMLElement>(
    ".docx-wrapper > section.docx",
  );
  if (!wrapper || !firstPage) {
    throw new Error("DOCX render produced no pages.");
  }

  const staticNodes = Array.from(renderHost.childNodes).filter(
    (node) => node !== wrapper,
  );
  wrapper.replaceChildren(firstPage);
  host.replaceChildren(...staticNodes, wrapper);
}
