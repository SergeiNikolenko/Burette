import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "@/components/ui/app-icons";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PanelEmptyState } from "@/components/ui/panel-empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useChemicalSpaceSetting } from "../hooks/use-chemical-space-setting";
import { useCollectionChartSource, type ChartMoleculePreview } from "../hooks/use-collection-chart-source";
import { Structure } from "./rgroup-preview";
import "./rgroup-analysis.css";
import { barChart, boxChart, histogramChart, type BandChart } from "../lib/collection-chart-bands";
import { CHART_CATEGORY_COLORS, CHART_NEUTRAL_COLOR, cssColor, rowColors, sequentialColor } from "../lib/collection-chart-color";
import {
  CHART_TYPE_LABELS,
  resolveChartConfig,
  type ChartAxisChoice,
  type ChartChoices,
  type ChartType,
} from "../lib/collection-chart-config";
import {
  chartSeriesKey,
  rowMask,
  sourceRecordIdsOfRows,
  type CategorySeries,
  type ChartColumn,
  type ChartSeries,
  type ChartTable,
  type NumericSeries,
} from "../lib/collection-chart-data";
import { fitScatterView, scatterSizeLevels } from "../lib/collection-chart-scatter";
import { countByGroup, formatAxisValue } from "../lib/collection-chart-stats";
import type { ViewerDocument } from "../types";
import { CollectionChartBands } from "./collection-chart-bands";
import { CollectionChartScatter, type ChartSelectionMode } from "./collection-chart-scatter";
import { ShortcutTooltip } from "./shortcut-tooltip";

const NO_CHOICES: ChartChoices = {};
const AXIS_LABELS: Record<ChartType, { x: string; y: string }> = {
  scatter: { x: "X", y: "Y" },
  histogram: { x: "Column", y: "" },
  bar: { x: "Category", y: "Value" },
  box: { x: "Group", y: "Value" },
};

type TipTarget = { kind: "row"; row: number } | { kind: "band"; band: number };
/** `right` is set instead of `left` when the tip opens towards the left. */
type Tip = TipTarget & { left?: number; right?: number; top: number };

// Values keep the decimal point of the axis labels next to them.
function formatValue(value: number) {
  return String(Number(value.toPrecision(5)));
}

function bandLabel(chart: BandChart, band: number) {
  if (chart.labels) return chart.labels[band];
  const { start, step } = chart.bins!;
  // One bin per whole number reads as that number, not as a half-open range.
  if (step === 1 && !Number.isInteger(start)) return String(start + band + 0.5);
  return `${formatAxisValue(start + band * step, step)} – ${formatAxisValue(start + (band + 1) * step, step)}`;
}

export function CollectionChartPanel({ document, visible }: { document: ViewerDocument | null; visible: boolean }) {
  if (!document) return <PanelEmptyState title="No collection selected" icon={<Chart />} />;
  return <CollectionChart key={document.id} documentId={document.id} visible={visible} />;
}

