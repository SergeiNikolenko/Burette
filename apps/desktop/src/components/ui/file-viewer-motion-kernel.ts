"use client";

import * as React from "react";
import { flushSync } from "react-dom";

import { FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT } from "./file-viewer-elements";
import {
  easeFileViewerMotion,
  FILE_VIEWER_MOTION_DURATION_MS,
  areFileViewerMotionFramesEqual,
  areFileViewerMotionRestFramesEqual,
  createFileViewerIdleMotionFrame,
  createFileViewerMotionPlan,
  createFileViewerMotionRestFrame,
  type FileViewerMotionFrame,
  type FileViewerMotionPlan,
  type FileViewerMotionRestFrame,
  type FileViewerMotionTarget,
} from "./file-viewer-motion-plan";

// The kernel is the single owner of sidebar motion. It holds the clock (one
// rAF loop from slide start through settle), writes the continuous inline
// styles, and publishes to React subscribers only at phase edges
// (idle → sliding → settling → idle). Everything discrete — data attributes,
// inert/aria, the overlay translate classes — is owned by React renders.
//
// Commit-then-relax ordering: the first sliding frame is flushed
// synchronously inside the toggle's own task, so renderers commit their
// TARGET layout and rebase scroll before anything paints; the per-tick style
// writes then only relax the counter-transform to identity. Settle removes a
// no-op transform — it never commits layout, so no flushSync runs inside rAF.
export type FileViewerMotionKernel = {
  getFlightRecords: () => readonly FileViewerMotionFlightRecord[];
  getInteractiveSnapshot: () => FileViewerMotionFrame;
  getSnapshot: () => FileViewerMotionFrame;
  setDocumentSurface: (surface: FileViewerDocumentSurface | null) => void;
  setSidebarGapElement: (element: HTMLElement | null) => void;
  startMotion: (target: FileViewerMotionTarget) => void;
  subscribe: (listener: () => void) => () => void;
  syncTarget: (target: FileViewerMotionTarget) => void;
};

// Always-on flight recorder: every motion leaves a bounded trace (per-tick
// widths, phase edges, settle holds, inter-frame gaps) so a blink report is
// diagnosable after the fact without re-instrumenting.
export type FileViewerMotionFlightRecord = {
  fromInlineSize: number;
  id: number;
  interrupted: boolean;
  maxTickGapMs: number;
  open: boolean;
  settleHoldFrameCount: number;
  startedAt: number;
  ticks: FileViewerMotionFlightTick[];
  toInlineSize: number;
};

export type FileViewerMotionFlightTick = {
  elapsedMs: number;
  phase: FileViewerMotionFrame["phase"];
  sidebarInlineSize: number;
};

const FILE_VIEWER_FLIGHT_RECORD_LIMIT = 8;
const FILE_VIEWER_FLIGHT_TICK_LIMIT = 240;

export type FileViewerDocumentSurface = {
  element: HTMLElement;
  getMotionProbeElement?: (() => HTMLElement | null) | null;
  readSettleSnapshot?: FileViewerDocumentSurfaceSettleSnapshotReader | null;
  resolveMotionStyle?: FileViewerDocumentSurfaceMotionResolver | null;
};

export type FileViewerDocumentSurfaceSettleSnapshotReader = () =>
  | readonly number[]
  | null
  | undefined;

// Layout reads are quarantined outside the kernel (viewer-measurement / the
// frame controller layer). The kernel owns time and style writes only, so the
// settle-hold rect reader is injected by its creator rather than imported.
export type FileViewerElementRectSnapshotReader = (
  element: HTMLElement | null,
) => readonly number[];

export type FileViewerMotionKernelOptions = {
  readElementRectSnapshot?: FileViewerElementRectSnapshotReader | null;
};

export type FileViewerDocumentSurfaceMotionStyle = {
  customProperties?: Readonly<Record<string, string | null>>;
  transform: string;
  transformOrigin: string;
  willChange: string;
};

export type FileViewerDocumentSurfaceMotionResolver = (
  frame: FileViewerMotionFrame,
) => FileViewerDocumentSurfaceMotionStyle | null;

