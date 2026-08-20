import {
  findPdfPageByOffset,
  getPdfPageLayout,
  type PdfPageLayoutModel,
} from "./pdf-viewer-layout";
import { clamp } from "./pdf-viewer-scale";
import type { PdfPageRenderTiming } from "./pdf-viewer-types";
import type { ViewerDocumentZoomMotionController } from "./viewer-types";

// A toolbar zoom step re-anchors the viewport CENTER on both axes (Apple
// Preview semantics): the content point under the viewport center before the
// step is back under the viewport center after it, and a short relax scales
// the painted surface about that fixed point. The reading-marker restore
// (20% from the top, block axis only) stays the semantics for every other
// geometry change — re-fits, rotation, container resizes — where the intent
// is "keep my reading position", not "zoom the camera".
const PDF_ZOOM_CENTER_MARKER_RATIO = 0.5;
const PDF_ZOOM_MOTION_DURATION_MS = 200;
const PDF_ZOOM_MOTION_MIN_TRANSLATE_PX = 0.5;
const PDF_ZOOM_MOTION_MIN_SCALE_DELTA = 0.001;
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
const PDF_ZOOM_MOTION_AXIS_FROZEN_DELTA = 0.02;
const PDF_ZOOM_MOTION_AXIS_MOVED_DELTA = 0.05;
const PDF_ZOOM_MOTION_AXIS_MISMATCH_RATIO = 0.25;
// The scroll write quantizes to device pixels, so the commit can land the
// anchor a sub-pixel off the pure center scale. Smearing that residual over
// the relax pans the anchor for 200ms — the eye tracks it as a wander.
// Folding it into the (invisible) opening frame instead keeps the anchor
// mathematically stationary for the whole flight; a residual beyond this
// epsilon is a REAL clamped-edge pan and must stay animated.
const PDF_ZOOM_MOTION_ANCHOR_SNAP_EPSILON_PX = 1.25;
// Stall net: a hidden tab freezes rAF, and an abandoned counter-transform
// must never outlive its flight. Generous on purpose — it only fires when
// the clock stopped ticking.
const PDF_ZOOM_MOTION_STALL_TIMEOUT_MS = PDF_ZOOM_MOTION_DURATION_MS * 2 + 200;

// The exact wait-out of the relax before the visual clip re-tightens and
// rasterization resumes; clip release and raster holds are React-rendered
// state, so they outlive the inline writes.
export const PDF_ZOOM_MOTION_TOTAL_MS = PDF_ZOOM_MOTION_DURATION_MS + 100;

const PDF_ZOOM_VISUAL_LAYER_SELECTOR = '[data-slot="pdf-viewer-visual-clip"]';

const PDF_ZOOM_FLIGHT_RECORD_LIMIT = 12;
const PDF_ZOOM_FLIGHT_TICK_LIMIT = 120;

export type PdfZoomTransaction = {
  /** Gesture timestamp — the flight's start-latency reference. */
  capturedAt: number;
  pageNumber: number;
  /**
   * Deliberately unclamped, like the reading anchor: the layout is linear in
   * scale, so a center marker resting in a gap or the edge padding restores
   * by the same page-relative fraction. Fallback for the rebased (paged)
   * physical scroll, where the painted layer stops spanning the document.
   */
  yPercent: number;
  /**
   * The viewport-center content point as fractions of the PAINTED visual
   * layer — the primary anchor on both axes. Painted (not committed) on
   * purpose: during a rapid retarget the user is centered on what is on
   * screen mid-flight, and the model-based fallback would re-anchor on the
   * committed geometry instead, bending the zoom's trajectory step to step.
   */
  paintedAnchor: { x: number; y: number } | null;
  /** Painted visual-layer rect at click time — the relax's "first" frame. */
  previousVisualRect: DOMRectReadOnly | null;
};

export type PdfZoomMotionTick = {
  elapsedMs: number;
  frameGapMs: number;
  progress: number;
  /** Painted (transform-inclusive) visual-layer rect at this tick. */
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
  rectHeight: number;
  scrollDriftPx: number;
};

export type PdfZoomMotionSkipReason =
  | "axis-scale-mismatch"
  | "bypass:resolve-failed"
  | "bypass:shell-transition"
  | "bypass:stale-intent"
  | "no-previous-rect"
  | "no-raf"
  | "no-visible-delta"
  | "no-visual-layer"
  | "reduced-motion"
  | "zero-rect";