function CollectionChart({ documentId, visible }: { documentId: string; visible: boolean }) {
  const settingsKey = `chart:${documentId}`;
  const [choices, setChoices] = useChemicalSpaceSetting<ChartChoices>(settingsKey, "choices", NO_CHOICES);
  const [tool, setTool] = useChemicalSpaceSetting<"navigate" | "lasso">(settingsKey, "tool", "navigate");
  const [fitRequest, setFitRequest] = useState(0);
  const [tip, setTip] = useState<Tip | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const columnsToRead = useCallback(
    (columns: readonly ChartColumn[]) => resolveChartConfig(columns, choices)?.requests ?? [],
    [choices],
  );
  const source = useCollectionChartSource(documentId, visible, columnsToRead);
  const { columns, table, selectedIds, visibleIds, select, hover } = source;
  const config = useMemo(() => columns ? resolveChartConfig(columns, choices) : null, [columns, choices]);

  const included = useMemo(() => table ? rowMask(table, visibleIds) : null, [table, visibleIds]);
  const selected = useMemo(() => table ? rowMask(table, selectedIds) : null, [table, selectedIds]);
  const selectedCount = useMemo(() => {
    let count = 0;
    if (selected && included) for (let row = 0; row < selected.length; row += 1) count += selected[row] & included[row];
    return count;
  }, [included, selected]);

  const seriesOf = (choice: ChartAxisChoice | null | undefined): ChartSeries | null =>
    choice?.request && table ? table.series.get(chartSeriesKey(choice.request)) ?? null : null;
  const xSeries = seriesOf(config?.x);
  const ySeries = seriesOf(config?.y);
  const colorSeries = seriesOf(config?.color);
  const sizeSeries = seriesOf(config?.size);
  // A chart is ready once the table answers every column the current picks need.
  const ready = Boolean(config && table && included && selected
    && config.requests.every(request => table.series.has(chartSeriesKey(request))));

  const type = config?.type ?? "scatter";
  const yTitle = type === "histogram" || (type === "bar" && !config?.y?.column)
    ? "Count"
    : type === "bar" ? `Mean ${config?.y?.column?.label ?? ""}` : config?.y?.column?.label ?? "";
  const xTitle = config?.x.column?.label ?? "";

  const bands = useMemo(() => {
    if (!ready || !included || type === "scatter") return null;
    if (type === "histogram") return xSeries?.kind === "number" ? histogramChart(xSeries, included) : null;
    if (type === "bar") {
      return xSeries?.kind === "category"
        ? barChart(xSeries, included, ySeries?.kind === "number" ? ySeries : null)
        : null;
    }
    return ySeries?.kind === "number"
      ? boxChart(xSeries?.kind === "category" ? xSeries : null, included, ySeries, yTitle)
      : null;
  }, [included, ready, type, xSeries, ySeries, yTitle]);

  const scatter = useMemo(() => {
    if (!ready || !table || !included || type !== "scatter") return null;
    if (xSeries?.kind !== "number" || ySeries?.kind !== "number") return null;
    if (!fitScatterView(xSeries.values, ySeries.values, included)) return null;
    return {
      x: xSeries,
      y: ySeries,
      colors: rowColors(colorSeries, table.sourceRecordIds.length),
      sizeLevels: sizeSeries?.kind === "number" ? scatterSizeLevels(sizeSeries.values, sizeSeries.min, sizeSeries.max) : null,
    };
  }, [colorSeries, included, ready, sizeSeries, table, type, xSeries, ySeries]);

  // The tip names a row or band of the chart that was on screen when it opened.
  useEffect(() => setTip(null), [bands, scatter]);
  // Opens beside the pointed mark, towards the middle of the chart.
  const showTip = (target: TipTarget, point: { x: number; y: number } | null) => {
    if (!point) {
      setTip(null);
      return;
    }
    const width = bodyRef.current?.clientWidth ?? 0;
    setTip({
      ...target,
      ...(point.x > width / 2 ? { right: width - point.x + 14 } : { left: point.x + 14 }),
      top: Math.max(8, point.y - 12),
    });
  };

  const selectRows = useCallback((rows: number[], mode: ChartSelectionMode, focusRow?: number) => {
    if (!table) return;
    const ids = sourceRecordIdsOfRows(table, rows);
    if (mode === "replace") {
      select(ids, focusRow === undefined ? null : table.sourceRecordIds[focusRow]);
      return;
    }
    const next = new Set(selectedIds);
    if (mode === "toggle" && ids.every(id => next.has(id))) for (const id of ids) next.delete(id);
    else for (const id of ids) next.add(id);
    select([...next]);
  }, [select, selectedIds, table]);

  const setAxis = (axis: "x" | "y", id: string) => setChoices(current => ({
    ...current,
    [axis]: { ...current[axis], [type]: id },
  }));
  const columnSelect = (label: string, choice: ChartAxisChoice, onChange: (id: string) => void) => (
    <label className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {label}
      <NativeSelect
        size="sm"
        className="w-28 min-w-20 max-w-44 flex-1"
        aria-label={`${label} column`}
        value={choice.column?.id ?? ""}
        onChange={event => onChange(event.currentTarget.value)}
      >
        {choice.noneLabel !== null ? <NativeSelectOption value="">{choice.noneLabel}</NativeSelectOption> : null}
        {choice.options.map(column => (
          <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );

  const hoveredRow = table && source.hoveredId !== null ? table.rowBySourceRecordId.get(source.hoveredId) ?? -1 : -1;
  const shownCount = useMemo(() => {
    let count = 0;
    if (included) for (const flag of included) count += flag;
    return count;
  }, [included]);

  let body: React.ReactNode;
  if (source.failed && !ready) {
    body = <PanelEmptyState title="Could not read the collection" icon={<Chart />} action={{ label: "Retry", run: source.retry }} />;
  } else if (columns && !config) {
    body = <PanelEmptyState title="No columns to chart" icon={<Chart />} />;
  } else if (!ready) {
    body = <DelayedSpinner />;
  } else if (scatter && table) {
    body = (
      <CollectionChartScatter
        {...scatter}
        xLabel={xTitle}
        yLabel={yTitle}
        viewKey={`${config!.x.column?.id}\n${config!.y?.column?.id}`}
        include={included!}
        selected={selected!}
        selectedCount={selectedCount}
        hoveredRow={hoveredRow}
        tool={tool}
        fitRequest={fitRequest}
        onSelectRows={selectRows}
        onHoverRow={(row, point) => {
          showTip({ kind: "row", row }, row >= 0 ? point : null);
          hover(row >= 0 ? table.sourceRecordIds[row] : null);
        }}
      >
        <p>{shownCount.toLocaleString()} points, {selectedCount.toLocaleString()} selected</p>
      </CollectionChartScatter>
    );
  } else if (bands) {
    body = (
      <CollectionChartBands
        chart={bands}
        xLabel={xTitle}
        yLabel={yTitle}
        selected={selected!}
        selectedCount={selectedCount}
        onSelectRows={selectRows}
        onHoverBand={(band, point) => showTip({ kind: "band", band }, band >= 0 ? point : null)}
      >
        <BandTable chart={bands} xLabel={xTitle} yLabel={yTitle} selected={selected!} />
      </CollectionChartBands>
    );
  } else {
    body = <PanelEmptyState title="Nothing to plot" icon={<Chart />} />;
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-testid="collection-chart-panel"
      data-chart-type={ready ? type : undefined}
      data-rows={ready ? shownCount : undefined}
      data-selected={ready ? selectedCount : undefined}
    >
      {config ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-3 py-1.5">
          <NativeSelect
            size="sm"
            className="w-28 shrink-0"
            aria-label="Chart type"
            value={type}
            onChange={event => setChoices(current => ({ ...current, type: event.currentTarget.value as ChartType }))}
          >
            {config.types.map(option => (
              <NativeSelectOption key={option} value={option}>{CHART_TYPE_LABELS[option]}</NativeSelectOption>
            ))}
          </NativeSelect>
          {columnSelect(AXIS_LABELS[type].x, config.x, id => setAxis("x", id))}
          {config.y ? columnSelect(AXIS_LABELS[type].y, config.y, id => setAxis("y", id)) : null}
          {config.color ? columnSelect("Colour", config.color, id => setChoices(current => ({ ...current, color: id }))) : null}
          {config.size ? columnSelect("Size", config.size, id => setChoices(current => ({ ...current, size: id }))) : null}
          {type === "scatter" ? (
            <>
              <ShortcutTooltip label={tool === "lasso" ? "Turn off lasso" : "Draw a selection"}>
                <Button
                  className="shrink-0"
                  variant={tool === "lasso" ? "secondary" : "ghost"}
                  size="sm"
                  aria-label="Lasso selection"
                  aria-pressed={tool === "lasso"}
                  onClick={() => setTool(current => current === "lasso" ? "navigate" : "lasso")}
                >
                  Lasso
                </Button>
              </ShortcutTooltip>
              <ShortcutTooltip label="Show every point" shortcut="0">
                <Button className="shrink-0" variant="ghost" size="sm" onClick={() => setFitRequest(value => value + 1)}>Fit</Button>
              </ShortcutTooltip>
            </>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {source.loading && ready ? <Spinner className="size-3.5" /> : null}
            {table && table.total > table.sourceRecordIds.length ? (
              <span>First {table.sourceRecordIds.length.toLocaleString()} of {table.total.toLocaleString()} rows</span>
            ) : null}
            {ready && visibleIds ? <span>{shownCount.toLocaleString()} of {table!.sourceRecordIds.length.toLocaleString()} shown</span> : null}
            {selectedIds.length > 0 ? <span>{selectedIds.length.toLocaleString()} selected</span> : null}
          </div>
        </div>
      ) : null}
      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-hidden">
        {body}
        {ready && scatter && colorSeries && config?.color?.column ? (
          <ColorLegend
            title={config.color.column.label}
            series={colorSeries}
            onSelectCategory={(code) => {
              const rows: number[] = [];
              if (colorSeries.kind === "category") {
                for (let row = 0; row < colorSeries.codes.length; row += 1) {
                  if (included![row] && (code < 0 ? colorSeries.codes[row] >= CHART_CATEGORY_COLORS.length : colorSeries.codes[row] === code)) rows.push(row);
                }
              }
              selectRows(rows, "replace");
            }}
          />
        ) : null}
        {ready && tip ? (
          <ChartTip
            tip={tip}
            table={table!}
            bands={bands}
            selected={selected!}
            preview={source.preview}
            lines={tip.kind === "row" && scatter
              ? [[xTitle, scatter.x.values[tip.row]], [yTitle, scatter.y.values[tip.row]]]
              : []}
            valueLabel={yTitle}
          />
        ) : null}
      </div>
    </div>
  );
}

// Loading that ends within a moment shows nothing; a spinner appears only for a real wait.
function DelayedSpinner() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), 300);
    return () => window.clearTimeout(timer);
  }, []);
  return shown ? (
    <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
      <Spinner className="size-4" />
      Reading the collection…
    </div>
  ) : null;
}

