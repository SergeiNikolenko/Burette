import { expect, test } from "bun:test";
import { histogramChart } from "../apps/desktop/src/lib/collection-chart-bands";
import { rowColors } from "../apps/desktop/src/lib/collection-chart-color";
import { categorySeries, numericSeries, rowMask, type ChartTable } from "../apps/desktop/src/lib/collection-chart-data";
import {
  drawScatterLayer,
  fitScatterView,
  mixedColors,
  nearestScatterRow,
  panScatterView,
  pointSprite,
  projectScatter,
  scatterPointOpacity,
  scatterPointRadius,
  scatterRowsInPolygon,
  zoomScatterView,
  type ScatterView,
} from "../apps/desktop/src/lib/collection-chart-scatter";

// A dock at its largest: 1600 × 700 CSS pixels on a 2× display.
const WIDTH = 1600;
const HEIGHT = 700;
const PIXEL_RATIO = 2;
const FRAME_BUDGET_MS = 1000 / 60;
const plot = { left: 60, top: 10, width: WIDTH - 74, height: HEIGHT - 50 };

// A deterministic generator, so every run measures the same picture.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function synthetic(rowCount: number) {
  const next = random(rowCount);
  const gaussian = () => (next() + next() + next() + next() - 2) * 1.2;
  const weight = Array.from({ length: rowCount }, () => 320 + gaussian() * 90);
  const logP = weight.map(value => (value - 320) / 80 + gaussian() * 1.5);
  const series = Array.from({ length: rowCount }, () => `Series ${1 + Math.floor(next() * 8)}`);
  return {
    x: numericSeries(weight, rowCount),
    y: numericSeries(logP, rowCount),
    category: categorySeries(series, rowCount),
  };
}

function median(samples: number[]) {
  return samples.sort((left, right) => left - right)[Math.floor(samples.length / 2)];
}

// One pan-and-zoom frame exactly as the chart paints it: clear the buffer,
// project every row, paint the unselected rows dimmed and the selected ones on
// top with their ring, then find the row under the pointer.
function measureFrames(rowCount: number, solid: boolean) {
  const data = synthetic(rowCount);
  const include = new Uint8Array(rowCount).fill(1);
  const selected = Uint8Array.from({ length: rowCount }, (_, row) => row % 10 === 0 ? 1 : 0);
  const unselected = Uint8Array.from(selected, flag => flag ? 0 : 1);
  const selectedRows = Int32Array.from({ length: Math.ceil(rowCount / 10) }, (_, index) => index * 10);
  const colors = rowColors(data.category, rowCount);
  const ringColors = new Uint32Array(rowCount).fill(0x202020);
  const radius = scatterPointRadius(rowCount) * PIXEL_RATIO;
  const opacity = scatterPointOpacity(rowCount);
  const sprites = {
    dim: [pointSprite(radius, opacity * 0.3)],
    strong: [pointSprite(radius + 0.5 * PIXEL_RATIO, 1)],
    ring: [pointSprite(radius + 1.75 * PIXEL_RATIO, 1, radius + 0.75 * PIXEL_RATIO)],
  };
  // Moving frames fill solid points with the colour the soft ones settle to.
  const dimColors = solid ? mixedColors(colors, 0xffffff, opacity * 0.3) : colors;
  const pixels = new Uint32Array(WIDTH * PIXEL_RATIO * HEIGHT * PIXEL_RATIO);
  const raster = {
    pixels, width: WIDTH * PIXEL_RATIO, height: HEIGHT * PIXEL_RATIO, pixelRatio: PIXEL_RATIO,
    clip: {
      left: plot.left * PIXEL_RATIO, top: plot.top * PIXEL_RATIO,
      right: (plot.left + plot.width) * PIXEL_RATIO, bottom: (plot.top + plot.height) * PIXEL_RATIO,
    },
  };
  const screenX = new Float32Array(rowCount);
  const screenY = new Float32Array(rowCount);
  const fit = fitScatterView(data.x.values, data.y.values, include)!;
  let view: ScatterView = fit;
  let painted = 0;
  const frame = (step: number) => {
    view = step % 2 ? panScatterView(view, 0.01, -0.006) : zoomScatterView(view, 1.03, 0.4, 0.6, fit);
    pixels.fill(0xffffffff);
    projectScatter(data.x.values, data.y.values, view, plot, screenX, screenY);
    const layer = { rows: null, colors, sizeLevels: null, solid };
    drawScatterLayer(raster, screenX, screenY, { ...layer, colors: dimColors, include: unselected, sprites: sprites.dim });
    drawScatterLayer(raster, screenX, screenY, { ...layer, rows: selectedRows, include, sprites: sprites.strong });
    drawScatterLayer(raster, screenX, screenY, { ...layer, rows: selectedRows, include, colors: ringColors, sprites: sprites.ring });
    painted += nearestScatterRow(screenX, screenY, include, 700 + step, 300, 10) >= -1 ? 1 : 0;
  };
  for (let step = 0; step < 8; step += 1) frame(step);
  const samples: number[] = [];
  for (let step = 0; step < 40; step += 1) {
    const started = performance.now();
    frame(step);
    samples.push(performance.now() - started);
  }
  expect(painted).toBe(48);
  expect(pixels.some(pixel => pixel !== 0xffffffff)).toBe(true);
  return median(samples);
}

