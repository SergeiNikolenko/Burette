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

export function frameCssSize(
  intrinsicSize: Size,
  scale: number,
  rotation: QuarterTurn,
): Size {
  const size = rotatedSize(intrinsicSize, rotation);
  return {
    width: size.width * scale,
    height: size.height * scale,
  };
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