function ColorLegend({ title, series, onSelectCategory }: {
  title: string;
  series: NumericSeries | CategorySeries;
  /** Category code, or -1 for the grey rows past the palette. */
  onSelectCategory: (code: number) => void;
}) {
  const frame = "absolute right-4 top-4 z-10 max-w-44 rounded-lg border border-border bg-background/85 px-2 py-1.5 text-[11px] shadow-sm backdrop-blur";
  if (series.kind === "number") {
    if (series.count === 0) return null;
    const stops = Array.from({ length: 9 }, (_, step) => cssColor(sequentialColor(step / 8))).join(", ");
    return (
      <div className={`${frame} pointer-events-none w-36`} data-testid="collection-chart-legend">
        <div className="truncate font-medium text-foreground">{title}</div>
        <div className="mt-1 h-1.5 rounded-full" style={{ background: `linear-gradient(to right, ${stops})` }} />
        <div className="mt-0.5 flex justify-between tabular-nums text-muted-foreground">
          <span>{formatValue(series.min)}</span>
          <span>{formatValue(series.max)}</span>
        </div>
      </div>
    );
  }
  const colored = series.labels.slice(0, CHART_CATEGORY_COLORS.length);
  const entry = (label: string, color: number, code: number) => (
    <button
      key={code}
      type="button"
      className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-foreground hover:bg-accent"
      onClick={() => onSelectCategory(code)}
    >
      <span className="size-2 shrink-0 rounded-full" style={{ background: cssColor(color) }} />
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <div className={`${frame} flex flex-col`} data-testid="collection-chart-legend">
      <div className="truncate px-1 font-medium text-foreground">{title}</div>
      {colored.map((label, code) => entry(label, CHART_CATEGORY_COLORS[code], code))}
      {series.labels.length > colored.length ? entry("Other", CHART_NEUTRAL_COLOR, -1) : null}
    </div>
  );
}