export type PdfZoomMotionInterruption = "cancelled" | "none" | "stalled";

// Always-on flight recorder, mirroring the shell kernel's: every zoom relax
// (and every refusal to relax) leaves a bounded trace so a jagged report is
// diagnosable after the fact without re-instrumenting.
export type PdfZoomMotionFlightRecord = {
  /**
   * Measured stationarity of the anchored content point (the viewport
   * center), per axis: how far the point the zoom is anchored on WANDERS
   * during the flight. A pure center zoom keeps this at 0; any residual is
   * a pan smeared over the relax — the "illegal move".
   */
  anchorDriftMax: { x: number; y: number };
  durationMs: number;
  id: number;
  interruption: PdfZoomMotionInterruption;
  /** Long tasks observed while the flight was live (needs PerformanceObserver). */
  longTaskCount: number;
  longTaskMs: number;
  maxTickGapMs: number;
  /** Page raster work that landed mid-flight — the main jank source; 0 when healthy. */
  pageRenderCount: number;
  pageRenderMainThreadMs: number;
  /**
   * Max deviation of the painted surface corner from the straight chord
   * between its start and end positions. A pure zoom (translate+scale on one
   * shared progress) moves every point on a straight line; curvature here
   * means an external writer or an inconsistent per-axis motion law.
   */
  pathDeviationMaxPx: number;
  /** Commit's deviation from a pure center scale (quantization/clamping). */
  residualPx: number;
  /** True when the residual was folded into the opening frame, not animated. */
  residualSnapped: boolean;
  scale: { x: number; y: number };
  /** Max |scroll − scroll@start| seen during the flight; scroll must be static. */
  scrollDriftMaxPx: number;
  /** Styles verified cleared at finish. */
  settledClean: boolean;
  skipReason: PdfZoomMotionSkipReason | null;
  /** Gesture capture → first painted-frame tick. */
  startLatencyMs: number | null;
  /**
   * First tick's painted rect vs the click-time captured rect: how far the
   * flight's opening frame is from the screen the user was just looking at.
   */
  startSnapPx: number | null;
  startedAt: number;
  status: "played" | "skipped";
  tickCount: number;
  ticks: PdfZoomMotionTick[];
  translate: { x: number; y: number };
};

const zoomFlightRecords: PdfZoomMotionFlightRecord[] = [];
let zoomFlightSequence = 0;
let liveZoomFlightRecord: PdfZoomMotionFlightRecord | null = null;

export function getPdfZoomMotionFlightRecords(): readonly PdfZoomMotionFlightRecord[] {
  return zoomFlightRecords.slice();
}

export function clearPdfZoomMotionFlightRecords() {
  zoomFlightRecords.length = 0;
  liveZoomFlightRecord = null;
}

/**
 * Attributes page raster work to a live zoom flight. Wired from the runtime's
 * render-timing tap; with the flight-time raster holds in place this counter
 * staying at 0 is the telemetry proof that no pdf.js work contends with the
 * relax.
 */
export function notePdfZoomMotionPageRender(timing: PdfPageRenderTiming) {
  const record = liveZoomFlightRecord;
  if (!record) return;
  record.pageRenderCount += 1;
  record.pageRenderMainThreadMs += Math.max(0, timing.durationMs);
}

function pushZoomFlightRecord(record: PdfZoomMotionFlightRecord) {
  zoomFlightRecords.push(record);
  if (zoomFlightRecords.length > PDF_ZOOM_FLIGHT_RECORD_LIMIT) {
    zoomFlightRecords.splice(
      0,
      zoomFlightRecords.length - PDF_ZOOM_FLIGHT_RECORD_LIMIT,
    );
  }
}

