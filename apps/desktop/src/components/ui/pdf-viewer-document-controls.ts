"use client";

import * as React from "react";

import type { ViewerResource } from "@/lib/viewer-resource";
import { joinEffectKey } from "@/lib/effect-key";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

import {
  useViewerControlsRegistration,
  type ViewerControlsState,
} from "./viewer-controls";

export function usePdfDocumentControlsState({
  currentPage,
  download,
  downloadAction,
  fitWidth,
  pageCount,
  resolvedScale,
  rotateClockwise,
  zoomIn,
  zoomOut,
}: {
  currentPage: number;
  download: boolean;
  downloadAction: ViewerResource["originalDownload"];
  fitWidth: () => void;
  pageCount: number;
  resolvedScale: number;
  rotateClockwise: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}): ViewerControlsState {
  return React.useMemo<ViewerControlsState>(
    () => ({
      position: {
        kind: "page",
        current: currentPage,
        total: pageCount,
      },
      zoom: {
        scale: resolvedScale,
        onZoomOut: zoomOut,
        onZoomIn: zoomIn,
        onFit: fitWidth,
      },
      rotate: { onRotate: rotateClockwise },
      downloads: download ? [downloadAction] : [],
    }),
    [
      currentPage,
      download,
      downloadAction,
      fitWidth,
      pageCount,
      resolvedScale,
      rotateClockwise,
      zoomIn,
      zoomOut,
    ],
  );
}

export function usePdfDocumentControlsRegistration(
  controlsState: ViewerControlsState,
) {
  const onControlsChange = useViewerControlsRegistration();

  useKeyedMountEffect(joinEffectKey([onControlsChange, controlsState]), () => {
    if (!onControlsChange) return;
    onControlsChange(controlsState);
    return () => onControlsChange(null);
  });
}
