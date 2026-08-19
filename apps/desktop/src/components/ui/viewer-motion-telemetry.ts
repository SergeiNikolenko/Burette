"use client";

import * as React from "react";

import { joinEffectKey } from "@/lib/effect-key";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

import type { FileViewerElementRegistry } from "./file-viewer-elements";
import type {
  FileViewerMotionFlightRecord,
  FileViewerMotionKernel,
} from "./file-viewer-motion-kernel";

// Shell-level motion telemetry, shipped with the component. It measures the
// FileViewer's own contract — gap monotonicity, surface continuity across the
// sliding → settling edge, scroll identity, DOM churn, layout shift, main
// thread — for ANY renderer hosted in the shell, complementing the renderer
// probes (e.g. __pdfViewerTelemetry's canvas continuity).
type FileViewerMotionTelemetryMetricId =
  | "blink"
  | "gap-stability"
  | "overshoot"
  | "content-start-snap"
  | "content-overshoot"
  | "settle-snap"
  | "scroll-identity"
  | "dom-mutations"
  | "layout-shift"
  | "main-thread"
  | "cycle-invariance";

export type FileViewerMotionTelemetryMetric = {
  budget: string;
  detail: string;
  id: FileViewerMotionTelemetryMetricId;
  label: string;
  passed: boolean;
  value: string;
};

export type FileViewerMotionTelemetrySample = {
  contentHeight: number;
  contentLeft: number;
  contentTop: number;
  contentWidth: number;
  elapsedMs: number;
  gapWidth: number;
  motionPhase: string;
  scrollHeight: number;
  scrollTop: number;
  scrollWidth: number;
  sidebarState: string | null;
  sidebarWidth: number;
  surfaceHeight: number;
  surfaceLeft: number;
  surfaceTop: number;
  surfaceTransform: string;
  surfaceWidth: number;
  timestamp: number;
  visibleCanvasCount: number;
};

export type FileViewerMotionTelemetryRun = {
  action: "close" | "open";
  addedNodeCount: number;
  after: FileViewerMotionTelemetrySample;
  before: FileViewerMotionTelemetrySample;
  canvasResizeMutationCount: number;
  layoutShiftCount: number;
  layoutShiftScore: number;
  longTaskCount: number;
  longTaskDurationMs: number;
  mutationCount: number;
  removedNodeCount: number;
  samples: FileViewerMotionTelemetrySample[];
  scrollEventCount: number;
};

export type FileViewerMotionTelemetryResult = {
  durationMs: number;
  metrics: FileViewerMotionTelemetryMetric[];
  runs: FileViewerMotionTelemetryRun[];
  sampledFrameCount: number;
  status: "failed" | "passed";
};

export type FileViewerMotionTelemetryRuntime = {
  getFlightRecords: () => readonly FileViewerMotionFlightRecord[];
  getLastResult: () => FileViewerMotionTelemetryResult | null;
  readSample: () => FileViewerMotionTelemetrySample | null;
  run: (options?: {
    settleFrameCount?: number;
  }) => Promise<FileViewerMotionTelemetryResult | null>;
};

declare global {
  interface Window {
    __fileViewerMotionTelemetry?: FileViewerMotionTelemetryRuntime;
  }
}

const FILE_VIEWER_TELEMETRY_DEFAULT_SETTLE_FRAMES = 16;
const FILE_VIEWER_TELEMETRY_GAP_REVERSAL_EPSILON_PX = 1;
const FILE_VIEWER_TELEMETRY_OVERSHOOT_BUDGET_PX = 1;
const FILE_VIEWER_TELEMETRY_CONTENT_START_SNAP_BUDGET_PX = 1.5;
const FILE_VIEWER_TELEMETRY_CONTENT_OVERSHOOT_BUDGET_PX = 1;
const FILE_VIEWER_TELEMETRY_SETTLE_SNAP_BUDGET_PX = 1.5;
const FILE_VIEWER_TELEMETRY_SCROLL_IDENTITY_BUDGET_PX = 1;
const FILE_VIEWER_TELEMETRY_CYCLE_BUDGET_PX = 2;
const FILE_VIEWER_TELEMETRY_MAIN_THREAD_P95_BUDGET_MS = 34;
const FILE_VIEWER_TELEMETRY_MAIN_THREAD_MAX_BUDGET_MS = 250;

