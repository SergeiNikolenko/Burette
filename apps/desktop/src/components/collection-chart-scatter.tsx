import { useEffect, useRef, type ReactNode } from "react";
import { simplifyLassoPolygon, type LassoPoint } from "../lib/chemical-space-lasso";
import {
  drawNumberAxis,
  drawPlotFrame,
  drawValueAxis,
  plotRect,
  valueAxisTicks,
  valueAxisWidth,
} from "../lib/collection-chart-axes";
import type { NumericSeries } from "../lib/collection-chart-data";
import {
  SCATTER_SIZE_LEVELS,
  drawScatterGridLine,
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
  scatterSizeScale,
  zoomScatterView,
  type PlotRect,
  type PointSprite,
  type ScatterView,
} from "../lib/collection-chart-scatter";
import { readChartPalette, sizeCanvas, useCanvasSize, useThemeEpoch, type CanvasSize, type ChartPalette } from "./collection-chart-canvas";

export type ChartSelectionMode = "replace" | "add" | "toggle";

type ScatterProps = {
  x: NumericSeries;
  y: NumericSeries;
  xLabel: string;
  yLabel: string;
  /** Changes when the user picks other columns, which is when the view refits. */
  viewKey: string;
  colors: Uint32Array;
  sizeLevels: Uint8Array | null;
  /** Rows the grid's filters let through. */
  include: Uint8Array;
  selected: Uint8Array;
  selectedCount: number;
  hoveredRow: number;
  tool: "navigate" | "lasso";
  fitRequest: number;
  onSelectRows: (rows: number[], mode: ChartSelectionMode, focusRow?: number) => void;
  onHoverRow: (row: number, point: LassoPoint | null) => void;
  /** Fallback content of the canvas, read by assistive technology. */
  children?: ReactNode;
};

// Above this many blended pixels a frame no longer fits a 60 fps gesture, so
// panning and zooming paint solid points and the soft ones return at rest.
const SOFT_PIXEL_BUDGET = 1_200_000;
const REFINE_DELAY_MS = 140;
const MAX_LASSO_POINTS = 4_096;
// Opacity of the rows outside a selection, relative to their usual one.
const DIM = 0.3;

type Sprites = {
  normal: PointSprite[];
  dim: PointSprite[];
  strong: PointSprite[];
  ring: PointSprite[];
  radius: number;
  opacity: number;
  /** Too many soft pixels for a frame: gestures paint solid points instead. */
  heavy: boolean;
};

// The drawing state lives outside React: a pan or zoom repaints on the next
// animation frame without a render, and React only hands over new data.
class ScatterEngine {
  private view: ScatterView | null = null;
  private fit: ScatterView | null = null;
  private userView = false;
  private size: CanvasSize = { width: 0, height: 0, pixelRatio: 1 };
  private plot: PlotRect = { left: 0, top: 0, width: 1, height: 1 };
  private screenX = new Float32Array(0);
  private screenY = new Float32Array(0);
  private image: ImageData | null = null;
  private palette: ChartPalette | null = null;
  private sprites: Sprites | null = null;
  private solidColors: Uint32Array | null = null;
  private unselected = new Uint8Array(0);
  private selectedRows = new Int32Array(0);
  private ringColors = new Uint32Array(0);
  private frame = 0;
  private baseDirty = true;
  private interactingUntil = 0;
  private refineTimer = 0;
  lasso: LassoPoint[] = [];

  constructor(
    private readonly surface: HTMLElement,
    private readonly base: HTMLCanvasElement,
    private readonly overlay: HTMLCanvasElement,
    private readonly props: () => ScatterProps,
  ) {}

