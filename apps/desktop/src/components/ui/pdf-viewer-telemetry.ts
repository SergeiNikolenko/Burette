"use client";

import * as React from "react";

import { joinEffectKey } from "@/lib/effect-key";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

import type { FileViewerRendererFrame } from "./file-viewer-renderer-contract";
import type { PdfPageLayoutModel } from "./pdf-viewer-layout";
import {
  getPdfZoomMotionFlightRecords,
  type PdfZoomMotionFlightRecord,
} from "./pdf-viewer-zoom-motion";

type PdfViewerTelemetryMetricId =
  | "blink"
  | "horizontal-back-and-forth"
  | "vertical-overshoot"
  | "settle-jitter"
  | "resize-linearity"
  | "scroll-stability"
  | "renderer-continuity"
  | "canvas-continuity"
  | "raster-headroom"
  | "virtual-window-retention";

type PdfViewerTelemetryMetric = {
  budget: string;
  detail: string;
  id: PdfViewerTelemetryMetricId;
  label: string;
  passed: boolean;
  value: string;
};

type PdfViewerTelemetrySample = {
  activeRenderPageNumbers: number[];
  canvasBitmapHeight: number | null;
  canvasBitmapWidth: number | null;
  canvasCssHeight: number | null;
  canvasCssWidth: number | null;
  canvasInkRatio: number | null;
  canvasPixelSignature: string | null;
  canvasRenderSource: string | null;
  canvasRenderStatus: string | null;
  clientHeight: number;
  clientWidth: number;
  devicePixelRatio: number;
  displayScale: number;
  documentKey: string;
  elapsedMs: number;
  gapWidth: number | null;
  hasBlink: boolean;
  layoutInlineSize: number | null;
  logicalScrollTop: number;
  motionPhase: FileViewerRendererFrame["phase"];
  physicalScrollTop: number;
  primaryPageBottom: number | null;
  primaryPageCenterX: number | null;
  primaryPageHeight: number | null;
  primaryPageLeft: number | null;
  primaryPageNumber: number | null;
  primaryPageTop: number | null;
  primaryPageWidth: number | null;
  renderPageNumbers: number[];
  renderScale: number;
  scrollHeight: number;
  scrollPageOffset: number;
  sidebarOpen: string | null;
  sidebarState: string | null;
  sidebarWidth: number | null;
  timestamp: number;
  toInlineSize: number | null;
  transform: string | null;
  visiblePageNumbers: number[];
  visibleRenderedPageNumbers: number[];
  visualHeight: number | null;
  visualLeft: number | null;
  visualTop: number | null;
  visualWidth: number | null;
};

type PdfViewerTelemetryRun = {
  action: "close" | "open";
  after: PdfViewerTelemetrySample;
  before: PdfViewerTelemetrySample;
  samples: PdfViewerTelemetrySample[];
};

type PdfViewerTelemetryResult = {
  durationMs: number;
  metrics: PdfViewerTelemetryMetric[];
  runs: PdfViewerTelemetryRun[];
  sampledFrameCount: number;
  status: "failed" | "passed";
};

type PdfViewerTelemetryRunOptions = {
  sampleFrameCount?: number;
  settleFrameCount?: number;
};

type PdfViewerTelemetryState = {
  activeRenderPageNumbers: readonly number[];
  displayScale: number;
  documentKey: string;
  getDocumentSurfaceElement: () => HTMLElement | null;
  getScrollMetrics: () => {
    physicalScrollHeight: number;
    physicalScrollTop: number;
    scrollPageOffset: number;
    scrollTop: number;
    viewportHeight: number;
  };
  getViewportElement: () => HTMLDivElement | null;
  layout: PdfPageLayoutModel;
  renderPageNumbers: readonly number[];
  renderScale: number;
  pageDevicePixelRatio: number;
  rendererFrame: FileViewerRendererFrame;
  visiblePageNumbers: readonly number[];
};

type PdfViewerTelemetryRuntime = {
  getLastResult: () => PdfViewerTelemetryResult | null;
  /** Flight recorder for toolbar zoom relaxes (pdf-viewer-zoom-motion). */
  getZoomFlightRecords: () => readonly PdfZoomMotionFlightRecord[];
  readSample: () => PdfViewerTelemetrySample | null;
  runShellMotion: (
    options?: PdfViewerTelemetryRunOptions,
  ) => Promise<PdfViewerTelemetryResult | null>;
};

