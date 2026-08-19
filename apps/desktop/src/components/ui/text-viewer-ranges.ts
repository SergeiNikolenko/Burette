export interface TextLineRange {
  start: number;
  end: number;
}

export interface NormalizedTextLineRange extends TextLineRange {
  readonly normalized: true;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function normalizeTextLineRange(
  range: TextLineRange | null | undefined,
  lineCount: number,
): NormalizedTextLineRange | null {
  if (
    !range ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    !Number.isFinite(lineCount) ||
    lineCount <= 0
  ) {
    return null;
  }

  const maxLine = Math.floor(lineCount);
  const rawStart = Math.trunc(range.start);
  const rawEnd = Math.trunc(range.end);
  const start = Math.min(rawStart, rawEnd);
  const end = Math.max(rawStart, rawEnd);

  if (end < 1 || start > maxLine) return null;

  return {
    start: clamp(start, 1, maxLine),
    end: clamp(end, 1, maxLine),
    normalized: true,
  };
}

export function isLineInRange(
  lineNumber: number,
  range: NormalizedTextLineRange | null,
) {
  return range != null && lineNumber >= range.start && lineNumber <= range.end;
}