type FileViewerActiveMotion = {
  durationMs: number;
  from: FileViewerMotionRestFrame;
  // The clock re-anchors to the first tick's vsync frame time: startedAt is
  // stamped inside the toggle's task, but the synchronous slide-start commit
  // can burn 10ms+ before anything paints, and an ease anchored at the click
  // lands its first painted frame that deep into the curve.
  hasFrameClockAnchor: boolean;
  id: number;
  startedAt: number;
  to: FileViewerMotionRestFrame;
};

type FileViewerSettleRelease = {
  idleFrame: FileViewerMotionFrame;
  lastSnapshot: readonly number[];
  remainingFrameCount: number;
  settlingFrame: FileViewerMotionFrame;
  stableFrameCount: number;
};

const FILE_VIEWER_SETTLE_SCROLL_EPSILON_PX = 0.25;
const FILE_VIEWER_SETTLE_STABLE_FRAME_COUNT = 2;
const FILE_VIEWER_SETTLE_MAX_HOLD_FRAMES = 6;
const FILE_VIEWER_SUBPIXEL_ENDPOINT_EPSILON_PX = 1;

export const DEFAULT_FILE_VIEWER_MOTION_FRAME: FileViewerMotionFrame = {
  shellInlineSize: 0,
  durationMs: FILE_VIEWER_MOTION_DURATION_MS,
  fromInlineSize: 0,
  layoutInlineSize: 0,
  mode: "overlay",
  motionId: null,
  motionProgress: 1,
  open: false,
  phase: "idle",
  side: "left",
  sidebarInlineSize: 0,
  sidebarWidth: 0,
  toInlineSize: 0,
};

