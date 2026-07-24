import { useMemo, useState } from "react";
import type { GridFilterColumn, GridFilterModel, ShellActions } from "./types";

const MAX_COLUMNS = 40;

function formatNumber(value: number) {
  if (Number.isInteger(value)) return String(value);
  const magnitude = Math.abs(value);
  const text = magnitude >= 1000 ? value.toFixed(1) : magnitude >= 1 ? value.toFixed(3) : value.toPrecision(3);
  return text.includes(".") ? text.replace(/\.?0+$/u, "") : text;
}

// Bars outside the selected range stay in place, dimmed, so a filter reads as a
// window onto the distribution rather than a new distribution.
function Histogram({ column }: { column: GridFilterColumn }) {
  const bins = column.bins ?? [];
  if (bins.length < 2 || column.min === undefined || column.max === undefined) return null;
  const peak = Math.max(...bins);
  const low = Number.parseFloat(column.filter?.min ?? "");
  const high = Number.parseFloat(column.filter?.max ?? "");
  const span = column.max - column.min;
  return (
    <div className="grid-filter-histogram">
      {bins.map((count, index) => {
        const start = column.min! + (span * index) / bins.length;
        const end = column.min! + (span * (index + 1)) / bins.length;
        const inRange = (!Number.isFinite(low) || end >= low) && (!Number.isFinite(high) || start <= high);
        return (
          <span
            key={index}
            className={inRange ? "grid-filter-bin in-range" : "grid-filter-bin"}
            style={{ height: `${peak ? Math.max(count ? 8 : 0, Math.round((count / peak) * 100)) : 0}%` }}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

function FilterCard({ column, actions }: { column: GridFilterColumn; actions: ShellActions }) {
  const active = Boolean(column.filter && (column.filter.min || column.filter.max || column.filter.text));
  return (
    <section className={active ? "grid-filter-card active" : "grid-filter-card"}>
      <header>
        <span title={column.label}>{column.label}</span>
        {active ? (
          <button
            type="button"
            className="grid-filter-clear"
            onClick={() => actions.clearGridColumnFilters(column.id)}
            aria-label={`Clear the ${column.label} filter`}
          >
            Clear
          </button>
        ) : null}
      </header>
      {column.type === "number" ? (
        <>
          <Histogram column={column} />
          {column.min !== undefined && column.max !== undefined ? (
            <div className="grid-filter-range">
              <span>{formatNumber(column.min)}</span>
              <span>{formatNumber(column.max)}</span>
            </div>
          ) : null}
          <div className="grid-filter-inputs">
            <input
              type="number"
              inputMode="decimal"
              placeholder="min"
              value={column.filter?.min ?? ""}
              aria-label={`Minimum ${column.label}`}
              onChange={(event) => actions.setGridColumnFilter(column.id, "min", event.currentTarget.value)}
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="max"
              value={column.filter?.max ?? ""}
              aria-label={`Maximum ${column.label}`}
              onChange={(event) => actions.setGridColumnFilter(column.id, "max", event.currentTarget.value)}
            />
          </div>
        </>
      ) : (
        <input
          type="search"
          placeholder="contains"
          value={column.filter?.text ?? ""}
          aria-label={`Filter ${column.label}`}
          onChange={(event) => actions.setGridColumnFilter(column.id, "text", event.currentTarget.value)}
        />
      )}
    </section>
  );
}

// The model is a copy of what the grid runtime holds; every edit here is a
// command back to it, and the next model it publishes is the confirmation.
export function GridFilterSection({ model, actions }: { model: GridFilterModel; actions: ShellActions }) {
  const [query, setQuery] = useState("");
  const columns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return model.columns.filter((column) => !needle || column.label.toLowerCase().includes(needle));
  }, [model.columns, query]);
  const shown = columns.slice(0, MAX_COLUMNS);
  const activeCount = model.columns.filter((column) => column.filter).length;

  return (
    <section className="structure-brief-card grid-filter-card-host">
      <div className="structure-inspector-section-header">
        <h4>Filters</h4>
        {activeCount ? (
          <button type="button" className="grid-filter-clear" onClick={() => actions.clearGridColumnFilters()}>
            Clear all
          </button>
        ) : (
          <span>{model.columns.length.toLocaleString()} columns</span>
        )}
      </div>
      <div className="grid-filter-count">
        {model.visible.toLocaleString()} of {model.total.toLocaleString()} molecules
      </div>
      <input
        type="search"
        className="grid-filter-search"
        value={query}
        placeholder="Find a column"
        aria-label="Find a column to filter"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="grid-filter-list">
        {shown.map((column) => <FilterCard key={column.id} column={column} actions={actions} />)}
        {columns.length > shown.length ? (
          <div className="grid-filter-more">
            {(columns.length - shown.length).toLocaleString()} more columns — narrow the search
          </div>
        ) : null}
        {columns.length ? null : <div className="dock-empty">No filterable columns</div>}
      </div>
    </section>
  );
}
