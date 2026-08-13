// Type surface for grid-value-stats.mjs (allowJs is off; the .mjs body is
// shared with the node tests, so types live in this declaration).

export type GridValueColumn = {
  min?: number;
  max?: number;
  bins?: number[];
};

export type GridColumnStats = {
  min: number;
  max: number;
  total: number;
  categorical: boolean;
  q1?: number;
  q3?: number;
  lowerFence?: number;
  upperFence?: number;
};

export type GridValueTone = "plain" | "flag-on" | "flag-off" | "outlier-high" | "outlier-low";

export type GridValueDescription = {
  tone: GridValueTone;
  position: number | null;
  detail: string | null;
};

export declare function columnStats(column: GridValueColumn | null | undefined): GridColumnStats | null;
export declare function ordinal(value: number): string;
export declare function describePropValue(
  rawValue: string | number | null | undefined,
  column: GridValueColumn | null | undefined,
): GridValueDescription;
