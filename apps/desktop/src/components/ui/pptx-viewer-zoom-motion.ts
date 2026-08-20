import { clamp } from "./pptx-viewer-core";
import type { ViewerDocumentZoomMotionController } from "./viewer-types";

// Structural copy of PptxSlideLayout's zoom-relevant slice, so the visible-
// slide module (which consumes this one) is not also an import of it.
export type PptxZoomSlideLayout = {
  slideCount: number;
  slideTopPadding: number;
  slideHeight: number;
  slideStride: number;
  totalHeight: number;
};

// A toolbar zoom step re-anchors the viewport CENTER on both axes (Apple
// Preview semantics): the content point under the viewport center before the
// step is back under the viewport center after it, and a short FLIP relax
// scales the painted surface about that fixed point. The reading-marker
// restore (20% from the top, block axis only) stays the semantics for every
// other geometry change — re-fits, rotation, container resizes — where the
// intent is "keep my reading position", not "zoom the camera".
const PPTX_ZOOM_CENTER_MARKER_RATIO = 0.5;
const PPTX_ZOOM_MOTION_DURATION_MS = 200;
// easeOutCubic: fast attack, gentle landing — a linear relax reads as a
// hard stop at settle.
const PPTX_ZOOM_MOTION_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";
const PPTX_ZOOM_MOTION_CLEANUP_MS = PPTX_ZOOM_MOTION_DURATION_MS + 50;
const PPTX_ZOOM_MOTION_MIN_TRANSLATE_PX = 0.5;
const PPTX_ZOOM_MOTION_MIN_SCALE_DELTA = 0.001;
// A rebased (paged) physical scroll detaches the stage box from the content
// scale, so the whole-surface FLIP would warp. Its signature is precise: the
// rebased axis is PINNED (the container keeps its size while the content
// rescales), so one axis barely moves while the other moves a lot. Testing for
// that beats a plain ratio tolerance — an honest slide stack carries small
// constant terms (rounded gaps, fixed outer padding) that put the block axis a
// couple of percent off the inline one. On a big jump a tight ratio tolerance
// then refuses the relax and the whole scale change lands in one frame —
// measured on the image viewer as an un-animated 620px snap on a multi-frame
// TIFF's fit-width, and this stack has the same shape of layout. The
// wide ratio net below still catches anything wilder, and the FLIP writes
// per-axis scales, so a slightly non-affine layout renders exactly.
const PPTX_ZOOM_MOTION_AXIS_FROZEN_DELTA = 0.02;
const PPTX_ZOOM_MOTION_AXIS_MOVED_DELTA = 0.05;
const PPTX_ZOOM_MOTION_AXIS_MISMATCH_RATIO = 0.25;

// The exact wait-out of the relax before the visual clip re-tightens; clip
// release is React-rendered state, so it outlives the inline transition.
export const PPTX_ZOOM_MOTION_TOTAL_MS = PPTX_ZOOM_MOTION_CLEANUP_MS + 50;

// A zoom intent is consumed by the layout commit its gesture causes; if no
// commit claims it in this window (scale already clamped, controlled scale
// ignored by the owner), it is stale and must not re-anchor a later,
// unrelated layout change.
export const PPTX_ZOOM_INTENT_MAX_AGE_MS = 400;

// The document surface shrink-wraps the slide column (width = slideWidth,
// exactly linear in scale) — the inline-anchor ruler. The FLIP relaxes on the
// virtual canvas inside it: the canvas spans the full (physical) scroll
// height and is NOT the kernel-registered surface, whose style the shell
// motion owns.
const PPTX_ZOOM_STAGE_SELECTOR = '[data-slot="pptx-viewer-document-surface"]';
const PPTX_ZOOM_VISUAL_LAYER_SELECTOR =
  '[data-slot="pptx-slide-virtual-canvas"]';

export type PptxZoomTransaction = {
  slideNumber: number;
  /**
   * Deliberately unclamped, like the reading anchor: the slide layout is
   * exactly linear in scale (fractional gap, fixed outer padding), so a
   * center marker resting in a gap restores by the same slide-relative
   * fraction.
   */
  yPercent: number;
  /** Viewport-center position as a fraction of the stage's inline size. */
  inlineFraction: number | null;
  /**
   * Same, on the BLOCK axis. Rect-derived like the inline one, so the solve
   * cannot be thrown off by anything the layout model does not know about —
   * chiefly the auto margins that centre a zoomed-out deck inside the pane.
   * The slide model stays the fallback for a rebased (paged) scroll, where
   * the stage stops spanning the deck.
   */
  blockFraction: number | null;
  /** Painted visual-layer rect at click time — the FLIP's "first" frame. */
  previousVisualRect: DOMRectReadOnly | null;
};

export function createPptxZoomMotionController(
  layout: PptxZoomSlideLayout,
): ViewerDocumentZoomMotionController<PptxZoomTransaction> {
  return {
    capture: ({ scrollTop, viewportElement }) =>
      capturePptxZoomTransaction({ layout, scrollTop, viewportElement }),
    resolveScrollTarget: ({ transaction, viewportElement }) =>
      resolvePptxZoomScrollTarget({ layout, transaction, viewportElement }),
    play: ({ transaction, viewportElement }) =>
      playPptxZoomMotion({ transaction, viewportElement }),
  };
}