declare global {
  interface Window {
    __pdfViewerTelemetry?: PdfViewerTelemetryRuntime;
  }
}

const PDF_TELEMETRY_READING_MARKER_RATIO = 0.2;
const PDF_TELEMETRY_REVERSAL_EPSILON_PX = 1;
const PDF_TELEMETRY_SETTLE_EPSILON_PX = 1;
const PDF_TELEMETRY_DEFAULT_SAMPLE_FRAMES = 36;
const PDF_TELEMETRY_DEFAULT_SETTLE_FRAMES = 12;

export function usePdfViewerTelemetry(state: PdfViewerTelemetryState) {
  const stateRef = React.useRef(state);
  const lastResultRef = React.useRef<PdfViewerTelemetryResult | null>(null);
  stateRef.current = state;

  useKeyedMountEffect(
    joinEffectKey(["pdf-viewer-telemetry", state.documentKey]),
    () => {
      if (typeof window === "undefined") return;

      const previousRuntime = window.__pdfViewerTelemetry;
      const runtime: PdfViewerTelemetryRuntime = {
        getLastResult: () => lastResultRef.current,
        getZoomFlightRecords: () => getPdfZoomMotionFlightRecords(),
        readSample: () =>
          readPdfViewerTelemetrySample({
            startedAt: performance.now(),
            state: stateRef.current,
          }),
        runShellMotion: async (options) => {
          const result = await runPdfViewerShellMotionTelemetry({
            options,
            stateRef,
          });
          lastResultRef.current = result;
          if (result) logPdfViewerTelemetryResult(result);
          return result;
        },
      };

      window.__pdfViewerTelemetry = runtime;

      return () => {
        if (window.__pdfViewerTelemetry === runtime) {
          window.__pdfViewerTelemetry = previousRuntime;
        }
      };
    },
  );
}

async function runPdfViewerShellMotionTelemetry({
  options,
  stateRef,
}: {
  options?: PdfViewerTelemetryRunOptions;
  stateRef: React.MutableRefObject<PdfViewerTelemetryState>;
}): Promise<PdfViewerTelemetryResult | null> {
  const state = stateRef.current;
  const viewportElement = state.getViewportElement();
  const shell = getPdfViewerTelemetryShell(viewportElement);
  if (!shell) return null;

  const sampleFrameCount =
    options?.sampleFrameCount ?? PDF_TELEMETRY_DEFAULT_SAMPLE_FRAMES;
  const settleFrameCount =
    options?.settleFrameCount ?? PDF_TELEMETRY_DEFAULT_SETTLE_FRAMES;
  const startedAt = performance.now();
  const runs: PdfViewerTelemetryRun[] = [];
  const firstAction =
    shell.root.dataset.fileViewerSidebarOpen === "true" ? "close" : "open";
  const secondAction = firstAction === "close" ? "open" : "close";

  runs.push(
    await samplePdfViewerShellMotionRun({
      action: firstAction,
      sampleFrameCount,
      settleFrameCount,
      shell,
      startedAt,
      stateRef,
    }),
  );
  runs.push(
    await samplePdfViewerShellMotionRun({
      action: secondAction,
      sampleFrameCount,
      settleFrameCount,
      shell,
      startedAt,
      stateRef,
    }),
  );

  const metrics = collectPdfViewerTelemetryMetrics(runs);
  const status = metrics.every((metric) => metric.passed) ? "passed" : "failed";

  return {
    durationMs: performance.now() - startedAt,
    metrics,
    runs,
    sampledFrameCount: runs.reduce(
      (count, run) => count + run.samples.length,
      0,
    ),
    status,
  };
}

async function samplePdfViewerShellMotionRun({
  action,
  sampleFrameCount,
  settleFrameCount,
  shell,
  startedAt,
  stateRef,
}: {
  action: PdfViewerTelemetryRun["action"];
  sampleFrameCount: number;
  settleFrameCount: number;
  shell: PdfViewerTelemetryShell;
  startedAt: number;
  stateRef: React.MutableRefObject<PdfViewerTelemetryState>;
}): Promise<PdfViewerTelemetryRun> {
  const before = readPdfViewerTelemetrySample({
    startedAt,
    state: stateRef.current,
  });
  if (!before) throw new Error("PDF telemetry sample unavailable before run.");

  const samples: PdfViewerTelemetrySample[] = [];
  shell.trigger.click();

  for (let index = 0; index < sampleFrameCount; index += 1) {
    await nextPdfTelemetryAnimationFrame();
    const sample = readPdfViewerTelemetrySample({
      startedAt,
      state: stateRef.current,
    });
    if (sample) samples.push(sample);
  }

  for (let index = 0; index < settleFrameCount; index += 1) {
    await nextPdfTelemetryAnimationFrame();
  }

  const after = readPdfViewerTelemetrySample({
    startedAt,
    state: stateRef.current,
  });
  if (!after) throw new Error("PDF telemetry sample unavailable after run.");

  return { action, after, before, samples };
}

