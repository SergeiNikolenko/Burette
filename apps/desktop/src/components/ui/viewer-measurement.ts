"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

export type StableElementSize<Element extends HTMLElement = HTMLElement> = {
  element: Element | null;
  hasMeasured: boolean;
  height: number | null;
  setElement: React.RefCallback<Element>;
  width: number | null;
};

export type StableElementSizeOptions = {
  enabled?: boolean;
  observe?: boolean;
  retainLastNonZero?: boolean;
};

export type StableCssLengthOptions = {
  element: HTMLElement | null;
  retainLastNonZero?: boolean;
  value: string;
};

type MeasuredSize = {
  height: number | null;
  width: number | null;
};

type RawMeasuredSize = {
  height: number;
  width: number;
};

// DOM layout reads for viewer chrome are quarantined in this module. The
// file-viewer motion kernel (time + style writes only) receives this reader by
// injection from the frame controller instead of touching layout APIs itself.
export function readElementRectSnapshot(
  element: HTMLElement | null,
): readonly number[] {
  if (!element) return [];
  const rect = element.getBoundingClientRect();
  return [rect.left, rect.top, rect.width, rect.height];
}

// Computed CSS inline direction of an element, sampled when it attaches (a
// runtime `dir` flip is picked up on the next mount). The fit-width motion
// transform works on the physical X axis, so the renderer frame needs to
// know which edge auto-margin alignment pins the stage to.
export function useViewerInlineDirection(
  element: HTMLElement | null,
): "ltr" | "rtl" {
  const [direction, setDirection] = React.useState<"ltr" | "rtl">("ltr");

  useKeyedLayoutEffect(element ? joinEffectKey([element]) : null, () => {
    if (!element) return;
    setDirection(getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr");
  });

  return direction;
}

function readElementSize(element: HTMLElement): RawMeasuredSize {
  const rect =
    typeof element.getBoundingClientRect === "function"
      ? element.getBoundingClientRect()
      : null;

  return {
    height: rect?.height || element.clientHeight,
    width: rect?.width || element.clientWidth,
  };
}

function resolveMeasuredElementSize({
  currentSize,
  nextSize,
  retainLastNonZero,
}: {
  currentSize: MeasuredSize;
  nextSize: RawMeasuredSize;
  retainLastNonZero: boolean;
}): MeasuredSize {
  const width =
    Number.isFinite(nextSize.width) &&
    (!retainLastNonZero || nextSize.width > 0)
      ? nextSize.width
      : currentSize.width;
  const height =
    Number.isFinite(nextSize.height) &&
    (!retainLastNonZero || nextSize.height > 0)
      ? nextSize.height
      : currentSize.height;

  if (currentSize.width === width && currentSize.height === height) {
    return currentSize;
  }

  return { height, width };
}

export function useStableElementSize<Element extends HTMLElement = HTMLElement>(
  options: StableElementSizeOptions = {},
): StableElementSize<Element> {
  const enabled = options.enabled ?? true;
  const observe = options.observe ?? true;
  const retainLastNonZero = options.retainLastNonZero ?? false;
  const [element, setElementState] = React.useState<Element | null>(null);
  const [size, setSize] = React.useState<MeasuredSize>({
    height: null,
    width: null,
  });
  const hasMeasured = size.height !== null || size.width !== null;

  const setElement = React.useCallback((nextElement: Element | null) => {
    setElementState(nextElement);
  }, []);

  useKeyedLayoutEffect(enabled ? null : "reset", () => {
    setSize({ height: null, width: null });
  });

  useKeyedLayoutEffect(
    enabled && element
      ? joinEffectKey([element, observe, retainLastNonZero])
      : null,
    () => {
      if (!element) return;

      setSize((currentSize) =>
        resolveMeasuredElementSize({
          currentSize,
          nextSize: readElementSize(element),
          retainLastNonZero,
        }),
      );

      const ResizeObserverConstructor = observe
        ? globalThis.ResizeObserver
        : undefined;
      if (typeof ResizeObserverConstructor === "undefined") return;

      let frame = 0;
      let latestSize = readElementSize(element);
      const observer = new ResizeObserverConstructor((entries) => {
        for (const entry of entries) {
          latestSize = readElementSize(entry.target as HTMLElement);
        }

        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          setSize((currentSize) =>
            resolveMeasuredElementSize({
              currentSize,
              nextSize: latestSize,
              retainLastNonZero,
            }),
          );
        });
      });

      observer.observe(element);

      return () => {
        if (frame) cancelAnimationFrame(frame);
        observer.disconnect();
      };
    },
  );

  return React.useMemo(
    () => ({
      element,
      hasMeasured,
      height: size.height,
      setElement,
      width: size.width,
    }),
    [element, hasMeasured, setElement, size.height, size.width],
  );
}

export function useStableCssLength({
  element,
  retainLastNonZero = true,
  value,
}: StableCssLengthOptions) {
  const [resolvedLength, setResolvedLength] = React.useState(0);

  useKeyedLayoutEffect(
    value ? joinEffectKey([element, retainLastNonZero, value]) : null,
    () => {
      const nextLength = resolveCssLength(value, element);

      setResolvedLength((currentLength) => {
        if (retainLastNonZero && nextLength <= 0) return currentLength;
        return areCssLengthsEqual(currentLength, nextLength)
          ? currentLength
          : nextLength;
      });
    },
  );

  return resolvedLength;
}

function resolveCssLength(value: string, element: HTMLElement | null) {
  const trimmedValue = value.trim();
  const pixelMatch = trimmedValue.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (pixelMatch) return Math.max(0, Number(pixelMatch[1]));

  if (typeof window === "undefined") return 0;

  const remMatch = trimmedValue.match(/^(-?\d+(?:\.\d+)?)rem$/);
  if (remMatch) {
    return (
      Math.max(0, Number(remMatch[1])) *
      readComputedFontSize(window.document.documentElement)
    );
  }

  const emMatch = trimmedValue.match(/^(-?\d+(?:\.\d+)?)em$/);
  if (emMatch) {
    return Math.max(0, Number(emMatch[1])) * readComputedFontSize(element);
  }

  const measuringElement = window.document.createElement("div");
  measuringElement.style.contain = "strict";
  measuringElement.style.inlineSize = trimmedValue;
  measuringElement.style.position = "absolute";
  measuringElement.style.visibility = "hidden";
  (element ?? window.document.body).appendChild(measuringElement);
  const width = readElementInlineSize(measuringElement);
  measuringElement.remove();
  return width;
}

function readElementInlineSize(element: HTMLElement) {
  const rect =
    typeof element.getBoundingClientRect === "function"
      ? element.getBoundingClientRect()
      : null;
  const width = rect?.width || element.clientWidth || 0;
  return Number.isFinite(width) && width > 0 ? width : 0;
}

function readComputedFontSize(element: Element | null) {
  if (typeof window === "undefined") return 16;
  const fontSize = element ? window.getComputedStyle(element).fontSize : "16px";
  const value = Number.parseFloat(fontSize);
  return Number.isFinite(value) && value > 0 ? value : 16;
}

function areCssLengthsEqual(previous: number, next: number) {
  return Math.abs(previous - next) <= 0.001;
}
