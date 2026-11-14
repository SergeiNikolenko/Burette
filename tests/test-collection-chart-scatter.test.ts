import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CHART_CATEGORY_COLORS, CHART_MARK_COLOR, CHART_NEUTRAL_COLOR, rowColors, sequentialColor } from "../apps/desktop/src/lib/collection-chart-color";
import { categorySeries, numericSeries } from "../apps/desktop/src/lib/collection-chart-data";
import {
  drawScatterLayer,
  fitScatterView,
  mixedColors,
  nearestScatterRow,
  panScatterView,
  pointSprite,
  projectScatter,
  scatterRowsInPolygon,
  scatterSizeLevels,
  zoomScatterView,
} from "../apps/desktop/src/lib/collection-chart-scatter";

const records = readFileSync("tests/fixtures/collection-chart/moses-properties.sdf", "utf8")
  .split("$$$$\n").filter(block => block.trim())
  .map(block => Object.fromEntries([...block.matchAll(/> <([^>]+)>\n([^\n]*)/gu)].map(match => [match[1], match[2]])));
const rowCount = records.length;
const everyRow = new Uint8Array(rowCount).fill(1);
const numbers = (name: string) => numericSeries(records.map(record => Number(record[name])), rowCount);
const categories = (name: string) => categorySeries(records.map(record => record[name]), rowCount);

test("zooming keeps the point under the cursor in place and panning follows the drag", () => {
  const xs = numbers("MolWt").values;
  const ys = numbers("SLogP").values;
  const fit = fitScatterView(xs, ys, everyRow)!;
  expect(fit.x0).toBeLessThan(250.371);
  expect(fit.x1).toBeGreaterThan(350.465);
  const plot = { left: 50, top: 10, width: 500, height: 300 };
  const screenX = new Float32Array(rowCount);
  const screenY = new Float32Array(rowCount);
  projectScatter(xs, ys, fit, plot, screenX, screenY);
  const row = 7;
  const anchorX = (screenX[row] - plot.left) / plot.width;
  const anchorY = 1 - (screenY[row] - plot.top) / plot.height;
  const zoomed = zoomScatterView(fit, 3, anchorX, anchorY, fit);
  expect(zoomed.x1 - zoomed.x0).toBeCloseTo((fit.x1 - fit.x0) / 3, 9);
  const zoomedX = new Float32Array(rowCount);
  const zoomedY = new Float32Array(rowCount);
  projectScatter(xs, ys, zoomed, plot, zoomedX, zoomedY);
  expect(zoomedX[row]).toBeCloseTo(screenX[row], 2);
  expect(zoomedY[row]).toBeCloseTo(screenY[row], 2);
  const panned = panScatterView(fit, 50 / plot.width, 30 / plot.height);
  projectScatter(xs, ys, panned, plot, zoomedX, zoomedY);
  expect(zoomedX[row] - screenX[row]).toBeCloseTo(50, 2);
  expect(zoomedY[row] - screenY[row]).toBeCloseTo(30, 2);
  // Zoom stops at the limits instead of collapsing or drifting away.
  const span = (view: typeof fit) => view.x1 - view.x0;
  expect(span(zoomScatterView(fit, 1e-9, 0.5, 0.5, fit))).toBeCloseTo(span(fit) * 4, 6);
  expect(span(zoomScatterView(fit, 1e9, 0.5, 0.5, fit))).toBeCloseTo(span(fit) / 5000, 9);
  expect(fitScatterView(xs, ys, new Uint8Array(rowCount))).toBeNull();
});

test("points are picked by distance and by lasso, never through a filter", () => {
  const xs = Float64Array.from([0, 10, 20, 30, Number.NaN]);
  const ys = Float64Array.from([0, 10, 20, 30, 5]);
  const include = Uint8Array.from([1, 1, 0, 1, 1]);
  const plot = { left: 0, top: 0, width: 300, height: 300 };
  const screenX = new Float32Array(5);
  const screenY = new Float32Array(5);
  projectScatter(xs, ys, { x0: 0, x1: 30, y0: 0, y1: 30 }, plot, screenX, screenY);
  expect([screenX[1], screenY[1]]).toEqual([100, 200]);
  expect(nearestScatterRow(screenX, screenY, include, 103, 198, 8)).toBe(1);
  expect(nearestScatterRow(screenX, screenY, include, 120, 180, 8)).toBe(-1);
  // Row 2 is filtered out, so the pointer on top of it finds nothing.
  expect(nearestScatterRow(screenX, screenY, include, 200, 100, 8)).toBe(-1);
  const lasso = [{ x: 50, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 250 }, { x: 50, y: 250 }];
  expect(scatterRowsInPolygon(screenX, screenY, include, lasso)).toEqual([1]);
  expect(scatterRowsInPolygon(screenX, screenY, new Uint8Array(5).fill(1), lasso)).toEqual([1, 2]);
  expect(scatterRowsInPolygon(screenX, screenY, include, lasso.slice(0, 2))).toEqual([]);
});