function createZoomFlightRecord({
  scaleX,
  scaleY,
  skipReason,
  translateX,
  translateY,
}: {
  scaleX: number;
  scaleY: number;
  skipReason: PdfZoomMotionSkipReason | null;
  translateX: number;
  translateY: number;
}): PdfZoomMotionFlightRecord {
  zoomFlightSequence += 1;
  return {
    anchorDriftMax: { x: 0, y: 0 },
    durationMs: PDF_ZOOM_MOTION_DURATION_MS,
    id: zoomFlightSequence,
    interruption: "none",
    longTaskCount: 0,
    longTaskMs: 0,
    maxTickGapMs: 0,
    pageRenderCount: 0,
    pageRenderMainThreadMs: 0,
    pathDeviationMaxPx: 0,
    residualPx: 0,
    residualSnapped: false,
    scale: { x: scaleX, y: scaleY },
    scrollDriftMaxPx: 0,
    settledClean: skipReason !== null,
    skipReason,
    startLatencyMs: null,
    startSnapPx: null,
    startedAt: readNow(),
    status: skipReason === null ? "played" : "skipped",
    tickCount: 0,
    ticks: [],
    translate: { x: translateX, y: translateY },
  };
}

function recordZoomFlightSkip(reason: PdfZoomMotionSkipReason) {
  pushZoomFlightRecord(
    createZoomFlightRecord({
      scaleX: 1,
      scaleY: 1,
      skipReason: reason,
      translateX: 0,
      translateY: 0,
    }),
  );
  return null;
}

export function createPdfZoomMotionController(
  layout: PdfPageLayoutModel,
): ViewerDocumentZoomMotionController<PdfZoomTransaction> {
  return {
    capture: ({ scrollTop, viewportElement }) =>
      capturePdfZoomTransaction({ layout, scrollTop, viewportElement }),
    noteBypass: (reason) => {
      recordZoomFlightSkip(`bypass:${reason}`);
    },
    resolveScrollTarget: ({ transaction, viewportElement }) =>
      resolvePdfZoomScrollTarget({ layout, transaction, viewportElement }),
    play: ({ transaction, viewportElement }) =>
      playPdfZoomMotion({ transaction, viewportElement }),
  };
}

export function capturePdfZoomTransaction({
  layout,
  scrollTop,
  viewportElement,
}: {
  layout: PdfPageLayoutModel;
  scrollTop: number;
  viewportElement: HTMLDivElement;
}): PdfZoomTransaction | null {
  if (layout.pageCount === 0) return null;

  const viewportBlockSize = Math.max(0, viewportElement.clientHeight);
  const centerOffset =
    Math.max(0, scrollTop) + viewportBlockSize * PDF_ZOOM_CENTER_MARKER_RATIO;
  const pageNumber = findPdfPageByOffset(layout, centerOffset);
  const pageLayout = getPdfPageLayout(layout, pageNumber);
  if (!pageLayout || pageLayout.height <= 0) return null;

  const paintedRect = readElementRect(findPdfZoomVisualLayer(viewportElement));
  return {
    capturedAt: readNow(),
    pageNumber,
    yPercent: (centerOffset - pageLayout.offsetTop) / pageLayout.height,
    paintedAnchor:
      paintedRect && paintedRect.width > 0 && paintedRect.height > 0
        ? {
            x:
              (getViewportCenterX(viewportElement) - paintedRect.left) /
              paintedRect.width,
            y:
              (getViewportCenterY(viewportElement) - paintedRect.top) /
              paintedRect.height,
          }
        : null,
    previousVisualRect: paintedRect,
  };
}

// Both axes resolve by rect delta against the COMMITTED (untransformed)
// visual layer: scroll by however far the anchored content point sits from
// the viewport center. The rects ARE the painted DOM, so model↔DOM sub-pixel
// mismatch cannot re-enter, and the math is direction-agnostic (RTL scroll
// coordinate spaces and browser clamping fall out for free). The page-model
// path stays as the fallback for a rebased physical scroll, where the layer
// stops spanning the document.
export function resolvePdfZoomScrollTarget({
  layout,
  transaction,
  viewportElement,
}: {
  layout: PdfPageLayoutModel;
  transaction: PdfZoomTransaction;
  viewportElement: HTMLDivElement;
}): { left?: number; top: number } | null {
  const viewportBlockSize = Math.max(0, viewportElement.clientHeight);
  const maxScrollTop = Math.max(0, layout.totalHeight - viewportBlockSize);
  const committedRect = readElementRect(
    findPdfZoomVisualLayer(viewportElement),
  );
  const anchor = transaction.paintedAnchor;
  const isLayerDocumentSpanning =
    committedRect != null &&
    Math.abs(committedRect.height - layout.totalHeight) < 2;

  let top: number | null = null;
  if (anchor && committedRect && isLayerDocumentSpanning) {
    top = clamp(
      viewportElement.scrollTop +
        (committedRect.top + anchor.y * committedRect.height) -
        getViewportCenterY(viewportElement),
      0,
      maxScrollTop,
    );
  }
  if (top == null) {
    const pageLayout = getPdfPageLayout(layout, transaction.pageNumber);
    if (!pageLayout) return null;
    top = clamp(
      pageLayout.offsetTop +
        pageLayout.height * transaction.yPercent -
        viewportBlockSize * PDF_ZOOM_CENTER_MARKER_RATIO,
      0,
      maxScrollTop,
    );
  }

  const left =
    anchor && committedRect
      ? viewportElement.scrollLeft +
        (committedRect.left + anchor.x * committedRect.width) -
        getViewportCenterX(viewportElement)
      : undefined;

  return { top, ...(left == null ? null : { left }) };
}

