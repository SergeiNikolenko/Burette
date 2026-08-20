import {
  findImageFrameByOffset,
  getImageFrameLayout,
  type ImageFrameLayoutModel,
} from "./image-viewer-virtualization";
import type { ViewerDocumentZoomMotionController } from "./viewer-types";

// A toolbar zoom step re-anchors the viewport CENTER on both axes (Apple
// Preview semantics): the content point under the viewport center before the
// step is back under the viewport center after it, and a short FLIP relax
// scales the painted surface about that fixed point. The reading-marker
// restore (20% from the top, block axis only) stays the semantics for every
// other geometry change — re-fits, rotation, container resizes — where the
// intent is "keep my reading position", not "zoom the camera".
const IMAGE_ZOOM_CENTER_MARKER_RATIO = 0.5;
const IMAGE_ZOOM_MOTION_DURATION_MS = 200;
// easeOutCubic: fast attack, gentle landing — a linear relax reads as a
// hard stop at settle.
const IMAGE_ZOOM_MOTION_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";
const IMAGE_ZOOM_MOTION_CLEANUP_MS = IMAGE_ZOOM_MOTION_DURATION_MS + 50;
const IMAGE_ZOOM_MOTION_MIN_TRANSLATE_PX = 0.5;
const IMAGE_ZOOM_MOTION_MIN_SCALE_DELTA = 0.001;
// A rebased (paged) physical scroll detaches the stage box from the content
// scale, so the whole-surface FLIP would warp. Its signature is precise: the
// rebased axis is PINNED (the container keeps its size while the content
// rescales), so one axis barely moves while the other moves a lot. Testing for
// that beats a plain ratio tolerance — an honest frame stack carries small
// constant terms (rounded gaps, fixed outer padding) that put the block axis a
// couple of percent off the inline one. On a big jump a tight ratio tolerance
// then refuses the relax and the whole scale change lands in one frame —
// measured as an un-animated 620px snap on a multi-frame TIFF's fit-width. The
// wide ratio net below still catches anything wilder, and the FLIP writes
// per-axis scales, so a slightly non-affine layout renders exactly.
const IMAGE_ZOOM_MOTION_AXIS_FROZEN_DELTA = 0.02;
const IMAGE_ZOOM_MOTION_AXIS_MOVED_DELTA = 0.05;
const IMAGE_ZOOM_MOTION_AXIS_MISMATCH_RATIO = 0.25;

// The exact wait-out of the relax before the visual clip re-tightens; clip
// release is React-rendered state, so it outlives the inline transition.
export const IMAGE_ZOOM_MOTION_TOTAL_MS = IMAGE_ZOOM_MOTION_CLEANUP_MS + 50;

const IMAGE_ZOOM_SCROLL_RANGE_SELECTOR =
  '[data-slot="image-viewer-scroll-range"]';
const IMAGE_ZOOM_VISUAL_LAYER_SELECTOR =
  '[data-slot="image-viewer-visual-clip"]';

export type ImageZoomTransaction = {
  frameNumber: number;
  /**
   * Deliberately unclamped, like the reading anchor: the layout is linear in
   * scale, so a center marker resting in a gap or the edge padding restores
   * by the same frame-relative fraction.
   */
  yPercent: number;
  /** Viewport-center position as a fraction of the stage's inline size. */
  inlineFraction: number | null;
  /**
   * Same, on the BLOCK axis. Rect-derived like the inline one, so the solve
   * cannot be thrown off by anything the layout model does not know about —
   * chiefly the auto margins that centre a zoomed-out stage inside the pane.
   * The model path below stays the fallback for a rebased (paged) scroll,
   * where the stage stops spanning the document.
   */
  blockFraction: number | null;
  /** Painted visual-layer rect at click time — the FLIP's "first" frame. */
  previousVisualRect: DOMRectReadOnly | null;
};

export function createImageZoomMotionController(
  layout: ImageFrameLayoutModel,
): ViewerDocumentZoomMotionController<ImageZoomTransaction> {
  return {
    capture: ({ scrollTop, viewportElement }) =>
      captureImageZoomTransaction({ layout, scrollTop, viewportElement }),
    resolveScrollTarget: ({ transaction, viewportElement }) =>
      resolveImageZoomScrollTarget({ layout, transaction, viewportElement }),
    play: ({ transaction, viewportElement }) =>
      playImageZoomMotion({ transaction, viewportElement }),
  };
}

