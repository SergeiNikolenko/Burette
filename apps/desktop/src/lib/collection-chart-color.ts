import type { CategorySeries, NumericSeries } from "./collection-chart-data";

// Colours are packed 0x00BBGGRR, the byte order of canvas pixels, so the
// scatter painter can blend them without unpacking.

function packRgb(red: number, green: number, blue: number) {
  return (blue << 16) | (green << 8) | red;
}

function packHex(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return packRgb((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
}

export function cssColor(packed: number) {
  return `rgb(${packed & 0xff} ${(packed >> 8) & 0xff} ${(packed >> 16) & 0xff})`;
}

// The same marks Chemical Space uses: one blue for plain points, ten group
// colours, and grey for whatever falls outside them.
export const CHART_MARK_COLOR = packHex("#659cc8");
export const CHART_NEUTRAL_COLOR = packHex("#a1a1aa");
export const CHART_CATEGORY_COLORS = [
  "#38bdf8", "#fb7185", "#4ade80", "#facc15", "#f97316",
  "#22d3ee", "#a3e635", "#f472b6", "#60a5fa", "#fbbf24",
].map(packHex);

const VIRIDIS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];

/** Viridis at `t` in 0–1, low values dark violet and high values yellow. */
export function sequentialColor(t: number) {
  const scaled = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const index = Math.min(VIRIDIS.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  const channel = (component: number) =>
    Math.round(VIRIDIS[index][component] + (VIRIDIS[index + 1][component] - VIRIDIS[index][component]) * fraction);
  return packRgb(channel(0), channel(1), channel(2));
}

/** Colour of every row for a colour column; rows without a value turn grey. */
export function rowColors(series: NumericSeries | CategorySeries | null, rowCount: number) {
  const colors = new Uint32Array(rowCount);
  if (!series) return colors.fill(CHART_MARK_COLOR);
  if (series.kind === "category") {
    for (let row = 0; row < rowCount; row += 1) {
      colors[row] = CHART_CATEGORY_COLORS[series.codes[row]] ?? CHART_NEUTRAL_COLOR;
    }
    return colors;
  }
  // 64 steps are past what the eye separates and keep the ramp a table lookup.
  const ramp = Uint32Array.from({ length: 64 }, (_, step) => sequentialColor(step / 63));
  const span = series.max - series.min;
  for (let row = 0; row < rowCount; row += 1) {
    const value = series.values[row];
    colors[row] = value !== value
      ? CHART_NEUTRAL_COLOR
      : ramp[span > 0 ? Math.min(63, Math.floor(((value - series.min) / span) * 64)) : 32];
  }
  return colors;
}
