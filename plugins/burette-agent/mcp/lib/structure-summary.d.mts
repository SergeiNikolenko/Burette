export interface StructureSummaryRow {
  label: string;
  value: string;
}

export interface StructureSummary {
  path?: string;
  title: string;
  extension: string;
  byteCount: number;
  lineCount: number;
  format: string;
  kind: string;
  summaryLine: string;
  counts: Record<string, number>;
  rows: StructureSummaryRow[];
  components: Record<string, unknown>;
  notes: string[];
}

export const MAX_SUMMARY_BYTES: number;

export function summarizeStructureFile(file: string): Promise<StructureSummary>;

export function summarizeStructureText(input: {
  text: string;
  fileName: string;
  byteCount?: number;
  sourcePath?: string;
}): StructureSummary;
