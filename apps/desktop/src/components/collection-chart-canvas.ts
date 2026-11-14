import { useEffect, useState, type RefObject } from "react";
import type { ChartInk } from "../lib/collection-chart-axes";

// Canvas plumbing shared by the chart types: the drawing size, and the theme
// colours resolved to something a pixel buffer can use.

export type CanvasSize = { width: number; height: number; pixelRatio: number };

export type ChartPalette = {
  /** 0x00BBGGRR, opaque. */
  background: number;
  foreground: number;
  foregroundCss: string;
  /** Grid lines as a pixel colour and its 0–256 coverage. */
  line: number;
  lineCoverage: number;
  ink: ChartInk;
};

let scratch: CanvasRenderingContext2D | null = null;

/** Any CSS colour as [0x00BBGGRR, alpha 0–255], read back from a painted pixel. */
function resolveColor(css: string): [number, number] {
  scratch ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!scratch) return [0, 255];
  scratch.canvas.width = 1;
  scratch.canvas.height = 1;
  scratch.clearRect(0, 0, 1, 1);
  // An unparseable colour leaves the fill style as it was, so start from black.
  scratch.fillStyle = "#000";
  scratch.fillStyle = css;
  scratch.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = scratch.getImageData(0, 0, 1, 1).data;
  return [(blue << 16) | (green << 8) | red, alpha];
}

/**
 * Colours of the chart, read from the elements that carry the theme classes:
 * `surface` has the panel background and text colour, `inked` the muted text
 * colour and the border colour.
 */
export function readChartPalette(surface: HTMLElement, inked: HTMLElement): ChartPalette {
  const surfaceStyle = getComputedStyle(surface);
  const inkStyle = getComputedStyle(inked);
  const [line, lineAlpha] = resolveColor(inkStyle.borderTopColor);
  return {
    background: resolveColor(surfaceStyle.backgroundColor)[0],
    foreground: resolveColor(surfaceStyle.color)[0],
    foregroundCss: surfaceStyle.color,
    line,
    lineCoverage: Math.round((lineAlpha / 255) * 256),
    ink: { text: inkStyle.color, line: inkStyle.borderTopColor, font: `11px ${surfaceStyle.fontFamily}` },
  };
}

export function useCanvasSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0, pixelRatio: 1 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = {
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      };
      setSize(current => current.width === next.width && current.height === next.height
        && current.pixelRatio === next.pixelRatio ? current : next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Changes whenever the app theme does, so canvases repaint with the new colours. */
export function useThemeEpoch(ref: RefObject<HTMLElement | null>) {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const shell = ref.current?.closest(".app-shell") ?? document.documentElement;
    const bump = () => setEpoch(value => value + 1);
    const observer = new MutationObserver(bump);
    observer.observe(shell, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-effective-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", bump);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", bump);
    };
  }, [ref]);
  return epoch;
}

export function sizeCanvas(canvas: HTMLCanvasElement, size: CanvasSize) {
  const width = Math.max(1, Math.round(size.width * size.pixelRatio));
  const height = Math.max(1, Math.round(size.height * size.pixelRatio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}
