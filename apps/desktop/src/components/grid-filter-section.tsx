import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown01Icon, ArrowUpDownIcon, Cancel01Icon, ChartHistogramIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Bar, BarChart, XAxis } from "recharts";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Slider } from "./ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import type { GridFilterColumn, GridFilterModel, ShellActions } from "./types";

const MAX_COLUMNS = 40;

const CHART_CONFIG = { count: { label: "Rows", color: "var(--accent)" } } satisfies ChartConfig;

function formatNumber(value: number) {
  if (Number.isInteger(value)) return String(value);
  const magnitude = Math.abs(value);
  const text = magnitude >= 1000 ? value.toFixed(1) : magnitude >= 1 ? value.toFixed(3) : value.toPrecision(3);
  return text.includes(".") ? text.replace(/\.?0+$/u, "") : text;
}

type Bin = { index: number; start: number; end: number; count: number };

type Scale = {
  min: number;
  max: number;
  bins: Bin[];
  /** Integer columns move by whole units; everything else gets a fine slider. */
  step: number;
  integral: boolean;
  /** A flat distribution — a row id or counter — says nothing worth drawing. */
  flat: boolean;
};

function columnScale(column: GridFilterColumn): Scale | null {
  const counts = column.bins ?? [];
  if (counts.length < 2 || column.min === undefined || column.max === undefined) return null;
  const { min, max } = column;
  const span = max - min;
  const width = span / counts.length;
  const integral = Number.isInteger(min) && Number.isInteger(max) && span >= counts.length;
  const peak = Math.max(...counts);
  return {
    min,
    max,
    integral,
    flat: peak > 0 && (peak - Math.min(...counts)) / peak <= 0.05,
    step: integral ? 1 : span / 400,
    bins: counts.map((count, index) => ({
      index,
      count,
      start: min + width * index,
      end: index === counts.length - 1 ? max : min + width * (index + 1),
    })),
  };
}

function snap(value: number, scale: Scale) {
  const clamped = Math.min(scale.max, Math.max(scale.min, value));
  return scale.integral ? Math.round(clamped) : Number(clamped.toPrecision(6));
}

// The bin a value lands in, so the chart can shade the selected window even
// while the range is still being dragged and the grid has not re-filtered yet.
function binOf(value: number, scale: Scale) {
  const span = scale.max - scale.min;
  if (!(span > 0)) return 0;
  const index = Math.floor(((value - scale.min) / span) * scale.bins.length);
  return Math.min(scale.bins.length - 1, Math.max(0, index));
}

