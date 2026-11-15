import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  drawBandAxis,
  drawNumberAxis,
  drawPlotFrame,
  drawValueAxis,
  plotRect,
  valueAxisWidth,
} from "../lib/collection-chart-axes";
import {
  bandAt,
  bandCenter,
  outlierAt,
  rowsOfBands,
  valueToY,
  type BandChart,
} from "../lib/collection-chart-bands";
import { CHART_MARK_COLOR, cssColor } from "../lib/collection-chart-color";
import type { PlotRect } from "../lib/collection-chart-scatter";
import { countByGroup } from "../lib/collection-chart-stats";
import { readChartPalette, sizeCanvas, useCanvasSize, useThemeEpoch } from "./collection-chart-canvas";
import type { ChartSelectionMode } from "./collection-chart-scatter";

type BandsProps = {
  chart: BandChart;
  xLabel: string;
  yLabel: string;
  selected: Uint8Array;
  selectedCount: number;
  onSelectRows: (rows: number[], mode: ChartSelectionMode, focusRow?: number) => void;
  onHoverBand: (band: number, point: { x: number; y: number } | null) => void;
  /** Fallback content of the canvas, read by assistive technology. */
  children?: ReactNode;
};

const MAX_BAR_WIDTH = 72;
// Selected rows of a box chart are marked one by one; past this the marks merge anyway.
const MAX_ROW_MARKS = 4_000;