type FileViewerMotionTelemetryHost = {
  getElements: FileViewerElementRegistry["getElements"];
  getIsSidebarOpen: () => boolean;
  motionDurationMs: number;
  motionKernel: FileViewerMotionKernel;
  toggleSidebar: () => void;
};

export function useFileViewerMotionTelemetry(
  host: FileViewerMotionTelemetryHost,
) {
  const hostRef = React.useRef(host);
  const lastResultRef = React.useRef<FileViewerMotionTelemetryResult | null>(
    null,
  );
  const isRunningRef = React.useRef(false);
  hostRef.current = host;

  useKeyedMountEffect(joinEffectKey(["file-viewer-motion-telemetry"]), () => {
    if (typeof window === "undefined") return;

    const previousRuntime = window.__fileViewerMotionTelemetry;
    const runtime: FileViewerMotionTelemetryRuntime = {
      getFlightRecords: () => hostRef.current.motionKernel.getFlightRecords(),
      getLastResult: () => lastResultRef.current,
      readSample: () =>
        readFileViewerMotionTelemetrySample(hostRef.current, performance.now()),
      run: async (options) => {
        // A telemetry run drives real toggles; a concurrent run would
        // interleave motions and score garbage. One at a time.
        if (isRunningRef.current) return null;
        isRunningRef.current = true;
        try {
          const result = await runFileViewerMotionTelemetry(hostRef, options);
          lastResultRef.current = result;
          if (result) logFileViewerMotionTelemetryResult(result);
          return result;
        } finally {
          isRunningRef.current = false;
        }
      },
    };

    window.__fileViewerMotionTelemetry = runtime;

    return () => {
      if (window.__fileViewerMotionTelemetry === runtime) {
        window.__fileViewerMotionTelemetry = previousRuntime;
      }
    };
  });
}

async function runFileViewerMotionTelemetry(
  hostRef: React.MutableRefObject<FileViewerMotionTelemetryHost>,
  options?: { settleFrameCount?: number },
): Promise<FileViewerMotionTelemetryResult | null> {
  const host = hostRef.current;
  const elements = host.getElements();
  if (!elements.viewerShellElement || !elements.documentSurfaceElement) {
    return null;
  }

  const startedAt = performance.now();
  const settleFrameCount =
    options?.settleFrameCount ?? FILE_VIEWER_TELEMETRY_DEFAULT_SETTLE_FRAMES;
  const firstAction = host.getIsSidebarOpen() ? "close" : "open";
  const secondAction = firstAction === "close" ? "open" : "close";
  const runs: FileViewerMotionTelemetryRun[] = [];

  runs.push(
    await sampleFileViewerMotionRun({
      action: firstAction,
      hostRef,
      settleFrameCount,
    }),
  );
  await waitForFileViewerTelemetryFrames(6);
  runs.push(
    await sampleFileViewerMotionRun({
      action: secondAction,
      hostRef,
      settleFrameCount,
    }),
  );

  const metrics = collectFileViewerMotionTelemetryMetrics(runs);

  return {
    durationMs: Math.max(0, performance.now() - startedAt),
    metrics,
    runs,
    sampledFrameCount: runs.reduce(
      (count, run) => count + run.samples.length,
      0,
    ),
    status: metrics.every((metric) => metric.passed) ? "passed" : "failed",
  };
}

