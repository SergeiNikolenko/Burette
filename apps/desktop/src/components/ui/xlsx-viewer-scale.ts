import * as React from "react";

const XLSX_MIN_SCALE = 0.1;
const XLSX_MAX_SCALE = 5;
const XLSX_ZOOM_STEP = 1.2;

export function useXlsxScale() {
  const [scale, setScale] = React.useState(1);

  return {
    scale,
    zoomOut: React.useCallback(
      () => setScale((value) => clampXlsxScale(value / XLSX_ZOOM_STEP)),
      [],
    ),
    zoomIn: React.useCallback(
      () => setScale((value) => clampXlsxScale(value * XLSX_ZOOM_STEP)),
      [],
    ),
    resetZoom: React.useCallback(() => setScale(1), []),
  };
}

export function clampXlsxScale(value: number) {
  return Math.min(XLSX_MAX_SCALE, Math.max(XLSX_MIN_SCALE, value));
}