function ChartTip({ tip, table, bands, selected, preview, lines, valueLabel }: {
  tip: Tip;
  table: ChartTable;
  bands: BandChart | null;
  selected: Uint8Array;
  preview: ChartMoleculePreview | null;
  lines: Array<[string, number]>;
  valueLabel: string;
}) {
  const frame = "pointer-events-none absolute z-20 w-max max-w-56 rounded-lg border border-border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md";
  const style = { left: tip.left, right: tip.right, top: tip.top };
  if (tip.kind === "row") {
    const id = table.sourceRecordIds[tip.row];
    const molecule = preview?.sourceRecordId === id ? preview : null;
    return (
      <div className={frame} style={style} data-testid="collection-chart-tip">
        {molecule?.smiles ? <div className="mb-1 w-52 [&_.rgroup-structure]:h-30"><Structure smiles={molecule.smiles} label={molecule.name} width={208} height={120} /></div>
          : molecule?.svgUrl ? <img className="mb-1 h-24 w-44 rounded-md bg-white object-contain" src={molecule.svgUrl} alt="" /> : null}
        <div className="truncate font-medium">{molecule?.name || `Row ${id + 1}`}</div>
        {lines.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 tabular-nums">
            <span className="truncate text-muted-foreground">{label}</span>
            <span>{formatValue(value)}</span>
          </div>
        ))}
      </div>
    );
  }
  if (!bands || tip.band >= bands.bandCount) return null;
  const rows = bands.rowCounts[tip.band];
  const picked = countByGroup(bands.groupOfRow, bands.bandCount, selected)[tip.band];
  const box = bands.boxes?.[tip.band];
  const height = bands.heights?.[tip.band];
  return (
    <div className={frame} style={style} data-testid="collection-chart-tip">
      <div className="truncate font-medium">{bandLabel(bands, tip.band)}</div>
      <div className="tabular-nums">{rows.toLocaleString()} {rows === 1 ? "row" : "rows"}</div>
      {bands.kind === "bar" && valueLabel !== "Count" && height === height && height !== undefined ? (
        <div className="tabular-nums">{valueLabel} {formatValue(height)}</div>
      ) : null}
      {box ? <div className="tabular-nums">Median {formatValue(box.median)}</div> : null}
      {picked > 0 ? <div className="tabular-nums">{picked.toLocaleString()} selected</div> : null}
    </div>
  );
}