async function sampleFileViewerMotionRun({
  action,
  hostRef,
  settleFrameCount,
}: {
  action: "close" | "open";
  hostRef: React.MutableRefObject<FileViewerMotionTelemetryHost>;
  settleFrameCount: number;
}): Promise<FileViewerMotionTelemetryRun> {
  const host = hostRef.current;
  const startedAt = performance.now();
  const before =
    readFileViewerMotionTelemetrySample(host, startedAt) ??
    createEmptyFileViewerMotionTelemetrySample();
  const trackers = createFileViewerMotionTelemetryTrackers(host);
  const samples: FileViewerMotionTelemetrySample[] = [];

  host.toggleSidebar();
  samples.push(readFileViewerMotionTelemetrySample(host, startedAt) ?? before);

  const sampleUntil = host.motionDurationMs + settleFrameCount * (1000 / 60);
  while (performance.now() - startedAt < sampleUntil) {
    await waitForFileViewerTelemetryFrames(1);
    const sample = readFileViewerMotionTelemetrySample(
      hostRef.current,
      startedAt,
    );
    if (sample) samples.push(sample);
  }

  await waitForFileViewerTelemetryFrames(2);
  const after =
    readFileViewerMotionTelemetrySample(hostRef.current, startedAt) ?? before;
  trackers.disconnect();

  return {
    action,
    addedNodeCount: trackers.addedNodeCount,
    after,
    before,
    canvasResizeMutationCount: trackers.canvasResizeMutationCount,
    layoutShiftCount: trackers.layoutShiftCount,
    layoutShiftScore: trackers.layoutShiftScore,
    longTaskCount: trackers.longTaskCount,
    longTaskDurationMs: trackers.longTaskDurationMs,
    mutationCount: trackers.mutationCount,
    removedNodeCount: trackers.removedNodeCount,
    samples,
    scrollEventCount: trackers.scrollEventCount,
  };
}

function createEmptyFileViewerMotionTelemetrySample(): FileViewerMotionTelemetrySample {
  return {
    contentHeight: 0,
    contentLeft: 0,
    contentTop: 0,
    contentWidth: 0,
    elapsedMs: 0,
    gapWidth: 0,
    motionPhase: "idle",
    scrollHeight: 0,
    scrollTop: 0,
    scrollWidth: 0,
    sidebarState: null,
    sidebarWidth: 0,
    surfaceHeight: 0,
    surfaceLeft: 0,
    surfaceTop: 0,
    surfaceTransform: "",
    surfaceWidth: 0,
    timestamp: 0,
    visibleCanvasCount: 0,
  };
}

function readFileViewerMotionTelemetrySample(
  host: FileViewerMotionTelemetryHost,
  startedAt: number,
): FileViewerMotionTelemetrySample | null {
  const elements = host.getElements();
  const surfaceElement = elements.documentSurfaceElement;
  if (!surfaceElement) return null;

  const gapRect = elements.sidebarGapElement?.getBoundingClientRect();
  const sidebarRect = elements.sidebarElement?.getBoundingClientRect();
  const surfaceRect = surfaceElement.getBoundingClientRect();
  const contentElement = readFileViewerMotionProbeElement(elements);
  const contentRect = contentElement
    ? readFileViewerMotionProbeRect(contentElement, elements.viewerShellElement)
    : null;
  const scroller = findFileViewerTelemetryScroller(surfaceElement);
  const frame = host.motionKernel.getInteractiveSnapshot();
  const visibleCanvasCount = countFileViewerVisibleCanvases(surfaceElement);

  return {
    contentHeight: contentRect?.height ?? surfaceRect.height,
    contentLeft: contentRect?.left ?? surfaceRect.left,
    contentTop: contentRect?.top ?? surfaceRect.top,
    contentWidth: contentRect?.width ?? surfaceRect.width,
    elapsedMs: Math.max(0, performance.now() - startedAt),
    gapWidth: gapRect?.width ?? 0,
    motionPhase: frame.phase,
    scrollHeight: scroller?.scrollHeight ?? 0,
    scrollTop: scroller?.scrollTop ?? 0,
    scrollWidth: scroller?.scrollWidth ?? 0,
    sidebarState:
      elements.sidebarElement?.getAttribute("data-file-viewer-sidebar-state") ??
      null,
    sidebarWidth: sidebarRect?.width ?? 0,
    surfaceHeight: surfaceRect.height,
    surfaceLeft: surfaceRect.left,
    surfaceTop: surfaceRect.top,
    surfaceTransform: getComputedStyle(surfaceElement).transform,
    surfaceWidth: surfaceRect.width,
    timestamp: performance.now(),
    visibleCanvasCount,
  };
}

