// The join behind Collection ▸ Merge Columns, kept apart from the run that
// pages the rows so it can be checked directly. Two rules decide everything a
// user notices: a row with nothing to merge stays empty rather than becoming a
// bare separator, and a row missing one side joins the side it has.
export function joinColumnValues(parts, separator) {
  const present = parts
    .map((part) => (typeof part === "string" ? part : ""))
    .filter((part) => part !== "");
  return present.length === 0 ? null : present.join(separator);
}
