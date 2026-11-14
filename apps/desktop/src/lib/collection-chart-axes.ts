import { axisTicks, formatAxisValue, type AxisTicks } from "./collection-chart-stats";
import type { PlotRect } from "./collection-chart-scatter";

// Axis drawing shared by every chart type. Coordinates are CSS pixels; the
// caller scales the context by the device pixel ratio.

export type ChartInk = {
  /** Tick labels and axis titles. */
  text: string;
  /** Grid lines and the plot frame. */
  line: string;
  font: string;
};

export const CHART_MARGIN = { top: 10, right: 14, bottom: 40, titleGap: 16 };
const TICK_GAP = 6;

export function valueAxisTicks(min: number, max: number, plotHeight: number) {
  return axisTicks(min, max, Math.min(8, Math.max(2, Math.floor(plotHeight / 44))));
}

/** Width the value axis needs for its tick labels and rotated title. */
export function valueAxisWidth(context: CanvasRenderingContext2D, axis: AxisTicks, ink: ChartInk) {
  context.font = ink.font;
  let widest = 0;
  for (const tick of axis.ticks) widest = Math.max(widest, context.measureText(formatAxisValue(tick, axis.step)).width);
  return Math.ceil(widest) + TICK_GAP + CHART_MARGIN.titleGap + 6;
}

export function plotRect(width: number, height: number, left: number): PlotRect {
  return {
    left,
    top: CHART_MARGIN.top,
    width: Math.max(1, width - left - CHART_MARGIN.right),
    height: Math.max(1, height - CHART_MARGIN.top - CHART_MARGIN.bottom),
  };
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && context.measureText(`${text.slice(0, end)}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** Left axis: tick labels, a rotated title and, unless the caller paints them itself, grid lines. */
export function drawValueAxis(
  context: CanvasRenderingContext2D,
  plot: PlotRect,
  axis: AxisTicks,
  ink: ChartInk,
  title: string,
  gridLines = true,
) {
  context.font = ink.font;
  context.lineWidth = 1;
  context.strokeStyle = ink.line;
  context.fillStyle = ink.text;
  context.textAlign = "right";
  context.textBaseline = "middle";
  const span = axis.max - axis.min;
  for (const tick of axis.ticks) {
    const y = Math.round(plot.top + plot.height * (1 - (tick - axis.min) / span)) + 0.5;
    if (gridLines) {
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.left + plot.width, y);
      context.stroke();
    }
    context.fillText(formatAxisValue(tick, axis.step), plot.left - TICK_GAP, y);
  }
  context.save();
  context.translate(10, plot.top + plot.height / 2);
  context.rotate(-Math.PI / 2);
  context.textAlign = "center";
  context.fillText(fitText(context, title, plot.height), 0, 0);
  context.restore();
}

/** Bottom axis over a number range, with its title underneath. */
export function drawNumberAxis(
  context: CanvasRenderingContext2D,
  plot: PlotRect,
  min: number,
  max: number,
  ink: ChartInk,
  title: string,
) {
  const axis = axisTicks(min, max, Math.min(10, Math.max(2, Math.floor(plot.width / 72))));
  const bottom = plot.top + plot.height;
  context.font = ink.font;
  context.lineWidth = 1;
  context.strokeStyle = ink.line;
  context.fillStyle = ink.text;
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const tick of axis.ticks) {
    const x = Math.round(plot.left + plot.width * ((tick - min) / (max - min))) + 0.5;
    context.beginPath();
    context.moveTo(x, bottom);
    context.lineTo(x, bottom + 4);
    context.stroke();
    context.fillText(formatAxisValue(tick, axis.step), x, bottom + TICK_GAP);
  }
  context.fillText(fitText(context, title, plot.width), plot.left + plot.width / 2, bottom + TICK_GAP + CHART_MARGIN.titleGap);
}

/** Bottom axis of named bands; labels thin out when the bands get narrow. */
export function drawBandAxis(
  context: CanvasRenderingContext2D,
  plot: PlotRect,
  labels: readonly string[],
  ink: ChartInk,
  title: string,
) {
  const bottom = plot.top + plot.height;
  const bandWidth = plot.width / labels.length;
  const every = Math.max(1, Math.ceil(36 / bandWidth));
  context.font = ink.font;
  context.fillStyle = ink.text;
  context.textAlign = "center";
  context.textBaseline = "top";
  for (let band = 0; band < labels.length; band += every) {
    context.fillText(
      fitText(context, labels[band], Math.max(24, bandWidth * every - 6)),
      plot.left + (band + 0.5) * bandWidth,
      bottom + TICK_GAP,
    );
  }
  context.fillText(fitText(context, title, plot.width), plot.left + plot.width / 2, bottom + TICK_GAP + CHART_MARGIN.titleGap);
}

export function drawPlotFrame(context: CanvasRenderingContext2D, plot: PlotRect, ink: ChartInk) {
  context.lineWidth = 1;
  context.strokeStyle = ink.line;
  context.strokeRect(plot.left + 0.5, plot.top + 0.5, plot.width - 1, plot.height - 1);
}