export function capturePptxZoomTransaction({
  layout,
  scrollTop,
  viewportElement,
}: {
  layout: PptxZoomSlideLayout;
  /** LOGICAL scroll top — the caller maps out of the paged physical space. */
  scrollTop: number;
  viewportElement: HTMLDivElement;
}): PptxZoomTransaction | null {
  if (layout.slideCount === 0 || layout.slideHeight <= 0) return null;

  const viewportBlockSize = Math.max(0, viewportElement.clientHeight);
  const centerOffset =
    Math.max(0, scrollTop) + viewportBlockSize * PPTX_ZOOM_CENTER_MARKER_RATIO;
  const slideNumber = getPptxZoomSlideAtOffset(layout, centerOffset);
  const slideTop = getPptxZoomSlideTop(layout, slideNumber - 1);

  return {
    slideNumber,
    yPercent: (centerOffset - slideTop) / layout.slideHeight,
    inlineFraction: capturePptxZoomInlineFraction(viewportElement),
    blockFraction: capturePptxZoomBlockFraction(viewportElement),
    previousVisualRect: readElementRect(
      findPptxZoomVisualLayer(viewportElement),
    ),
  };
}

export function resolvePptxZoomScrollTarget({
  layout,
  transaction,
  viewportElement,
}: {
  layout: PptxZoomSlideLayout;
  transaction: PptxZoomTransaction;
  viewportElement: HTMLDivElement;
}): { left?: number; top: number } | null {
  if (
    layout.slideHeight <= 0 ||
    transaction.slideNumber < 1 ||
    transaction.slideNumber > layout.slideCount
  ) {
    return null;
  }

  const viewportBlockSize = Math.max(0, viewportElement.clientHeight);
  const maxScrollTop = Math.max(0, layout.totalHeight - viewportBlockSize);
  const slideTop = getPptxZoomSlideTop(layout, transaction.slideNumber - 1);
  // LOGICAL target — the caller maps back into the paged physical space.
  const top = clamp(
    resolvePptxZoomScrollTop({ layout, transaction, viewportElement }) ??
      slideTop +
        layout.slideHeight * transaction.yPercent -
        viewportBlockSize * PPTX_ZOOM_CENTER_MARKER_RATIO,
    0,
    maxScrollTop,
  );

  const left = resolvePptxZoomScrollLeft(viewportElement, transaction);
  return { top, ...(left == null ? null : { left }) };
}

// The stage is measured by live rects rather than re-deriving its centered
// offset, so the math is direction-agnostic: RTL scrollLeft coordinate spaces
// and the browser's own clamping both fall out for free.
function capturePptxZoomInlineFraction(viewportElement: HTMLDivElement) {
  const stageRect = readElementRect(findPptxZoomStage(viewportElement));
  if (!stageRect || stageRect.width <= 0) return null;
  return (
    (getViewportCenterX(viewportElement) - stageRect.left) / stageRect.width
  );
}

function capturePptxZoomBlockFraction(viewportElement: HTMLDivElement) {
  const stageRect = readElementRect(findPptxZoomStage(viewportElement));
  if (!stageRect || stageRect.height <= 0) return null;
  return (
    (getViewportCenterY(viewportElement) - stageRect.top) / stageRect.height
  );
}

// Scroll down by however far the anchored content point currently sits below
// the viewport centre — the block mirror of the inline solve. Only valid while
// the stage box IS the deck; a rebased scroll detaches the two and the caller
// falls back to the slide model.
function resolvePptxZoomScrollTop({
  layout,
  transaction,
  viewportElement,
}: {
  layout: PptxZoomSlideLayout;
  transaction: PptxZoomTransaction;
  viewportElement: HTMLDivElement;
}) {
  if (transaction.blockFraction == null) return null;
  const stageRect = readElementRect(findPptxZoomStage(viewportElement));
  if (!stageRect || stageRect.height <= 0) return null;
  if (Math.abs(stageRect.height - layout.totalHeight) > 2) return null;
  return (
    viewportElement.scrollTop +
    (stageRect.top + stageRect.height * transaction.blockFraction) -
    getViewportCenterY(viewportElement)
  );
}

function resolvePptxZoomScrollLeft(
  viewportElement: HTMLDivElement,
  transaction: PptxZoomTransaction,
) {
  if (transaction.inlineFraction == null) return undefined;
  const stageRect = readElementRect(findPptxZoomStage(viewportElement));
  if (!stageRect || stageRect.width <= 0) return undefined;

  // Scroll right by however far the anchored content point currently sits
  // right of the viewport center; the browser clamps to the scrollable range
  // (which also zeroes it out when the stage fits without overflow).
  return (
    viewportElement.scrollLeft +
    (stageRect.left + stageRect.width * transaction.inlineFraction) -
    getViewportCenterX(viewportElement)
  );
}

