import { clamp } from "./docx-viewer-core";
import {
  DOCX_VIEWER_PADDING_PX,
  type DocxPageLayout,
} from "./docx-viewer-layout";
import type { ViewerDocumentZoomMotionController } from "./viewer-types";

// A toolbar zoom step re-anchors the viewport CENTER on both axes (Apple
// Preview semantics): the content point under the viewport center before the
// step is back under the viewport center after it, and a short FLIP relax
// scales the painted surface about that fixed point. The reading-marker
// restore (20% from the top, block axis only) stays the semantics for every
// other geometry change — re-fits, container resizes — where the intent is
// "keep my reading position", not "zoom the camera".
const DOCX_ZOOM_CENTER_MARKER_RATIO = 0.5;
const DOCX_ZOOM_MOTION_DURATION_MS = 200;
// easeOutCubic: fast attack, gentle landing — a linear relax reads as a
// hard stop at settle.
const DOCX_ZOOM_MOTION_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";
const DOCX_ZOOM_MOTION_CLEANUP_MS = DOCX_ZOOM_MOTION_DURATION_MS + 50;
const DOCX_ZOOM_MOTION_MIN_TRANSLATE_PX = 0.5;
const DOCX_ZOOM_MOTION_MIN_SCALE_DELTA = 0.001;
// A rebased (paged) physical scroll detaches the stage box from the content
// scale, so the whole-surface FLIP would warp. Its signature is precise: the
// rebased axis is PINNED (the container keeps its size while the content
// rescales), so one axis barely moves while the other moves a lot. Testing for
// that beats a plain ratio tolerance — an honest page stack carries small
// constant terms (rounded gaps, fixed outer padding) that put the block axis a
// couple of percent off the inline one. On a big jump a tight ratio tolerance
// then refuses the relax and the whole scale change lands in one frame —
// measured on the image viewer as an un-animated 620px snap on a multi-frame
// TIFF's fit-width, and this stack has the same shape of layout. The
// wide ratio net below still catches anything wilder, and the FLIP writes
// per-axis scales, so a slightly non-affine layout renders exactly.
const DOCX_ZOOM_MOTION_AXIS_FROZEN_DELTA = 0.02;
const DOCX_ZOOM_MOTION_AXIS_MOVED_DELTA = 0.05;
const DOCX_ZOOM_MOTION_AXIS_MISMATCH_RATIO = 0.25;

// The exact wait-out of the relax before the visual clip re-tightens; clip
// release is React-rendered state, so it outlives the inline transition.
export const DOCX_ZOOM_MOTION_TOTAL_MS = DOCX_ZOOM_MOTION_CLEANUP_MS + 50;

// A zoom intent is consumed by the layout commit its gesture causes; if no
// commit claims it in this window (scale already clamped, controlled scale
// ignored by the owner), it is stale and must not re-anchor a later,
// unrelated layout change.
export const DOCX_ZOOM_INTENT_MAX_AGE_MS = 400;

// The zoom stage wraps the CSS-zoomed docx host: it shrink-wraps the page box
// (width = pageWidth × scale, exactly linear in scale), so it serves as both
// the inline-anchor ruler and the FLIP layer. The transform must NOT go on
// the `zoom`-styled host itself — zoom and transform-origin resolve in
// different coordinate spaces — and not on the kernel-registered document
// surface, whose style the shell motion owns.
const DOCX_ZOOM_STAGE_SELECTOR = '[data-slot="docx-viewer-zoom-stage"]';

export type DocxZoomTransaction = {
  pageNumber: number;
  /**
   * Deliberately unclamped, like the reading anchor: page offsets are linear
   * in scale (intrinsic tops × scale + fixed outer padding), so a center
   * marker resting in a gap restores by the same page-relative fraction.
   */
  yPercent: number;
  /** Viewport-center position as a fraction of the stage's inline size. */
  inlineFraction: number | null;
  /**
   * Same, on the BLOCK axis. Rect-derived like the inline one, so the solve
   * cannot be thrown off by anything the layout model does not know about —
   * chiefly the auto margins that centre a zoomed-out page inside the pane.
   * The page model stays the fallback whenever the stage's painted height
   * stops matching the scaled document.
   */
  blockFraction: number | null;
  /** Painted stage rect at click time — the FLIP's "first" frame. */
  previousVisualRect: DOMRectReadOnly | null;
};