// The relax is a kernel-style rAF clock, not a CSS transition: the clock
// anchors its ease at the first tick's FRAME time (the commit can burn ms
// before anything paints, and an ease anchored at the click lands its first
// painted frame that deep into the curve), every write is recorded as a
// flight tick, and translate/scale share one eased progress so the anchor
// point stays exactly fixed for the whole flight.
export function playPdfZoomMotion({
  transaction,
  viewportElement,
}: {
  transaction: PdfZoomTransaction;
  viewportElement: HTMLDivElement;
}): (() => void) | null {
  if (typeof requestAnimationFrame !== "function") {
    return recordZoomFlightSkip("no-raf");
  }
  if (prefersReducedMotion()) return recordZoomFlightSkip("reduced-motion");

  const previousRect = transaction.previousVisualRect;
  if (!previousRect) return recordZoomFlightSkip("no-previous-rect");
  const visualLayer = findPdfZoomVisualLayer(viewportElement);
  if (!visualLayer) return recordZoomFlightSkip("no-visual-layer");

  const currentRect = readElementRect(visualLayer);
  if (
    !currentRect ||
    previousRect.width <= 0 ||
    previousRect.height <= 0 ||
    currentRect.width <= 0 ||
    currentRect.height <= 0
  ) {
    return recordZoomFlightSkip("zero-rect");
  }

  const scaleX = previousRect.width / currentRect.width;
  const scaleY = previousRect.height / currentRect.height;
  if (hasDetachedPdfZoomAxes(scaleX, scaleY)) {
    return recordZoomFlightSkip("axis-scale-mismatch");
  }

  const translateX = previousRect.left - currentRect.left;
  const translateY = previousRect.top - currentRect.top;
  const hasVisibleDelta =
    Math.abs(translateX) > PDF_ZOOM_MOTION_MIN_TRANSLATE_PX ||
    Math.abs(translateY) > PDF_ZOOM_MOTION_MIN_TRANSLATE_PX ||
    Math.abs(1 - scaleX) > PDF_ZOOM_MOTION_MIN_SCALE_DELTA ||
    Math.abs(1 - scaleY) > PDF_ZOOM_MOTION_MIN_SCALE_DELTA;
  if (!hasVisibleDelta) return recordZoomFlightSkip("no-visible-delta");

  // Re-express the relax about the viewport center instead of the stage's
  // top-left: the stage is the full document (hundreds of thousands of px
  // tall), and a scale that far from its origin runs into GPU float
  // precision. Anchoring at the viewport keeps the rasterized region's
  // coordinates small; the mapping is identical.
  const originX = getViewportCenterX(viewportElement) - currentRect.left;
  const originY = getViewportCenterY(viewportElement) - currentRect.top;
  const residualX = translateX + (scaleX - 1) * originX;
  const residualY = translateY + (scaleY - 1) * originY;

  // The anchored translate IS the flight's deviation from a pure scale about
  // the viewport center. A sub-pixel residual (scroll quantization) folds
  // into the opening frame — invisible under the zoom onset, and the anchor
  // then never moves. A larger residual is a clamped-edge pan: intended
  // motion, animated.
  const residualPx = Math.hypot(residualX, residualY);
  const shouldSnapResidual =
    residualPx > 0 && residualPx <= PDF_ZOOM_MOTION_ANCHOR_SNAP_EPSILON_PX;
  const anchoredTranslateX = shouldSnapResidual ? 0 : residualX;
  const anchoredTranslateY = shouldSnapResidual ? 0 : residualY;

  const record = createZoomFlightRecord({
    scaleX,
    scaleY,
    skipReason: null,
    translateX: anchoredTranslateX,
    translateY: anchoredTranslateY,
  });
  record.residualPx = residualPx;
  record.residualSnapped = shouldSnapResidual;
  pushZoomFlightRecord(record);
  liveZoomFlightRecord = record;

  const scrollLeftAtStart = viewportElement.scrollLeft;
  const scrollTopAtStart = viewportElement.scrollTop;
  const stopLongTaskObserver = observeZoomFlightLongTasks(record);
  // Spatial probe basis: the anchored content point as fractions of the
  // untransformed (committed) layer, and its expected fixed screen position.
  // The per-tick painted rect re-derives the point; any wander is a real
  // style-level pan, whatever wrote it.
  const anchorFractionX = originX / currentRect.width;
  const anchorFractionY = originY / currentRect.height;
  const expectedAnchorScreenX = currentRect.left + originX;
  const expectedAnchorScreenY = currentRect.top + originY;

  let clockStartedAt: number | null = null;
  let lastTickAt: number | null = null;
  let rafHandle = 0;
  let stallTimeout: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const writeFrame = (progress: number) => {
    const remaining = 1 - progress;
    const frameTranslateX = anchoredTranslateX * remaining;
    const frameTranslateY = anchoredTranslateY * remaining;
    const frameScaleX = scaleX + (1 - scaleX) * progress;
    const frameScaleY = scaleY + (1 - scaleY) * progress;
    visualLayer.style.transform = `translate3d(${frameTranslateX}px, ${frameTranslateY}px, 0px) scale(${frameScaleX}, ${frameScaleY})`;
  };

  const finish = (interruption: PdfZoomMotionInterruption) => {
    if (finished) return;
    finished = true;
    if (rafHandle !== 0) cancelAnimationFrame(rafHandle);
    if (stallTimeout !== null) clearTimeout(stallTimeout);
    stopLongTaskObserver();
    visualLayer.style.transform = "";
    visualLayer.style.transformOrigin = "";
    visualLayer.style.willChange = "";
    record.interruption = interruption;
    record.settledClean =
      visualLayer.style.transform === "" && visualLayer.style.willChange === "";
    record.pathDeviationMaxPx = computeZoomFlightPathDeviation(record.ticks);
    if (liveZoomFlightRecord === record) liveZoomFlightRecord = null;
  };

  const tick = (frameTime: number) => {
    rafHandle = 0;
    if (finished) return;
    const now = Number.isFinite(frameTime) ? frameTime : readNow();
    if (clockStartedAt === null) {
      clockStartedAt = now;
      record.startLatencyMs = Math.max(0, now - transaction.capturedAt);
    }
    const timeProgress = clamp(
      PDF_ZOOM_MOTION_DURATION_MS <= 0
        ? 1
        : (now - clockStartedAt) / PDF_ZOOM_MOTION_DURATION_MS,
      0,
      1,
    );
    const progress = easePdfZoomMotion(timeProgress);
    writeFrame(progress);

    const scrollDriftPx = Math.max(
      Math.abs(viewportElement.scrollTop - scrollTopAtStart),
      Math.abs(viewportElement.scrollLeft - scrollLeftAtStart),
    );
    record.scrollDriftMaxPx = Math.max(record.scrollDriftMaxPx, scrollDriftPx);
    const frameGapMs = lastTickAt === null ? 0 : now - lastTickAt;
    lastTickAt = now;
    record.maxTickGapMs = Math.max(record.maxTickGapMs, frameGapMs);
    record.tickCount += 1;

    const paintedRect = visualLayer.getBoundingClientRect();
    record.anchorDriftMax.x = Math.max(
      record.anchorDriftMax.x,
      Math.abs(
        paintedRect.left +
          anchorFractionX * paintedRect.width -
          expectedAnchorScreenX,
      ),
    );
    record.anchorDriftMax.y = Math.max(
      record.anchorDriftMax.y,
      Math.abs(
        paintedRect.top +
          anchorFractionY * paintedRect.height -
          expectedAnchorScreenY,
      ),
    );
    if (record.startSnapPx === null) {
      record.startSnapPx = Math.max(
        Math.abs(paintedRect.left - previousRect.left),
        Math.abs(paintedRect.top - previousRect.top),
      );
    }
    if (record.ticks.length < PDF_ZOOM_FLIGHT_TICK_LIMIT) {
      record.ticks.push({
        elapsedMs: Math.max(0, now - clockStartedAt),
        frameGapMs,
        progress,
        rectLeft: paintedRect.left,
        rectTop: paintedRect.top,
        rectWidth: paintedRect.width,
        rectHeight: paintedRect.height,
        scrollDriftPx,
      });
    }

    if (timeProgress >= 1) {
      finish("none");
      return;
    }
    rafHandle = requestAnimationFrame(tick);
  };

  // First frame is written synchronously inside the geometry commit, so the
  // discontinuity is hidden behind the counter-transform before first paint
  // (commit-then-relax); the clock itself starts at the next painted frame.
  visualLayer.style.transformOrigin = `${originX}px ${originY}px`;
  visualLayer.style.willChange = "transform";
  writeFrame(0);

  rafHandle = requestAnimationFrame(tick);
  stallTimeout = setTimeout(
    () => finish("stalled"),
    PDF_ZOOM_MOTION_STALL_TIMEOUT_MS,
  );

  return () => finish("cancelled");
}