function readPdfViewerTelemetrySample({
  startedAt,
  state,
}: {
  startedAt: number;
  state: PdfViewerTelemetryState;
}): PdfViewerTelemetrySample | null {
  const viewportElement = state.getViewportElement();
  const surfaceElement = state.getDocumentSurfaceElement();
  if (!viewportElement || !surfaceElement) return null;

  const pdfRoot = surfaceElement.closest<HTMLElement>(
    '[data-slot="pdf-viewer"]',
  );
  const shell = getPdfViewerTelemetryShell(viewportElement);
  const viewportRect = viewportElement.getBoundingClientRect();
  const surfaceRect = surfaceElement.getBoundingClientRect();
  const metrics = state.getScrollMetrics();
  const pages = readPdfViewerTelemetryPages({ pdfRoot, viewportRect });
  const marker =
    viewportRect.top + viewportRect.height * PDF_TELEMETRY_READING_MARKER_RATIO;
  const primaryPage = getPdfTelemetryPrimaryPage({ marker, pages });
  const visibleRenderedPageNumbers = pages
    .filter((page) => page.isVisible && page.hasCanvasPixels)
    .map((page) => page.pageNumber);
  const transform =
    surfaceElement.style.transform ||
    getComputedStyle(surfaceElement).transform;

  return {
    activeRenderPageNumbers: [...state.activeRenderPageNumbers],
    canvasBitmapHeight: primaryPage?.canvasBitmapHeight ?? null,
    canvasBitmapWidth: primaryPage?.canvasBitmapWidth ?? null,
    canvasCssHeight: primaryPage?.canvasCssHeight ?? null,
    canvasCssWidth: primaryPage?.canvasCssWidth ?? null,
    canvasInkRatio: primaryPage?.canvasInkRatio ?? null,
    canvasPixelSignature: primaryPage?.canvasPixelSignature ?? null,
    canvasRenderSource: primaryPage?.canvasRenderSource ?? null,
    canvasRenderStatus: primaryPage?.canvasRenderStatus ?? null,
    clientHeight: viewportElement.clientHeight,
    clientWidth: viewportElement.clientWidth,
    devicePixelRatio: state.pageDevicePixelRatio,
    displayScale: state.displayScale,
    documentKey: state.documentKey,
    elapsedMs: Math.max(0, performance.now() - startedAt),
    gapWidth: shell?.gap.getBoundingClientRect().width ?? null,
    hasBlink:
      !primaryPage ||
      !primaryPage.hasCanvasPixels ||
      primaryPage.canvasRenderStatus === "failed" ||
      primaryPage.canvasRenderStatus === "cancelled" ||
      visibleRenderedPageNumbers.length === 0,
    layoutInlineSize: state.rendererFrame.layoutInlineSize,
    logicalScrollTop: metrics.scrollTop,
    motionPhase: state.rendererFrame.phase,
    physicalScrollTop: viewportElement.scrollTop,
    primaryPageBottom:
      primaryPage == null ? null : primaryPage.bottom - viewportRect.top,
    primaryPageCenterX:
      primaryPage == null
        ? null
        : primaryPage.left - viewportRect.left + primaryPage.width / 2,
    primaryPageHeight: primaryPage?.height ?? null,
    primaryPageLeft:
      primaryPage == null ? null : primaryPage.left - viewportRect.left,
    primaryPageNumber: primaryPage?.pageNumber ?? null,
    primaryPageTop:
      primaryPage == null ? null : primaryPage.top - viewportRect.top,
    primaryPageWidth: primaryPage?.width ?? null,
    renderPageNumbers: [...state.renderPageNumbers],
    renderScale: state.renderScale,
    scrollHeight: viewportElement.scrollHeight,
    scrollPageOffset: metrics.scrollPageOffset,
    sidebarOpen: shell?.root.dataset.fileViewerSidebarOpen ?? null,
    sidebarState: shell?.root.dataset.fileViewerSidebarState ?? null,
    sidebarWidth: shell?.sidebar?.getBoundingClientRect().width ?? null,
    timestamp: performance.now(),
    toInlineSize: state.rendererFrame.toInlineSize,
    transform: transform && transform !== "none" ? transform : null,
    visiblePageNumbers: [...state.visiblePageNumbers],
    visibleRenderedPageNumbers,
    visualHeight: surfaceRect.height,
    visualLeft: surfaceRect.left - viewportRect.left,
    visualTop: surfaceRect.top - viewportRect.top,
    visualWidth: surfaceRect.width,
  };
}