  dispose() {
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.refineTimer);
  }

  resize(size: CanvasSize) {
    this.size = size;
    sizeCanvas(this.base, size);
    sizeCanvas(this.overlay, size);
    this.image = null;
    this.sprites = null;
    // A dock being dragged resizes every frame: dense data repaints solid until it stops.
    this.interactingUntil = performance.now() + REFINE_DELAY_MS;
    this.invalidate(true);
  }

  themeChanged() {
    this.palette = null;
    this.solidColors = null;
    this.interactingUntil = performance.now() + REFINE_DELAY_MS;
    this.invalidate(true);
  }

  /** New columns, rows, filters, colours or selection. */
  dataChanged(resetView: boolean) {
    const { x, y, include, selected, selectedCount } = this.props();
    const rowCount = x.values.length;
    if (this.screenX.length !== rowCount) {
      this.screenX = new Float32Array(rowCount);
      this.screenY = new Float32Array(rowCount);
      this.ringColors = new Uint32Array(rowCount);
      this.palette = null;
    }
    this.fit = fitScatterView(x.values, y.values, include);
    if (resetView) this.userView = false;
    if (!this.userView || !this.view) this.view = this.fit;
    if (selectedCount > 0) {
      this.unselected = Uint8Array.from(include, (included, row) => included && !selected[row] ? 1 : 0);
      const rows: number[] = [];
      for (let row = 0; row < rowCount; row += 1) if (include[row] && selected[row]) rows.push(row);
      this.selectedRows = Int32Array.from(rows);
    }
    this.sprites = null;
    this.solidColors = null;
    this.invalidate(true);
  }

  invalidate(base: boolean) {
    this.baseDirty ||= base;
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  fitAll() {
    this.userView = false;
    this.view = this.fit;
    this.invalidate(true);
  }

  private moved() {
    this.userView = true;
    this.interactingUntil = performance.now() + REFINE_DELAY_MS;
    this.invalidate(true);
  }

  zoom(factor: number, point: LassoPoint | null) {
    if (!this.view || !this.fit) return;
    const anchorX = point ? (point.x - this.plot.left) / this.plot.width : 0.5;
    const anchorY = point ? 1 - (point.y - this.plot.top) / this.plot.height : 0.5;
    this.view = zoomScatterView(this.view, factor, anchorX, anchorY, this.fit);
    this.moved();
  }

  pan(dx: number, dy: number) {
    if (!this.view) return;
    this.view = panScatterView(this.view, dx / this.plot.width, dy / this.plot.height);
    this.moved();
  }

  rowAt(point: LassoPoint) {
    return nearestScatterRow(this.screenX, this.screenY, this.props().include, point.x, point.y,
      Math.max(8, (this.sprites?.radius ?? 3) + 5));
  }

  rowsInLasso() {
    return scatterRowsInPolygon(this.screenX, this.screenY, this.props().include, simplifyLassoPolygon(this.lasso));
  }

  pointOf(row: number): LassoPoint {
    return { x: this.screenX[row], y: this.screenY[row] };
  }

  private buildSprites(): Sprites {
    const { include, sizeLevels } = this.props();
    let drawn = 0;
    for (let row = 0; row < include.length; row += 1) drawn += include[row];
    const ratio = this.size.pixelRatio;
    const radius = scatterPointRadius(drawn);
    const opacity = scatterPointOpacity(drawn);
    const sprites: Sprites = {
      normal: [], dim: [], strong: [], ring: [], radius, opacity,
      heavy: drawn * Math.PI * (radius * ratio) ** 2 > SOFT_PIXEL_BUDGET,
    };
    for (let level = 0; level < (sizeLevels ? SCATTER_SIZE_LEVELS : 1); level += 1) {
      const scaled = radius * ratio * (sizeLevels ? scatterSizeScale(level) : 1);
      sprites.normal.push(pointSprite(scaled, opacity));
      sprites.dim.push(pointSprite(scaled, opacity * DIM));
      sprites.strong.push(pointSprite(scaled + 0.5 * ratio, 1));
      sprites.ring.push(pointSprite(scaled + 1.75 * ratio, 1, scaled + 0.75 * ratio));
    }
    return sprites;
  }

  private draw() {
    const { width, height, pixelRatio } = this.size;
    const base = this.base.getContext("2d");
    const overlay = this.overlay.getContext("2d");
    if (!base || !overlay || width < 2 || height < 2) return;
    const props = this.props();
    if (!this.palette) {
      this.palette = readChartPalette(this.surface, this.overlay);
      this.ringColors.fill(this.palette.foreground);
    }
    const palette = this.palette;
    overlay.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    overlay.clearRect(0, 0, width, height);
    const view = this.view;
    if (!view) {
      base.clearRect(0, 0, this.base.width, this.base.height);
      return;
    }
    const yAxis = valueAxisTicks(view.y0, view.y1, height - 50);
    const plot = this.plot = plotRect(width, height, valueAxisWidth(overlay, yAxis, palette.ink));

    if (this.baseDirty) {
      this.baseDirty = false;
      this.image ??= base.createImageData(this.base.width, this.base.height);
      this.sprites ??= this.buildSprites();
      const sprites = this.sprites;
      const pixels = new Uint32Array(this.image.data.buffer);
      pixels.fill(0xff000000 | palette.background);
      const raster = {
        pixels,
        width: this.image.width,
        height: this.image.height,
        pixelRatio,
        clip: {
          left: Math.round(plot.left * pixelRatio),
          top: Math.round(plot.top * pixelRatio),
          right: Math.min(this.image.width, Math.round((plot.left + plot.width) * pixelRatio)),
          bottom: Math.min(this.image.height, Math.round((plot.top + plot.height) * pixelRatio)),
        },
      };
      for (const tick of yAxis.ticks) {
        const y = plot.top + plot.height * (1 - (tick - view.y0) / (view.y1 - view.y0));
        drawScatterGridLine(raster, y, palette.line, palette.lineCoverage);
      }
      projectScatter(props.x.values, props.y.values, view, plot, this.screenX, this.screenY);
      const solid = sprites.heavy && performance.now() < this.interactingUntil;
      const picking = props.selectedCount > 0;
      // Solid points take the colour the soft ones settle to over the background.
      if (solid) {
        this.solidColors ??= mixedColors(props.colors, palette.background, sprites.opacity * (picking ? DIM : 1));
      }
      const layer = { rows: null, colors: props.colors, sizeLevels: props.sizeLevels, solid };
      const resting = solid ? { ...layer, colors: this.solidColors! } : layer;
      if (!picking) {
        drawScatterLayer(raster, this.screenX, this.screenY, { ...resting, include: props.include, sprites: sprites.normal });
      } else {
        drawScatterLayer(raster, this.screenX, this.screenY, { ...resting, include: this.unselected, sprites: sprites.dim });
        const picked = { ...layer, rows: this.selectedRows, include: props.include };
        drawScatterLayer(raster, this.screenX, this.screenY, { ...picked, sprites: sprites.strong });
        drawScatterLayer(raster, this.screenX, this.screenY, { ...picked, colors: this.ringColors, sprites: sprites.ring });
      }
      base.putImageData(this.image, 0, 0);
      window.clearTimeout(this.refineTimer);
      if (solid) this.refineTimer = window.setTimeout(() => this.invalidate(true), REFINE_DELAY_MS);
    }

    drawValueAxis(overlay, plot, yAxis, palette.ink, props.yLabel, false);
    drawNumberAxis(overlay, plot, view.x0, view.x1, palette.ink, props.xLabel);
    drawPlotFrame(overlay, plot, palette.ink);
    overlay.strokeStyle = palette.foregroundCss;
    const hovered = props.hoveredRow;
    if (hovered >= 0 && props.include[hovered]) {
      const x = this.screenX[hovered];
      const y = this.screenY[hovered];
      if (x >= plot.left && x <= plot.left + plot.width && y >= plot.top && y <= plot.top + plot.height) {
        overlay.lineWidth = 1.5;
        overlay.beginPath();
        overlay.arc(x, y, (this.sprites?.radius ?? 3) + 4, 0, Math.PI * 2);
        overlay.stroke();
      }
    }
    if (this.lasso.length > 1) {
      overlay.lineWidth = 1;
      overlay.setLineDash([4, 3]);
      overlay.beginPath();
      overlay.moveTo(this.lasso[0].x, this.lasso[0].y);
      for (const point of this.lasso) overlay.lineTo(point.x, point.y);
      overlay.closePath();
      overlay.stroke();
      overlay.setLineDash([]);
    }
  }
}

