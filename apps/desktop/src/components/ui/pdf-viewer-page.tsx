import * as React from "react";

import { readPdfPageResource } from "@/lib/pdf-document-resource";
import type { PdfDocumentProxy } from "@/lib/pdf-document-types";

import { getPdfCanvasPixelSize } from "./pdf-viewer-canvas";
import {
  readPdfRenderedPageCache,
  readPdfRenderedPageCachePreview,
  writePdfRenderedPageCache,
  type PdfRenderedPageCache,
  type PdfRenderedPageSignature,
} from "./pdf-viewer-render-cache";
import { toPdfRenderFailedError } from "./pdf-viewer-render-error";
import type {
  PageOverlayProps,
  PdfPageRenderStatus,
  PdfPageRenderTiming,
  PdfPageSize,
} from "./pdf-viewer-types";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

type PdfRenderedPage = PdfRenderedPageSignature;
type PdfDocumentPage = ReturnType<typeof readPdfPageResource>;
type PdfViewportSize = {
  width: number;
  height: number;
};

type PdfPageProps = {
  document: PdfDocumentProxy;
  documentKey: string;
  pageNumber: number;
  scale: number;
  renderScale?: number;
  isLayoutTransitioning?: boolean;
  rotation: number;
  devicePixelRatio: number;
  renderCache?: PdfRenderedPageCache;
  renderOverlay?: (props: PageOverlayProps) => React.ReactNode;
  onRenderTiming?: (timing: PdfPageRenderTiming) => void;
  onSize?: (pageNumber: number, size: PdfPageSize) => void;
};

type PdfPageCanvasProps = {
  documentKey: string;
  page: PdfDocumentPage;
  pageNumber: number;
  renderScale: number;
  rotation: number;
  devicePixelRatio: number;
  renderCache?: PdfRenderedPageCache;
  onRenderTiming?: (timing: PdfPageRenderTiming) => void;
};

export const PdfPage = React.memo(function PdfPage({
  document,
  documentKey,
  pageNumber,
  scale,
  renderScale,
  isLayoutTransitioning,
  rotation,
  devicePixelRatio,
  renderCache,
  renderOverlay,
  onRenderTiming,
  onSize,
}: PdfPageProps) {
  const page = readPdfPageResource(document, pageNumber);
  const intrinsicViewport = React.useMemo(
    () => page.getViewport({ scale: 1, rotation: page.rotate ?? 0 }),
    [page],
  );

  useKeyedMountEffect(
    joinEffectKey([
      intrinsicViewport.height,
      intrinsicViewport.width,
      onSize,
      pageNumber,
    ]),
    () => {
      onSize?.(pageNumber, {
        width: intrinsicViewport.width,
        height: intrinsicViewport.height,
      });
    },
  );

  const displaySize = React.useMemo(
    () =>
      getPdfDisplayViewportSize({
        intrinsicViewport,
        rotation,
        scale,
      }),
    [intrinsicViewport, rotation, scale],
  );
  const resolvedRenderScale = renderScale ?? scale;

  return (
    <div
      className="ring-border relative shadow-sm ring-1"
      data-layout-transitioning={isLayoutTransitioning ? "" : undefined}
      style={{ width: displaySize.width, height: displaySize.height }}
      data-slot="pdf-page"
      data-page={pageNumber}
    >
      <PdfPageCanvas
        documentKey={documentKey}
        page={page}
        pageNumber={pageNumber}
        renderScale={resolvedRenderScale}
        rotation={rotation}
        devicePixelRatio={devicePixelRatio}
        renderCache={renderCache}
        onRenderTiming={onRenderTiming}
      />
      {renderOverlay ? (
        <div className="pointer-events-none absolute inset-0">
          {renderOverlay({
            pageNumber,
            width: displaySize.width,
            height: displaySize.height,
            scale,
            rotation,
          })}
        </div>
      ) : null}
    </div>
  );
}, arePdfPagePropsEqual);