function NumericFilter({
  column,
  scale,
  chartOpen,
  actions,
}: { column: GridFilterColumn; scale: Scale; chartOpen: boolean; actions: ShellActions }) {
  const filterKey = `${column.filter?.min ?? ""}|${column.filter?.max ?? ""}`;
  const committed = useMemo<[number, number]>(() => {
    const low = Number.parseFloat(column.filter?.min ?? "");
    const high = Number.parseFloat(column.filter?.max ?? "");
    return [Number.isFinite(low) ? low : scale.min, Number.isFinite(high) ? high : scale.max];
  }, [column.filter?.min, column.filter?.max, scale.min, scale.max]);

  // Re-seed the draft whenever the grid reports a different filter, so dragging
  // stays smooth locally but an outside change still wins.
  const [draft, setDraft] = useState<[number, number]>(committed);
  const seen = useRef(filterKey);
  if (seen.current !== filterKey) {
    seen.current = filterKey;
    setDraft(committed);
  }

  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; from: [number, number]; next: [number, number] } | null>(null);

  const commit = (range: [number, number]) => {
    actions.setGridColumnFilter(column.id, "min", range[0] <= scale.min ? "" : String(snap(range[0], scale)));
    actions.setGridColumnFilter(column.id, "max", range[1] >= scale.max ? "" : String(snap(range[1], scale)));
  };

  // Dragging the middle of the range slides the whole window, keeping its width,
  // which is the one gesture a two-thumb slider cannot express on its own.
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { x: event.clientX, from: draft, next: draft };
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const width = trackRef.current?.clientWidth ?? 0;
    if (!pan || !width) return;
    const span = scale.max - scale.min;
    const raw = ((event.clientX - pan.x) / width) * span;
    const shift = Math.max(scale.min - pan.from[0], Math.min(scale.max - pan.from[1], raw));
    pan.next = [pan.from[0] + shift, pan.from[1] + shift];
    setDraft(pan.next);
  };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    panRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    commit(pan.next);
  };

  const low = ((draft[0] - scale.min) / (scale.max - scale.min)) * 100;
  const high = ((draft[1] - scale.min) / (scale.max - scale.min)) * 100;

  const shaded = drag
    ? { lo: Math.min(drag.from, drag.to), hi: Math.max(drag.from, drag.to) }
    : { lo: binOf(draft[0], scale), hi: binOf(draft[1], scale) };
  // Recharts reads `fill` off each datum, so the selected window repaints from
  // the draft range without waiting for the grid to re-filter.
  const data = scale.bins.map((bin) => ({
    ...bin,
    fill: bin.index >= shaded.lo && bin.index <= shaded.hi ? "var(--grid-filter-bin-active)" : "var(--grid-filter-bin)",
  }));

  // The bin under the pointer is pure geometry — bars fill the plot area evenly —
  // so reading it directly beats waiting on the chart library's own hit testing.
  const binAt = (clientX: number) => {
    const box = chartRef.current?.getBoundingClientRect();
    if (!box || !box.width) return null;
    const index = Math.floor(((clientX - box.left) / box.width) * scale.bins.length);
    return Math.min(scale.bins.length - 1, Math.max(0, index));
  };
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const index = binAt(event.clientX);
    if (index === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ from: index, to: index });
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const index = binAt(event.clientX);
    if (index !== null && index !== drag.to) setDrag({ from: drag.from, to: index });
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const lo = scale.bins[Math.min(drag.from, drag.to)];
    const hi = scale.bins[Math.max(drag.from, drag.to)];
    setDrag(null);
    const range: [number, number] = [snap(lo.start, scale), snap(hi.end, scale)];
    setDraft(range);
    commit(range);
  };

  return (
    <>
      {chartOpen ? (
        <div
          className="grid-filter-chart-wrap"
          ref={chartRef}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <ChartContainer config={CHART_CONFIG} className="grid-filter-chart aspect-auto h-28 w-full">
            {/* The chart is pointer-driven and the slider below is the keyboard
                path, so the surface must not grab focus and draw a focus ring. */}
            <BarChart accessibilityLayer={false} data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={1}>
              <XAxis dataKey="index" type="category" hide />
              <ChartTooltip
                cursor={{ fill: "color-mix(in srgb, currentColor 8%, transparent)" }}
                content={
                  <ChartTooltipContent
                    hideIndicator
                    labelFormatter={(_label, payload) => {
                      const bin = payload?.[0]?.payload as Bin | undefined;
                      return bin ? `${formatNumber(bin.start)} – ${formatNumber(bin.end)}` : "";
                    }}
                    formatter={(value) => `${Number(value).toLocaleString()} rows`}
                  />
                }
              />
              <Bar dataKey="count" name="count" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </div>
      ) : null}
      <div className="grid-filter-slider-wrap" ref={trackRef}>
        <Slider
          className="grid-filter-slider"
          min={scale.min}
          max={scale.max}
          step={scale.step}
          value={draft}
          onValueChange={(next) => setDraft([next[0], next[1]])}
          onValueCommit={(next) => commit([next[0], next[1]])}
          aria-label={`${column.label} range`}
        />
        <div
          className="grid-filter-slider-grab"
          style={{ left: `calc(${low}% + 9px)`, width: `calc(${high - low}% - 18px)` }}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          aria-hidden
        />
      </div>
      <div className="grid-filter-inputs">
        <Input
          type="number"
          inputMode="decimal"
          placeholder={formatNumber(scale.min)}
          value={column.filter?.min ?? ""}
          aria-label={`Minimum ${column.label}`}
          onChange={(event) => actions.setGridColumnFilter(column.id, "min", event.currentTarget.value)}
        />
        <Input
          type="number"
          inputMode="decimal"
          placeholder={formatNumber(scale.max)}
          value={column.filter?.max ?? ""}
          aria-label={`Maximum ${column.label}`}
          onChange={(event) => actions.setGridColumnFilter(column.id, "max", event.currentTarget.value)}
        />
      </div>
    </>
  );
}