function readFileViewerMotionProbeElement(
  elements: ReturnType<FileViewerElementRegistry["getElements"]>,
) {
  try {
    return elements.getDocumentSurfaceMotionProbeElement?.() ?? null;
  } catch {
    return null;
  }
}

function readFileViewerMotionProbeRect(
  element: HTMLElement,
  boundaryElement: HTMLElement | null,
) {
  const rect = element.getBoundingClientRect();
  let left = rect.left;
  let right = rect.right;

  // getBoundingClientRect reports the transformed content box even when an
  // ancestor removes part of it at paint. Intersect horizontal clipping
  // ancestors so telemetry measures the pixels a sidebar resize can actually
  // show, while leaving vertical viewport clipping (ordinary document
  // scrolling) out of this horizontal motion signal.
  let ancestor = element.parentElement;
  while (ancestor) {
    const style = getComputedStyle(ancestor);
    if (clipsFileViewerMotionProbeInline(style)) {
      const ancestorRect = ancestor.getBoundingClientRect();
      left = Math.max(left, ancestorRect.left);
      right = Math.min(right, ancestorRect.right);
    }
    if (ancestor === boundaryElement) break;
    ancestor = ancestor.parentElement;
  }

  return {
    height: rect.height,
    left,
    top: rect.top,
    width: Math.max(0, right - left),
  };
}

function clipsFileViewerMotionProbeInline(style: CSSStyleDeclaration) {
  const contain = style.contain.split(/\s+/);
  return (
    style.overflowX === "auto" ||
    style.overflowX === "clip" ||
    style.overflowX === "hidden" ||
    style.overflowX === "scroll" ||
    contain.includes("content") ||
    contain.includes("paint") ||
    contain.includes("strict")
  );
}

function findFileViewerTelemetryScroller(element: HTMLElement) {
  let candidate: HTMLElement | null = element.parentElement;
  while (candidate) {
    const overflowY = getComputedStyle(candidate).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return candidate;
    candidate = candidate.parentElement;
  }
  return null;
}

function countFileViewerVisibleCanvases(surfaceElement: HTMLElement) {
  let count = 0;
  for (const canvas of surfaceElement.querySelectorAll("canvas")) {
    if (!(canvas instanceof HTMLCanvasElement)) continue;
    if (canvas.width <= 0 || canvas.height <= 0) continue;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    count += 1;
  }
  return count;
}

function createFileViewerMotionTelemetryTrackers(
  host: FileViewerMotionTelemetryHost,
) {
  const elements = host.getElements();
  const rootElement = elements.viewerShellElement;
  const scroller = elements.documentSurfaceElement
    ? findFileViewerTelemetryScroller(elements.documentSurfaceElement)
    : null;

  const trackers = {
    addedNodeCount: 0,
    canvasResizeMutationCount: 0,
    layoutShiftCount: 0,
    layoutShiftScore: 0,
    longTaskCount: 0,
    longTaskDurationMs: 0,
    mutationCount: 0,
    removedNodeCount: 0,
    scrollEventCount: 0,
    disconnect: () => {},
  };

  const cleanups: (() => void)[] = [];

  if (rootElement && typeof MutationObserver === "function") {
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        trackers.mutationCount += 1;
        trackers.addedNodeCount += record.addedNodes.length;
        trackers.removedNodeCount += record.removedNodes.length;
        if (
          record.type === "attributes" &&
          record.target instanceof HTMLCanvasElement &&
          (record.attributeName === "width" ||
            record.attributeName === "height")
        ) {
          trackers.canvasResizeMutationCount += 1;
        }
      }
    });
    mutationObserver.observe(rootElement, {
      attributeFilter: ["width", "height", "style", "data-pdf-render-status"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    cleanups.push(() => mutationObserver.disconnect());
  }

  const layoutShiftObserver = observeFileViewerPerformanceEntries(
    "layout-shift",
    (entry) => {
      const layoutShift = entry as PerformanceEntry & {
        hadRecentInput?: boolean;
        value?: number;
      };
      if (layoutShift.hadRecentInput) return;
      trackers.layoutShiftCount += 1;
      trackers.layoutShiftScore += layoutShift.value ?? 0;
    },
  );
  if (layoutShiftObserver) cleanups.push(layoutShiftObserver);

  const longTaskObserver = observeFileViewerPerformanceEntries(
    "longtask",
    (entry) => {
      trackers.longTaskCount += 1;
      trackers.longTaskDurationMs += entry.duration;
    },
  );
  if (longTaskObserver) cleanups.push(longTaskObserver);

  if (scroller) {
    const handleScroll = () => {
      trackers.scrollEventCount += 1;
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    cleanups.push(() => scroller.removeEventListener("scroll", handleScroll));
  }

  trackers.disconnect = () => {
    for (const cleanup of cleanups) cleanup();
  };

  return trackers;
}

function observeFileViewerPerformanceEntries(
  type: string,
  onEntry: (entry: PerformanceEntry) => void,
) {
  if (typeof PerformanceObserver !== "function") return null;
  const supported = PerformanceObserver.supportedEntryTypes;
  if (Array.isArray(supported) && !supported.includes(type)) return null;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) onEntry(entry);
    });
    observer.observe({ type, buffered: false });
    return () => observer.disconnect();
  } catch {
    return null;
  }
}