const PdfPageCanvas = React.memo(function PdfPageCanvas({
  documentKey,
  page,
  pageNumber,
  renderScale,
  rotation,
  devicePixelRatio,
  renderCache,
  onRenderTiming,
}: PdfPageCanvasProps) {
  const renderViewport = React.useMemo(
    () =>
      page.getViewport({
        scale: renderScale,
        rotation: ((page.rotate ?? 0) + rotation) % 360,
      }),
    [page, renderScale, rotation],
  );
  const [renderError, setRenderError] = React.useState<unknown>(null);
  if (renderError) throw renderError;

  const renderedPageRef = React.useRef<PdfRenderedPage | null>(null);

  const canvasRef = React.useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const renderSignature = {
        documentKey,
        pageNumber,
        scale: renderScale,
        rotation,
        devicePixelRatio,
        viewportWidth: renderViewport.width,
        viewportHeight: renderViewport.height,
      } satisfies PdfRenderedPage;
      if (
        renderedPageRef.current &&
        doesRenderedPageSatisfyRequest(renderedPageRef.current, renderSignature)
      ) {
        return;
      }

      const startedAt = readNow();
      const reportRenderTiming = (
        status: PdfPageRenderStatus,
        source?: PdfPageRenderTiming["source"],
      ) => {
        onRenderTiming?.({
          pageNumber,
          scale: renderScale,
          rotation,
          devicePixelRatio,
          status,
          source,
          durationMs: Math.max(0, readNow() - startedAt),
        });
      };
      const context = canvas.getContext("2d");
      if (!context) {
        markCanvasRenderStatus(canvas, renderSignature, "failed");
        reportRenderTiming("failed");
        setRenderError(
          toPdfRenderFailedError(new Error("Canvas 2D context unavailable.")),
        );
        return;
      }

      const canvasWidth = getPdfCanvasPixelSize(
        renderSignature.viewportWidth,
        devicePixelRatio,
      );
      const canvasHeight = getPdfCanvasPixelSize(
        renderSignature.viewportHeight,
        devicePixelRatio,
      );
      const cachedPage = readPdfRenderedPageCache(renderCache, renderSignature);
      if (cachedPage) {
        replaceCanvasImage(
          canvas,
          context,
          cachedPage.canvas,
          canvasWidth,
          canvasHeight,
        );
        renderedPageRef.current = renderSignature;
        markCanvasRenderStatus(canvas, renderSignature, "rendered", "cache");
        reportRenderTiming("rendered", "cache");
        return;
      }

      const previewPage = readPdfRenderedPageCachePreview(
        renderCache,
        renderSignature,
      );
      const canKeepRenderedPageVisible =
        renderedPageRef.current !== null &&
        canRenderedPageStayVisibleWhilePending(
          renderedPageRef.current,
          renderSignature,
        );
      if (previewPage && !canKeepRenderedPageVisible) {
        replaceCanvasImage(
          canvas,
          context,
          previewPage.canvas,
          canvasWidth,
          canvasHeight,
        );
        markCanvasRenderStatus(
          canvas,
          renderSignature,
          "pending",
          "cache-preview",
        );
      } else if (!canKeepRenderedPageVisible) {
        resizeCanvas(canvas, canvasWidth, canvasHeight);
        markCanvasRenderStatus(canvas, renderSignature, "pending");
      } else {
        markCanvasRenderStatus(canvas, renderSignature, "pending");
      }

      const renderCanvas = canvas.ownerDocument.createElement("canvas");
      renderCanvas.width = canvasWidth;
      renderCanvas.height = canvasHeight;
      renderCanvas.style.width = `${renderViewport.width}px`;
      renderCanvas.style.height = `${renderViewport.height}px`;
      const renderContext = renderCanvas.getContext("2d");
      if (!renderContext) {
        markCanvasRenderStatus(canvas, renderSignature, "failed");
        reportRenderTiming("failed");
        setRenderError(
          toPdfRenderFailedError(new Error("Canvas 2D context unavailable.")),
        );
        return;
      }

      let renderTask: ReturnType<typeof page.render>;
      try {
        renderTask = page.render({
          canvas: renderCanvas,
          canvasContext: renderContext,
          viewport: renderViewport,
          transform:
            devicePixelRatio !== 1
              ? [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0]
              : undefined,
        });
      } catch (error) {
        markCanvasRenderStatus(canvas, renderSignature, "failed");
        reportRenderTiming("failed");
        setRenderError(toPdfRenderFailedError(error));
        return;
      }
      let isActive = true;
      let didFinishPdfRender = false;
      renderTask.promise.then(
        () => {
          if (!isActive) return;
          didFinishPdfRender = true;
          replaceCanvasImage(
            canvas,
            context,
            renderCanvas,
            canvasWidth,
            canvasHeight,
          );
          renderedPageRef.current = renderSignature;
          writePdfRenderedPageCache({
            cache: renderCache,
            rendered: renderSignature,
            sourceCanvas: renderCanvas,
          });
          markCanvasRenderStatus(canvas, renderSignature, "rendered", "pdfjs");
          reportRenderTiming("rendered", "pdfjs");
        },
        (error) => {
          if (!isActive) return;
          didFinishPdfRender = true;
          markCanvasRenderStatus(canvas, renderSignature, "failed");
          reportRenderTiming("failed");
          setRenderError(toPdfRenderFailedError(error));
        },
      );
      return () => {
        isActive = false;
        if (!didFinishPdfRender) {
          renderTask.cancel();
        }
        if (!didFinishPdfRender) {
          markCanvasRenderStatus(canvas, renderSignature, "cancelled");
          reportRenderTiming("cancelled");
        }
      };
    },
    [
      devicePixelRatio,
      documentKey,
      onRenderTiming,
      page,
      pageNumber,
      renderCache,
      renderScale,
      renderViewport,
      rotation,
    ],
  );

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%" }}
      className="block bg-white"
    />
  );
}, arePdfPageCanvasPropsEqual);

