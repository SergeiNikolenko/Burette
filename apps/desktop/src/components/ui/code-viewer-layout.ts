import type { NormalizedTextLineRange } from "./line-ranges";

export const LINE_SCROLL_HEADROOM = 64;

export interface LineRangeMetrics {
  startLine: number;
  endLine: number;
  lineHeight: number;
  viewportHeight: number;
  paddingStart?: number;
}

export function scrollTopForLineRangeMetrics({
  startLine,
  endLine,
  lineHeight,
  viewportHeight,
  paddingStart = 0,
}: LineRangeMetrics) {
  const rangeTop = paddingStart + (startLine - 1) * lineHeight;
  const rangeBottom = paddingStart + endLine * lineHeight;
  const rangeHeight = rangeBottom - rangeTop;
  const targetTop =
    rangeHeight <= viewportHeight
      ? rangeTop - (viewportHeight - rangeHeight) / 2
      : rangeTop - LINE_SCROLL_HEADROOM;

  return Math.max(0, targetTop);
}

export function scrollLineRangeMetricsIntoView({
  viewportElement,
  range,
  lineHeight,
  paddingStart,
  options,
}: {
  viewportElement: HTMLDivElement | null;
  range: NormalizedTextLineRange | null;
  lineHeight: number;
  paddingStart?: number;
  options?: ScrollToOptions;
}) {
  if (!viewportElement || !range) return;
  if (typeof viewportElement.scrollTo !== "function") return;

  viewportElement.scrollTo({
    top: scrollTopForLineRangeMetrics({
      startLine: range.start,
      endLine: range.end,
      lineHeight,
      paddingStart,
      viewportHeight: viewportElement.clientHeight,
    }),
    behavior: "smooth",
    ...options,
  });
}
