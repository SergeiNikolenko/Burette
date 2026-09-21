"use client";

import * as React from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";

import { cn } from "@/lib/utils";
import type { ViewerResource } from "@/lib/viewer-resource";
import { getPptxSource } from "@/components/ui/pptx-viewer-source";
import {
  cachedThumbnailResource,
  createThumbnailArtifactCache,
} from "@/components/file-thumbnail/thumbnail-cache";
import { withThumbnailDecodeSlot } from "@/components/file-thumbnail/thumbnail-decode-queue";
import { withThumbnailFormatError } from "@/components/file-thumbnail/thumbnail-errors";
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
import type { ThumbnailAnchor } from "@/components/file-thumbnail/types";
import { ANCHOR_CORNER } from "@/components/file-thumbnail/types";

interface PptxFirstSlideSource {
  render: (canvas: HTMLCanvasElement, scale: number) => Promise<void>;
  baseWidth: number;
  baseHeight: number;
  dispose?: () => void;
}

const pptxCache = createThumbnailArtifactCache<PptxFirstSlideSource>({
  maxEntries: 4,
  dispose: (source) => source.dispose?.(),
});

function getPptxFirstSlide(
  meta: ThumbnailFileMeta,
  content: ThumbnailBytesContent,
  thumbnailKey: string,
): Promise<PptxFirstSlideSource> {
  return cachedThumbnailResource(pptxCache, thumbnailKey, () =>
    withThumbnailDecodeSlot(() =>
      withThumbnailFormatError(
        "pptx",
        "parse_failed",
        meta.fileName,
        "Failed to parse presentation thumbnail",
        () =>
          timedThumbnail(`pptx:total ${shortName(meta)}`, async () => {
            const source = await getPptxSource(content);
            const release = source.retain();
            const render = async (canvas: HTMLCanvasElement, scale: number) => {
              await withThumbnailFormatError(
                "pptx",
                "render_failed",
                meta.fileName,
                "Failed to render presentation thumbnail",
                async () => {
                  const result = await source.renderSlide({
                    canvas,
                    renderScale: scale,
                    slideIndex: 0,
                    priority: {
                      distanceFromReadingMarker: 0,
                      isCurrentSlide: true,
                      isInViewport: true,
                      isScrollLead: true,
                    },
                  });
                  if (result.status === "failed") throw result.error;
                },
              );
            };
            return {
              render,
              baseWidth: source.baseSize.width,
              baseHeight: source.baseSize.height,
              dispose: release,
            };
          }),
      ),
    ),
  );
}

export function PptxFirstSlide({
  resource,
  thumbnailKey,
  anchor,
}: {
  resource: ViewerResource;
  thumbnailKey: string;
  anchor: ThumbnailAnchor;
}) {
  useMountEffect(() => {
    const preload = () => {
      void import("@/components/ui/pptx-viewer").then((module) => {
        module.preloadPptxViewer();
      });
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(preload);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preload, 0);
    return () => window.clearTimeout(id);
  });

  const source = useThumbnailResource(
    getPptxFirstSlide(
      thumbnailFileMeta(resource),
      resource.content,
      thumbnailKey,
    ),
  );
  const [renderError, setRenderError] = React.useState<unknown>(null);
  const baseW = source.baseWidth || 960;
  const baseH = source.baseHeight || 720;
  const FILL_PX = 1024;
  const scale = FILL_PX / Math.min(baseW, baseH);

  if (renderError) throw renderError;

  const canvasRef = React.useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      let active = true;
      source.render(canvas, scale).catch((error: unknown) => {
        if (active) setRenderError(error);
      });
      return () => {
        active = false;
      };
    },
    [source, scale],
  );

  const landscape = baseW >= baseH;
  return (
    <div className="absolute inset-0 overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute block",
          ANCHOR_CORNER[anchor],
          landscape ? "h-full w-auto max-w-none" : "h-auto w-full",
        )}
        style={{ aspectRatio: `${baseW} / ${baseH}` }}
      />
    </div>
  );
}
