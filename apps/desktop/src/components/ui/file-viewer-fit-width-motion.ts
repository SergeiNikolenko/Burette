"use client";

import type { FileViewerDocumentSurfaceMotionResolver } from "./file-viewer-motion-kernel";
import type { FileViewerMotionFrame } from "./file-viewer-motion-plan";
import type {
  FileViewerDocumentAlign,
  FileViewerInlineDirection,
} from "./file-viewer-renderer-contract";

export const FILE_VIEWER_FIT_WIDTH_ANCHOR_BLOCK_PROPERTY =
  "--file-viewer-fit-width-anchor-block";

// Commit-then-relax: the renderer lays out at the motion's TARGET width from
// the first commit, and this resolver reprojects that settled layout to the
// in-flight visual width with one uniform transform. The transform terminates
// on identity, so settle removes a no-op style instead of committing layout.
//
// The anchor custom property is the reading line's block offset in the settled
// stage's own coordinates (post-rebase scrollTop + marker offset). It is read
// live via var(), so the renderer writes it once per motion (in a layout
// effect after the slide-start scroll rebase) without re-entering the kernel.
export function createFileViewerFitWidthSurfaceMotionResolver({
  align,
  anchorBlockProperty = FILE_VIEWER_FIT_WIDTH_ANCHOR_BLOCK_PROPERTY,
  direction = "ltr",
  isFitWidth,
  stageInlineSize,
  stageOuterInlinePadding = 0,
  stageInlinePadding = 0,
  stageInlineSlope = 1,
  stageBlockSlope = stageInlineSlope,
}: {
  align: FileViewerDocumentAlign;
  anchorBlockProperty?: string;
  direction?: FileViewerInlineDirection;
  isFitWidth: boolean;
  stageInlineSize: number;
  /** Constant symmetric padding around the transformed stage. */
  stageOuterInlinePadding?: number;
  /** Constant symmetric inline padding inside the transformed stage. */
  stageInlinePadding?: number;
  stageInlineSlope?: number;
  /**
   * Slope for the BLOCK axis when it differs from the inline one. A stage
   * whose inline box carries constant padding while its block stack scales
   * with the content (the image viewer: fit subtracts the horizontal
   * padding, vertical gaps/padding scale) has two different affine models —
   * X tracks the pane 1:1 while Y scales by the content ratio — and a
   * uniform scale cannot land both axes exactly. Defaults to the inline
   * slope (uniform scale) for fully proportional stages like the PDF.
   */
  stageBlockSlope?: number;
}): FileViewerDocumentSurfaceMotionResolver {
  return (frame) => {
    if (!isFitWidth || frame.phase !== "sliding") {
      return {
        transform: "",
        transformOrigin: "",
        willChange: "",
      };
    }

    return {
      transform: getFileViewerFitWidthSurfaceMotionTransform({
        align,
        anchorBlockProperty,
        direction,
        frame,
        stageInlineSize,
        stageOuterInlinePadding,
        stageInlinePadding,
        stageInlineSlope,
        stageBlockSlope,
      }),
      transformOrigin: "0px 0px",
      willChange: "transform",
    };
  };
}

// Commit-then-relax for a CLAMPED reading column rather than a fit-width
// stage: the stage's inline size is min(canvas, maxStageInlineSize), so it
// does not scale with the pane — the only thing a width change moves is the
// align margin. The canvas commits the motion's TARGET width from the first
// sliding frame (minWidth under layoutPolicy "target"), which means a
// widening pane's chunks land at the settled margin synchronously with the
// click; this resolver reprojects them back to the live width's margin with
// a translate that terminates on identity. A narrowing pane never engages it
// (the canvas tracks the live width above its minWidth, so live and settled
// margins agree) — exactly the leg that already glides on layout.
export function createFileViewerAlignTranslateSurfaceMotionResolver({
  align,
  direction = "ltr",
  maxStageInlineSize,
}: {
  align: FileViewerDocumentAlign;
  direction?: FileViewerInlineDirection;
  /** The column's max inline size (the chunk's max-width, in px). */
  maxStageInlineSize: number;
}): FileViewerDocumentSurfaceMotionResolver {
  return (frame) => {
    if (frame.phase !== "sliding") {
      return {
        transform: "",
        transformOrigin: "",
        willChange: "",
      };
    }

    return {
      transform: getFileViewerAlignTranslateSurfaceMotionTransform({
        align,
        direction,
        frame,
        maxStageInlineSize,
      }),
      transformOrigin: "0px 0px",
      willChange: "transform",
    };
  };
}