type PdfViewerTelemetryShell = {
  gap: HTMLElement;
  root: HTMLElement;
  sidebar: HTMLElement | null;
  trigger: HTMLButtonElement;
};

function getPdfViewerTelemetryShell(
  viewportElement: HTMLElement | null,
): PdfViewerTelemetryShell | null {
  const root = viewportElement?.closest<HTMLElement>(
    '[data-slot="file-viewer-root"]',
  );
  const trigger = root?.querySelector<HTMLButtonElement>(
    '[data-slot="file-viewer-sidebar-trigger"]',
  );
  const gap = root?.querySelector<HTMLElement>(
    '[data-slot="file-viewer-sidebar-gap"]',
  );

  if (!root || !trigger || !gap) return null;

  return {
    gap,
    root,
    sidebar: root.querySelector<HTMLElement>(
      '[data-slot="file-viewer-sidebar"]',
    ),
    trigger,
  };
}

type PdfViewerTelemetryPage = {
  bottom: number;
  canvasBitmapHeight: number | null;
  canvasBitmapWidth: number | null;
  canvasCssHeight: number | null;
  canvasCssWidth: number | null;
  canvasInkRatio: number | null;
  canvasPixelSignature: string | null;
  canvasRenderSource: string | null;
  canvasRenderStatus: string | null;
  hasCanvasPixels: boolean;
  height: number;
  isVisible: boolean;
  left: number;
  pageNumber: number;
  top: number;
  width: number;
};

function readPdfViewerTelemetryPages({
  pdfRoot,
  viewportRect,
}: {
  pdfRoot: HTMLElement | null;
  viewportRect: DOMRect;
}): PdfViewerTelemetryPage[] {
  if (!pdfRoot) return [];

  return Array.from(
    pdfRoot.querySelectorAll<HTMLElement>('[data-slot="pdf-page"]'),
  )
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const canvas = element.querySelector("canvas");
      const canvasRect = canvas?.getBoundingClientRect();
      const canvasBitmapWidth =
        canvas instanceof HTMLCanvasElement ? canvas.width : null;
      const canvasBitmapHeight =
        canvas instanceof HTMLCanvasElement ? canvas.height : null;
      const pixelSample =
        canvas instanceof HTMLCanvasElement
          ? readPdfTelemetryCanvasPixels(canvas)
          : null;

      return {
        bottom: rect.bottom,
        canvasBitmapHeight,
        canvasBitmapWidth,
        canvasCssHeight: canvasRect?.height ?? null,
        canvasCssWidth: canvasRect?.width ?? null,
        canvasInkRatio: pixelSample?.inkRatio ?? null,
        canvasPixelSignature: pixelSample?.signature ?? null,
        canvasRenderSource: canvas?.dataset.pdfRenderSource ?? null,
        canvasRenderStatus: canvas?.dataset.pdfRenderStatus ?? null,
        hasCanvasPixels:
          (canvasBitmapWidth ?? 0) > 0 && (canvasBitmapHeight ?? 0) > 0,
        height: rect.height,
        isVisible:
          rect.width > 1 &&
          rect.height > 1 &&
          rect.bottom > viewportRect.top + 1 &&
          rect.top < viewportRect.bottom - 1,
        left: rect.left,
        pageNumber: Number(element.dataset.page ?? 0),
        top: rect.top,
        width: rect.width,
      };
    })
    .filter((page) => page.pageNumber > 0)
    .sort((left, right) => left.pageNumber - right.pageNumber);
}

function getPdfTelemetryPrimaryPage({
  marker,
  pages,
}: {
  marker: number;
  pages: readonly PdfViewerTelemetryPage[];
}) {
  const visiblePages = pages.filter((page) => page.isVisible);
  if (visiblePages.length === 0) return null;

  return (
    visiblePages.find((page) => page.top <= marker && page.bottom >= marker) ??
    visiblePages.reduce((nearest, page) =>
      Math.abs(page.top - marker) < Math.abs(nearest.top - marker)
        ? page
        : nearest,
    )
  );
}