// Histogram, bar and box charts: a few dozen shapes, so the canvas is simply
// redrawn whenever anything changes.
export function CollectionChartBands({ chart, xLabel, yLabel, selected, selectedCount, onSelectRows, onHoverBand, children }: BandsProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plotRef = useRef<PlotRect>({ left: 0, top: 0, width: 1, height: 1 });
  const dragRef = useRef<{ start: number; moved: boolean; x: number } | null>(null);
  const [hoverBand, setHoverBand] = useState(-1);
  const [dragRange, setDragRange] = useState<[number, number] | null>(null);
  const size = useCanvasSize(surfaceRef);
  const themeEpoch = useThemeEpoch(surfaceRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !surface || !context || size.width < 2 || size.height < 2) return;
    sizeCanvas(canvas, size);
    const palette = readChartPalette(surface, canvas);
    context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    const plot = plotRef.current = plotRect(size.width, size.height, valueAxisWidth(context, chart.axis, palette.ink));
    const bandWidth = plot.width / chart.bandCount;
    const mark = cssColor(CHART_MARK_COLOR);

    const highlighted = dragRange ?? (hoverBand >= 0 ? [hoverBand, hoverBand] : null);
    if (highlighted) {
      context.globalAlpha = 0.07;
      context.fillStyle = palette.foregroundCss;
      context.fillRect(plot.left + highlighted[0] * bandWidth, plot.top, (highlighted[1] - highlighted[0] + 1) * bandWidth, plot.height);
      context.globalAlpha = 1;
    }
    drawValueAxis(context, plot, chart.axis, palette.ink, yLabel);

    const selectedCounts = selectedCount > 0 ? countByGroup(chart.groupOfRow, chart.bandCount, selected) : null;
    const barWidth = chart.kind === "histogram"
      ? Math.max(1, bandWidth - 1)
      : Math.min(MAX_BAR_WIDTH, Math.max(1, bandWidth * 0.7));
    if (chart.heights) {
      const zero = valueToY(Math.min(Math.max(0, chart.axis.min), chart.axis.max), chart.axis, plot);
      for (let band = 0; band < chart.bandCount; band += 1) {
        const height = chart.heights[band];
        if (height !== height) continue;
        const left = bandCenter(band, plot, chart.bandCount) - barWidth / 2;
        const top = valueToY(height, chart.axis, plot);
        context.fillStyle = mark;
        context.globalAlpha = selectedCounts ? 0.3 : 0.85;
        context.fillRect(left, Math.min(top, zero), barWidth, Math.abs(zero - top));
        const picked = selectedCounts?.[band] ?? 0;
        if (picked > 0) {
          // The picked share of the bar, measured from the baseline.
          const pickedTop = zero + (top - zero) * (picked / chart.rowCounts[band]);
          context.globalAlpha = 1;
          context.fillRect(left, Math.min(pickedTop, zero), barWidth, Math.abs(zero - pickedTop));
          context.strokeStyle = palette.foregroundCss;
          context.lineWidth = 1;
          context.strokeRect(left + 0.5, Math.min(pickedTop, zero) + 0.5, barWidth - 1, Math.max(0, Math.abs(zero - pickedTop) - 1));
        }
      }
      context.globalAlpha = 1;
    }
    if (chart.boxes && chart.rowValues) {
      const values = chart.rowValues;
      const y = (value: number) => valueToY(value, chart.axis, plot);
      const boxWidth = Math.min(MAX_BAR_WIDTH, Math.max(3, bandWidth * 0.5));
      context.lineWidth = 1;
      for (let band = 0; band < chart.bandCount; band += 1) {
        const box = chart.boxes[band];
        if (!box) continue;
        const center = Math.round(bandCenter(band, plot, chart.bandCount)) + 0.5;
        const left = center - boxWidth / 2;
        context.strokeStyle = palette.foregroundCss;
        context.beginPath();
        context.moveTo(center, y(box.whiskerHigh));
        context.lineTo(center, y(box.q3));
        context.moveTo(center, y(box.q1));
        context.lineTo(center, y(box.whiskerLow));
        for (const whisker of [box.whiskerHigh, box.whiskerLow]) {
          context.moveTo(center - boxWidth / 4, Math.round(y(whisker)) + 0.5);
          context.lineTo(center + boxWidth / 4, Math.round(y(whisker)) + 0.5);
        }
        context.stroke();
        context.fillStyle = mark;
        context.globalAlpha = selectedCounts ? 0.3 : 0.6;
        context.fillRect(left, y(box.q3), boxWidth, Math.max(1, y(box.q1) - y(box.q3)));
        context.globalAlpha = 1;
        context.strokeRect(left, Math.round(y(box.q3)) + 0.5, boxWidth, Math.max(1, Math.round(y(box.q1) - y(box.q3))));
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(left, y(box.median));
        context.lineTo(left + boxWidth, y(box.median));
        context.stroke();
        context.lineWidth = 1;
        context.strokeStyle = mark;
        for (const row of box.outlierRows) {
          context.beginPath();
          context.arc(center, y(values[row]), 2.5, 0, Math.PI * 2);
          context.stroke();
        }
      }
      if (selectedCounts) {
        // Where the picked rows sit inside each distribution.
        context.fillStyle = palette.foregroundCss;
        let marks = 0;
        for (let row = 0; row < chart.groupOfRow.length && marks < MAX_ROW_MARKS; row += 1) {
          const band = chart.groupOfRow[row];
          if (band < 0 || !selected[row]) continue;
          marks += 1;
          context.fillRect(bandCenter(band, plot, chart.bandCount) - boxWidth / 2 - 5, Math.round(y(values[row])) - 0.5, 4, 1.5);
          context.fillRect(bandCenter(band, plot, chart.bandCount) + boxWidth / 2 + 2, Math.round(y(values[row])) - 0.5, 4, 1.5);
        }
      }
    }
    if (chart.labels) drawBandAxis(context, plot, chart.labels, palette.ink, xLabel);
    else if (chart.bins) {
      drawNumberAxis(context, plot, chart.bins.start, chart.bins.start + chart.bins.step * chart.bandCount, palette.ink, xLabel);
    }
    drawPlotFrame(context, plot, palette.ink);
  }, [chart, dragRange, hoverBand, selected, selectedCount, size, themeEpoch, xLabel, yLabel]);

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  // The bands between where a drag started and the pointer, which may have left the plot.
  const draggedBands = (start: number, x: number): [number, number] => {
    const plot = plotRef.current;
    const band = bandAt(Math.min(plot.left + plot.width - 1, Math.max(plot.left, x)), plot, chart.bandCount);
    return [Math.min(start, band), Math.max(start, band)];
  };
  const hover = (band: number, point: { x: number; y: number } | null) => {
    if (band === hoverBand) return;
    setHoverBand(band);
    onHoverBand(band, band >= 0 && point ? { x: bandCenter(band, plotRef.current, chart.bandCount), y: point.y } : null);
  };

  return (
    <div ref={surfaceRef} className="absolute inset-0 bg-background text-foreground">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full touch-none border-border text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/30"
        tabIndex={0}
        aria-label={chart.kind === "histogram"
          ? `Histogram of ${xLabel}`
          : `${chart.kind === "box" ? "Box" : "Bar"} chart of ${yLabel}${xLabel ? ` by ${xLabel}` : ""}`}
        aria-keyshortcuts="ArrowLeft ArrowRight Enter Space Escape"
        onKeyDown={(event) => {
          // The arrows walk the bands, showing each one's tip; Enter or Space selects it.
          const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (step) {
            const band = Math.min(chart.bandCount - 1, Math.max(0, hoverBand + step));
            const plot = plotRef.current;
            hover(band, { x: 0, y: plot.top + plot.height / 3 });
          } else if ((event.key === "Enter" || event.key === " ") && hoverBand >= 0) {
            onSelectRows(rowsOfBands(chart, hoverBand, hoverBand), event.shiftKey ? "toggle" : "replace");
          } else if (event.key === "Escape") {
            onSelectRows([], "replace");
          } else {
            return;
          }
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = localPoint(event);
          dragRef.current = { start: bandAt(point.x, plotRef.current, chart.bandCount), moved: false, x: point.x };
        }}
        onPointerMove={(event) => {
          const point = localPoint(event);
          const band = bandAt(point.x, plotRef.current, chart.bandCount);
          const drag = dragRef.current;
          if (!drag) {
            hover(point.y >= plotRef.current.top && point.y <= plotRef.current.top + plotRef.current.height ? band : -1, point);
            return;
          }
          drag.moved ||= Math.abs(point.x - drag.x) > 3;
          if (drag.moved && drag.start >= 0) setDragRange(draggedBands(drag.start, point.x));
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (!drag) return;
          setDragRange(null);
          const mode = event.shiftKey ? "toggle" : "replace";
          const point = localPoint(event);
          if (drag.moved && drag.start >= 0) {
            const [first, last] = draggedBands(drag.start, point.x);
            onSelectRows(rowsOfBands(chart, first, last), event.shiftKey ? "add" : "replace");
            return;
          }
          const outlier = outlierAt(chart, plotRef.current, point.x, point.y, 6);
          if (outlier >= 0) {
            onSelectRows([outlier], mode, outlier);
            return;
          }
          const band = point.y >= plotRef.current.top && point.y <= plotRef.current.top + plotRef.current.height
            ? bandAt(point.x, plotRef.current, chart.bandCount)
            : -1;
          if (band >= 0 && chart.rowCounts[band] > 0) onSelectRows(rowsOfBands(chart, band, band), mode);
          else if (!event.shiftKey) onSelectRows([], "replace");
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragRange(null);
        }}
        onPointerLeave={() => {
          if (!dragRef.current) hover(-1, null);
        }}
      >
        {children}
      </canvas>
    </div>
  );
}
