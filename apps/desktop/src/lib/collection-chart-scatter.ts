import { pointInPolygon, polygonBounds, type LassoPoint } from "./chemical-space-lasso";

// The scatter chart's per-frame work: project every row, paint it into a pixel
// buffer, and pick rows under the pointer. All of it is plain loops over typed
// arrays so 100k rows stay inside a frame without an index to rebuild on zoom.

export type ScatterView = { x0: number; x1: number; y0: number; y1: number };
/** The plot area in CSS pixels, inside the axis margins. */
export type PlotRect = { left: number; top: number; width: number; height: number };

const FIT_PADDING = 0.05;
const MAX_ZOOM_IN = 5_000;
const MAX_ZOOM_OUT = 4;

function paddedRange(min: number, max: number): [number, number] {
  const span = max - min;
  const pad = span > 0 ? span * FIT_PADDING : Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
  return [min - pad, max + pad];
}

/** The view that shows every included row that has both values. */
export function fitScatterView(xs: Float64Array, ys: Float64Array, include: Uint8Array): ScatterView | null {
  let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < xs.length; row += 1) {
    const x = xs[row];
    const y = ys[row];
    if (!include[row] || x !== x || y !== y) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX > maxX) return null;
  const [x0, x1] = paddedRange(minX, maxX);
  const [y0, y1] = paddedRange(minY, maxY);
  return { x0, x1, y0, y1 };
}

/** Zoom about a point given as fractions of the plot, measured from its left and bottom. */
export function zoomScatterView(
  view: ScatterView,
  factor: number,
  anchorX: number,
  anchorY: number,
  fit: ScatterView,
): ScatterView {
  const zoomAxis = (low: number, high: number, anchor: number, fitSpan: number) => {
    const span = high - low;
    const next = Math.min(fitSpan * MAX_ZOOM_OUT, Math.max(fitSpan / MAX_ZOOM_IN, span / factor));
    const pivot = low + span * anchor;
    return [pivot - next * anchor, pivot + next * (1 - anchor)] as const;
  };
  const [x0, x1] = zoomAxis(view.x0, view.x1, anchorX, fit.x1 - fit.x0);
  const [y0, y1] = zoomAxis(view.y0, view.y1, anchorY, fit.y1 - fit.y0);
  return { x0, x1, y0, y1 };
}

/** Shift the view by a pointer movement given as fractions of the plot size. */
export function panScatterView(view: ScatterView, dx: number, dy: number): ScatterView {
  const shiftX = -(view.x1 - view.x0) * dx;
  const shiftY = (view.y1 - view.y0) * dy;
  return { x0: view.x0 + shiftX, x1: view.x1 + shiftX, y0: view.y0 + shiftY, y1: view.y1 + shiftY };
}

/** Screen position of every row in CSS pixels; NaN where a row has no point. */
export function projectScatter(
  xs: Float64Array,
  ys: Float64Array,
  view: ScatterView,
  plot: PlotRect,
  screenX: Float32Array,
  screenY: Float32Array,
) {
  const scaleX = plot.width / (view.x1 - view.x0);
  const scaleY = plot.height / (view.y1 - view.y0);
  const bottom = plot.top + plot.height;
  for (let row = 0; row < xs.length; row += 1) {
    screenX[row] = plot.left + (xs[row] - view.x0) * scaleX;
    screenY[row] = bottom - (ys[row] - view.y0) * scaleY;
  }
}

export function nearestScatterRow(
  screenX: Float32Array,
  screenY: Float32Array,
  include: Uint8Array,
  x: number,
  y: number,
  maxDistance: number,
) {
  let best = -1;
  let bestDistance = maxDistance * maxDistance;
  for (let row = 0; row < screenX.length; row += 1) {
    if (!include[row]) continue;
    const dx = screenX[row] - x;
    const dy = screenY[row] - y;
    const distance = dx * dx + dy * dy;
    // NaN compares false, so rows without a point never win.
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = row;
    }
  }
  return best;
}

