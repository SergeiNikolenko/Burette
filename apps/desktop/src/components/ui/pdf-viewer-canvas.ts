export function getPdfCanvasPixelSize(
  cssSize: number,
  devicePixelRatio: number,
) {
  if (
    !Number.isFinite(cssSize) ||
    !Number.isFinite(devicePixelRatio) ||
    cssSize <= 0 ||
    devicePixelRatio <= 0
  ) {
    return 1;
  }
  return Math.max(1, Math.floor(cssSize * devicePixelRatio));
}