// Max perpendicular distance of the painted corner's trajectory from the
// straight chord between its first and last tick positions. Shared-progress
// translate+scale moves every point on a straight line, so any curvature is
// foreign motion.
function computeZoomFlightPathDeviation(
  ticks: readonly PdfZoomMotionTick[],
): number {
  if (ticks.length < 3) return 0;
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  const chordX = last.rectLeft - first.rectLeft;
  const chordY = last.rectTop - first.rectTop;
  const chordLength = Math.hypot(chordX, chordY);
  let maxDeviation = 0;
  for (const tick of ticks) {
    const pointX = tick.rectLeft - first.rectLeft;
    const pointY = tick.rectTop - first.rectTop;
    const deviation =
      chordLength <= 1e-6
        ? Math.hypot(pointX, pointY)
        : Math.abs(pointX * chordY - pointY * chordX) / chordLength;
    maxDeviation = Math.max(maxDeviation, deviation);
  }
  return maxDeviation;
}

function observeZoomFlightLongTasks(record: PdfZoomMotionFlightRecord) {
  if (typeof PerformanceObserver !== "function") return () => {};
  try {
    const observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        record.longTaskCount += 1;
        record.longTaskMs += entry.duration;
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    return () => observer.disconnect();
  } catch {
    // Long-task attribution is diagnostic, not correctness-critical; some
    // engines do not expose the entry type.
    return () => {};
  }
}