export function createDocxZoomMotionController({
  layout,
  scale,
}: {
  layout: DocxPageLayout | null;
  scale: number;
}): ViewerDocumentZoomMotionController<DocxZoomTransaction> {
  return {
    capture: ({ scrollTop, viewportElement }) =>
      captureDocxZoomTransaction({ layout, scale, scrollTop, viewportElement }),
    resolveScrollTarget: ({ transaction, viewportElement }) =>
      resolveDocxZoomScrollTarget({
        layout,
        scale,
        transaction,
        viewportElement,
      }),
    play: ({ transaction, viewportElement }) =>
      playDocxZoomMotion({ transaction, viewportElement }),
  };
}

export function captureDocxZoomTransaction({
  layout,
  scale,
  scrollTop,
  viewportElement,
}: {
  layout: DocxPageLayout | null;
  scale: number;
  scrollTop: number;
  viewportElement: HTMLDivElement;
}): DocxZoomTransaction | null {
  const pages = layout?.pages;
  if (!pages?.length) return null;

  const viewportBlockSize = Math.max(0, viewportElement.clientHeight);
  const centerOffset =
    Math.max(0, scrollTop) + viewportBlockSize * DOCX_ZOOM_CENTER_MARKER_RATIO;
  // Intrinsic (unscaled) document coordinate of the center marker.
  const y = (centerOffset - DOCX_VIEWER_PADDING_PX) / safeDocxZoomScale(scale);
  const page = findDocxPageAtIntrinsicOffset(pages, y);
  if (!page || page.height <= 0) return null;

  return {
    pageNumber: page.pageNumber,
    yPercent: (y - page.top) / page.height,
    inlineFraction: captureDocxZoomInlineFraction(viewportElement),
    blockFraction: captureDocxZoomBlockFraction(viewportElement),
    previousVisualRect: readElementRect(findDocxZoomStage(viewportElement)),
  };
}

export function resolveDocxZoomScrollTarget({
  layout,
  scale,
  transaction,
  viewportElement,
}: {
  layout: DocxPageLayout | null;
  scale: number;
  transaction: DocxZoomTransaction;
  viewportElement: HTMLDivElement;
}): { left?: number; top: number } | null {
  const page = layout?.pages[transaction.pageNumber - 1];
  if (!page || page.height <= 0) return null;

  const viewportBlockSize = Math.max(0, viewportElement.clientHeight);
  const maxScrollTop = Math.max(
    0,
    viewportElement.scrollHeight - viewportBlockSize,
  );
  const top = clamp(
    resolveDocxZoomScrollTop({ layout, scale, transaction, viewportElement }) ??
      DOCX_VIEWER_PADDING_PX +
        (page.top + page.height * transaction.yPercent) *
          safeDocxZoomScale(scale) -
        viewportBlockSize * DOCX_ZOOM_CENTER_MARKER_RATIO,
    0,
    maxScrollTop,
  );

  const left = resolveDocxZoomScrollLeft(viewportElement, transaction);
  return { top, ...(left == null ? null : { left }) };
}

// The stage is measured by live rects rather than re-deriving its centered
// offset, so the math is direction-agnostic: RTL scrollLeft coordinate spaces
// and the browser's own clamping both fall out for free.
function captureDocxZoomInlineFraction(viewportElement: HTMLDivElement) {
  const stageRect = readElementRect(findDocxZoomStage(viewportElement));
  if (!stageRect || stageRect.width <= 0) return null;
  return (
    (getViewportCenterX(viewportElement) - stageRect.left) / stageRect.width
  );
}

function captureDocxZoomBlockFraction(viewportElement: HTMLDivElement) {
  const stageRect = readElementRect(findDocxZoomStage(viewportElement));
  if (!stageRect || stageRect.height <= 0) return null;
  return (
    (getViewportCenterY(viewportElement) - stageRect.top) / stageRect.height
  );
}

// Scroll down by however far the anchored content point currently sits below
// the viewport centre — the block mirror of the inline solve. Guarded on the
// stage still painting the whole scaled document, so a virtualized or
// otherwise detached stage falls back to the page model.
function resolveDocxZoomScrollTop({
  layout,
  scale,
  transaction,
  viewportElement,
}: {
  layout: DocxPageLayout | null;
  scale: number;
  transaction: DocxZoomTransaction;
  viewportElement: HTMLDivElement;
}) {
  if (transaction.blockFraction == null || !layout) return null;
  const stageRect = readElementRect(findDocxZoomStage(viewportElement));
  if (!stageRect || stageRect.height <= 0) return null;
  const documentHeight = layout.totalHeight * safeDocxZoomScale(scale);
  if (Math.abs(stageRect.height - documentHeight) > 2) return null;
  return (
    viewportElement.scrollTop +
    (stageRect.top + stageRect.height * transaction.blockFraction) -
    getViewportCenterY(viewportElement)
  );
}