function FilterCard({ column, actions, bulk }: { column: GridFilterColumn; actions: ShellActions; bulk: { open: boolean } | null }) {
  const scale = useMemo(() => columnScale(column), [column]);
  const active = Boolean(column.filter && (column.filter.min || column.filter.max || column.filter.text));
  const [open, setOpen] = useState(active);
  // A flat histogram is a row id or a counter, so its chart starts folded away.
  const [chartOpen, setChartOpen] = useState<boolean | null>(null);
  const showChart = chartOpen ?? !scale?.flat;

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  // Each click mints a fresh object, so the same direction applies again to
  // cards the user has toggled by hand since the last sweep.
  useEffect(() => {
    if (bulk) setOpen(bulk.open);
  }, [bulk]);

  return (
    <Collapsible className="grid-filter-card" data-active={active || undefined} open={open} onOpenChange={setOpen}>
      <div className="grid-filter-card-header">
        <CollapsibleTrigger asChild>
          <Button className="grid-filter-card-trigger" variant="ghost" size="sm">
            <HugeiconsIcon icon={ArrowDown01Icon} data-icon="inline-start" aria-hidden="true" />
            <span title={column.label}>{column.label}</span>
            {active ? <Badge variant="secondary">Active</Badge> : null}
          </Button>
        </CollapsibleTrigger>
        <div className="grid-filter-card-actions">
          {active ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-2xs"
                  onClick={() => actions.clearGridColumnFilters(column.id)}
                  aria-label={`Clear the ${column.label} filter`}
                >
                  <HugeiconsIcon icon={Cancel01Icon} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent showArrow={false}>Clear filter</TooltipContent>
            </Tooltip>
          ) : null}
          {scale ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-2xs"
                  aria-expanded={showChart}
                  aria-label={`${showChart ? "Hide" : "Show"} the ${column.label} distribution`}
                  onClick={() => setChartOpen(!showChart)}
                >
                  <HugeiconsIcon icon={ChartHistogramIcon} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent showArrow={false}>{showChart ? "Hide" : "Show"} distribution</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <CollapsibleContent className="grid-filter-card-content">
        <Field>
          <FieldLabel className="sr-only">{column.label}</FieldLabel>
          {scale ? (
            <NumericFilter column={column} scale={scale} chartOpen={showChart} actions={actions} />
          ) : (
            <Input
              type="search"
              placeholder="contains"
              value={column.filter?.text ?? ""}
              aria-label={`Filter ${column.label}`}
              onChange={(event) => actions.setGridColumnFilter(column.id, "text", event.currentTarget.value)}
            />
          )}
        </Field>
      </CollapsibleContent>
    </Collapsible>
  );
}

// The model is a copy of what the grid runtime holds; every edit here is a
// command back to it, and the next model it publishes is the confirmation.
export function GridFilterSection({ model, actions }: { model: GridFilterModel; actions: ShellActions }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const [bulk, setBulk] = useState<{ open: boolean } | null>(null);
  const allOpen = bulk?.open === true;
  const columns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return model.columns.filter((column) => !needle || column.label.toLowerCase().includes(needle));
  }, [model.columns, query]);
  const shown = columns.slice(0, MAX_COLUMNS);
  const activeCount = model.columns.filter((column) => column.filter).length;

  return (
    <TooltipProvider>
      <Collapsible
        className="structure-brief-card structure-inspector-section grid-filter-card-host"
        data-collapsed={!open || undefined}
        open={open}
        onOpenChange={setOpen}
      >
        <div className="structure-inspector-section-header">
          <CollapsibleTrigger asChild>
            <Button className="structure-inspector-section-title-button" variant="ghost" size="sm">
              Filters
            </Button>
          </CollapsibleTrigger>
          <div className="grid-filter-host-actions">
            {open ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-2xs"
                    aria-expanded={allOpen}
                    aria-label={allOpen ? "Collapse all filters" : "Expand all filters"}
                    onClick={() => setBulk({ open: !allOpen })}
                  >
                    <HugeiconsIcon icon={ArrowUpDownIcon} aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent showArrow={false}>{allOpen ? "Collapse all" : "Expand all"}</TooltipContent>
              </Tooltip>
            ) : null}
            {activeCount ? (
              <Button type="button" variant="ghost" size="xs" onClick={() => actions.clearGridColumnFilters()}>
                Clear all
                <Badge variant="secondary">{activeCount.toLocaleString()}</Badge>
              </Button>
            ) : (
              <Badge variant="secondary">{model.columns.length.toLocaleString()} columns</Badge>
            )}
          </div>
        </div>
        <CollapsibleContent>
          <div className="grid-filter-count">
            {model.visible.toLocaleString()} of {model.total.toLocaleString()} rows
          </div>
          <Field className="grid-filter-search-field">
            <FieldLabel className="sr-only">Find a column to filter</FieldLabel>
            <div className="grid-filter-search-wrap">
              <HugeiconsIcon icon={Search01Icon} aria-hidden="true" />
              <Input
                type="search"
                className="grid-filter-search"
                value={query}
                placeholder="Find a column"
                aria-label="Find a column to filter"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
          </Field>
          <div className="grid-filter-list">
            {shown.map((column) => <FilterCard key={column.id} column={column} actions={actions} bulk={bulk} />)}
            {columns.length > shown.length ? (
              <div className="grid-filter-more">
                {(columns.length - shown.length).toLocaleString()} more columns — narrow the search
              </div>
            ) : null}
            {columns.length ? null : <div className="dock-empty">No filterable columns</div>}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </TooltipProvider>
  );
}