test("a 10k-row scatter repaints with soft points inside one 60 fps frame", () => {
  const frame = measureFrames(10_000, false);
  console.log(`10k rows, soft points: ${frame.toFixed(2)} ms per frame`);
  expect(frame).toBeLessThan(FRAME_BUDGET_MS);
});

test("a 100k-row scatter pans and zooms with solid points inside one frame and settles within three", () => {
  const moving = measureFrames(100_000, true);
  const settled = measureFrames(100_000, false);
  console.log(`100k rows: ${moving.toFixed(2)} ms per frame while moving, ${settled.toFixed(2)} ms settled`);
  expect(moving).toBeLessThan(FRAME_BUDGET_MS);
  expect(settled).toBeLessThan(FRAME_BUDGET_MS * 3);
});

test("selection, filter and lasso updates of 100k rows fit an interaction", () => {
  const rowCount = 100_000;
  const data = synthetic(rowCount);
  const table: ChartTable = {
    sourceRecordIds: Int32Array.from({ length: rowCount }, (_, row) => row),
    rowBySourceRecordId: new Map(Array.from({ length: rowCount }, (_, row) => [row, row])),
    series: new Map(),
    total: rowCount,
    sourceRevision: 0,
  };
  const half = Array.from({ length: rowCount / 2 }, (_, index) => index * 2);
  const include = new Uint8Array(rowCount).fill(1);
  const screenX = new Float32Array(rowCount);
  const screenY = new Float32Array(rowCount);
  projectScatter(data.x.values, data.y.values, fitScatterView(data.x.values, data.y.values, include)!, plot, screenX, screenY);
  const lasso = Array.from({ length: 96 }, (_, index) => ({
    x: 800 + Math.cos(index / 96 * Math.PI * 2) * 300,
    y: 340 + Math.sin(index / 96 * Math.PI * 2) * 200,
  }));
  const time = (work: () => unknown) => median(Array.from({ length: 9 }, () => {
    const started = performance.now();
    work();
    return performance.now() - started;
  }));
  const maskMs = time(() => rowMask(table, half));
  const lassoMs = time(() => scatterRowsInPolygon(screenX, screenY, include, lasso));
  const histogramMs = time(() => histogramChart(data.x, include));
  console.log(`100k rows: mask ${maskMs.toFixed(2)} ms, lasso ${lassoMs.toFixed(2)} ms, histogram ${histogramMs.toFixed(2)} ms`);
  expect(scatterRowsInPolygon(screenX, screenY, include, lasso).length).toBeGreaterThan(10_000);
  // Each of these runs once per change, not per frame; 100 ms is the limit a response feels instant at.
  expect(maskMs).toBeLessThan(100);
  expect(lassoMs).toBeLessThan(100);
  expect(histogramMs).toBeLessThan(100);
});