function resolveDocxZoomScrollLeft(
  viewportElement: HTMLDivElement,
  transaction: DocxZoomTransaction,
) {
  if (transaction.inlineFraction == null) return undefined;
  const stageRect = readElementRect(findDocxZoomStage(viewportElement));
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

export function playDocxZoomMotion({
  transaction,
  viewportElement,
}: {
  transaction: DocxZoomTransaction;
  viewportElement: HTMLDivElement;
}): (() => void) | null {
  if (typeof requestAnimationFrame !== "function") return null;
  if (prefersReducedMotion()) return null;

  const previousRect = transaction.previousVisualRect;
  const stage = findDocxZoomStage(viewportElement);
  if (!previousRect || !stage) return null;

  const currentRect = readElementRect(stage);
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
  if (hasDetachedDocxZoomAxes(scaleX, scaleY)) {
    return null;
  }

  const translateX = previousRect.left - currentRect.left;
  const translateY = previousRect.top - currentRect.top;
  const hasVisibleDelta =
    Math.abs(translateX) > DOCX_ZOOM_MOTION_MIN_TRANSLATE_PX ||
    Math.abs(translateY) > DOCX_ZOOM_MOTION_MIN_TRANSLATE_PX ||
    Math.abs(1 - scaleX) > DOCX_ZOOM_MOTION_MIN_SCALE_DELTA ||
    Math.abs(1 - scaleY) > DOCX_ZOOM_MOTION_MIN_SCALE_DELTA;
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
    removeInterruptListeners();
    stage.style.transition = "";
    stage.style.transform = "";
    stage.style.transformOrigin = "";
    stage.style.willChange = "";
  };
  // A user gesture mid-relax snaps to the committed endpoint: layout and
  // scroll already landed in the zoom's own commit, so clearing the transform
  // is always safe — and content must never keep gliding under a live scroll.
  // (Gesture events only; the zoom's own programmatic scroll writes do not
  // fire these.)
  const removeInterruptListeners = attachDocxZoomInterruptListeners(
    viewportElement,
    () => finish(),
  );

  stage.style.transition = "none";
  stage.style.transformOrigin = `${originX}px ${originY}px`;
  stage.style.transform = `translate3d(${anchoredTranslateX}px, ${anchoredTranslateY}px, 0px) scale(${scaleX}, ${scaleY})`;
  stage.style.willChange = "transform";

  startFrame = requestAnimationFrame(() => {
    startFrame = 0;
    if (finished) return;
    stage.style.transition = `transform ${DOCX_ZOOM_MOTION_DURATION_MS}ms ${DOCX_ZOOM_MOTION_EASING}`;
    stage.style.transform = "translate3d(0px, 0px, 0px) scale(1, 1)";
  });
  cleanupTimeout = setTimeout(finish, DOCX_ZOOM_MOTION_CLEANUP_MS);

  return finish;
}

function attachDocxZoomInterruptListeners(
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

function findDocxPageAtIntrinsicOffset(
  pages: DocxPageLayout["pages"],
  y: number,
) {
  let low = 0;
  let high = pages.length - 1;
  let current = pages[0] ?? null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const page = pages[mid]!;
    if (page.top <= y) {
      current = page;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return current;
}

function findDocxZoomStage(viewportElement: HTMLDivElement) {
  if (typeof viewportElement.querySelector !== "function") return null;
  return viewportElement.querySelector<HTMLElement>(DOCX_ZOOM_STAGE_SELECTOR);
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
function hasDetachedDocxZoomAxes(scaleX: number, scaleY: number) {
  const inlineDelta = Math.abs(scaleX - 1);
  const blockDelta = Math.abs(scaleY - 1);
  const frozenAxis =
    (blockDelta < DOCX_ZOOM_MOTION_AXIS_FROZEN_DELTA &&
      inlineDelta > DOCX_ZOOM_MOTION_AXIS_MOVED_DELTA) ||
    (inlineDelta < DOCX_ZOOM_MOTION_AXIS_FROZEN_DELTA &&
      blockDelta > DOCX_ZOOM_MOTION_AXIS_MOVED_DELTA);
  return (
    frozenAxis ||
    Math.abs(scaleX - scaleY) >
      DOCX_ZOOM_MOTION_AXIS_MISMATCH_RATIO * Math.max(scaleX, scaleY)
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

function safeDocxZoomScale(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
