// Type surface for correlation-matrix.mjs (allowJs is off; the .mjs body is
// shared with the node tests, so types live in this declaration).

export type CorrelationColumnInput = {
  id: string;
  label: string;
  values: Array<[number, number]>;
};

export type CorrelationMatrixResult = {
  ids: string[];
  labels: string[];
  /** matrix[i][j] is the coefficient, or null when the pair barely overlaps. */
  matrix: Array<Array<number | null>>;
  /** Shared observations behind each coefficient. */
  counts: number[][];
};

export declare function pearson(xs: number[], ys: number[]): number | null;
export declare function correlationMatrix(columns: CorrelationColumnInput[]): CorrelationMatrixResult;
