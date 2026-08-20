import type * as React from "react";

export function getFixedGridRowStyle({
  gridTemplate,
  rowHeight,
  top,
  contain = true,
}: {
  gridTemplate?: string;
  rowHeight: number;
  top: number;
  contain?: boolean;
}): React.CSSProperties {
  const safeRowHeight =
    Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 0;
  const safeTop = Number.isFinite(top) && top > 0 ? top : 0;
  const style: React.CSSProperties = {
    height: safeRowHeight,
    minHeight: safeRowHeight,
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    transform: `translate3d(0, ${safeTop}px, 0)`,
  };
  if (gridTemplate?.trim()) style.gridTemplateColumns = gridTemplate;
  if (contain) style.contain = "layout paint style";
  return style;
}
