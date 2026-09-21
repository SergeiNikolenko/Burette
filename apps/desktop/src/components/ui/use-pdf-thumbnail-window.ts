"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

import {
  getVisiblePdfThumbnailItems,
  type PdfThumbnailLayout,
  type PdfThumbnailLayoutItem,
} from "./pdf-thumbnail-layout";
import { joinEffectKey } from "@/lib/effect-key";

interface PdfThumbnailWindowMetrics {
  scrollTop: number;
  viewportHeight: number;
}

export interface PdfThumbnailWindow {
  viewportHeight: number;
  visibleItems: readonly PdfThumbnailLayoutItem[];
  totalHeight: number;
}

export function usePdfThumbnailWindow({
  layout,
  viewportRef,
  overscanPx,
  initialViewportHeight,
}: {
  layout: PdfThumbnailLayout;
  viewportRef: React.RefObject<HTMLElement | null>;
  overscanPx: number;
  initialViewportHeight: number;
}): PdfThumbnailWindow {
  const [metrics, setMetrics] = React.useState<PdfThumbnailWindowMetrics>({
    scrollTop: 0,
    viewportHeight: initialViewportHeight,
  });
  const metricsRef = React.useRef(metrics);

  const setMeasuredMetrics = React.useCallback(
    (next: PdfThumbnailWindowMetrics) => {
      const current = metricsRef.current;
      if (
        current.scrollTop === next.scrollTop &&
        current.viewportHeight === next.viewportHeight
      ) {
        return;
      }

      metricsRef.current = next;
      setMetrics(next);
    },
    [],
  );

  const viewportEffectKey = joinEffectKey([
    "pdf-thumbnail-window",
    initialViewportHeight,
    viewportRef,
  ]);
  useKeyedMountEffect(viewportEffectKey, () => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let frame = 0;
    const read = () => {
      const scrollTop =
        Number.isFinite(viewport.scrollTop) && viewport.scrollTop > 0
          ? viewport.scrollTop
          : 0;
      const viewportHeight =
        Number.isFinite(viewport.clientHeight) && viewport.clientHeight > 0
          ? viewport.clientHeight
          : initialViewportHeight;

      setMeasuredMetrics({ scrollTop, viewportHeight });
    };
    const scheduleRead = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        read();
      });
    };
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleRead)
        : null;

    read();
    observer?.observe(viewport);
    viewport.addEventListener("scroll", scheduleRead, { passive: true });

    return () => {
      viewport.removeEventListener("scroll", scheduleRead);
      observer?.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  });

  return React.useMemo(
    () => ({
      viewportHeight: metrics.viewportHeight,
      visibleItems: getVisiblePdfThumbnailItems({
        layout,
        scrollTop: metrics.scrollTop,
        viewportHeight: metrics.viewportHeight,
        overscanPx,
      }),
      totalHeight: layout.totalHeight,
    }),
    [layout, metrics, overscanPx],
  );
}