export function playPptxZoomMotion({
  transaction,
  viewportElement,
}: {
  transaction: PptxZoomTransaction;
  viewportElement: HTMLDivElement;
}): (() => void) | null {
  if (typeof requestAnimationFrame !== "function") return null;
  if (prefersReducedMotion()) return null;

  const previousRect = transaction.previousVisualRect;
  const visualLayer = findPptxZoomVisualLayer(viewportElement);
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
  if (hasDetachedPptxZoomAxes(scaleX, scaleY)) {
    return null;
  }

  const translateX = previousRect.left - currentRect.left;
  const translateY = previousRect.top - currentRect.top;
  const hasVisibleDelta =
    Math.abs(translateX) > PPTX_ZOOM_MOTION_MIN_TRANSLATE_PX ||
    Math.abs(translateY) > PPTX_ZOOM_MOTION_MIN_TRANSLATE_PX ||
    Math.abs(1 - scaleX) > PPTX_ZOOM_MOTION_MIN_SCALE_DELTA ||
    Math.abs(1 - scaleY) > PPTX_ZOOM_MOTION_MIN_SCALE_DELTA;
  if (!hasVisibleDelta) return null;

  // Re-express the FLIP about the viewport center instead of the canvas's
  // top-left: the canvas is the full deck (potentially hundreds of thousands
  // of px tall), and a scale that far from its origin runs into GPU float
  // precision. Anchoring at the viewport keeps the rasterized region's
  // coordinates small; the mapping is identical.
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
    removeInterruptListeners();
    visualLayer.style.transition = "";
    visualLayer.style.transform = "";
    visualLayer.style.transformOrigin = "";
    visualLayer.style.willChange = "";
  };
  // A user gesture mid-relax snaps to the committed endpoint: layout and
  // scroll already landed in the zoom's own commit, so clearing the transform
  // is always safe — and content must never keep gliding under a live scroll.
  // (Gesture events only; the zoom's own programmatic scroll writes do not
  // fire these.)
  const removeInterruptListeners = attachPptxZoomInterruptListeners(
    viewportElement,
    () => finish(),
  );

  visualLayer.style.transition = "none";
  visualLayer.style.transformOrigin = `${originX}px ${originY}px`;
  visualLayer.style.transform = `translate3d(${anchoredTranslateX}px, ${anchoredTranslateY}px, 0px) scale(${scaleX}, ${scaleY})`;
  visualLayer.style.willChange = "transform";

  startFrame = requestAnimationFrame(() => {
    startFrame = 0;
    if (finished) return;
    visualLayer.style.transition = `transform ${PPTX_ZOOM_MOTION_DURATION_MS}ms ${PPTX_ZOOM_MOTION_EASING}`;
    visualLayer.style.transform = "translate3d(0px, 0px, 0px) scale(1, 1)";
  });
  cleanupTimeout = setTimeout(finish, PPTX_ZOOM_MOTION_CLEANUP_MS);

  return finish;
}

function attachPptxZoomInterruptListeners(
  viewportElement: HTMLDivElement,
  interrupt: () => void,
) {
  if (typeof viewportElement.addEventListener !== "function") return () => {};
  const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  for (const event of events) {
    viewportElement.addEventListener(event, interrupt, { passive: true });
  }
  return () => {
    for (const event of events) {
      viewportElement.removeEventListener(event, interrupt);
    }
  };
}

function getPptxZoomSlideAtOffset(layout: PptxZoomSlideLayout, offset: number) {
  if (layout.slideCount <= 1 || layout.slideStride <= 0) return 1;
  const slideIndex = Math.floor(
    (offset - layout.slideTopPadding) / layout.slideStride,
  );
  return clamp(slideIndex + 1, 1, layout.slideCount);
}

function getPptxZoomSlideTop(layout: PptxZoomSlideLayout, slideIndex: number) {
  return layout.slideTopPadding + slideIndex * layout.slideStride;
}

function findPptxZoomStage(viewportElement: HTMLDivElement) {
  if (typeof viewportElement.querySelector !== "function") return null;
  return viewportElement.querySelector<HTMLElement>(PPTX_ZOOM_STAGE_SELECTOR);
}

function findPptxZoomVisualLayer(viewportElement: HTMLDivElement) {
  if (typeof viewportElement.querySelector !== "function") return null;
  return viewportElement.querySelector<HTMLElement>(
    PPTX_ZOOM_VISUAL_LAYER_SELECTOR,
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
function hasDetachedPptxZoomAxes(scaleX: number, scaleY: number) {
  const inlineDelta = Math.abs(scaleX - 1);
  const blockDelta = Math.abs(scaleY - 1);
  const frozenAxis =
    (blockDelta < PPTX_ZOOM_MOTION_AXIS_FROZEN_DELTA &&
      inlineDelta > PPTX_ZOOM_MOTION_AXIS_MOVED_DELTA) ||
    (inlineDelta < PPTX_ZOOM_MOTION_AXIS_FROZEN_DELTA &&
      blockDelta > PPTX_ZOOM_MOTION_AXIS_MOVED_DELTA);
  return (
    frozenAxis ||
    Math.abs(scaleX - scaleY) >
      PPTX_ZOOM_MOTION_AXIS_MISMATCH_RATIO * Math.max(scaleX, scaleY)
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