function waitForFileViewerTelemetryFrames(frameCount: number) {
  return new Promise<void>((resolve) => {
    let remaining = Math.max(1, frameCount);
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function collectFileViewerMotionTelemetryMetrics(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric[] {
  return [
    collectFileViewerBlinkMetric(runs),
    collectFileViewerGapStabilityMetric(runs),
    collectFileViewerOvershootMetric(runs),
    collectFileViewerContentStartSnapMetric(runs),
    collectFileViewerContentOvershootMetric(runs),
    collectFileViewerSettleSnapMetric(runs),
    collectFileViewerScrollIdentityMetric(runs),
    collectFileViewerDomMutationsMetric(runs),
    collectFileViewerLayoutShiftMetric(runs),
    collectFileViewerMainThreadMetric(runs),
    collectFileViewerCycleInvarianceMetric(runs),
  ];
}

function collectFileViewerContentStartSnapMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  let snapPx = 0;

  for (const run of runs) {
    const before = getFileViewerTelemetryContentEdges(run.before);
    const first = run.samples[0]
      ? getFileViewerTelemetryContentEdges(run.samples[0])
      : null;
    if (!before || !first) continue;
    for (let index = 0; index < before.length; index += 1) {
      snapPx = Math.max(snapPx, Math.abs(first[index]! - before[index]!));
    }
  }

  return {
    budget: `<= ${FILE_VIEWER_TELEMETRY_CONTENT_START_SNAP_BUDGET_PX}px`,
    detail:
      "The synchronous target-layout commit must paint exactly where the pre-toggle content was; any first-sample deviation is an opening snap or ancestor clip.",
    id: "content-start-snap",
    label: "Content start snap",
    passed: snapPx <= FILE_VIEWER_TELEMETRY_CONTENT_START_SNAP_BUDGET_PX,
    value: `${formatFileViewerTelemetryNumber(snapPx, 2)}px`,
  };
}

function collectFileViewerContentOvershootMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  let overshootPx = 0;

  for (const run of runs) {
    const before = getFileViewerTelemetryContentEdges(run.before);
    const after = getFileViewerTelemetryContentEdges(run.after);
    if (!before || !after) continue;

    for (const sample of run.samples) {
      const edges = getFileViewerTelemetryContentEdges(sample);
      if (!edges) continue;
      for (let index = 0; index < edges.length; index += 1) {
        const low = Math.min(before[index]!, after[index]!);
        const high = Math.max(before[index]!, after[index]!);
        overshootPx = Math.max(
          overshootPx,
          low - edges[index]!,
          edges[index]! - high,
        );
      }
    }
  }

  return {
    budget: `<= ${FILE_VIEWER_TELEMETRY_CONTENT_OVERSHOOT_BUDGET_PX}px`,
    detail:
      "The visible content edges must stay inside their endpoint corridor; an excursion outside it is the first-frame back-and-forth wobble.",
    id: "content-overshoot",
    label: "Content overshoot",
    passed: overshootPx <= FILE_VIEWER_TELEMETRY_CONTENT_OVERSHOOT_BUDGET_PX,
    value: `${formatFileViewerTelemetryNumber(Math.max(0, overshootPx), 2)}px`,
  };
}

function getFileViewerTelemetryContentEdges(
  sample: FileViewerMotionTelemetrySample,
): readonly [number, number, number, number] | null {
  if (sample.contentWidth <= 0 || sample.contentHeight <= 0) return null;
  return [
    sample.contentLeft,
    sample.contentTop,
    sample.contentLeft + sample.contentWidth,
    sample.contentTop + sample.contentHeight,
  ];
}

function collectFileViewerBlinkMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  let blinkFrameCount = 0;
  for (const run of runs) {
    // Canvas-backed renderers must never lose all visible pixels mid-motion;
    // renderers without canvases (text-like) hold both endpoints at 0 and the
    // check degrades to surface-box presence.
    const endpointCanvasFloor = Math.min(
      run.before.visibleCanvasCount,
      run.after.visibleCanvasCount,
    );
    for (const sample of run.samples) {
      const surfaceMissing =
        sample.surfaceWidth <= 0 || sample.surfaceHeight <= 0;
      const canvasDropout =
        endpointCanvasFloor > 0 && sample.visibleCanvasCount === 0;
      if (surfaceMissing || canvasDropout) blinkFrameCount += 1;
    }
  }

  return {
    budget: "0 blink frames",
    detail:
      "A blink frame has a collapsed document surface or loses every visible canvas while both endpoints have rendered content.",
    id: "blink",
    label: "Blink",
    passed: blinkFrameCount === 0,
    value: `${blinkFrameCount} frames`,
  };
}

function collectFileViewerGapStabilityMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  let reversalCount = 0;
  for (const run of runs) {
    const widths = run.samples.map((sample) => sample.gapWidth);
    const direction = Math.sign((widths.at(-1) ?? 0) - (widths.at(0) ?? 0));
    if (direction === 0) continue;
    for (let index = 1; index < widths.length; index += 1) {
      const step = widths[index] - widths[index - 1];
      if (
        Math.sign(step) === -direction &&
        Math.abs(step) > FILE_VIEWER_TELEMETRY_GAP_REVERSAL_EPSILON_PX
      ) {
        reversalCount += 1;
      }
    }
  }

  return {
    budget: `0 reversals over ${FILE_VIEWER_TELEMETRY_GAP_REVERSAL_EPSILON_PX}px`,
    detail:
      "The sidebar gap width must progress monotonically toward its target.",
    id: "gap-stability",
    label: "Gap stability",
    passed: reversalCount === 0,
    value: `${reversalCount} reversals`,
  };
}

function collectFileViewerOvershootMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  let overshootPx = 0;
  for (const run of runs) {
    const endpoints = [
      run.samples.at(0)?.gapWidth ?? 0,
      run.samples.at(-1)?.gapWidth ?? 0,
    ];
    const low = Math.min(...endpoints);
    const high = Math.max(...endpoints);
    for (const sample of run.samples) {
      overshootPx = Math.max(
        overshootPx,
        low - sample.gapWidth,
        sample.gapWidth - high,
      );
    }
  }

  return {
    budget: `<= ${FILE_VIEWER_TELEMETRY_OVERSHOOT_BUDGET_PX}px`,
    detail:
      "The gap width must stay inside the interval spanned by its endpoints.",
    id: "overshoot",
    label: "Overshoot",
    passed: overshootPx <= FILE_VIEWER_TELEMETRY_OVERSHOOT_BUDGET_PX,
    value: `${formatFileViewerTelemetryNumber(Math.max(0, overshootPx), 2)}px`,
  };
}

// The settle-boundary blink: once the transform leaves the sliding phase it
// is identity over the already-settled layout, so every post-sliding sample's
// surface box must already equal the final rest box. Deviation here is the
// "reach the target, then move again" wobble. (Comparing against the final
// box — not the previous frame — keeps dropped frames, whose mid-flight box
// coordinates legitimately sweep with the transform's anchor term, out of
// this metric; main-thread covers those.)
function collectFileViewerSettleSnapMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  let snapPx = 0;
  for (const run of runs) {
    let sawSliding = false;
    // Content position, not box position: late page-size measurements can
    // resize the stage after the motion — vertically the scroll layer
    // compensates scrollTop in the same commit, horizontally the pages stay
    // centered — so the box moves while the pixels do not. The
    // content-invariant observables are surfaceTop + scrollTop (vertical)
    // and the stage center (horizontal).
    const afterContentTop = run.after.surfaceTop + run.after.scrollTop;
    const afterContentCenter =
      run.after.surfaceLeft + run.after.surfaceWidth / 2;
    for (const sample of run.samples) {
      if (sample.motionPhase === "sliding") {
        sawSliding = true;
        continue;
      }
      if (!sawSliding) continue;
      // A sample can catch the frame where the kernel has advanced to
      // settling but the last sliding tick's transform is still applied; its
      // box sweeps with the anchor term while the viewport pixels hold. The
      // metric asserts rest AFTER the transform clears.
      if (
        sample.surfaceTransform !== "none" &&
        sample.surfaceTransform !== ""
      ) {
        continue;
      }
      snapPx = Math.max(
        snapPx,
        Math.abs(
          sample.surfaceLeft + sample.surfaceWidth / 2 - afterContentCenter,
        ),
        Math.abs(sample.surfaceTop + sample.scrollTop - afterContentTop),
      );
    }
  }

  return {
    budget: `<= ${FILE_VIEWER_TELEMETRY_SETTLE_SNAP_BUDGET_PX}px settle deviation`,
    detail:
      "After the sliding phase ends the surface box must already sit at its final rest position; deviation is the settle-boundary wobble.",
    id: "settle-snap",
    label: "Settle snap",
    passed: snapPx <= FILE_VIEWER_TELEMETRY_SETTLE_SNAP_BUDGET_PX,
    value: `${formatFileViewerTelemetryNumber(snapPx, 2)}px`,
  };
}

function collectFileViewerScrollIdentityMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  let scrollRangePx = 0;
  for (const run of runs) {
    // Layout and scroll commit in the toggle's own task, so every sampled
    // frame (the first sample runs after the toggle) sees the final scrollTop.
    const tops = run.samples.map((sample) => sample.scrollTop);
    if (tops.length === 0) continue;
    scrollRangePx = Math.max(
      scrollRangePx,
      Math.max(...tops) - Math.min(...tops),
    );
  }

  return {
    budget: `<= ${FILE_VIEWER_TELEMETRY_SCROLL_IDENTITY_BUDGET_PX}px scroll range`,
    detail:
      "scrollTop is rebased once at slide start and must hold for the rest of the motion.",
    id: "scroll-identity",
    label: "Scroll identity",
    passed: scrollRangePx <= FILE_VIEWER_TELEMETRY_SCROLL_IDENTITY_BUDGET_PX,
    value: `${formatFileViewerTelemetryNumber(scrollRangePx, 2)}px`,
  };
}

function collectFileViewerDomMutationsMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  const canvasResizeMutationCount = runs.reduce(
    (count, run) => count + run.canvasResizeMutationCount,
    0,
  );
  const mutationCount = runs.reduce(
    (count, run) => count + run.mutationCount,
    0,
  );

  return {
    budget: "0 canvas resizes",
    detail:
      "Raster headroom is prepared before motion, so no canvas backing store may resize (and wipe) during it. Total mutations are reported for diagnosis.",
    id: "dom-mutations",
    label: "DOM mutations",
    passed: canvasResizeMutationCount === 0,
    value: `${canvasResizeMutationCount} canvas resizes / ${mutationCount} total`,
  };
}

function collectFileViewerLayoutShiftMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  const score = runs.reduce((total, run) => total + run.layoutShiftScore, 0);
  const count = runs.reduce((total, run) => total + run.layoutShiftCount, 0);

  return {
    budget: "diagnostic",
    detail:
      "Cumulative layout-shift entries during motion (the intentional sidebar reflow is included; read alongside settle-snap).",
    id: "layout-shift",
    label: "Layout shift",
    passed: true,
    value: `${count} shifts / ${formatFileViewerTelemetryNumber(score, 4)}`,
  };
}

function collectFileViewerMainThreadMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  const gaps: number[] = [];
  for (const run of runs) {
    for (let index = 1; index < run.samples.length; index += 1) {
      gaps.push(
        run.samples[index].timestamp - run.samples[index - 1].timestamp,
      );
    }
  }
  const sortedGaps = gaps.slice().sort((left, right) => left - right);
  const p95 =
    sortedGaps.length > 0
      ? sortedGaps[
          Math.min(sortedGaps.length - 1, Math.floor(sortedGaps.length * 0.95))
        ]
      : 0;
  const max = sortedGaps.at(-1) ?? 0;
  const longTaskDurationMs = runs.reduce(
    (total, run) => total + run.longTaskDurationMs,
    0,
  );

  const passed =
    p95 <= FILE_VIEWER_TELEMETRY_MAIN_THREAD_P95_BUDGET_MS &&
    max <= FILE_VIEWER_TELEMETRY_MAIN_THREAD_MAX_BUDGET_MS;

  return {
    budget: `p95 <= ${FILE_VIEWER_TELEMETRY_MAIN_THREAD_P95_BUDGET_MS}ms, max <= ${FILE_VIEWER_TELEMETRY_MAIN_THREAD_MAX_BUDGET_MS}ms`,
    detail:
      "Frame-to-frame sample gaps during motion; a long gap is a dropped frame the user sees as stutter. Long-task time is reported alongside.",
    id: "main-thread",
    label: "Main thread",
    passed,
    value: `p95 ${formatFileViewerTelemetryNumber(p95, 1)}ms / max ${formatFileViewerTelemetryNumber(max, 1)}ms / ${formatFileViewerTelemetryNumber(longTaskDurationMs, 1)}ms long tasks`,
  };
}

function collectFileViewerCycleInvarianceMetric(
  runs: readonly FileViewerMotionTelemetryRun[],
): FileViewerMotionTelemetryMetric {
  if (runs.length < 2) {
    return {
      budget: `<= ${FILE_VIEWER_TELEMETRY_CYCLE_BUDGET_PX}px`,
      detail: "Needs a full toggle cycle.",
      id: "cycle-invariance",
      label: "Cycle invariance",
      passed: true,
      value: "n/a",
    };
  }

  const first = runs[0].before;
  const last = runs[runs.length - 1].after;
  const drift = Math.max(
    Math.abs(first.gapWidth - last.gapWidth),
    Math.abs(first.surfaceLeft - last.surfaceLeft),
    Math.abs(first.surfaceWidth - last.surfaceWidth),
    Math.abs(first.scrollTop - last.scrollTop),
  );

  return {
    budget: `<= ${FILE_VIEWER_TELEMETRY_CYCLE_BUDGET_PX}px`,
    detail:
      "A full open/close cycle must return the gap, surface box, and scroll position to their starting values.",
    id: "cycle-invariance",
    label: "Cycle invariance",
    passed: drift <= FILE_VIEWER_TELEMETRY_CYCLE_BUDGET_PX,
    value: `${formatFileViewerTelemetryNumber(drift, 2)}px`,
  };
}

function logFileViewerMotionTelemetryResult(
  result: FileViewerMotionTelemetryResult,
) {
  const summary = {
    durationMs: Number(result.durationMs.toFixed(1)),
    failedMetricIds: result.metrics
      .filter((metric) => !metric.passed)
      .map((metric) => metric.id),
    metrics: result.metrics,
    sampledFrameCount: result.sampledFrameCount,
    status: result.status,
  };
  console.info(
    `[file-viewer:motion-telemetry] result ${JSON.stringify(summary)}`,
  );
}

function formatFileViewerTelemetryNumber(
  value: number,
  fractionDigits: number,
) {
  return Number.isFinite(value) ? Number(value.toFixed(fractionDigits)) : 0;
}
