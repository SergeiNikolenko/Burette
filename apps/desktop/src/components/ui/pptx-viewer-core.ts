export interface PptxSize {
  width: number;
  height: number;
}

export interface PptxSlideOverlayProps {
  /** 1-based slide index. */
  slideNumber: number;
  /** Rendered slide size in CSS pixels, after scale and rotation. */
  width: number;
  height: number;
  scale: number;
  rotation: number;
}

export interface PptxSlideRenderTiming {
  slideNumber: number;
  durationMs: number;
  renderScale: number;
  pixelRatio: number;
  cached: boolean;
  status: "rendered" | "cancelled" | "failed";
}

export interface PptxSourceLoadTiming {
  byteLength: number;
  slideCount: number;
  totalMs: number;
  readBytesMs: number;
  importPptxMs: number;
  readSlideSizeMs: number;
  loadFileMs: number;
  inspectMs: number;
}

export interface PptxResetInput {
  resourceKey: string;
  scale?: number;
  defaultScale?: number;
  eager?: boolean;
}

export interface PptxBitmapCacheInput {
  slideIndex: number;
  renderScale: number;
}

export interface PptxSlideRenderPriority {
  isCurrentSlide: boolean;
  isInViewport: boolean;
  isScrollLead: boolean;
  distanceFromReadingMarker: number;
}

// 16:9 — the modern PowerPoint/Slides default. Used as the pre-parse skeleton
// aspect and as a last-resort fallback when a loaded deck can't report its size.
export const DEFAULT_PPTX_SLIDE_SIZE = {
  width: 960,
  height: 540,
} satisfies PptxSize;

export function getPptxFitScale(
  containerWidth: number | null,
  baseWidth: number,
) {
  if (!containerWidth || !Number.isFinite(containerWidth) || baseWidth <= 0) {
    return 1;
  }
  return clamp((containerWidth - 32) / baseWidth, 0.1, 5);
}

export function getPptxResetKey({
  resourceKey,
  scale,
  defaultScale,
  eager,
}: PptxResetInput) {
  return [
    resourceKey,
    getResetScaleKey({ scale, defaultScale }),
    eager ? "eager" : "settled",
  ].join("\u0000");
}

function getResetScaleKey({
  scale,
  defaultScale,
}: Pick<PptxResetInput, "scale" | "defaultScale">) {
  if (scale !== undefined) return normalizePptxScale(scale);
  if (defaultScale !== undefined) return normalizePptxScale(defaultScale);
  return "fit";
}

export function getPptxBitmapCacheKey({
  slideIndex,
  renderScale,
}: PptxBitmapCacheInput) {
  return `${slideIndex}@${Math.round(renderScale * 1000)}`;
}

export function getPptxRenderPixelRatio(rawPixelRatio: number) {
  if (!Number.isFinite(rawPixelRatio) || rawPixelRatio <= 0) return 1;
  return Math.min(rawPixelRatio, 2);
}

export function getScaledSlideSize(
  baseSize: PptxSize,
  zoomScale: number,
): PptxSize {
  return {
    width: baseSize.width * zoomScale,
    height: baseSize.height * zoomScale,
  };
}

export function getVisibleSlideSize(
  slideSize: PptxSize,
  rotation: number,
): PptxSize {
  return getRotatedSize(slideSize, rotation);
}

export function getRotatedSize(size: PptxSize, rotation: number): PptxSize {
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90 || normalized === 270) {
    return { width: size.height, height: size.width };
  }
  return size;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizePptxScale(scale: number) {
  return clamp(Number.isFinite(scale) ? scale : 1, 0.1, 5);
}
