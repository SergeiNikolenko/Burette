"use client";

import type {
  FileViewerSidebarMode,
  FileViewerSidebarSide,
} from "./file-viewer-context";

export const FILE_VIEWER_MOTION_EPSILON = 0.5;

// The one duration for every sidebar motion timeline — the kernel clock, the
// motion targets, and the overlay panel's CSS transition all read this value.
export const FILE_VIEWER_MOTION_DURATION_MS = 150;

// The one easing for every sidebar motion timeline. Cubic ease-out: the slide
// decelerates into rest. Linear progress ends at full velocity, and content
// far from the reading anchor (the bottom of a tall fit-width document)
// travels several pixels per millisecond straight into a hard stop — a
// visible jolt the anchor line never shows.
export function easeFileViewerMotion(timeProgress: number) {
  return 1 - (1 - timeProgress) ** 3;
}

export type FileViewerMotionPhase = "idle" | "sliding" | "settling";

export type FileViewerMotionTarget = {
  shellInlineSize: number;
  durationMs: number;
  mode: FileViewerSidebarMode;
  open: boolean;
  side: FileViewerSidebarSide;
  sidebarWidth: number;
};

export type FileViewerMotionFrame = {
  shellInlineSize: number;
  durationMs: number;
  fromInlineSize: number;
  layoutInlineSize: number;
  mode: FileViewerSidebarMode;
  motionId: number | null;
  motionProgress: number;
  open: boolean;
  phase: FileViewerMotionPhase;
  side: FileViewerSidebarSide;
  sidebarInlineSize: number;
  sidebarWidth: number;
  toInlineSize: number;
};

export type FileViewerMotionRestFrame = Pick<
  FileViewerMotionFrame,
  | "shellInlineSize"
  | "durationMs"
  | "layoutInlineSize"
  | "mode"
  | "open"
  | "side"
  | "sidebarInlineSize"
  | "sidebarWidth"
>;

export type FileViewerMotionPlan = {
  currentRestFrame: FileViewerMotionRestFrame;
  fromInlineSize: number;
  nextRestFrame: FileViewerMotionRestFrame;
  resolvedTarget: FileViewerMotionTarget;
  shouldAnimate: boolean;
};

export function createFileViewerMotionRestFrame(
  target: FileViewerMotionTarget,
): FileViewerMotionRestFrame {
  const shellInlineSize = target.shellInlineSize;
  const sidebarInlineSize =
    target.mode === "inline" && target.open
      ? Math.min(target.sidebarWidth, shellInlineSize)
      : 0;

  return {
    shellInlineSize,
    durationMs: target.durationMs,
    layoutInlineSize: Math.max(0, shellInlineSize - sidebarInlineSize),
    mode: target.mode,
    open: target.open,
    side: target.side,
    sidebarInlineSize,
    sidebarWidth: target.sidebarWidth,
  };
}

export function createFileViewerIdleMotionFrame(
  restFrame: FileViewerMotionRestFrame,
): FileViewerMotionFrame {
  return {
    ...restFrame,
    fromInlineSize: restFrame.layoutInlineSize,
    motionId: null,
    motionProgress: 1,
    phase: "idle",
    toInlineSize: restFrame.layoutInlineSize,
  };
}

export function getFileViewerMotionRasterInlineSize(
  frame: Pick<
    FileViewerMotionFrame,
    "fromInlineSize" | "layoutInlineSize" | "toInlineSize"
  >,
): number {
  return Math.max(
    frame.fromInlineSize,
    frame.toInlineSize,
    frame.layoutInlineSize,
  );
}

