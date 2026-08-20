import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

import {
  clampDocxScale,
  DOCX_ZOOM_STEP,
  normalizeDocxScale,
} from "./docx-viewer-core";
import { joinEffectKey } from "@/lib/effect-key";

// The docx stage's own inline padding (p-4 on both sides). Fit-width sizes the
// page to the layout width minus this padding, so the settled stage box
// (page + padding) is an affine unit-slope function of the layout width — the
// shape the fit-width surface motion resolver reprojects.
export const DOCX_STAGE_INLINE_PADDING_PX = 32;

export function useDocxViewerScale({
  defaultScale,
  layoutInlineSize,
  onScaleChange,
  pageWidth,
  resetKey,
  scale: controlledScale,
}: {
  defaultScale?: number;
  layoutInlineSize: number | null;
  onScaleChange?: (scale: number | null) => void;
  pageWidth: number | null;
  resetKey: string;
  scale?: number;
}) {
  const normalizedControlledScale = normalizeDocxScale(controlledScale);
  const isScaleControlled = controlledScale != null;
  const normalizedDefaultScale = normalizeDocxScale(defaultScale);
  const [manualScale, setManualScale] = React.useState<number | null>(
    normalizedDefaultScale,
  );

  useKeyedMountEffect(
    joinEffectKey(["docx-scale-reset", normalizedDefaultScale, resetKey]),
    () => {
      setManualScale(normalizedDefaultScale);
    },
  );

  const fitScale =
    layoutInlineSize && pageWidth
      ? clampDocxScale(
          (layoutInlineSize - DOCX_STAGE_INLINE_PADDING_PX) / pageWidth,
        )
      : 1;
  const isFitWidth = normalizedControlledScale == null && manualScale == null;
  const scale = normalizedControlledScale ?? manualScale ?? fitScale;

  const setViewerScale = React.useCallback(
    (nextScale: number | null) => {
      const normalized =
        nextScale == null ? null : normalizeDocxScale(nextScale);
      if (isScaleControlled) {
        onScaleChange?.(normalized);
        return;
      }
      setManualScale(normalized);
      onScaleChange?.(normalized);
    },
    [isScaleControlled, onScaleChange],
  );

  const zoomIn = React.useCallback(() => {
    setViewerScale(clampDocxScale(scale * DOCX_ZOOM_STEP));
  }, [scale, setViewerScale]);

  const zoomOut = React.useCallback(() => {
    setViewerScale(clampDocxScale(scale / DOCX_ZOOM_STEP));
  }, [scale, setViewerScale]);

  const fitWidth = React.useCallback(() => {
    setViewerScale(null);
  }, [setViewerScale]);

  return {
    fitWidth,
    isFitWidth,
    isScaleControlled,
    scale,
    setViewerScale,
    zoomIn,
    zoomOut,
  };
}