export function scatterRowsInPolygon(
  screenX: Float32Array,
  screenY: Float32Array,
  include: Uint8Array,
  polygon: LassoPoint[],
): number[] {
  if (polygon.length < 3) return [];
  const bounds = polygonBounds(polygon);
  const rows: number[] = [];
  const point = { x: 0, y: 0 };
  for (let row = 0; row < screenX.length; row += 1) {
    if (!include[row]) continue;
    const x = screenX[row];
    const y = screenY[row];
    if (!(x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY)) continue;
    point.x = x;
    point.y = y;
    if (pointInPolygon(point, polygon)) rows.push(row);
  }
  return rows;
}

/**
 * The pixels a point covers, as offsets from its centre. Cells that are at
 * least half covered come first: those are the ones a solid point fills.
 */
export type PointSprite = {
  extent: number;
  dx: Int8Array;
  dy: Int8Array;
  /** Coverage of each cell, 1–256, already scaled by the point's opacity. */
  alpha: Uint16Array;
  solidCount: number;
  /** dy × width + dx for the buffer width the sprite was last drawn into. */
  linear: Int32Array;
  linearWidth: number;
};

/** An antialiased disc, or a ring when `inner` is above zero. Radii are device pixels. */
export function pointSprite(radius: number, opacity: number, inner = 0): PointSprite {
  const extent = Math.max(1, Math.ceil(radius + 0.5));
  const cells: Array<{ dx: number; dy: number; coverage: number }> = [];
  for (let dy = -extent; dy <= extent; dy += 1) {
    for (let dx = -extent; dx <= extent; dx += 1) {
      const distance = Math.hypot(dx, dy);
      const outside = Math.min(1, Math.max(0, radius + 0.5 - distance));
      const inside = inner > 0 ? Math.min(1, Math.max(0, distance - inner + 0.5)) : 1;
      const coverage = outside * inside;
      if (Math.round(256 * opacity * coverage) > 0) cells.push({ dx, dy, coverage });
    }
  }
  const solid = cells.filter(cell => cell.coverage >= 0.5);
  const ordered = [...solid, ...cells.filter(cell => cell.coverage < 0.5)];
  return {
    extent,
    dx: Int8Array.from(ordered, cell => cell.dx),
    dy: Int8Array.from(ordered, cell => cell.dy),
    alpha: Uint16Array.from(ordered, cell => Math.round(256 * opacity * cell.coverage)),
    solidCount: solid.length,
    linear: new Int32Array(ordered.length),
    linearWidth: 0,
  };
}

export type ScatterRaster = {
  /** Little-endian RGBA pixels: 0xAABBGGRR. */
  pixels: Uint32Array;
  width: number;
  height: number;
  /** Device-pixel bounds points may touch: the plot area. */
  clip: { left: number; top: number; right: number; bottom: number };
  pixelRatio: number;
};

export type ScatterLayer = {
  /** Rows to draw in order, or null for every row. */
  rows: Int32Array | null;
  include: Uint8Array;
  /** 0x00BBGGRR per row. */
  colors: Uint32Array;
  /** Sprite of a row by its size level; one entry when sizes do not vary. */
  sprites: PointSprite[];
  sizeLevels: Uint8Array | null;
  /**
   * Fill the half-covered cells with the colour as it is instead of blending:
   * several times cheaper, for frames painted while the view is moving.
   */
  solid: boolean;
};

// Blends red+blue and green as two packed multiplies; the products stay below
// 2³² so the unsigned shift is exact. The destination is always opaque.
function blend(destination: number, color: number, coverage: number) {
  const rest = 256 - coverage;
  return 0xff000000
    | ((((color & 0xff00ff) * coverage + (destination & 0xff00ff) * rest) >>> 8) & 0xff00ff)
    | ((((color & 0x00ff00) * coverage + (destination & 0x00ff00) * rest) >>> 8) & 0x00ff00);
}

