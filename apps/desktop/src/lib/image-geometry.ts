export type QuarterTurn = 0 | 90 | 180 | 270;

export interface Size {
  width: number;
  height: number;
}

export interface NormalizedBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FrameOverlayProps {
  frameNumber: number;
  frameRect: Size;
  scale: number;
  rotation: QuarterTurn;
}

export function normalizeRotation(rotation: number): QuarterTurn {
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return 0;
}

export function isRotatedSideways(rotation: QuarterTurn): boolean {
  return rotation === 90 || rotation === 270;
}

export function rotatedSize(size: Size, rotation: QuarterTurn): Size {
  return isRotatedSideways(rotation)
    ? { width: size.height, height: size.width }
    : size;
}

/** Device pixels per CSS pixel; anything unusable reads as a 1x screen. */
export function normalizePixelRatio(pixelRatio: number | undefined): number {
  return pixelRatio !== undefined &&
    Number.isFinite(pixelRatio) &&
    pixelRatio > 0
    ? pixelRatio
    : 1;
}

/**
 * The frame's size in CSS pixels at 100%. A raster's intrinsic size counts
 * device pixels, so a @2x screenshot spans half as many CSS pixels as it has
 * pixels: "100%" means the size the image was captured at, not twice that on
 * a Retina screen.
 */
export function logicalFrameSize(
  intrinsicSize: Size,
  pixelRatio: number,
): Size {
  const ratio = normalizePixelRatio(pixelRatio);
  return {
    width: intrinsicSize.width / ratio,
    height: intrinsicSize.height / ratio,
  };
}

/**
 * The frame's CSS box for a display scale: 1 is one CSS pixel per logical
 * image pixel (`logicalFrameSize`). `pixelRatio` defaults to 1 for callers
 * that already work in logical pixels.
 */
export function frameCssSize(
  intrinsicSize: Size,
  scale: number,
  rotation: QuarterTurn,
  pixelRatio = 1,
): Size {
  const size = rotatedSize(
    logicalFrameSize(intrinsicSize, pixelRatio),
    rotation,
  );
  return {
    width: size.width * scale,
    height: size.height * scale,
  };
}

/**
 * Device pixels the canvas backing store draws per intrinsic pixel. The
 * frame lays out at `scale / pixelRatio` CSS pixels per intrinsic pixel and
 * the backing covers that box at `pixelRatio` device pixels per CSS pixel,
 * so the ratios cancel: the backing scale is the display scale itself, capped
 * at intrinsic resolution (one resample generation, whatever the screen).
 */
export function frameBackingScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? Math.min(scale, 1) : 1;
}

export function rotateNormalizedBox(
  box: NormalizedBox,
  rotation: QuarterTurn,
): NormalizedBox {
  if (rotation === 90) {
    return {
      left: 1 - box.top - box.height,
      top: box.left,
      width: box.height,
      height: box.width,
    };
  }
  if (rotation === 180) {
    return {
      left: 1 - box.left - box.width,
      top: 1 - box.top - box.height,
      width: box.width,
      height: box.height,
    };
  }
  if (rotation === 270) {
    return {
      left: box.top,
      top: 1 - box.left - box.width,
      width: box.height,
      height: box.width,
    };
  }
  return box;
}

export function frameNumberToIndex(frameNumber: number): number {
  if (!Number.isFinite(frameNumber)) return 0;
  return Math.max(0, Math.floor(frameNumber) - 1);
}

export function frameIndexToNumber(frameIndex: number): number {
  return frameIndex + 1;
}
