import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useMountEffect } from "@/hooks/use-mount-effect";

import { clamp } from "./docx-viewer-core";
import {
  captureDocxReadingAnchorFromLayout,
  findDocxPageByMarker,
  restoreDocxReadingAnchorFromLayout,
  type DocxPageLayout,
  type DocxReadingAnchor,
} from "./docx-viewer-layout";
import {
  DOCX_ZOOM_INTENT_MAX_AGE_MS,
  type DocxZoomTransaction,
} from "./docx-viewer-zoom-motion";
import type { ViewerDocumentZoomMotionController } from "./viewer-types";
import { joinEffectKey } from "@/lib/effect-key";

export function useDocxViewerScroll({
  layoutKey,
  pageLayout,
  onScrollProgressChange,
  onVisiblePageChange,
  ready,
  scale,
  zoomMotion,
}: {
  layoutKey: unknown;
  pageLayout: DocxPageLayout | null;
  onScrollProgressChange?: (progress: number) => void;
  onVisiblePageChange?: (page: number) => void;
  ready: boolean;
  scale: number;
  zoomMotion?: ViewerDocumentZoomMotionController<DocxZoomTransaction>;
}) {
  const scrollViewportRef = React.useRef<HTMLDivElement | null>(null);
  const lastReported = React.useRef(0);
  const latestAnchorRef = React.useRef<DocxReadingAnchor>({ kind: "top" });
  const committedLayoutKeyRef = React.useRef(layoutKey);
  const [currentPage, setCurrentPage] = React.useState(1);
  const scrollFrame = React.useRef(0);
  const pendingZoomIntentRef = React.useRef<{
    capturedAt: number;
    transaction: DocxZoomTransaction;
  } | null>(null);
  const activeZoomMotionCancelRef = React.useRef<(() => void) | null>(null);

  // Interrupting a zoom relax snaps to its committed endpoint: the layout and
  // scroll landed in the zoom's own commit, so clearing the transform is
  // always safe and never moves the settled geometry.
  const cancelZoomMotion = React.useCallback(() => {
    pendingZoomIntentRef.current = null;
    const cancelActiveZoomMotion = activeZoomMotionCancelRef.current;
    activeZoomMotionCancelRef.current = null;
    cancelActiveZoomMotion?.();
  }, []);

  // Called in the zoom gesture's own task, against the pre-zoom layout and
  // painted DOM; the layout commit the gesture causes consumes the intent.
  const captureZoomIntent = React.useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || !zoomMotion) {
      pendingZoomIntentRef.current = null;
      return;
    }
    const transaction = zoomMotion.capture({
      scrollTop: viewport.scrollTop,
      viewportElement: viewport,
    });
    pendingZoomIntentRef.current =
      transaction == null
        ? null
        : { capturedAt: readDocxScrollNow(), transaction };
  }, [zoomMotion]);

  const resetScroll = React.useCallback(() => {
    setCurrentPage(1);
    lastReported.current = 0;
    latestAnchorRef.current = { kind: "top" };
    cancelZoomMotion();
    if (scrollViewportRef.current) scrollViewportRef.current.scrollTop = 0;
  }, [cancelZoomMotion]);

  const measureScroll = React.useCallback(() => {
    scrollFrame.current = 0;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const scrollable = viewport.scrollHeight - viewport.clientHeight;
    onScrollProgressChange?.(
      scrollable > 0 ? clamp(viewport.scrollTop / scrollable, 0, 1) : 0,
    );
    const current =
      findDocxPageByMarker({
        layout: pageLayout,
        scale,
        scrollTop: viewport.scrollTop,
        viewportHeight: viewport.clientHeight,
      })?.pageNumber ?? 1;
    latestAnchorRef.current = captureDocxReadingAnchorFromLayout({
      layout: pageLayout,
      scale,
      scrollTop: viewport.scrollTop,
      viewportHeight: viewport.clientHeight,
    });
    if (current && current !== lastReported.current) {
      lastReported.current = current;
      setCurrentPage(current);
      onVisiblePageChange?.(current);
    }
  }, [onScrollProgressChange, onVisiblePageChange, pageLayout, scale]);

  const handleScroll = React.useCallback(() => {
    if (scrollFrame.current) return;
    scrollFrame.current = -1;
    const requestedFrame = requestAnimationFrame(measureScroll);
    if (scrollFrame.current === -1) scrollFrame.current = requestedFrame;
  }, [measureScroll]);

  useKeyedMountEffect(
    joinEffectKey(["docx-measure", measureScroll, ready]),
    () => {
      if (ready) measureScroll();
    },
  );

  useKeyedLayoutEffect(
    joinEffectKey([
      "docx-layout",
      layoutKey,
      measureScroll,
      pageLayout,
      ready,
      scale,
      zoomMotion,
    ]),
    () => {
      const previousLayoutKey = committedLayoutKeyRef.current;
      committedLayoutKeyRef.current = layoutKey;
      if (!ready) return;
      if (Object.is(previousLayoutKey, layoutKey)) return;

      const viewport = scrollViewportRef.current;
      if (!viewport) return;

      // A fresh layout commit owns the zoom stage; an in-flight relax against
      // the previous layout can no longer settle correctly.
      const pendingZoomIntent = pendingZoomIntentRef.current;
      pendingZoomIntentRef.current = null;
      cancelZoomMotion();

      if (
        pendingZoomIntent &&
        zoomMotion &&
        readDocxScrollNow() - pendingZoomIntent.capturedAt <=
          DOCX_ZOOM_INTENT_MAX_AGE_MS
      ) {
        const zoomTarget = zoomMotion.resolveScrollTarget({
          transaction: pendingZoomIntent.transaction,
          viewportElement: viewport,
        });
        if (zoomTarget) {
          // Commit-then-relax: land the centered scroll inside this commit,
          // then relax the painted FLIP over it. Raw scrollLeft assignment on
          // purpose — the browser clamps to the live scrollable range,
          // including RTL's negative coordinate space.
          viewport.scrollTop = zoomTarget.top;
          if (zoomTarget.left != null && Number.isFinite(zoomTarget.left)) {
            viewport.scrollLeft = zoomTarget.left;
          }
          activeZoomMotionCancelRef.current = zoomMotion.play({
            transaction: pendingZoomIntent.transaction,
            viewportElement: viewport,
          });
          measureScroll();
          return;
        }
      }

      const maxScrollTop = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight,
      );
      const restored = restoreDocxReadingAnchorFromLayout({
        anchor: latestAnchorRef.current,
        layout: pageLayout,
        maxScrollTop,
        scale,
        viewportHeight: viewport.clientHeight,
      });
      if (restored != null) viewport.scrollTop = restored;
      measureScroll();
    },
  );

  useMountEffect(() => {
    return () => {
      cancelZoomMotion();
      if (scrollFrame.current > 0) cancelAnimationFrame(scrollFrame.current);
    };
  });

  return {
    captureZoomIntent,
    currentPage,
    handleScroll,
    measureScroll,
    resetScroll,
    scrollViewportRef,
  };
}

function readDocxScrollNow() {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
