"use client";

import * as React from "react";

import type { PdfDocumentProxy } from "@/lib/pdf-document-types";
import { readPdfPageResource } from "@/lib/pdf-document-resource";

import { getPdfCanvasPixelSize } from "./pdf-viewer-canvas";
import {
  readPdfRenderedPageCache,
  writePdfRenderedPageCache,
  type PdfRenderedPageCache,
  type PdfRenderedPageSignature,
} from "./pdf-viewer-render-cache";
import { toPdfRenderFailedError } from "./pdf-viewer-render-error";

const PDF_THUMBNAIL_MAX_DEVICE_PIXEL_RATIO = 1;

export function PdfThumbnailCanvas({
  doc,
  documentKey,
  isRenderingSuspended = false,
  pageNumber,
  renderCache,
  width,
}: {
  doc: PdfDocumentProxy;
  documentKey: string;
  isRenderingSuspended?: boolean;
  pageNumber: number;
  renderCache?: PdfRenderedPageCache;
  width: number;
}) {
  const page = readPdfPageResource(doc, pageNumber);
  const baseViewport = React.useMemo(
    () => page.getViewport({ scale: 1 }),
    [page],
  );
  const viewport = React.useMemo(
    () => page.getViewport({ scale: width / baseViewport.width }),
    [baseViewport.width, page, width],
  );
  const dpr = Math.min(
    (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1,
    PDF_THUMBNAIL_MAX_DEVICE_PIXEL_RATIO,
  );
  const [renderError, setRenderError] = React.useState<unknown>(null);
  if (renderError) throw renderError;

  const canvasRef = React.useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) {
        setRenderError(
          toPdfRenderFailedError(new Error("Canvas 2D context unavailable.")),
        );
        return;
      }

      const renderSignature = {
        documentKey,
        pageNumber,
        scale: width / baseViewport.width,
        rotation: 0,
        devicePixelRatio: dpr,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      } satisfies PdfRenderedPageSignature;
      const canvasWidth = getPdfCanvasPixelSize(viewport.width, dpr);
      const canvasHeight = getPdfCanvasPixelSize(viewport.height, dpr);
      const cachedPage = readPdfRenderedPageCache(renderCache, renderSignature);

      resizeCanvas(canvas, canvasWidth, canvasHeight);
      if (isRenderingSuspended) {
        markCanvasRenderStatus(canvas, renderSignature, "suspended");
        return;
      }

      if (cachedPage) {
        drawCanvasImage(context, cachedPage.canvas, canvasWidth, canvasHeight);
        markCanvasRenderStatus(canvas, renderSignature, "rendered", "cache");
        return;
      }
      markCanvasRenderStatus(canvas, renderSignature, "pending");

      let task: ReturnType<typeof page.render>;
      try {
        task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
      } catch (error) {
        setRenderError(toPdfRenderFailedError(error));
        return;
      }

      let isActive = true;
      let didFinishPdfRender = false;
      task.promise.then(
        () => {
          if (!isActive) return;
          didFinishPdfRender = true;
          writePdfRenderedPageCache({
            cache: renderCache,
            rendered: renderSignature,
            sourceCanvas: canvas,
          });
          markCanvasRenderStatus(canvas, renderSignature, "rendered", "pdfjs");
        },
        (error) => {
          if (!isActive) return;
          didFinishPdfRender = true;
          markCanvasRenderStatus(canvas, renderSignature, "failed");
          setRenderError(toPdfRenderFailedError(error));
        },
      );

      return () => {
        isActive = false;
        if (!didFinishPdfRender) {
          task.cancel();
          markCanvasRenderStatus(canvas, renderSignature, "cancelled");
        }
      };
    },
    [
      baseViewport.width,
      documentKey,
      dpr,
      isRenderingSuspended,
      page,
      pageNumber,
      renderCache,
      viewport,
      width,
    ],
  );

  return (
    <canvas
      ref={canvasRef}
      style={{ width: viewport.width, height: viewport.height }}
      className="block"
    />
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

function markCanvasRenderStatus(
  canvas: HTMLCanvasElement,
  rendered: PdfRenderedPageSignature,
  status: "pending" | "rendered" | "cancelled" | "failed" | "suspended",
  source?: "cache" | "pdfjs",
) {
  canvas.dataset.pdfPageNumber = String(rendered.pageNumber);
  canvas.dataset.pdfRenderStatus = status;
  if (source) {
    canvas.dataset.pdfRenderSource = source;
  } else {
    delete canvas.dataset.pdfRenderSource;
  }
}

export function PdfThumbnailSkeleton() {
  return <div className="bg-muted aspect-[3/4] w-full" />;
}
