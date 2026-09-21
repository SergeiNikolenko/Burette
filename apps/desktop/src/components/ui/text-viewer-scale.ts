export const TEXT_VIEWER_MIN_SCALE = 0.1;
export const TEXT_VIEWER_MAX_SCALE = 5;
export const TEXT_VIEWER_BLOCK_PADDING = 8;

export function clampTextViewerScale(value: number) {
  return Math.min(
    TEXT_VIEWER_MAX_SCALE,
    Math.max(TEXT_VIEWER_MIN_SCALE, value),
  );
}