// Downsample the page canvas to 8x8 with a GPU-side drawImage and do a single
// 64-pixel readback: per-point getImageData forces one full GPU->CPU sync per
// call and would inflate the main-thread work this telemetry measures. The
// downsampled cells average their region, so any text or figure reads as
// non-white ink while a wiped buffer reads fully blank — presence and status
// attributes cannot distinguish those two.
const PDF_TELEMETRY_CANVAS_PROBE_SIZE = 8;
let pdfTelemetryCanvasProbe: {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} | null = null;

function getPdfTelemetryCanvasProbe() {
  if (pdfTelemetryCanvasProbe) return pdfTelemetryCanvasProbe;
  const canvas = document.createElement("canvas");
  canvas.width = PDF_TELEMETRY_CANVAS_PROBE_SIZE;
  canvas.height = PDF_TELEMETRY_CANVAS_PROBE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  pdfTelemetryCanvasProbe = { canvas, context };
  return pdfTelemetryCanvasProbe;
}

function readPdfTelemetryCanvasPixels(canvas: HTMLCanvasElement) {
  if (canvas.width <= 0 || canvas.height <= 0) return null;
  const probe = getPdfTelemetryCanvasProbe();
  if (!probe) return null;

  const size = PDF_TELEMETRY_CANVAS_PROBE_SIZE;
  let hash = 2166136261;
  let inkCount = 0;

  try {
    probe.context.clearRect(0, 0, size, size);
    probe.context.drawImage(canvas, 0, 0, size, size);
    const { data } = probe.context.getImageData(0, 0, size, size);
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      if (alpha > 0 && luminance < 245) inkCount += 1;
      hash ^= red;
      hash = Math.imul(hash, 16777619);
      hash ^= green;
      hash = Math.imul(hash, 16777619);
      hash ^= blue;
      hash = Math.imul(hash, 16777619);
      hash ^= alpha;
      hash = Math.imul(hash, 16777619);
    }
  } catch {
    return null;
  }

  return {
    inkRatio: inkCount / (size * size),
    signature: hash.toString(16),
  };
}