function getFileViewerAlignTranslateSurfaceMotionTransform({
  align,
  direction,
  frame,
  maxStageInlineSize,
}: {
  align: FileViewerDocumentAlign;
  direction: FileViewerInlineDirection;
  frame: FileViewerMotionFrame;
  maxStageInlineSize: number;
}) {
  if (
    !Number.isFinite(maxStageInlineSize) ||
    maxStageInlineSize <= 0 ||
    frame.layoutInlineSize <= 0 ||
    frame.toInlineSize <= 0
  ) {
    return "";
  }

  // The canvas lays out at max(live, target): minWidth holds the committed
  // target under a still-narrow pane, and a pane wider than the target just
  // fills. The stage (reading column) centers/aligns INSIDE the canvas, and
  // an overflowing canvas itself pins to the pane's start edge — left in
  // LTR, right in RTL — so the stage's pane-space position carries the
  // canvas offset too.
  const canvasInlineSize = Math.max(frame.layoutInlineSize, frame.toInlineSize);
  const stageInlineSize = Math.min(canvasInlineSize, maxStageInlineSize);
  const canvasInlineOffset =
    direction === "rtl"
      ? Math.min(0, frame.layoutInlineSize - canvasInlineSize)
      : 0;
  const settledStageLeft =
    canvasInlineOffset +
    getFileViewerStageInlineMargin({
      align,
      availableInlineSize: canvasInlineSize,
      direction,
      stageInlineSize,
    });
  const liveStageLeft = getFileViewerStageInlineMargin({
    align,
    availableInlineSize: frame.layoutInlineSize,
    direction,
    stageInlineSize,
  });
  const translateX = liveStageLeft - settledStageLeft;

  if (Math.abs(translateX) <= 0.001) return "";

  return `translate3d(${formatFileViewerMotionPixel(translateX)}px, 0px, 0)`;
}

export function getFileViewerFitWidthScale({
  availableInlineSize,
  contentInlineSize,
  stageInlinePadding = 0,
}: {
  availableInlineSize: number;
  contentInlineSize: number;
  stageInlinePadding?: number;
}) {
  if (availableInlineSize <= 0 || contentInlineSize <= 0) return 1;

  const contentAvailableInlineSize = Math.max(
    1,
    availableInlineSize - stageInlinePadding,
  );
  return contentAvailableInlineSize / contentInlineSize;
}

// The visual scale the resolver renders for a given live width — the same
// affine reprojection as the transform itself. Renderers use it to reason
// about the on-screen state (anchor capture/solve) without duplicating the
// formula.
//
// stageInlineSlope is how many stage pixels the settled stage grows per pane
// pixel. It is 1 whenever the stage IS the fit-width content (image, docx,
// pptx, uniform-width PDFs: stage = pane − constant padding), but a stage
// that is WIDER than its fit basis grows faster than the pane — a PDF fits
// its FIRST page while the stage spans its WIDEST page, so a mixed-width
// document has slope maxBase/fitBase > 1. A unit-slope assumption there
// under-scales the first frame by (slope − 1)·delta/stage — measured as a
// ~7px content step at the anchor-hold frame of a 355-page prospectus.
export function getFileViewerFitWidthVisualScale({
  liveInlineSize,
  stageInlineSize,
  stageInlineSlope = 1,
  targetInlineSize,
}: {
  liveInlineSize: number;
  stageInlineSize: number;
  stageInlineSlope?: number;
  targetInlineSize: number;
}) {
  if (
    stageInlineSize <= 0 ||
    !Number.isFinite(liveInlineSize) ||
    !Number.isFinite(targetInlineSize)
  ) {
    return 1;
  }
  const slope =
    Number.isFinite(stageInlineSlope) && stageInlineSlope > 0
      ? stageInlineSlope
      : 1;
  return (
    Math.max(1, stageInlineSize + slope * (liveInlineSize - targetInlineSize)) /
    stageInlineSize
  );
}

