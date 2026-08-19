export function buildVirtualGridTemplate({
  leadingWidth,
  leftPad,
  columnWidths,
  rightPad,
}: {
  leadingWidth: number;
  leftPad: number;
  columnWidths: readonly number[];
  rightPad: number;
}) {
  const columns = columnWidths.map(formatTemplateWidth).join(" ");
  return [
    formatTemplateWidth(leadingWidth),
    formatTemplateWidth(leftPad),
    columns,
    formatTemplateWidth(rightPad),
  ]
    .filter(Boolean)
    .join(" ");
}

function formatTemplateWidth(width: number) {
  return `${Number.isFinite(width) && width > 0 ? width : 0}px`;
}
