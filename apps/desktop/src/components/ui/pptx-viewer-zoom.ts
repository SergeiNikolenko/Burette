"use client";

import * as React from "react";

import { normalizePptxScale } from "./pptx-viewer-core";

type PptxZoomState =
  | { mode: "fit" }
  | {
      mode: "manual";
      value: number;
    };

export interface PptxZoomInput {
  controlledScale?: number;
  defaultScale?: number;
  fitScale: number;
  onScaleChange?: (scale: number | null) => void;
}

export function usePptxZoom({
  controlledScale,
  defaultScale,
  fitScale,
  onScaleChange,
}: PptxZoomInput) {
  const [zoomState, setZoomState] = React.useState<PptxZoomState>(() =>
    defaultScale == null
      ? { mode: "fit" }
      : { mode: "manual", value: normalizePptxScale(defaultScale) },
  );

  const isScaleControlled = controlledScale !== undefined;
  const normalizedControlledScale = isScaleControlled
    ? normalizePptxScale(controlledScale)
    : undefined;
  const zoomScale =
    normalizedControlledScale ??
    (zoomState.mode === "manual" ? zoomState.value : fitScale);
  const isFitWidth = !isScaleControlled && zoomState.mode === "fit";
  const scaleControlsDisabled = isScaleControlled && !onScaleChange;

  const setViewerScale = React.useCallback(
    (nextScale: number | null) => {
      const normalized =
        nextScale == null ? null : normalizePptxScale(nextScale);
      if (isScaleControlled) {
        onScaleChange?.(normalized);
        return;
      }
      setZoomState(
        normalized == null
          ? { mode: "fit" }
          : { mode: "manual", value: normalized },
      );
    },
    [isScaleControlled, onScaleChange],
  );

  return { isFitWidth, scaleControlsDisabled, setViewerScale, zoomScale };
}
