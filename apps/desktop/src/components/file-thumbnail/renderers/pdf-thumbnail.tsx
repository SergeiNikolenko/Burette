"use client";

import * as React from "react";

import type { PdfDocumentProxy } from "@/lib/pdf-document-types";
import {
  getPdfDocumentResource,
  getPdfPageResource,
} from "@/lib/pdf-document-resource";
import { cn } from "@/lib/utils";
import type { ViewerResource } from "@/lib/viewer-resource";
import { withThumbnailFormatError } from "@/components/file-thumbnail/thumbnail-errors";
import { useThumbnailResource } from "@/components/file-thumbnail/thumbnail-resource";
import type { ThumbnailAnchor } from "@/components/file-thumbnail/types";
import { ANCHOR_CORNER } from "@/components/file-thumbnail/types";
import { getPdfCanvasPixelSize } from "@/components/ui/pdf-viewer-canvas";
import {
  readPdfRenderedPageCache,
  usePdfRenderedPageCache,
  writePdfRenderedPageCache,
  type PdfRenderedPageSignature,
} from "@/components/ui/pdf-viewer-render-cache";

const PDF_FIRST_PAGE_THUMBNAIL_WIDTH = 520;

// Page 1 via pdfjs, reusing the PdfViewer's cached document.
export function PdfFirstPage({
  resource,
  anchor,
}: {
  resource: ViewerResource;
  anchor: ThumbnailAnchor;
}) {
  const doc = useThumbnailResource(
    getPdfDocumentResource(resource.content),
  ) as PdfDocumentProxy;
  const renderCache = usePdfRenderedPageCache(doc);
  const page = useThumbnailResource(getPdfPageResource(doc, 1));
  const [renderError, setRenderError] = React.useState<unknown>(null);

  const baseViewport = React.useMemo(
    () => page.getViewport({ scale: 1 }),
    [page],
  );
  const viewport = React.useMemo(() => {
    return page.getViewport({
      scale: PDF_FIRST_PAGE_THUMBNAIL_WIDTH / baseViewport.width,
    });
  }, [baseViewport.width, page]);
  const dpr =
    (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;

  if (renderError) throw renderError;

  const canvasRef = React.useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const renderSignature = {
        documentKey: resource.content.key,
        pageNumber: 1,
        scale: PDF_FIRST_PAGE_THUMBNAIL_WIDTH / baseViewport.width,
        rotation: 0,
        devicePixelRatio: dpr,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      } satisfies PdfRenderedPageSignature;
      const canvasWidth = getPdfCanvasPixelSize(viewport.width, dpr);
      const canvasHeight = getPdfCanvasPixelSize(viewport.height, dpr);
      const cachedPage = readPdfRenderedPageCache(renderCache, renderSignature);

      resizeCanvas(canvas, canvasWidth, canvasHeight);
      if (cachedPage) {
        drawCanvasImage(context, cachedPage.canvas, canvasWidth, canvasHeight);
        return;
      }

      let active = true;
      let didFinishPdfRender = false;
      let task: ReturnType<typeof page.render>;
      try {
        task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
      } catch (error) {
        void normalizePdfThumbnailRenderError(
          resource.fileName,
          Promise.reject(error),
        ).catch((normalizedError: unknown) => {
          if (active) setRenderError(normalizedError);
        });
        return () => {
          active = false;
        };
      }
      void normalizePdfThumbnailRenderError(
        resource.fileName,
        task.promise,
      ).then(
        () => {
          if (!active) return;
          didFinishPdfRender = true;
          writePdfRenderedPageCache({
            cache: renderCache,
            rendered: renderSignature,
            sourceCanvas: canvas,
          });
        },
        (error: unknown) => {
          didFinishPdfRender = true;
          if (active) setRenderError(error);
        },
      );
      return () => {
        active = false;
        if (!didFinishPdfRender) task.cancel();
      };
    },
    [
      baseViewport.width,
      dpr,
      page,
      renderCache,
      resource.content.key,
      resource.fileName,
      viewport,
    ],
  );

  return (
    <div className="absolute inset-0 overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        className={cn("absolute block w-full", ANCHOR_CORNER[anchor])}
      />
    </div>
  );
}

function normalizePdfThumbnailRenderError(
  fileName: string,
  promise: Promise<void>,
) {
  return withThumbnailFormatError(
    "pdf",
    "render_failed",
    fileName,
    "Failed to render PDF thumbnail",
    () => promise,
  );
}

function resizeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function drawCanvasImage(
  context: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  width: number,
  height: number,
) {
  if (typeof context.setTransform === "function") {
    context.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (typeof context.drawImage === "function") {
    context.drawImage(image, 0, 0, width, height);
  }
}
