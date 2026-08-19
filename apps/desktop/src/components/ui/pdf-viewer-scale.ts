import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

export const MIN_PDF_SCALE = 0.1;
export const MAX_PDF_SCALE = 5;
export const PDF_ZOOM_STEP = 1.2;
export const PDF_PAGE_HORIZONTAL_PADDING = 32;
export const PDF_PAGE_SETTLED_MAX_DEVICE_PIXEL_RATIO = 2;
export const PDF_PAGE_SCROLLING_MAX_DEVICE_PIXEL_RATIO =
  PDF_PAGE_SETTLED_MAX_DEVICE_PIXEL_RATIO;

export type PdfPageDprMode = "scrolling" | "settled";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clampPdfScale(value: number) {
  // NaN has no ordering, so default it to 1; ±Infinity clamps to the bounds
  // like any large/small finite value (e.g. 1e9 → MAX, -1e9 → MIN).
  if (Number.isNaN(value)) return 1;
  return clamp(value, MIN_PDF_SCALE, MAX_PDF_SCALE);
}

export function getPdfFitWidthScale(
  containerWidth: number | null,
  pageWidth: number,
  inlinePadding = PDF_PAGE_HORIZONTAL_PADDING,
) {
  if (!containerWidth || !Number.isFinite(containerWidth) || pageWidth <= 0) {
    return 1;
  }
  return clampPdfScale((containerWidth - inlinePadding) / pageWidth);
}

export function getPdfPageDevicePixelRatio({
  devicePixelRatio,
  mode: _mode,
}: {
  devicePixelRatio: number;
  mode: PdfPageDprMode;
}) {
  const normalizedDevicePixelRatio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return Math.min(
    normalizedDevicePixelRatio,
    PDF_PAGE_SETTLED_MAX_DEVICE_PIXEL_RATIO,
  );
}

export function useMeasuredElementWidth({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const [element, setElement] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState<number | null>(null);

  const ref = React.useCallback((nextElement: HTMLDivElement | null) => {
    setElement(nextElement);
  }, []);

  useKeyedLayoutEffect(enabled ? null : "reset", () => {
    setWidth(null);
  });

  useKeyedLayoutEffect(
    enabled && element ? joinEffectKey([element]) : null,
    () => {
      if (!element) return;

      let frame = 0;
      const measure = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          setWidth(element.clientWidth);
        });
      };

      measure();
      if (typeof ResizeObserver === "undefined") {
        return () => {
          if (frame) cancelAnimationFrame(frame);
        };
      }

      const observer = new ResizeObserver(measure);

      observer.observe(element);
      return () => {
        if (frame) cancelAnimationFrame(frame);
        observer.disconnect();
      };
    },
  );

  return { ref, width };
}

export function usePdfScale({
  controlledScale,
  defaultScale,
  onScaleChange,
  containerWidth,
  pageWidth,
  fitWidthInlinePadding,
  resetKey,
}: {
  controlledScale?: number;
  defaultScale?: number;
  onScaleChange?: (scale: number | null) => void;
  containerWidth: number | null;
  fitWidthInlinePadding?: number;
  pageWidth: number;
  resetKey?: unknown;
}) {
  const initialRequestedScale =
    defaultScale == null ? null : clampPdfScale(defaultScale);
  const [uncontrolledScaleState, setUncontrolledScaleState] = React.useState<{
    resetKey: unknown;
    requestedScale: number | null;
  }>(() => ({
    resetKey,
    requestedScale: initialRequestedScale,
  }));
  const uncontrolledRequestedScale = Object.is(
    uncontrolledScaleState.resetKey,
    resetKey,
  )
    ? uncontrolledScaleState.requestedScale
    : initialRequestedScale;
  const isControlledScale = controlledScale !== undefined;
  const isFitWidth = !isControlledScale && uncontrolledRequestedScale == null;
  const fitWidthScale = getPdfFitWidthScale(
    containerWidth,
    pageWidth,
    fitWidthInlinePadding,
  );
  const resolvedScale = isControlledScale
    ? clampPdfScale(controlledScale)
    : (uncontrolledRequestedScale ?? fitWidthScale);

  const setRequestedScale = React.useCallback(
    (nextScale: number | null) => {
      const normalizedScale =
        nextScale == null ? null : clampPdfScale(nextScale);
      if (isControlledScale) {
        onScaleChange?.(normalizedScale);
        return;
      }
      setUncontrolledScaleState((previousState) =>
        Object.is(previousState.resetKey, resetKey) &&
        previousState.requestedScale === normalizedScale
          ? previousState
          : { resetKey, requestedScale: normalizedScale },
      );
    },
    [isControlledScale, onScaleChange, resetKey],
  );

  const zoomIn = React.useCallback(
    () => setRequestedScale(resolvedScale * PDF_ZOOM_STEP),
    [resolvedScale, setRequestedScale],
  );
  const zoomOut = React.useCallback(
    () => setRequestedScale(resolvedScale / PDF_ZOOM_STEP),
    [resolvedScale, setRequestedScale],
  );
  const fitWidth = React.useCallback(
    () => setRequestedScale(null),
    [setRequestedScale],
  );

  return {
    resolvedScale,
    isFitWidth,
    zoomIn,
    zoomOut,
    fitWidth,
  };
}