// Capture side of the motion anchor: the probe content line's on-screen block
// offset relative to the scroll box, taken just before a motion (or retarget)
// commits. When a motion is already in flight the DOM is the settled layout
// PLUS the live transform, so the capture applies that transform — otherwise
// a retarget would solve continuity against a picture the reader never saw.
export function captureFileViewerFitWidthAnchorScreenOffset({
  lastAnchorBlock,
  liveFrame,
  probeStageOffset,
  scrollTop,
  stageInlineSize,
  stageInlinePadding = 0,
  stageBlockSlope = 1,
}: {
  lastAnchorBlock: number | null;
  liveFrame: FileViewerMotionFrame | null;
  probeStageOffset: number;
  scrollTop: number;
  stageInlineSize: number;
  stageInlinePadding?: number;
  /** The BLOCK-axis slope — anchor capture/solve is block-axis math. */
  stageBlockSlope?: number;
}) {
  const untransformed = probeStageOffset - scrollTop;
  if (!liveFrame || liveFrame.phase !== "sliding") return untransformed;

  const liveScale = getFileViewerFitWidthVisualScale({
    liveInlineSize: liveFrame.layoutInlineSize,
    stageInlineSize: getFileViewerFitWidthContentInlineSize({
      stageInlinePadding,
      stageInlineSize,
    }),
    stageInlineSlope: stageBlockSlope,
    targetInlineSize: liveFrame.toInlineSize,
  });
  if (Math.abs(1 - liveScale) <= 0.001) return untransformed;

  return (
    liveScale * probeStageOffset +
    (1 - liveScale) * (lastAnchorBlock ?? 0) -
    scrollTop
  );
}

// Solve side: the anchor block offset that puts the probe content line back on
// its captured screen position under the NEW layout model at the motion's
// first-frame scale. Exact regardless of how the rebase clamped or how the
// old/new layout models relate (measured page sizes, constant gaps/padding).
// Returns null when the motion is degenerate (caller falls back to the live
// reading marker).
export function resolveFileViewerFitWidthMotionAnchorBlock({
  fromInlineSize,
  probeScreenOffset,
  probeStageOffset,
  scrollTop,
  stageInlineSize,
  stageInlinePadding = 0,
  stageBlockSlope = 1,
  toInlineSize,
}: {
  fromInlineSize: number | null;
  probeScreenOffset: number;
  probeStageOffset: number;
  scrollTop: number;
  stageInlineSize: number;
  stageInlinePadding?: number;
  /** The BLOCK-axis slope — anchor capture/solve is block-axis math. */
  stageBlockSlope?: number;
  toInlineSize: number | null;
}) {
  if (fromInlineSize == null || toInlineSize == null) return null;

  const startScale = getFileViewerFitWidthVisualScale({
    liveInlineSize: fromInlineSize,
    stageInlineSize: getFileViewerFitWidthContentInlineSize({
      stageInlinePadding,
      stageInlineSize,
    }),
    stageInlineSlope: stageBlockSlope,
    targetInlineSize: toInlineSize,
  });
  if (!Number.isFinite(startScale) || Math.abs(1 - startScale) <= 0.001) {
    return null;
  }

  return (
    (probeScreenOffset + scrollTop - startScale * probeStageOffset) /
    (1 - startScale)
  );
}