test("the painter blends points inside the plot area only", () => {
  const width = 40;
  const height = 30;
  const background = 0xffffffff;
  const pixels = new Uint32Array(width * height).fill(background);
  const raster = { pixels, width, height, pixelRatio: 2, clip: { left: 10, top: 4, right: 36, bottom: 26 } };
  const screenX = Float32Array.from([10, 5, 100, Number.NaN]);
  const screenY = Float32Array.from([7, 7, 7, 7]);
  const colors = Uint32Array.from([0x0000ff, 0x00ff00, 0xff0000, 0xff0000]);
  const layer = { rows: null, include: new Uint8Array(4).fill(1), colors, sizeLevels: null, solid: false };
  drawScatterLayer(raster, screenX, screenY, { ...layer, sprites: [pointSprite(3, 1)] });
  // Row 0 sits at device pixel (20, 14): solid red in the middle.
  expect(pixels[14 * width + 20]).toBe(0xff0000ff);
  // Row 1 is centred on the clip edge: painted inside it, untouched outside.
  expect(pixels[14 * width + 10]).toBe(0xff00ff00);
  expect(pixels[14 * width + 9]).toBe(background);
  // Nothing escapes the clip rectangle, and off-screen or valueless rows draw nothing.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= 10 && x < 36 && y >= 4 && y < 26;
      if (!inside) expect(pixels[y * width + x]).toBe(background);
    }
  }
  expect(pixels.filter(pixel => (pixel & 0xff0000) === 0xff0000 && pixel !== background).length).toBe(0);
  // Half coverage over white gives the midpoint of the two colours.
  pixels.fill(background);
  drawScatterLayer(raster, screenX, screenY, { ...layer, sprites: [pointSprite(3, 0.5)] });
  expect(pixels[14 * width + 20]).toBe(0xff7f7fff);
  // Solid mode fills the cells at least half covered with the colour as it is,
  // and the caller hands it the colour the soft point would settle to.
  pixels.fill(background);
  const sprite = pointSprite(3, 0.5);
  drawScatterLayer(raster, screenX, screenY, { ...layer, solid: true, colors: mixedColors(colors, 0xffffff, 0.5), sprites: [sprite] });
  expect(pixels[14 * width + 20]).toBe(0xff7f7fff);
  expect(pixels[14 * width + 23]).toBe(0xff7f7fff);
  expect(pixels[14 * width + 24]).toBe(background);
  expect(sprite.solidCount).toBeLessThan(sprite.alpha.length);
  // A filtered-out row is skipped.
  pixels.fill(background);
  drawScatterLayer(raster, screenX, screenY, { ...layer, include: Uint8Array.from([0, 1, 1, 1]), sprites: [pointSprite(3, 1)] });
  expect(pixels[14 * width + 20]).toBe(background);
});

test("colour and size follow a column", () => {
  const rings = numbers("Rings");
  const byNumber = rowColors(rings, rowCount);
  const ringsOf = (row: number) => Number(records[row].Rings);
  const low = records.findIndex(record => record.Rings === "1");
  const high = records.findIndex(record => record.Rings === "4");
  expect(byNumber[low]).toBe(sequentialColor(0));
  expect(byNumber[high]).toBe(sequentialColor(1));
  expect(new Set(byNumber).size).toBe(4);
  const halogen = categories("Halogen");
  const byCategory = rowColors(halogen, rowCount);
  records.forEach((record, row) => {
    expect(byCategory[row]).toBe(CHART_CATEGORY_COLORS[halogen.labels.indexOf(record.Halogen)]);
  });
  expect(new Set(rowColors(null, rowCount))).toEqual(new Set([CHART_MARK_COLOR]));
  expect(rowColors(numericSeries([1, null, 3], 3), 3)[1]).toBe(CHART_NEUTRAL_COLOR);
  const levels = scatterSizeLevels(rings.values, rings.min, rings.max);
  expect(levels[low]).toBe(0);
  expect(levels[high]).toBe(7);
  for (let row = 1; row < rowCount; row += 1) {
    if (ringsOf(row) > ringsOf(row - 1)) expect(levels[row]).toBeGreaterThan(levels[row - 1]);
  }
});