function arePdfPagePropsEqual(previous: PdfPageProps, next: PdfPageProps) {
  return (
    previous.document === next.document &&
    previous.documentKey === next.documentKey &&
    previous.pageNumber === next.pageNumber &&
    previous.scale === next.scale &&
    previous.renderScale === next.renderScale &&
    previous.isLayoutTransitioning === next.isLayoutTransitioning &&
    previous.rotation === next.rotation &&
    previous.devicePixelRatio === next.devicePixelRatio &&
    previous.renderCache === next.renderCache &&
    previous.renderOverlay === next.renderOverlay &&
    previous.onRenderTiming === next.onRenderTiming &&
    previous.onSize === next.onSize
  );
}

function arePdfPageCanvasPropsEqual(
  previous: PdfPageCanvasProps,
  next: PdfPageCanvasProps,
) {
  return (
    previous.documentKey === next.documentKey &&
    previous.page === next.page &&
    previous.pageNumber === next.pageNumber &&
    previous.renderScale === next.renderScale &&
    previous.rotation === next.rotation &&
    previous.devicePixelRatio === next.devicePixelRatio &&
    previous.renderCache === next.renderCache &&
    previous.onRenderTiming === next.onRenderTiming
  );
}

function getPdfDisplayViewportSize({
  intrinsicViewport,
  rotation,
  scale,
}: {
  intrinsicViewport: PdfViewportSize;
  rotation: number;
  scale: number;
}): PdfViewportSize {
  const isRotated = normalizePdfRotation(rotation) % 180 !== 0;
  return {
    width: Math.round(
      (isRotated ? intrinsicViewport.height : intrinsicViewport.width) * scale,
    ),
    height: Math.round(
      (isRotated ? intrinsicViewport.width : intrinsicViewport.height) * scale,
    ),
  };
}

function normalizePdfRotation(rotation: number) {
  return ((rotation % 360) + 360) % 360;
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

function replaceCanvasImage(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  width: number,
  height: number,
) {
  resizeCanvas(canvas, width, height);
  drawCanvasImage(context, image, width, height);
}

function markCanvasRenderStatus(
  canvas: HTMLCanvasElement,
  rendered: PdfRenderedPage,
  status: "pending" | PdfPageRenderStatus,
  source?: PdfPageRenderTiming["source"],
) {
  canvas.dataset.pdfPageNumber = String(rendered.pageNumber);
  canvas.dataset.pdfRenderStatus = status;
  if (source) {
    canvas.dataset.pdfRenderSource = source;
  } else {
    delete canvas.dataset.pdfRenderSource;
  }
}

function doesRenderedPageSatisfyRequest(
  rendered: PdfRenderedPage,
  requested: PdfRenderedPage,
) {
  return (
    rendered.documentKey === requested.documentKey &&
    rendered.pageNumber === requested.pageNumber &&
    rendered.rotation === requested.rotation &&
    rendered.scale >= requested.scale &&
    rendered.viewportWidth >= requested.viewportWidth &&
    rendered.viewportHeight >= requested.viewportHeight &&
    hasMatchingPageAspectRatio(rendered, requested) &&
    rendered.devicePixelRatio >= requested.devicePixelRatio
  );
}

function canRenderedPageStayVisibleWhilePending(
  rendered: PdfRenderedPage,
  requested: PdfRenderedPage,
) {
  return (
    rendered.documentKey === requested.documentKey &&
    rendered.pageNumber === requested.pageNumber &&
    rendered.rotation === requested.rotation &&
    hasMatchingPageAspectRatio(rendered, requested)
  );
}

function hasMatchingPageAspectRatio(
  rendered: PdfRenderedPage,
  requested: PdfRenderedPage,
) {
  const renderedRatio = rendered.viewportWidth / rendered.viewportHeight;
  const requestedRatio = requested.viewportWidth / requested.viewportHeight;
  return Math.abs(renderedRatio - requestedRatio) < 0.0001;
}

function readNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
