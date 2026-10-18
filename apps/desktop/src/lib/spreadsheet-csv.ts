/** Apply only to spreadsheet exports; scientific Save paths retain original values. */
export function spreadsheetCell(value: string): string {
  const significant = value.replace(/^[\s\u0000-\u001f\u007f-\u009f]*/u, "");
  if (!/^[=+\-@＝＋－＠]/u.test(significant)) return value;
  // Signed decimal/scientific literals are data, not executable expressions.
  const number = significant.replace(/[\s\u0000-\u001f\u007f-\u009f]*$/u, "");
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(number)) {
    return value;
  }
  return "'" + value;
}