export function CollectionChartScatter(props: ScatterProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ScatterEngine | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const pointerRef = useRef<{ start: LassoPoint; last: LassoPoint; moved: boolean } | null>(null);
  const hoverRef = useRef(-1);
  const size = useCanvasSize(surfaceRef);
  const themeEpoch = useThemeEpoch(surfaceRef);

  useEffect(() => {
    const engine = new ScatterEngine(surfaceRef.current!, baseRef.current!, overlayRef.current!, () => propsRef.current);
    engineRef.current = engine;
    // React registers wheel listeners as passive, and the zoom must not scroll the dock.
    const overlay = overlayRef.current!;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = overlay.getBoundingClientRect();
      engine.zoom(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)),
        { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    overlay.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      overlay.removeEventListener("wheel", onWheel);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => engineRef.current?.resize(size), [size]);
  useEffect(() => engineRef.current?.themeChanged(), [themeEpoch]);
  const viewKey = useRef<string | null>(null);
  useEffect(() => {
    engineRef.current?.dataChanged(viewKey.current !== props.viewKey);
    viewKey.current = props.viewKey;
  }, [props.viewKey, props.x, props.y, props.include, props.selected, props.selectedCount, props.colors, props.sizeLevels]);
  useEffect(() => engineRef.current?.invalidate(false), [props.hoveredRow, props.xLabel, props.yLabel]);
  useEffect(() => {
    if (props.fitRequest > 0) engineRef.current?.fitAll();
  }, [props.fitRequest]);

  const localPoint = (event: { clientX: number; clientY: number; currentTarget: Element }): LassoPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const hoverRow = (row: number) => {
    if (row === hoverRef.current) return;
    hoverRef.current = row;
    props.onHoverRow(row, row >= 0 ? engineRef.current!.pointOf(row) : null);
  };
  const endLasso = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.lasso = [];
    engine.invalidate(false);
  };

  return (
    <div ref={surfaceRef} className="absolute inset-0 bg-background text-foreground">
      <canvas ref={baseRef} className="absolute inset-0 size-full" aria-hidden />
      <canvas
        ref={overlayRef}
        className={`absolute inset-0 size-full touch-none border-border text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/30 ${props.tool === "lasso" ? "cursor-crosshair" : ""}`}
        tabIndex={0}
        aria-label={`Scatter chart of ${props.yLabel} against ${props.xLabel}`}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - 0 Escape"
        onKeyDown={(event) => {
          const engine = engineRef.current;
          if (!engine) return;
          const step = event.shiftKey ? 120 : 40;
          if (event.key === "ArrowLeft") engine.pan(step, 0);
          else if (event.key === "ArrowRight") engine.pan(-step, 0);
          else if (event.key === "ArrowUp") engine.pan(0, step);
          else if (event.key === "ArrowDown") engine.pan(0, -step);
          else if (event.key === "+" || event.key === "=") engine.zoom(1.25, null);
          else if (event.key === "-") engine.zoom(0.8, null);
          else if (event.key === "0") engine.fitAll();
          else if (event.key === "Escape") props.onSelectRows([], "replace");
          else return;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = localPoint(event);
          pointerRef.current = { start: point, last: point, moved: false };
          hoverRow(-1);
          if (props.tool === "lasso") engineRef.current!.lasso = [point];
        }}
        onPointerMove={(event) => {
          const engine = engineRef.current;
          if (!engine) return;
          const point = localPoint(event);
          const pointer = pointerRef.current;
          if (!pointer) {
            hoverRow(engine.rowAt(point));
            return;
          }
          pointer.moved ||= Math.abs(point.x - pointer.start.x) + Math.abs(point.y - pointer.start.y) > 3;
          if (props.tool === "lasso") {
            if (engine.lasso.length < MAX_LASSO_POINTS) engine.lasso.push(point);
            engine.invalidate(false);
          } else if (pointer.moved) {
            engine.pan(point.x - pointer.last.x, point.y - pointer.last.y);
          }
          pointer.last = point;
        }}
        onPointerUp={(event) => {
          const engine = engineRef.current;
          const pointer = pointerRef.current;
          pointerRef.current = null;
          if (!engine || !pointer) return;
          if (props.tool === "lasso" && pointer.moved) {
            const rows = engine.rowsInLasso();
            endLasso();
            props.onSelectRows(rows, event.shiftKey ? "add" : "replace");
            return;
          }
          endLasso();
          if (pointer.moved) return;
          const row = engine.rowAt(localPoint(event));
          if (row >= 0) props.onSelectRows([row], event.shiftKey ? "toggle" : "replace", row);
          else if (!event.shiftKey) props.onSelectRows([], "replace");
        }}
        onPointerCancel={() => {
          pointerRef.current = null;
          endLasso();
        }}
        onPointerLeave={() => {
          if (!pointerRef.current) hoverRow(-1);
        }}
      >
        {props.children}
      </canvas>
    </div>
  );
}