export function createFileViewerMotionKernel({
  readElementRectSnapshot = null,
}: FileViewerMotionKernelOptions = {}): FileViewerMotionKernel {
  const listeners = new Set<() => void>();
  let contractFrame = DEFAULT_FILE_VIEWER_MOTION_FRAME;
  let interactiveFrame = DEFAULT_FILE_VIEWER_MOTION_FRAME;
  let target: FileViewerMotionTarget = {
    shellInlineSize: 0,
    durationMs: DEFAULT_FILE_VIEWER_MOTION_FRAME.durationMs,
    mode: DEFAULT_FILE_VIEWER_MOTION_FRAME.mode,
    open: DEFAULT_FILE_VIEWER_MOTION_FRAME.open,
    side: DEFAULT_FILE_VIEWER_MOTION_FRAME.side,
    sidebarWidth: 0,
  };
  let documentSurface: FileViewerDocumentSurface | null = null;
  let documentSurfaceCustomProperties = new Set<string>();
  let sidebarGapElement: HTMLElement | null = null;
  let activeMotion: FileViewerActiveMotion | null = null;
  let settleRelease: FileViewerSettleRelease | null = null;
  let rafHandle = 0;
  let settleReleaseHandle = 0;
  let motionSequence = 0;
  const flightRecords: FileViewerMotionFlightRecord[] = [];
  let activeFlightRecord: FileViewerMotionFlightRecord | null = null;
  let lastFlightTickAt = 0;

  const beginFlightRecord = (motion: FileViewerActiveMotion) => {
    if (activeFlightRecord && activeFlightRecord.id !== motion.id) {
      activeFlightRecord.interrupted = true;
    }
    activeFlightRecord = {
      fromInlineSize: motion.from.layoutInlineSize,
      id: motion.id,
      interrupted: false,
      maxTickGapMs: 0,
      open: motion.to.open,
      settleHoldFrameCount: 0,
      startedAt: motion.startedAt,
      ticks: [],
      toInlineSize: motion.to.layoutInlineSize,
    };
    lastFlightTickAt = motion.startedAt;
    flightRecords.push(activeFlightRecord);
    if (flightRecords.length > FILE_VIEWER_FLIGHT_RECORD_LIMIT) {
      flightRecords.splice(
        0,
        flightRecords.length - FILE_VIEWER_FLIGHT_RECORD_LIMIT,
      );
    }
  };

  const recordFlightTick = (frame: FileViewerMotionFrame, now = readNow()) => {
    const record = activeFlightRecord;
    if (!record || frame.motionId !== record.id) return;
    record.maxTickGapMs = Math.max(record.maxTickGapMs, now - lastFlightTickAt);
    lastFlightTickAt = now;
    if (frame.phase === "settling") record.settleHoldFrameCount += 1;
    if (record.ticks.length >= FILE_VIEWER_FLIGHT_TICK_LIMIT) return;
    record.ticks.push({
      elapsedMs: Math.max(0, now - record.startedAt),
      phase: frame.phase,
      sidebarInlineSize: frame.sidebarInlineSize,
    });
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const publishContractFrame = (
    nextFrame: FileViewerMotionFrame,
    { flushSubscribers = false }: { flushSubscribers?: boolean } = {},
  ) => {
    if (areFileViewerMotionFramesEqual(contractFrame, nextFrame)) return;
    contractFrame = nextFrame;

    if (flushSubscribers) {
      flushSync(notify);
      return;
    }

    notify();
  };

  // The gap's inline size and the document surface's counter-scale must land
  // in the same frame: two independent CSS transitions (width on the gap,
  // transform on the surface) can desync under main-thread jank, letting the
  // document edge drift off the sidebar edge mid-slide. The kernel therefore
  // writes both here, once per tick.
  const writeElementStyles = (nextFrame: FileViewerMotionFrame) => {
    writeSidebarGapStyle(nextFrame);
    writeDocumentSurfaceStyle(nextFrame);
  };

  const commit = (
    nextFrame: FileViewerMotionFrame,
    { publish = true }: { publish?: boolean } = {},
  ) => {
    writeElementStyles(nextFrame);
    interactiveFrame = nextFrame;
    if (publish) publishContractFrame(nextFrame);
  };

  const cancelTick = () => {
    if (rafHandle === 0) return;
    getCancelAnimationFrame()(rafHandle);
    rafHandle = 0;
  };

  const cancelSettleRelease = () => {
    settleRelease = null;
    if (settleReleaseHandle === 0) return;
    getCancelAnimationFrame()(settleReleaseHandle);
    settleReleaseHandle = 0;
  };

  const readMotionSample = (
    motion: FileViewerActiveMotion,
    now = readNow(),
  ): FileViewerMotionFrame => {
    const rawTimeProgress =
      motion.durationMs <= 0
        ? 1
        : clamp((now - motion.startedAt) / motion.durationMs, 0, 1);
    const rawMotionProgress = easeFileViewerMotion(rawTimeProgress);
    const rawSidebarInlineSize = lerp(
      motion.from.sidebarInlineSize,
      motion.to.sidebarInlineSize,
      rawMotionProgress,
    );
    const isSubpixelEndpoint =
      rawMotionProgress > 0.98 &&
      Math.abs(rawSidebarInlineSize - motion.to.sidebarInlineSize) <=
        FILE_VIEWER_SUBPIXEL_ENDPOINT_EPSILON_PX;
    const motionProgress = isSubpixelEndpoint ? 1 : rawMotionProgress;
    const sidebarInlineSize = isSubpixelEndpoint
      ? motion.to.sidebarInlineSize
      : rawSidebarInlineSize;
    const layoutInlineSize = Math.max(
      0,
      motion.to.shellInlineSize - sidebarInlineSize,
    );
    const fromInlineSize = motion.from.layoutInlineSize;

    return {
      shellInlineSize: motion.to.shellInlineSize,
      durationMs: motion.durationMs,
      fromInlineSize,
      layoutInlineSize,
      mode: motion.to.mode,
      motionId: motion.id,
      motionProgress,
      open: motion.to.open,
      phase: motionProgress < 1 ? "sliding" : "settling",
      side: motion.to.side,
      sidebarInlineSize,
      sidebarWidth: motion.to.sidebarWidth,
      toInlineSize: motion.to.layoutInlineSize,
    };
  };

  const settle = () => {
    if (!activeMotion) return;
    const finishedMotion = activeMotion;
    activeMotion = null;
    cancelTick();

    const idleFrame = createFileViewerIdleMotionFrame(finishedMotion.to);
    const settlingFrame: FileViewerMotionFrame = {
      ...idleFrame,
      fromInlineSize: finishedMotion.from.layoutInlineSize,
      motionId: finishedMotion.id,
      phase: "settling",
    };

    // Layout and scroll were committed at slide start; settling only clears
    // the (now identity) counter-transform and holds until shell geometry
    // stops moving. Nothing here re-renders geometry, so no flushSync in rAF.
    commit(settlingFrame, { publish: false });
    recordFlightTick(settlingFrame);
    publishContractFrame(settlingFrame);
    scheduleSettleRelease(settlingFrame, idleFrame);
  };

  // Ticks sample the clock at the rAF FRAME timestamp, never the callback's
  // execution time: the frame time is the vsync the paint belongs to, and a
  // callback running late in a janky frame would otherwise write a position
  // ahead of the frame's own time axis — a real paint-side velocity excess
  // (the probes' rule 11, applied to the writer). The first tick also
  // re-anchors startedAt to its frame time, so the ease starts at the first
  // paintable frame rather than at the click that precedes the slide-start
  // commit.
  const tick = (frameTime: number) => {
    rafHandle = 0;
    if (!activeMotion) return;
    const now = Number.isFinite(frameTime) ? frameTime : readNow();
    if (!activeMotion.hasFrameClockAnchor) {
      activeMotion.hasFrameClockAnchor = true;
      activeMotion.startedAt = now;
    }
    const sample = readMotionSample(activeMotion, now);
    if (sample.motionProgress >= 1) {
      settle();
      return;
    }
    commit(sample, { publish: false });
    recordFlightTick(sample, now);
    scheduleTick();
  };

  const scheduleTick = () => {
    if (rafHandle !== 0) return;
    rafHandle = getRequestAnimationFrame()(tick);
  };

  const scheduleSettleRelease = (
    settlingFrame: FileViewerMotionFrame,
    idleFrame: FileViewerMotionFrame,
  ) => {
    cancelSettleRelease();
    settleRelease = {
      idleFrame,
      lastSnapshot: readSettleSnapshot(),
      remainingFrameCount: FILE_VIEWER_SETTLE_MAX_HOLD_FRAMES,
      settlingFrame,
      stableFrameCount: 0,
    };
    scheduleSettleReleaseFrame();
  };

  const scheduleSettleReleaseFrame = () => {
    if (settleReleaseHandle !== 0) return;
    settleReleaseHandle = getRequestAnimationFrame()(holdSettleRelease);
  };

  const holdSettleRelease = () => {
    settleReleaseHandle = 0;
    if (!settleRelease) return;

    commit(settleRelease.settlingFrame, { publish: false });
    recordFlightTick(settleRelease.settlingFrame);

    const snapshot = readSettleSnapshot();
    const stableFrameCount = areSettleSnapshotsEqual(
      settleRelease.lastSnapshot,
      snapshot,
    )
      ? settleRelease.stableFrameCount + 1
      : 0;
    const remainingFrameCount = settleRelease.remainingFrameCount - 1;

    if (
      stableFrameCount >= FILE_VIEWER_SETTLE_STABLE_FRAME_COUNT ||
      remainingFrameCount <= 0
    ) {
      const idleFrame = settleRelease.idleFrame;
      settleRelease = null;
      // Natural completion: close the flight record so the next motion does
      // not mark this one interrupted.
      activeFlightRecord = null;
      commit(idleFrame);
      return;
    }

    settleRelease = {
      ...settleRelease,
      lastSnapshot: snapshot,
      remainingFrameCount,
      stableFrameCount,
    };
    scheduleSettleReleaseFrame();
  };

  // The event carries the kernel's LIVE frame so renderers can capture their
  // pre-commit anchor against what is actually on screen — during a mid-flight
  // retarget that is the settled layout PLUS the in-flight transform, not the
  // settled layout alone.
  const dispatchBeforeLayoutMotion = (currentFrame: FileViewerMotionFrame) => {
    documentSurface?.element.dispatchEvent(
      new CustomEvent<FileViewerMotionFrame>(
        FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
        { detail: currentFrame },
      ),
    );
  };

  const interruptActiveFlightRecord = () => {
    if (!activeFlightRecord) return;
    activeFlightRecord.interrupted = true;
    activeFlightRecord = null;
  };

  const retarget = (nextTarget: FileViewerMotionTarget, animate: boolean) => {
    cancelSettleRelease();
    // Continuity is with what is PAINTED, not with the clock: mid-flight the
    // screen shows the last tick's commit (`interactiveFrame`), which can be
    // a frame behind a fresh clock sample. Planning (and the before-motion
    // capture renderers do off the event detail) from the painted frame keeps
    // the retarget hand-off pixel-continuous; the new motion simply re-lerps
    // from the painted geometry.
    const currentFrame =
      interactiveFrame.shellInlineSize > 0
        ? interactiveFrame
        : createFileViewerIdleMotionFrame(
            createFileViewerMotionRestFrame(target),
          );
    const plan = createFileViewerMotionPlan({
      animate: animate && !prefersReducedMotion(),
      currentFrame,
      nextTarget,
    });
    if (shouldDispatchBeforeLayoutMotion(plan)) {
      dispatchBeforeLayoutMotion(currentFrame);
    }
    target = plan.resolvedTarget;

    if (!plan.shouldAnimate) {
      if (activeMotion) interruptActiveFlightRecord();
      activeMotion = null;
      cancelTick();
      commit(createFileViewerIdleMotionFrame(plan.nextRestFrame));
      return;
    }

    motionSequence += 1;
    activeMotion = {
      durationMs: plan.resolvedTarget.durationMs,
      from: { ...plan.currentRestFrame, layoutInlineSize: plan.fromInlineSize },
      hasFrameClockAnchor: false,
      id: motionSequence,
      startedAt: readNow(),
      to: plan.nextRestFrame,
    };
    beginFlightRecord(activeMotion);
    const startFrame = readMotionSample(activeMotion, activeMotion.startedAt);
    // Commit the discontinuity while it cannot be seen: flush the first
    // sliding frame synchronously (inside the toggle's own task) so renderers
    // lay out at the target width and rebase scroll before first paint, hidden
    // behind the counter-transform written above in the same task.
    writeElementStyles(startFrame);
    interactiveFrame = startFrame;
    recordFlightTick(startFrame, activeMotion.startedAt);
    publishContractFrame(startFrame, { flushSubscribers: true });
    scheduleTick();
  };

  const syncTarget = (nextTarget: FileViewerMotionTarget) => {
    const nextRestFrame = createFileViewerMotionRestFrame(nextTarget);

    if (activeMotion) {
      target = nextTarget;
      if (areFileViewerMotionRestFramesEqual(activeMotion.to, nextRestFrame)) {
        return;
      }
      // A mode flip mid-motion (breakpoint crossing during the slide) cannot
      // be animated: React re-renders the new mode immediately, so an inline
      // slide continuing against overlay DOM (or vice versa) double-moves the
      // surface. Snap to the new rest geometry instead.
      if (nextRestFrame.mode !== activeMotion.to.mode) {
        interruptActiveFlightRecord();
        activeMotion = null;
        cancelTick();
        cancelSettleRelease();
        commit(createFileViewerIdleMotionFrame(nextRestFrame));
        return;
      }
      retarget(nextTarget, true);
      return;
    }

    cancelSettleRelease();
    target = nextTarget;
    commit(createFileViewerIdleMotionFrame(nextRestFrame));
  };

  return {
    getFlightRecords: () => flightRecords.slice(),
    getInteractiveSnapshot: () =>
      activeMotion ? readMotionSample(activeMotion) : interactiveFrame,
    getSnapshot: () => contractFrame,
    setDocumentSurface: (surface) => {
      const previousSurface = documentSurface;
      if (
        previousSurface &&
        (!surface || previousSurface.element !== surface.element)
      ) {
        clearDocumentSurfaceStyle(previousSurface.element);
      }
      documentSurface = surface;
      writeDocumentSurfaceStyle(interactiveFrame);
    },
    setSidebarGapElement: (element) => {
      sidebarGapElement = element;
      writeSidebarGapStyle(interactiveFrame);
    },
    startMotion: (nextTarget) => retarget(nextTarget, true),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncTarget,
  };

  function writeSidebarGapStyle(nextFrame: FileViewerMotionFrame) {
    if (!sidebarGapElement) return;

    // Overlay motion is CSS-owned; relinquish the gap so its `w-0` class is
    // the only writer outside inline mode.
    if (nextFrame.mode !== "inline") {
      sidebarGapElement.style.width = "";
      sidebarGapElement.style.flexBasis = "";
      return;
    }

    sidebarGapElement.style.width = `${nextFrame.sidebarInlineSize}px`;
    sidebarGapElement.style.flexBasis = `${nextFrame.sidebarInlineSize}px`;
  }

  function writeDocumentSurfaceStyle(nextFrame: FileViewerMotionFrame) {
    if (!documentSurface) return;

    const { element, resolveMotionStyle } = documentSurface;
    const resolvedStyle = resolveMotionStyle?.(nextFrame);
    if (resolvedStyle) {
      writeDocumentSurfaceCustomProperties(
        element,
        resolvedStyle.customProperties,
      );
      element.style.transform = resolvedStyle.transform;
      element.style.transformOrigin = resolvedStyle.transformOrigin;
      element.style.willChange = resolvedStyle.willChange;
      return;
    }

    // Default (no motion resolver): identity. Fit-width renderers register
    // the shared commit-then-relax resolver (file-viewer-fit-width-motion);
    // a surface without one either tracks the live DOM width on its own or
    // opts out of shell motion entirely, and must not be transformed here.
    writeDocumentSurfaceCustomProperties(element, null);
    element.style.transform = "";
    element.style.transformOrigin = "";
    element.style.willChange = "";
  }

  function writeDocumentSurfaceCustomProperties(
    element: HTMLElement,
    customProperties:
      | Readonly<Record<string, string | null>>
      | null
      | undefined,
  ) {
    const nextNames = new Set(Object.keys(customProperties ?? {}));
    for (const name of documentSurfaceCustomProperties) {
      if (!nextNames.has(name)) {
        element.style.removeProperty(name);
      }
    }

    for (const [name, value] of Object.entries(customProperties ?? {})) {
      if (value == null) {
        element.style.removeProperty(name);
      } else {
        element.style.setProperty(name, value);
      }
    }

    documentSurfaceCustomProperties = nextNames;
  }

  function clearDocumentSurfaceStyle(element: HTMLElement) {
    element.style.transform = "";
    element.style.transformOrigin = "";
    element.style.willChange = "";
    for (const name of documentSurfaceCustomProperties) {
      element.style.removeProperty(name);
    }
    documentSurfaceCustomProperties = new Set();
  }

  function readSettleSnapshot(): readonly number[] {
    const values: number[] = [];

    appendElementRectSnapshot(values, sidebarGapElement);
    appendElementRectSnapshot(values, documentSurface?.element ?? null);

    try {
      const surfaceSnapshot = documentSurface?.readSettleSnapshot?.();
      if (surfaceSnapshot) {
        values.push(...surfaceSnapshot.map(toSettleSnapshotNumber));
      }
    } catch {
      // A renderer snapshot is diagnostic, not correctness-critical. If a
      // renderer unmounts while settling, fall back to shell geometry.
    }

    return values.length > 0 ? values : [0];
  }

  function appendElementRectSnapshot(
    values: number[],
    element: HTMLElement | null,
  ) {
    if (!readElementRectSnapshot || !element) return;
    for (const value of readElementRectSnapshot(element)) {
      values.push(toSettleSnapshotNumber(value));
    }
  }
}

function areSettleSnapshotsEqual(
  previous: readonly number[],
  next: readonly number[],
) {
  if (previous.length !== next.length) return false;
  return previous.every(
    (value, index) =>
      Math.abs(value - next[index]) <= FILE_VIEWER_SETTLE_SCROLL_EPSILON_PX,
  );
}

function toSettleSnapshotNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function shouldDispatchBeforeLayoutMotion({
  currentRestFrame,
  nextRestFrame,
}: FileViewerMotionPlan) {
  return (
    currentRestFrame.mode === "inline" &&
    nextRestFrame.mode === "inline" &&
    Math.abs(
      currentRestFrame.layoutInlineSize - nextRestFrame.layoutInlineSize,
    ) > 0.001
  );
}

export function useFileViewerMotionFrame(
  kernel: FileViewerMotionKernel | null | undefined,
): FileViewerMotionFrame {
  const subscribe = React.useCallback(
    (listener: () => void) => kernel?.subscribe(listener) ?? (() => {}),
    [kernel],
  );
  const getSnapshot = React.useCallback(
    () => kernel?.getSnapshot() ?? DEFAULT_FILE_VIEWER_MOTION_FRAME,
    [kernel],
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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

function getRequestAnimationFrame() {
  return (
    globalThis.requestAnimationFrame ??
    ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(readNow()), 16))
  );
}

function getCancelAnimationFrame() {
  return (
    globalThis.cancelAnimationFrame ??
    ((id: number) => {
      window.clearTimeout(id);
    })
  );
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