export function captureImageZoomTransaction({
  layout,
  scrollTop,
  viewportElement,
}: {
  layout: ImageFrameLayoutModel;
  scrollTop: number;
  viewportElement: HTMLDivElement;
}): ImageZoomTransaction | null {
  if (layout.frameCount === 0) return null;

  const viewportBlockSize = Math.max(0, viewportElement.clientHeight);
  const centerOffset =
    Math.max(0, scrollTop) + viewportBlockSize * IMAGE_ZOOM_CENTER_MARKER_RATIO;
  const frameNumber = findImageFrameByOffset(layout, centerOffset);
  const frameLayout = getImageFrameLayout(layout, frameNumber);
  if (!frameLayout || frameLayout.height <= 0) return null;

  return {
    frameNumber,
    yPercent: (centerOffset - frameLayout.offsetTop) / frameLayout.height,
    inlineFraction: captureImageZoomInlineFraction(viewportElement),
    blockFraction: captureImageZoomBlockFraction(viewportElement),
    previousVisualRect: readElementRect(
      findImageZoomVisualLayer(viewportElement),
    ),
  };
}

export function resolveImageZoomScrollTarget({
  layout,
  transaction,
  viewportElement,
}: {
  layout: ImageFrameLayoutModel;
  transaction: ImageZoomTransaction;
  viewportElement: HTMLDivElement;
}): { left?: number; top: number } | null {
  const frameLayout = getImageFrameLayout(layout, transaction.frameNumber);
  if (!frameLayout) return null;

  const viewportBlockSize = Math.max(0, viewportElement.clientHeight);
  const maxScrollTop = Math.max(0, layout.totalHeight - viewportBlockSize);
  const top = clamp(
    resolveImageZoomScrollTop({ layout, transaction, viewportElement }) ??
      frameLayout.offsetTop +
        frameLayout.height * transaction.yPercent -
        viewportBlockSize * IMAGE_ZOOM_CENTER_MARKER_RATIO,
    0,
    maxScrollTop,
  );

  const left = resolveImageZoomScrollLeft(viewportElement, transaction);
  return { top, ...(left == null ? null : { left }) };
}

// The stage (scroll range) is measured by live rects rather than re-deriving
// its centered offset, so the math is direction-agnostic: RTL scrollLeft
// coordinate spaces and the browser's own clamping both fall out for free.
function captureImageZoomInlineFraction(viewportElement: HTMLDivElement) {
  const rangeRect = readElementRect(
    viewportElement.querySelector<HTMLElement>(
      IMAGE_ZOOM_SCROLL_RANGE_SELECTOR,
    ),
  );
  if (!rangeRect || rangeRect.width <= 0) return null;
  return (
    (getViewportCenterX(viewportElement) - rangeRect.left) / rangeRect.width
  );
}

function captureImageZoomBlockFraction(viewportElement: HTMLDivElement) {
  const rangeRect = readElementRect(
    viewportElement.querySelector<HTMLElement>(
      IMAGE_ZOOM_SCROLL_RANGE_SELECTOR,
    ),
  );
  if (!rangeRect || rangeRect.height <= 0) return null;
  return (
    (getViewportCenterY(viewportElement) - rangeRect.top) / rangeRect.height
  );
}

// Scroll down by however far the anchored content point currently sits below
// the viewport centre — the block mirror of the inline solve. Only valid while
// the stage box IS the document; a rebased scroll detaches the two, and the
// caller falls back to the frame model.
function resolveImageZoomScrollTop({
  layout,
  transaction,
  viewportElement,
}: {
  layout: ImageFrameLayoutModel;
  transaction: ImageZoomTransaction;
  viewportElement: HTMLDivElement;
}) {
  if (transaction.blockFraction == null) return null;
  const rangeRect = readElementRect(
    viewportElement.querySelector<HTMLElement>(
      IMAGE_ZOOM_SCROLL_RANGE_SELECTOR,
    ),
  );
  if (!rangeRect || rangeRect.height <= 0) return null;
  if (Math.abs(rangeRect.height - layout.totalHeight) > 2) return null;
  return (
    viewportElement.scrollTop +
    (rangeRect.top + rangeRect.height * transaction.blockFraction) -
    getViewportCenterY(viewportElement)
  );
}

function resolveImageZoomScrollLeft(
  viewportElement: HTMLDivElement,
  transaction: ImageZoomTransaction,
) {
  if (transaction.inlineFraction == null) return undefined;
  const rangeRect = readElementRect(
    viewportElement.querySelector<HTMLElement>(
      IMAGE_ZOOM_SCROLL_RANGE_SELECTOR,
    ),
  );
  if (!rangeRect || rangeRect.width <= 0) return undefined;

  // Scroll right by however far the anchored content point currently sits
  // right of the viewport center; the browser clamps to the scrollable range
  // (which also zeroes it out when the stage fits without overflow).
  return (
    viewportElement.scrollLeft +
    (rangeRect.left + rangeRect.width * transaction.inlineFraction) -
    getViewportCenterX(viewportElement)
  );
}