// What the canvas shows, as a table for assistive technology.
function BandTable({ chart, xLabel, yLabel, selected }: { chart: BandChart; xLabel: string; yLabel: string; selected: Uint8Array }) {
  const picked = countByGroup(chart.groupOfRow, chart.bandCount, selected);
  return (
    <table>
      <thead>
        <tr>
          <th>{xLabel}</th>
          {chart.boxes
            ? <><th>Rows</th><th>Lower whisker</th><th>First quartile</th><th>Median</th><th>Third quartile</th><th>Upper whisker</th><th>Outliers</th></>
            : <th>{yLabel}</th>}
          <th>Selected</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: chart.bandCount }, (_, band) => {
          const box = chart.boxes?.[band];
          const height = chart.heights?.[band];
          return (
            <tr key={band}>
              <th scope="row">{bandLabel(chart, band)}</th>
              {chart.boxes
                ? <><td>{chart.rowCounts[band]}</td><td>{box ? formatValue(box.whiskerLow) : ""}</td><td>{box ? formatValue(box.q1) : ""}</td><td>{box ? formatValue(box.median) : ""}</td><td>{box ? formatValue(box.q3) : ""}</td><td>{box ? formatValue(box.whiskerHigh) : ""}</td><td>{box?.outlierRows.length ?? 0}</td></>
                : <td>{height !== undefined && height === height ? formatValue(height) : ""}</td>}
              <td>{picked[band]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
