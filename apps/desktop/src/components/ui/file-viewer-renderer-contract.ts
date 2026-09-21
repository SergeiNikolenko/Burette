"use client";

import {
  getFileViewerMotionRasterInlineSize,
  type FileViewerMotionFrame,
  type FileViewerMotionPhase,
} from "./file-viewer-motion-plan";
import type { ViewerDocumentTransition } from "./viewer-types";

export type FileViewerDocumentAlign = "start" | "center" | "end";

// Physical inline direction of the document frame (computed CSS `direction`).
// The fit-width motion transform works on the physical X axis, so it needs
// the direction to model where auto-margin alignment actually puts the stage.
export type FileViewerInlineDirection = "ltr" | "rtl";

// `phase` is the motion clock's state; `documentTransition` is the single
// spelling of the policies derived from it. Renderers read layout/scroll/
// visual decisions from the transition, never from duplicated top-level
// fields. `isTransitioning` is shorthand for `phase === "sliding"`.
export type FileViewerRendererFrame = {
  align: FileViewerDocumentAlign;
  canToggleSidebar: boolean;
  direction: FileViewerInlineDirection;
  documentTransition: ViewerDocumentTransition;
  element: HTMLDivElement | null;
  fromInlineSize: number | null;
  isTransitioning: boolean;
  layoutInlineSize: number | null;
  motionDurationMs: number;
  phase: FileViewerMotionPhase;
  rasterInlineSize: number | null;
  settledInlineSize: number | null;
  shellInlineSize: number | null;
  toInlineSize: number | null;
  usesShellGeometry: boolean;
};

export function resolveFileViewerRendererLayoutInlineSize({
  fallbackInlineSize,
  rendererFrame,
}: {
  fallbackInlineSize: number | null;
  rendererFrame: FileViewerRendererFrame;
}) {
  const fallbackSize = resolveMeasuredInlineSize(fallbackInlineSize);

  // Commit-then-relax: the renderer lays out at the motion's TARGET width for
  // the entire motion (layoutPolicy "target" from the first sliding frame).
  // The in-flight visual is the surface motion transform reprojecting that
  // settled layout, so settle never commits layout.
  if (
    rendererFrame.documentTransition.layoutPolicy === "target" &&
    rendererFrame.toInlineSize != null
  ) {
    return rendererFrame.toInlineSize;
  }

  return rendererFrame.layoutInlineSize ?? fallbackSize;
}

export function createFileViewerRendererFrame({
  align,
  canToggleSidebar,
  direction = "ltr",
  element,
  fallbackInlineSize,
  motionFrame,
  motionDurationMs,
  usesShellGeometry,
}: {
  align: FileViewerDocumentAlign;
  canToggleSidebar: boolean;
  direction?: FileViewerInlineDirection;
  element: HTMLDivElement | null;
  fallbackInlineSize: number | null;
  motionFrame: FileViewerMotionFrame;
  motionDurationMs: number;
  usesShellGeometry: boolean;
}): FileViewerRendererFrame {
  const measuredInlineSize = resolveMeasuredInlineSize(fallbackInlineSize);
  const shellInlineSize = usesShellGeometry
    ? motionFrame.shellInlineSize
    : null;
  const layoutInlineSize = usesShellGeometry
    ? motionFrame.layoutInlineSize
    : measuredInlineSize;
  const settledInlineSize = usesShellGeometry
    ? motionFrame.toInlineSize
    : measuredInlineSize;
  const rasterInlineSize = usesShellGeometry
    ? getFileViewerMotionRasterInlineSize(motionFrame)
    : layoutInlineSize;
  const fromInlineSize = usesShellGeometry
    ? motionFrame.fromInlineSize
    : settledInlineSize;
  const toInlineSize = usesShellGeometry
    ? motionFrame.toInlineSize
    : settledInlineSize;
  const documentTransition = createFileViewerRendererTransition({
    motionFrame,
    usesShellGeometry,
  });

  const phase = usesShellGeometry ? motionFrame.phase : "idle";

  return {
    align,
    canToggleSidebar,
    direction,
    documentTransition,
    element,
    fromInlineSize,
    isTransitioning: phase === "sliding",
    layoutInlineSize,
    motionDurationMs,
    phase,
    rasterInlineSize,
    settledInlineSize: settledInlineSize ?? layoutInlineSize,
    shellInlineSize,
    toInlineSize: toInlineSize ?? layoutInlineSize,
    usesShellGeometry,
  };
}

function resolveMeasuredInlineSize(inlineSize: number | null | undefined) {
  return inlineSize != null && Number.isFinite(inlineSize) && inlineSize > 0
    ? inlineSize
    : null;
}

function createFileViewerRendererTransition({
  motionFrame,
  usesShellGeometry,
}: {
  motionFrame: FileViewerMotionFrame;
  usesShellGeometry: boolean;
}): ViewerDocumentTransition {
  if (!usesShellGeometry) {
    return {
      layoutPolicy: "live",
      scrollPolicy: "preserve",
      source: "none",
      transitionId: null,
      visualPolicy: "none",
    };
  }

  switch (motionFrame.phase) {
    // Sliding commits the TARGET layout immediately (inside the toggle's own
    // task, before first paint) and rebases scroll to the reading anchor in
    // the same commit; the shell transform hides the jump. Settling then has
    // no layout or scroll work left — it only clears the identity transform.
    case "sliding":
      return {
        layoutPolicy: "target",
        scrollPolicy: "rebase",
        source: "viewer-shell",
        transitionId: motionFrame.motionId,
        visualPolicy: "shell-transform",
      };
    case "settling":
      return {
        layoutPolicy: "target",
        scrollPolicy: "rebase",
        source: "viewer-shell",
        transitionId: motionFrame.motionId,
        visualPolicy: "shell-transform",
      };
    case "idle":
      return {
        layoutPolicy: "live",
        scrollPolicy: "preserve",
        source: "none",
        transitionId: null,
        visualPolicy: "none",
      };
  }
}