function collectPdfViewerTelemetryMetrics(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric[] {
  return [
    collectPdfTelemetryBlinkMetric(runs),
    collectPdfTelemetryHorizontalMetric(runs),
    collectPdfTelemetryVerticalMetric(runs),
    collectPdfTelemetrySettleJitterMetric(runs),
    collectPdfTelemetryResizeLinearityMetric(runs),
    collectPdfTelemetryScrollStabilityMetric(runs),
    collectPdfTelemetryRendererContinuityMetric(runs),
    collectPdfTelemetryCanvasContinuityMetric(runs),
    collectPdfTelemetryRasterHeadroomMetric(runs),
    collectPdfTelemetryVirtualWindowRetentionMetric(runs),
  ];
}

function collectPdfTelemetryBlinkMetric(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric {
  const frames = getPdfTelemetryAllSamples(runs).filter(
    (sample) => sample.hasBlink,
  ).length;

  return {
    budget: "0 blink frames",
    detail:
      "A blink frame has no visible rendered page, a missing canvas, or a failed visible canvas.",
    id: "blink",
    label: "Blink",
    passed: frames === 0,
    value: `${frames} frames`,
  };
}

function collectPdfTelemetryHorizontalMetric(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric {
  const reversals = Math.max(
    0,
    ...runs.map((run) =>
      Math.max(
        countPdfTelemetryReversals(
          getPdfTelemetryMotionSamples(run).map(
            (sample) => sample.primaryPageLeft,
          ),
          PDF_TELEMETRY_REVERSAL_EPSILON_PX,
        ),
        countPdfTelemetryReversals(
          getPdfTelemetryMotionSamples(run).map(
            (sample) => sample.primaryPageCenterX,
          ),
          PDF_TELEMETRY_REVERSAL_EPSILON_PX,
        ),
      ),
    ),
  );
  const overshoot = Math.max(
    0,
    ...runs.flatMap((run) => [
      getPdfTelemetryRunOvershoot(run, (sample) => sample.primaryPageLeft),
      getPdfTelemetryRunOvershoot(run, (sample) => sample.primaryPageCenterX),
    ]),
  );

  return {
    budget: "0 x reversals over 1px, <= 2px x overshoot",
    detail: "Tracks the visible page left edge and center during shell motion.",
    id: "horizontal-back-and-forth",
    label: "Horizontal back and forth",
    passed: reversals === 0 && overshoot <= 2,
    value: `${reversals} reversals / ${formatPdfTelemetryNumber(
      overshoot,
      2,
    )}px`,
  };
}

function collectPdfTelemetryVerticalMetric(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric {
  const overshoot = Math.max(
    0,
    ...runs.flatMap((run) => [
      getPdfTelemetryRunOvershoot(run, (sample) => sample.primaryPageTop),
      getPdfTelemetryRunOvershoot(run, (sample) => sample.logicalScrollTop),
    ]),
  );

  return {
    budget: "<= 4px",
    detail:
      "Visible page top and logical scroll position should stay inside their start/end intervals.",
    id: "vertical-overshoot",
    label: "Vertical overshoot",
    passed: overshoot <= 4,
    value: `${formatPdfTelemetryNumber(overshoot, 2)}px`,
  };
}

function collectPdfTelemetrySettleJitterMetric(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric {
  const range = Math.max(
    0,
    ...runs.flatMap((run) => {
      const settled = getPdfTelemetrySettledSamples(run);
      return [
        getPdfTelemetryRange(settled.map((sample) => sample.primaryPageLeft)),
        getPdfTelemetryRange(settled.map((sample) => sample.primaryPageTop)),
      ];
    }),
  );

  return {
    budget: "<= 1px settled range",
    detail:
      "After endpoint geometry is reached, the visible page and logical scroll should not tremble.",
    id: "settle-jitter",
    label: "Settle jitter",
    passed: range <= 1,
    value: `${formatPdfTelemetryNumber(range, 2)}px`,
  };
}

function collectPdfTelemetryResizeLinearityMetric(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric {
  const maxError = Math.max(
    0,
    ...runs.map((run) => getPdfTelemetryResizeProgressError(run)),
  );

  return {
    budget: "<= 20% progress error",
    detail:
      "Visible page width should progress with sidebar width instead of waiting for settle.",
    id: "resize-linearity",
    label: "Resize linearity",
    passed: maxError <= 0.2,
    value: `${formatPdfTelemetryNumber(maxError * 100, 1)}%`,
  };
}

function collectPdfTelemetryScrollStabilityMetric(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric {
  const maxSlidingRange = Math.max(
    0,
    ...runs.map((run) =>
      getPdfTelemetryRange(
        getPdfTelemetryMotionSamples(run).map(
          (sample) => sample.physicalScrollTop,
        ),
      ),
    ),
  );

  return {
    budget: "<= 1px physical scroll range while sliding",
    detail:
      "The shell motion should not emit native scroll drift while the PDF surface is being transformed.",
    id: "scroll-stability",
    label: "Scroll stability",
    passed: maxSlidingRange <= 1,
    value: `${formatPdfTelemetryNumber(maxSlidingRange, 2)}px`,
  };
}

function collectPdfTelemetryRendererContinuityMetric(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric {
  let missingPrimaryFrames = 0;
  let emptyRenderedFrames = 0;

  for (const run of runs) {
    const primaryPageNumber = run.before.primaryPageNumber;
    for (const sample of getPdfTelemetryLifecycleSamples(run)) {
      if (sample.visibleRenderedPageNumbers.length === 0)
        emptyRenderedFrames += 1;
      if (
        primaryPageNumber != null &&
        !sample.visibleRenderedPageNumbers.includes(primaryPageNumber)
      ) {
        missingPrimaryFrames += 1;
      }
    }
  }

  return {
    budget: "0 blank rendered frames, 0 primary-page drops",
    detail:
      "The virtualized window must keep the visible rendered page mounted throughout motion and settle.",
    id: "renderer-continuity",
    label: "Renderer continuity",
    passed: emptyRenderedFrames === 0 && missingPrimaryFrames === 0,
    value: `${emptyRenderedFrames} blank / ${missingPrimaryFrames} drops`,
  };
}

function collectPdfTelemetryCanvasContinuityMetric(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric {
  let missingCanvasFrames = 0;
  let failedCanvasFrames = 0;
  let whiteoutFrames = 0;

  for (const sample of getPdfTelemetryAllSamples(runs)) {
    if (
      sample.canvasBitmapWidth == null ||
      sample.canvasBitmapHeight == null ||
      sample.canvasBitmapWidth <= 0 ||
      sample.canvasBitmapHeight <= 0
    ) {
      missingCanvasFrames += 1;
    }
    if (
      sample.canvasRenderStatus === "failed" ||
      sample.canvasRenderStatus === "cancelled"
    ) {
      failedCanvasFrames += 1;
    }
  }

  // A whiteout is the blink presence checks cannot see: the same primary page
  // keeps a sized, "ready" canvas whose buffer momentarily holds zero ink —
  // a resize wiped it before the redraw landed.
  for (const run of runs) {
    const samples = [run.before, ...run.samples, run.after];
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];
      if (
        previous.primaryPageNumber != null &&
        previous.primaryPageNumber === current.primaryPageNumber &&
        previous.canvasInkRatio != null &&
        previous.canvasInkRatio > 0 &&
        current.canvasInkRatio === 0
      ) {
        whiteoutFrames += 1;
      }
    }
  }

  return {
    budget:
      "0 missing canvas frames, 0 failed/cancelled visible canvases, 0 whiteouts",
    detail:
      "The primary visible page canvas must keep pixels while target raster work is pending — including its buffer contents, which must never wipe to blank mid-motion.",
    id: "canvas-continuity",
    label: "Canvas continuity",
    passed:
      missingCanvasFrames === 0 &&
      failedCanvasFrames === 0 &&
      whiteoutFrames === 0,
    value: `${missingCanvasFrames} missing / ${failedCanvasFrames} failed / ${whiteoutFrames} whiteouts`,
  };
}

function collectPdfTelemetryRasterHeadroomMetric(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric {
  const minHeadroom = Math.min(
    0,
    ...runs.flatMap((run) => {
      const maxCssWidth = Math.max(
        0,
        ...getPdfTelemetryLifecycleSamples(run).map(
          (sample) => sample.primaryPageWidth ?? 0,
        ),
      );
      return getPdfTelemetryLifecycleSamples(run).map((sample) => {
        if (
          sample.canvasBitmapWidth == null ||
          sample.canvasBitmapWidth <= 0 ||
          sample.canvasCssWidth == null ||
          sample.canvasCssWidth <= 0 ||
          sample.primaryPageWidth == null ||
          sample.primaryPageWidth <= 0
        ) {
          return 0;
        }

        return sample.canvasBitmapWidth / sample.devicePixelRatio - maxCssWidth;
      });
    }),
  );

  return {
    budget: ">= -1px visible canvas backing headroom",
    detail:
      "Visible canvases should keep enough backing resolution for the largest page width in the sidebar cycle.",
    id: "raster-headroom",
    label: "Raster headroom",
    passed: minHeadroom >= -1,
    value: `${formatPdfTelemetryNumber(minHeadroom, 2)}px`,
  };
}

function collectPdfTelemetryVirtualWindowRetentionMetric(
  runs: readonly PdfViewerTelemetryRun[],
): PdfViewerTelemetryMetric {
  let droppedFrames = 0;

  for (const run of runs) {
    const primaryPageNumber = run.before.primaryPageNumber;
    if (primaryPageNumber == null) {
      droppedFrames += 1;
      continue;
    }

    for (const sample of getPdfTelemetryLifecycleSamples(run)) {
      if (!sample.renderPageNumbers.includes(primaryPageNumber)) {
        droppedFrames += 1;
      }
    }
  }

  return {
    budget: "0 retained-window drops",
    detail:
      "The virtual render window must retain the pre-motion reading page until the shell motion settles.",
    id: "virtual-window-retention",
    label: "Virtual window retention",
    passed: droppedFrames === 0,
    value: `${droppedFrames} drops`,
  };
}

function logPdfViewerTelemetryResult(result: PdfViewerTelemetryResult) {
  const metrics = result.metrics.map((metric) => ({
    budget: metric.budget,
    detail: metric.detail,
    id: metric.id,
    label: metric.label,
    passed: metric.passed,
    value: metric.value,
  }));
  const summary = {
    durationMs: Number(result.durationMs.toFixed(1)),
    failedMetricIds: metrics
      .filter((metric) => !metric.passed)
      .map((metric) => metric.id),
    metrics,
    passedMetricCount: metrics.filter((metric) => metric.passed).length,
    sampledFrameCount: result.sampledFrameCount,
    status: result.status,
    totalMetricCount: metrics.length,
  };

  console.info("[pdf-viewer:telemetry] result", JSON.stringify(summary));
  console.info("[pdf-viewer:telemetry] full result", JSON.stringify(result));
  console.table(metrics);
}

function getPdfTelemetryResizeProgressError(run: PdfViewerTelemetryRun) {
  const beforeGap = run.before.gapWidth;
  const afterGap = run.after.gapWidth;
  const beforeWidth = run.before.primaryPageWidth;
  const afterWidth = run.after.primaryPageWidth;

  if (
    beforeGap == null ||
    afterGap == null ||
    beforeWidth == null ||
    afterWidth == null ||
    Math.abs(afterGap - beforeGap) <= 8 ||
    Math.abs(afterWidth - beforeWidth) <= 8
  ) {
    return 0;
  }

  return Math.max(
    0,
    ...getPdfTelemetryMotionSamples(run).map((sample) => {
      const gapProgress = getPdfTelemetryProgress(
        sample.gapWidth,
        beforeGap,
        afterGap,
      );
      const widthProgress = getPdfTelemetryProgress(
        sample.primaryPageWidth,
        beforeWidth,
        afterWidth,
      );
      return Math.abs(gapProgress - widthProgress);
    }),
  );
}

function getPdfTelemetryProgress(
  value: number | null,
  start: number,
  end: number,
) {
  if (value == null) return 1;
  const travel = end - start;
  if (Math.abs(travel) <= 0.001) return 1;
  return clampPdfTelemetryNumber((value - start) / travel, 0, 1);
}

function getPdfTelemetryRunOvershoot(
  run: PdfViewerTelemetryRun,
  getValue: (sample: PdfViewerTelemetrySample) => number | null,
) {
  const start = getValue(run.before);
  const end = getValue(run.after);
  if (start == null || end == null) return 0;

  const min = Math.min(start, end);
  const max = Math.max(start, end);

  return Math.max(
    0,
    ...getPdfTelemetryMotionSamples(run).map((sample) => {
      const value = getValue(sample);
      if (value == null) return 0;
      if (value < min) return min - value;
      if (value > max) return value - max;
      return 0;
    }),
  );
}

function getPdfTelemetrySettledSamples(run: PdfViewerTelemetryRun) {
  const afterGap = run.after.gapWidth;
  const afterWidth = run.after.primaryPageWidth;
  const settledIndex = run.samples.findIndex(
    (sample) =>
      afterGap != null &&
      afterWidth != null &&
      sample.gapWidth != null &&
      sample.primaryPageWidth != null &&
      Math.abs(sample.gapWidth - afterGap) <= PDF_TELEMETRY_SETTLE_EPSILON_PX &&
      Math.abs(sample.primaryPageWidth - afterWidth) <=
        PDF_TELEMETRY_SETTLE_EPSILON_PX,
  );

  return settledIndex < 0
    ? [run.after]
    : [...run.samples.slice(settledIndex), run.after];
}

function getPdfTelemetryMotionSamples(run: PdfViewerTelemetryRun) {
  return run.samples.filter((sample) => sample.motionPhase === "sliding");
}

function getPdfTelemetryLifecycleSamples(run: PdfViewerTelemetryRun) {
  return [...run.samples, run.after];
}

function getPdfTelemetryAllSamples(runs: readonly PdfViewerTelemetryRun[]) {
  return runs.flatMap((run) => [run.before, ...run.samples, run.after]);
}

function countPdfTelemetryReversals(
  values: readonly (number | null)[],
  epsilon: number,
) {
  let direction = 0;
  let reversals = 0;
  let previous: number | null = null;

  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    if (previous === null) {
      previous = value;
      continue;
    }

    const delta = value - previous;
    previous = value;
    if (Math.abs(delta) <= epsilon) continue;

    const nextDirection = delta > 0 ? 1 : -1;
    if (direction !== 0 && nextDirection !== direction) reversals += 1;
    direction = nextDirection;
  }

  return reversals;
}

function getPdfTelemetryRange(values: readonly (number | null)[]) {
  const finiteValues = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  if (finiteValues.length === 0) return 0;
  return Math.max(...finiteValues) - Math.min(...finiteValues);
}

function nextPdfTelemetryAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function clampPdfTelemetryNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatPdfTelemetryNumber(value: number, fractionDigits: number) {
  return Number.isFinite(value) ? Number(value.toFixed(fractionDigits)) : 0;
}