export function playImageZoomMotion({
  transaction,
  viewportElement,
}: {
  transaction: ImageZoomTransaction;
  viewportElement: HTMLDivElement;
}): (() => void) | null {
  if (typeof requestAnimationFrame !== "function") return null;
  if (prefersReducedMotion()) return null;

  const previousRect = transaction.previousVisualRect;
  const visualLayer = findImageZoomVisualLayer(viewportElement);
  if (!previousRect || !visualLayer) return null;

  const currentRect = readElementRect(visualLayer);
  if (
    !currentRect ||
    previousRect.width <= 0 ||
    previousRect.height <= 0 ||
    currentRect.width <= 0 ||
    currentRect.height <= 0
  ) {
    return null;
  }

  const scaleX = previousRect.width / currentRect.width;
  const scaleY = previousRect.height / currentRect.height;
  if (hasDetachedImageZoomAxes(scaleX, scaleY)) {
    return null;
  }

  const translateX = previousRect.left - currentRect.left;
  const translateY = previousRect.top - currentRect.top;
  const hasVisibleDelta =
    Math.abs(translateX) > IMAGE_ZOOM_MOTION_MIN_TRANSLATE_PX ||
    Math.abs(translateY) > IMAGE_ZOOM_MOTION_MIN_TRANSLATE_PX ||
    Math.abs(1 - scaleX) > IMAGE_ZOOM_MOTION_MIN_SCALE_DELTA ||
    Math.abs(1 - scaleY) > IMAGE_ZOOM_MOTION_MIN_SCALE_DELTA;
  if (!hasVisibleDelta) return null;

  // Re-express the FLIP about the viewport center instead of the stage's
  // top-left: the stage is the full document (potentially hundreds of
  // thousands of px tall), and a scale that far from its origin runs into
  // GPU float precision. Anchoring at the viewport keeps the rasterized
  // region's coordinates small; the mapping is identical.
  const originX = getViewportCenterX(viewportElement) - currentRect.left;
  const originY =
    viewportElement.getBoundingClientRect().top +
    Math.max(0, viewportElement.clientHeight) / 2 -
    currentRect.top;
  const anchoredTranslateX = translateX + (scaleX - 1) * originX;
  const anchoredTranslateY = translateY + (scaleY - 1) * originY;

  let cleanupTimeout: ReturnType<typeof setTimeout> | null = null;
  let startFrame = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (startFrame !== 0) cancelAnimationFrame(startFrame);
    if (cleanupTimeout !== null) clearTimeout(cleanupTimeout);
    visualLayer.style.transition = "";
    visualLayer.style.transform = "";
    visualLayer.style.transformOrigin = "";
    visualLayer.style.willChange = "";
  };

  visualLayer.style.transition = "none";
  visualLayer.style.transformOrigin = `${originX}px ${originY}px`;
  visualLayer.style.transform = `translate3d(${anchoredTranslateX}px, ${anchoredTranslateY}px, 0px) scale(${scaleX}, ${scaleY})`;
  visualLayer.style.willChange = "transform";

  startFrame = requestAnimationFrame(() => {
    startFrame = 0;
    if (finished) return;
    visualLayer.style.transition = `transform ${IMAGE_ZOOM_MOTION_DURATION_MS}ms ${IMAGE_ZOOM_MOTION_EASING}`;
    visualLayer.style.transform = "translate3d(0px, 0px, 0px) scale(1, 1)";
  });
  cleanupTimeout = setTimeout(finish, IMAGE_ZOOM_MOTION_CLEANUP_MS);

  return finish;
}

function findImageZoomVisualLayer(viewportElement: HTMLDivElement) {
  if (typeof viewportElement.querySelector !== "function") return null;
  return viewportElement.querySelector<HTMLElement>(
    IMAGE_ZOOM_VISUAL_LAYER_SELECTOR,
  );
}

function getViewportCenterX(viewportElement: HTMLDivElement) {
  return (
    viewportElement.getBoundingClientRect().left +
    Math.max(0, viewportElement.clientWidth) / 2
  );
}

function getViewportCenterY(viewportElement: HTMLDivElement) {
  return (
    viewportElement.getBoundingClientRect().top +
    Math.max(0, viewportElement.clientHeight) / 2
  );
}

// True when one axis is pinned while the other rescales — the paged-scroll
// signature — or when the two ratios are so far apart that the stage box
// cannot be tracking the content at all.
function hasDetachedImageZoomAxes(scaleX: number, scaleY: number) {
  const inlineDelta = Math.abs(scaleX - 1);
  const blockDelta = Math.abs(scaleY - 1);
  const frozenAxis =
    (blockDelta < IMAGE_ZOOM_MOTION_AXIS_FROZEN_DELTA &&
      inlineDelta > IMAGE_ZOOM_MOTION_AXIS_MOVED_DELTA) ||
    (inlineDelta < IMAGE_ZOOM_MOTION_AXIS_FROZEN_DELTA &&
      blockDelta > IMAGE_ZOOM_MOTION_AXIS_MOVED_DELTA);
  return (
    frozenAxis ||
    Math.abs(scaleX - scaleY) >
      IMAGE_ZOOM_MOTION_AXIS_MISMATCH_RATIO * Math.max(scaleX, scaleY)
  );
}

function readElementRect(element: HTMLElement | null) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return null;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function prefersReducedMotion() {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
