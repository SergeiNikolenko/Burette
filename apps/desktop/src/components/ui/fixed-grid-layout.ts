import type * as React from "react";

export type CssLength = number | string;
type CssLengthProperty = "height" | "marginTop" | "minWidth" | "width";

export interface FixedGridInverseRowWindowGeometry {
  size: number;
  start: number;
}

export function getFixedGridCanvasStyle({
  width,
  minWidth = "100%",
  contain = false,
}: {
  width?: CssLength;
  minWidth?: CssLength;
  contain?: boolean;
}): React.CSSProperties {
  return {
    position: "relative",
    ...cssLengthProperty("width", width),
    ...cssLengthProperty("minWidth", minWidth),
    ...(contain ? { contain: "layout paint style" } : null),
  };
}

export function getFixedGridRowWindowStyle({
  height,
  minWidth,
}: {
  height: CssLength;
  minWidth?: CssLength;
}): React.CSSProperties {
  return {
    position: "relative",
    ...cssLengthProperty("height", height),
    ...cssLengthProperty("minWidth", minWidth),
  };
}

export function getFixedGridInverseRowOffsetStyle({
  height,
  minWidth,
}: {
  height: CssLength;
  minWidth?: CssLength;
}): React.CSSProperties {
  return {
    ...cssLengthProperty("height", height),
    ...cssLengthProperty("minWidth", minWidth),
  };
}

export function getFixedGridInverseStickyRowWindowStyle({
  height,
  minWidth,
  viewportHeight,
}: {
  height: number;
  minWidth?: CssLength;
  viewportHeight: number;
}): React.CSSProperties {
  const stickyOffset = fixedGridInverseStickyOffset({
    viewportSize: viewportHeight,
    windowSize: height,
  });

  return {
    position: "sticky",
    ...cssLengthProperty("height", height),
    ...cssLengthProperty("minWidth", minWidth),
    top: `${stickyOffset}px`,
    bottom: `${stickyOffset}px`,
  };
}

export function getFixedGridInverseRowWindowStyles({
  minWidth,
  rowMinWidth,
  totalSize,
  viewportHeight,
  window,
}: {
  minWidth?: CssLength;
  rowMinWidth?: CssLength;
  totalSize: CssLength;
  viewportHeight: number;
  window: FixedGridInverseRowWindowGeometry;
}): {
  offsetStyle: React.CSSProperties;
  spacerStyle: React.CSSProperties;
  windowStyle: React.CSSProperties;
} {
  return {
    offsetStyle: getFixedGridInverseRowOffsetStyle({
      height: window.start,
      minWidth: rowMinWidth,
    }),
    spacerStyle: getFixedGridRowWindowStyle({
      height: totalSize,
      minWidth,
    }),
    windowStyle: getFixedGridInverseStickyRowWindowStyle({
      height: window.size,
      minWidth: rowMinWidth,
      viewportHeight,
    }),
  };
}

export function getFixedGridInverseRowWindowStyle({
  height,
  minWidth,
  top,
  viewportHeight,
}: {
  height: number;
  minWidth?: CssLength;
  top: number;
  viewportHeight: number;
}): React.CSSProperties {
  const stickyOffset = fixedGridInverseStickyOffset({
    viewportSize: viewportHeight,
    windowSize: height,
  });

  return {
    position: "sticky",
    ...cssLengthProperty("height", height),
    ...cssLengthProperty("marginTop", top),
    ...cssLengthProperty("minWidth", minWidth),
    top: `${stickyOffset}px`,
    bottom: `${stickyOffset}px`,
  };
}

export function fixedGridInverseStickyOffset({
  viewportSize,
  windowSize,
}: {
  viewportSize: number;
  windowSize: number;
}) {
  const offset = Math.max(
    0,
    safeCssNumber(windowSize) - safeCssNumber(viewportSize),
  );
  return offset === 0 ? 0 : -offset;
}

export function setFixedGridInverseRowWindowGeometry({
  rowOffsetElement,
  rowWindowElement,
  viewportHeight,
  window,
}: {
  rowOffsetElement: HTMLElement;
  rowWindowElement: HTMLElement;
  viewportHeight: number;
  window: FixedGridInverseRowWindowGeometry;
}) {
  const offsetStyle = getFixedGridInverseRowOffsetStyle({
    height: window.start,
  });
  const windowStyle = getFixedGridInverseStickyRowWindowStyle({
    height: window.size,
    viewportHeight,
  });
  patchStyleProperties(rowOffsetElement.style, offsetStyle, ["height"]);
  patchStyleProperties(rowWindowElement.style, windowStyle, [
    "position",
    "height",
    "top",
    "bottom",
  ]);
  setStyleValue(rowWindowElement.style, "margin-top", "");
}

function formatCssLength(value: CssLength | undefined) {
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (typeof value !== "number") return value;
  return Number.isFinite(value) && value >= 0 ? `${value}px` : undefined;
}

function cssLengthProperty<Property extends CssLengthProperty>(
  property: Property,
  value: CssLength | undefined,
): Pick<React.CSSProperties, Property> | object {
  const formattedValue = formatCssLength(value);
  return formattedValue === undefined ? {} : { [property]: formattedValue };
}

function safeCssNumber(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function patchStyleProperties(
  style: CSSStyleDeclaration,
  values: React.CSSProperties,
  properties: string[],
) {
  for (const property of properties) {
    const value = values[property as keyof React.CSSProperties];
    setStyleValue(
      style,
      property,
      typeof value === "number" ? `${value}px` : value,
    );
  }
}

function setStyleValue(
  style: CSSStyleDeclaration,
  propertyName: string,
  value: unknown,
) {
  const nextValue = typeof value === "string" ? value : "";
  if (style.getPropertyValue(propertyName) !== nextValue) {
    style.setProperty(propertyName, nextValue);
  }
}