export function drawScatterLayer(raster: ScatterRaster, screenX: Float32Array, screenY: Float32Array, layer: ScatterLayer) {
  const { pixels, width, clip, pixelRatio } = raster;
  const { rows, include, colors, sprites, sizeLevels, solid } = layer;
  for (const sprite of sprites) {
    if (sprite.linearWidth === width) continue;
    for (let cell = 0; cell < sprite.linear.length; cell += 1) sprite.linear[cell] = sprite.dy[cell] * width + sprite.dx[cell];
    sprite.linearWidth = width;
  }
  const count = rows ? rows.length : screenX.length;
  for (let index = 0; index < count; index += 1) {
    const row = rows ? rows[index] : index;
    if (!include[row]) continue;
    const centerX = Math.round(screenX[row] * pixelRatio);
    const centerY = Math.round(screenY[row] * pixelRatio);
    const sprite = sprites[sizeLevels ? sizeLevels[row] : 0];
    const extent = sprite.extent;
    // Also false for NaN, which is how rows without a point drop out.
    if (!(centerX + extent >= clip.left && centerX - extent < clip.right
      && centerY + extent >= clip.top && centerY - extent < clip.bottom)) continue;
    const color = colors[row];
    const alpha = sprite.alpha;
    const cells = solid ? sprite.solidCount : alpha.length;
    if (centerX - extent >= clip.left && centerX + extent < clip.right
      && centerY - extent >= clip.top && centerY + extent < clip.bottom) {
      const linear = sprite.linear;
      const center = centerY * width + centerX;
      if (solid) {
        const paint = 0xff000000 | color;
        for (let cell = 0; cell < cells; cell += 1) pixels[center + linear[cell]] = paint;
      } else {
        for (let cell = 0; cell < cells; cell += 1) {
          const pixelIndex = center + linear[cell];
          pixels[pixelIndex] = blend(pixels[pixelIndex], color, alpha[cell]);
        }
      }
      continue;
    }
    // A point on the edge of the plot is clipped cell by cell.
    for (let cell = 0; cell < cells; cell += 1) {
      const x = centerX + sprite.dx[cell];
      const y = centerY + sprite.dy[cell];
      if (x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom) continue;
      const pixelIndex = y * width + x;
      pixels[pixelIndex] = solid ? 0xff000000 | color : blend(pixels[pixelIndex], color, alpha[cell]);
    }
  }
}

/** Colours as they look painted at `opacity` over an opaque background, for solid frames. */
export function mixedColors(colors: Uint32Array, background: number, opacity: number) {
  const coverage = Math.round(256 * opacity);
  return colors.map(color => blend(background, color, coverage) & 0xffffff);
}

/** A one-pixel horizontal line across the plot, blended like a point. */
export function drawScatterGridLine(raster: ScatterRaster, y: number, color: number, coverage: number) {
  const { pixels, width, clip } = raster;
  const row = Math.round(y * raster.pixelRatio);
  if (row < clip.top || row >= clip.bottom) return;
  for (let pixelIndex = row * width + clip.left, end = row * width + clip.right; pixelIndex < end; pixelIndex += 1) {
    pixels[pixelIndex] = blend(pixels[pixelIndex], color, coverage);
  }
}

/** Point radius in CSS pixels: dense collections get smaller, calmer points. */
export function scatterPointRadius(rowCount: number) {
  return Math.max(1.4, Math.min(3.4, 3.4 * Math.sqrt(1_500 / Math.max(1_500, rowCount))));
}

export function scatterPointOpacity(rowCount: number) {
  return Math.max(0.5, Math.min(0.8, 0.8 * Math.sqrt(2_500 / Math.max(2_500, rowCount))));
}

export const SCATTER_SIZE_LEVELS = 8;

/** Size level of every row: area grows with the value, blank rows take the smallest. */
export function scatterSizeLevels(values: Float64Array, min: number, max: number) {
  const levels = new Uint8Array(values.length);
  const span = max - min;
  for (let row = 0; row < values.length; row += 1) {
    const value = values[row];
    if (value !== value || !(span > 0)) continue;
    levels[row] = Math.min(SCATTER_SIZE_LEVELS - 1, Math.floor(((value - min) / span) * SCATTER_SIZE_LEVELS));
  }
  return levels;
}

/** Radius multiplier of a size level, from 0.6× to 2.4× the base radius. */
export function scatterSizeScale(level: number) {
  return 0.6 + 1.8 * Math.sqrt(level / (SCATTER_SIZE_LEVELS - 1));
}