function easePdfZoomMotion(timeProgress: number) {
  // easeOutCubic: fast attack, gentle landing — a linear relax reads as a
  // hard stop at settle.
  const inverse = 1 - clamp(timeProgress, 0, 1);
  return 1 - inverse * inverse * inverse;
}

function findPdfZoomVisualLayer(viewportElement: HTMLDivElement) {
  if (typeof viewportElement.querySelector !== "function") return null;
  return viewportElement.querySelector<HTMLElement>(
    PDF_ZOOM_VISUAL_LAYER_SELECTOR,
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
function hasDetachedPdfZoomAxes(scaleX: number, scaleY: number) {
  const inlineDelta = Math.abs(scaleX - 1);
  const blockDelta = Math.abs(scaleY - 1);
  const frozenAxis =
    (blockDelta < PDF_ZOOM_MOTION_AXIS_FROZEN_DELTA &&
      inlineDelta > PDF_ZOOM_MOTION_AXIS_MOVED_DELTA) ||
    (inlineDelta < PDF_ZOOM_MOTION_AXIS_FROZEN_DELTA &&
      blockDelta > PDF_ZOOM_MOTION_AXIS_MOVED_DELTA);
  return (
    frozenAxis ||
    Math.abs(scaleX - scaleY) >
      PDF_ZOOM_MOTION_AXIS_MISMATCH_RATIO * Math.max(scaleX, scaleY)
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

function readNow() {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