function getFileViewerFitWidthSurfaceMotionTransform({
  align,
  anchorBlockProperty,
  direction,
  frame,
  stageInlineSize,
  stageOuterInlinePadding,
  stageInlinePadding,
  stageInlineSlope,
  stageBlockSlope,
}: {
  align: FileViewerDocumentAlign;
  anchorBlockProperty: string;
  direction: FileViewerInlineDirection;
  frame: FileViewerMotionFrame;
  stageInlineSize: number;
  stageOuterInlinePadding: number;
  stageInlinePadding: number;
  stageInlineSlope: number;
  stageBlockSlope: number;
}) {
  if (
    stageInlineSize <= 0 ||
    frame.layoutInlineSize <= 0 ||
    frame.toInlineSize <= 0
  ) {
    return "";
  }

  // Fit-width renderers size their stage as an affine function of the
  // available width (stage = slope × width − constant padding), so the
  // in-flight visual stage is the settled stage plus the scaled live width
  // delta. At the first frame this resolves to exactly the pre-toggle stage
  // size, and at the last frame to the settled stage — identity. Each axis
  // carries its own slope: they differ when the stage's inline box holds
  // constant padding while its block stack scales with the content.
  const contentInlineSize = getFileViewerFitWidthContentInlineSize({
    stageInlinePadding,
    stageInlineSize,
  });
  const inlineScale = getFileViewerFitWidthVisualScale({
    liveInlineSize: frame.layoutInlineSize,
    stageInlineSize: contentInlineSize,
    stageInlineSlope,
    targetInlineSize: frame.toInlineSize,
  });
  const blockScale = getFileViewerFitWidthVisualScale({
    liveInlineSize: frame.layoutInlineSize,
    stageInlineSize: contentInlineSize,
    stageInlineSlope: stageBlockSlope,
    targetInlineSize: frame.toInlineSize,
  });
  const visualStageInlineSize =
    inlineScale * contentInlineSize + stageInlinePadding;
  const availableStageInlineSize = Math.max(
    1,
    frame.layoutInlineSize - Math.max(0, stageOuterInlinePadding),
  );
  const settledMargin = getFileViewerStageInlineMargin({
    align,
    availableInlineSize: availableStageInlineSize,
    direction,
    stageInlineSize,
  });
  const visualMargin = getFileViewerStageInlineMargin({
    align,
    availableInlineSize: availableStageInlineSize,
    direction,
    stageInlineSize: visualStageInlineSize,
  });
  // The padding is constant in both endpoint layouts. Scaling the outer stage
  // would scale that inset too, making the visible page briefly too wide or
  // narrow on the first frame. Rebase the symmetric start inset so the inner
  // content edge, not the transparent wrapper edge, is pixel-continuous.
  const inlinePaddingStart = stageInlinePadding / 2;
  const translateX =
    visualMargin - settledMargin + (1 - inlineScale) * inlinePaddingStart;

  if (Math.abs(frame.layoutInlineSize - frame.toInlineSize) <= 0.001) {
    return "";
  }

  const formattedInlineScale = formatFileViewerMotionScale(inlineScale);
  const formattedBlockScale = formatFileViewerMotionScale(blockScale);
  const formattedTranslateX = formatFileViewerMotionPixel(translateX);
  // Scale about the stage origin; the anchor term keeps the reading line
  // fixed on the block axis: y' = s·y + (1 − s)·anchor equals y at
  // y = anchor.
  const translateY = `calc((1 - ${formattedBlockScale}) * var(${anchorBlockProperty}, 0px))`;
  const formattedScale =
    formattedInlineScale === formattedBlockScale
      ? formattedInlineScale
      : `${formattedInlineScale}, ${formattedBlockScale}`;

  return `translate3d(${formattedTranslateX}px, ${translateY}, 0) scale(${formattedScale})`;
}

function getFileViewerFitWidthContentInlineSize({
  stageInlinePadding,
  stageInlineSize,
}: {
  stageInlinePadding: number;
  stageInlineSize: number;
}) {
  const padding = Number.isFinite(stageInlinePadding)
    ? Math.max(0, stageInlinePadding)
    : 0;
  return Math.max(1, stageInlineSize - padding);
}

// Physical LEFT offset of the stage box inside the available inline size —
// translateX shifts along the physical X axis, so the model must speak
// physical-left in both directions. Stages align with physical auto margins
// (mx-auto for center, ml-auto for end, plain flow for start), so:
// - free space ≥ 0: center splits it; end pins right in both directions
//   (ml-auto is physical); start follows flow (left in LTR, right in RTL).
// - free space < 0 (the settled stage overflows the live container — the
//   close leg's early frames): auto margins collapse to 0 and CSS resolves
//   the over-constraint against the direction's end edge, pinning the box to
//   the start edge — left edge at 0 in LTR, at the negative free space in
//   RTL. The old unconditional max(0, …) clamp encoded only the LTR half and
//   made the RTL close leg overshoot by the overflow amount.
function getFileViewerStageInlineMargin({
  align,
  availableInlineSize,
  direction,
  stageInlineSize,
}: {
  align: FileViewerDocumentAlign;
  availableInlineSize: number;
  direction: FileViewerInlineDirection;
  stageInlineSize: number;
}) {
  const freeInlineSize = availableInlineSize - stageInlineSize;
  if (freeInlineSize < 0) return direction === "rtl" ? freeInlineSize : 0;

  switch (align) {
    case "start":
      return direction === "rtl" ? freeInlineSize : 0;
    case "end":
      return freeInlineSize;
    case "center":
      return freeInlineSize / 2;
  }
}

function formatFileViewerMotionPixel(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

function formatFileViewerMotionScale(value: number) {
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : "1";
}
