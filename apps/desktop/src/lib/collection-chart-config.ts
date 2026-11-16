import { chartSeriesKey, type ChartColumn, type ChartColumnRequest } from "./collection-chart-data";

// Which columns a chart draws. The user's picks are kept per chart type, and
// anything unset or no longer in the collection falls back to a sensible column.

export type ChartType = "scatter" | "histogram" | "bar" | "box";

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  scatter: "Scatter",
  histogram: "Histogram",
  bar: "Bar",
  box: "Box",
};

/** A stored pick: a column id, "" for an explicit none, undefined for the default. */
export type ChartChoices = {
  type?: ChartType;
  x?: Partial<Record<ChartType, string>>;
  y?: Partial<Record<ChartType, string>>;
  color?: string;
  size?: string;
};

export type ChartAxisChoice = {
  column: ChartColumn | null;
  options: ChartColumn[];
  /** Label of the choice that uses no column, when the axis allows one. */
  noneLabel: string | null;
  /** How the grid should read the column for this role. */
  request: ChartColumnRequest | null;
};

export type ChartConfig = {
  type: ChartType;
  types: ChartType[];
  x: ChartAxisChoice;
  y: ChartAxisChoice | null;
  color: ChartAxisChoice | null;
  size: ChartAxisChoice | null;
  requests: ChartColumnRequest[];
};

function pick(
  options: ChartColumn[],
  stored: string | undefined,
  fallback: ChartColumn | null,
  noneLabel: string | null,
  valueType: "number" | "text" | "column",
): ChartAxisChoice {
  const column = stored === "" && noneLabel !== null
    ? null
    : options.find(option => option.id === stored) ?? fallback;
  return {
    column,
    options,
    noneLabel,
    request: column ? { id: column.id, valueType: valueType === "column" ? column.type : valueType } : null,
  };
}

export function resolveChartConfig(columns: readonly ChartColumn[], choices: ChartChoices): ChartConfig | null {
  if (columns.length === 0) return null;
  const all = [...columns];
  const numbers = all.filter(column => column.type === "number");
  const texts = all.filter(column => column.type === "text");
  const types: ChartType[] = numbers.length > 0 ? ["scatter", "histogram", "bar", "box"] : ["bar"];
  const fallbackType: ChartType = numbers.length >= 2 ? "scatter" : numbers.length === 1 ? "histogram" : "bar";
  const type = choices.type && types.includes(choices.type) ? choices.type : fallbackType;
  const storedX = choices.x?.[type];
  const storedY = choices.y?.[type];
  let x: ChartAxisChoice;
  let y: ChartAxisChoice | null = null;
  let color: ChartAxisChoice | null = null;
  let size: ChartAxisChoice | null = null;
  if (type === "scatter") {
    x = pick(numbers, storedX, numbers[0], null, "number");
    y = pick(numbers, storedY, numbers[1] ?? numbers[0], null, "number");
    color = pick(all, choices.color, null, "None", "column");
    size = pick(numbers, choices.size, null, "None", "number");
  } else if (type === "histogram") {
    x = pick(numbers, storedX, numbers[0], null, "number");
  } else if (type === "bar") {
    x = pick(all, storedX, texts[0] ?? all[0], null, "text");
    y = pick(numbers, storedY, null, "Count", "number");
  } else {
    x = pick(all, storedX, texts[0] ?? null, "All rows", "text");
    y = pick(numbers, storedY, numbers[0], null, "number");
  }
  const requests: ChartColumnRequest[] = [];
  for (const choice of [x, y, color, size]) {
    const request = choice?.request;
    if (request && !requests.some(existing => chartSeriesKey(existing) === chartSeriesKey(request))) requests.push(request);
  }
  return { type, types, x, y, color, size, requests };
}