export function createFileViewerMotionPlan({
  animate,
  currentFrame,
  nextTarget,
}: {
  animate: boolean;
  currentFrame: FileViewerMotionFrame;
  nextTarget: FileViewerMotionTarget;
}): FileViewerMotionPlan {
  const resolvedTarget = resolveFileViewerMotionTarget({
    currentFrame,
    nextTarget,
  });
  const currentRestFrame = pickFileViewerMotionRestFrame(currentFrame);
  const nextRestFrame = createFileViewerMotionRestFrame(resolvedTarget);
  // The motion's visual origin is what is on screen RIGHT NOW: for a fresh
  // motion that is the rest layout; for a mid-flight retarget it is the live
  // interpolated width, so the new motion's first frame (and every renderer's
  // anchor solve) continues from the picture the reader is looking at rather
  // than the interrupted motion's origin.
  const fromInlineSize =
    currentFrame.phase === "sliding"
      ? currentFrame.layoutInlineSize
      : currentRestFrame.layoutInlineSize;
  const shouldAnimate =
    animate &&
    resolvedTarget.mode === "inline" &&
    currentFrame.shellInlineSize > 0 &&
    Math.abs(
      currentRestFrame.sidebarInlineSize - nextRestFrame.sidebarInlineSize,
    ) > FILE_VIEWER_MOTION_EPSILON &&
    resolvedTarget.durationMs > 0;

  return {
    currentRestFrame,
    fromInlineSize,
    nextRestFrame,
    resolvedTarget,
    shouldAnimate,
  };
}

export function areFileViewerMotionRestFramesEqual(
  previous: FileViewerMotionRestFrame,
  next: FileViewerMotionRestFrame,
) {
  return (
    areFileViewerMotionNumbersEqual(
      previous.shellInlineSize,
      next.shellInlineSize,
    ) &&
    previous.durationMs === next.durationMs &&
    areFileViewerMotionNumbersEqual(
      previous.layoutInlineSize,
      next.layoutInlineSize,
    ) &&
    previous.mode === next.mode &&
    previous.open === next.open &&
    previous.side === next.side &&
    areFileViewerMotionNumbersEqual(
      previous.sidebarInlineSize,
      next.sidebarInlineSize,
    ) &&
    areFileViewerMotionNumbersEqual(previous.sidebarWidth, next.sidebarWidth)
  );
}

export function areFileViewerMotionFramesEqual(
  previous: FileViewerMotionFrame,
  next: FileViewerMotionFrame,
) {
  return (
    areFileViewerMotionRestFramesEqual(previous, next) &&
    previous.motionId === next.motionId &&
    areFileViewerMotionNumbersEqual(
      previous.motionProgress,
      next.motionProgress,
    ) &&
    previous.phase === next.phase &&
    areFileViewerMotionNumbersEqual(
      previous.fromInlineSize,
      next.fromInlineSize,
    ) &&
    areFileViewerMotionNumbersEqual(previous.toInlineSize, next.toInlineSize)
  );
}

function pickFileViewerMotionRestFrame(
  frame: FileViewerMotionFrame,
): FileViewerMotionRestFrame {
  return {
    shellInlineSize: frame.shellInlineSize,
    durationMs: frame.durationMs,
    layoutInlineSize: frame.layoutInlineSize,
    mode: frame.mode,
    open: frame.open,
    side: frame.side,
    sidebarInlineSize: frame.sidebarInlineSize,
    sidebarWidth: frame.sidebarWidth,
  };
}

function resolveFileViewerMotionTarget({
  currentFrame,
  nextTarget,
}: {
  currentFrame: FileViewerMotionFrame;
  nextTarget: FileViewerMotionTarget;
}): FileViewerMotionTarget {
  if (
    nextTarget.mode !== "overlay" ||
    currentFrame.mode !== "inline" ||
    currentFrame.shellInlineSize <= 0
  ) {
    return nextTarget;
  }

  return {
    ...nextTarget,
    shellInlineSize:
      nextTarget.shellInlineSize > 0
        ? nextTarget.shellInlineSize
        : currentFrame.shellInlineSize,
    mode: "inline",
  };
}

function areFileViewerMotionNumbersEqual(previous: number, next: number) {
  return Math.abs(previous - next) <= 0.001;
}
