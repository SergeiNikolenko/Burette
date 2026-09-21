"use client";

import * as React from "react";

import {
  getFixedGridInverseRowWindowStyles,
  type CssLength,
  type FixedGridInverseRowWindowGeometry,
} from "./fixed-grid-layout";

type FixedGridRowWindowElement = keyof React.JSX.IntrinsicElements;
type FixedGridRowWindowElementProps = React.HTMLAttributes<HTMLElement> & {
  "data-slot"?: string;
};

export interface FixedGridRowWindowProps extends Omit<
  FixedGridRowWindowElementProps,
  "children"
> {
  as?: FixedGridRowWindowElement;
  children?: React.ReactNode;
  minWidth?: CssLength;
  offsetAs?: FixedGridRowWindowElement;
  offsetClassName?: string;
  offsetDataSlot?: string;
  offsetProps?: FixedGridRowWindowElementProps;
  rowMinWidth?: CssLength;
  rowOffsetRef?: React.Ref<HTMLElement>;
  rowWindowRef?: React.Ref<HTMLElement>;
  totalSize: CssLength;
  viewportHeight: number;
  virtualRowWindow: FixedGridInverseRowWindowGeometry;
  windowAs?: FixedGridRowWindowElement;
  windowClassName?: string;
  windowDataSlot?: string;
  windowProps?: FixedGridRowWindowElementProps;
}

export function FixedGridRowWindow({
  as = "div",
  children,
  minWidth,
  offsetAs = "div",
  offsetClassName,
  offsetDataSlot,
  offsetProps,
  rowMinWidth,
  rowOffsetRef,
  rowWindowRef,
  style,
  totalSize,
  viewportHeight,
  virtualRowWindow,
  windowAs = "div",
  windowClassName,
  windowDataSlot,
  windowProps,
  className,
  ...props
}: FixedGridRowWindowProps) {
  const { offsetStyle, spacerStyle, windowStyle } =
    getFixedGridInverseRowWindowStyles({
      minWidth,
      rowMinWidth,
      totalSize,
      viewportHeight,
      window: virtualRowWindow,
    });
  const offsetElementProps = {
    ...offsetProps,
    ...(offsetDataSlot ? { "data-slot": offsetDataSlot } : null),
    "aria-hidden": offsetProps?.["aria-hidden"] ?? true,
    className: offsetClassName ?? offsetProps?.className,
    ref: rowOffsetRef,
    style: { ...offsetProps?.style, ...offsetStyle },
  };
  const windowElementProps = {
    ...windowProps,
    ...(windowDataSlot ? { "data-slot": windowDataSlot } : null),
    className: windowClassName ?? windowProps?.className,
    ref: rowWindowRef,
    style: { ...windowProps?.style, ...windowStyle },
  };

  return React.createElement(
    as,
    {
      ...props,
      className,
      style: { ...style, ...spacerStyle },
    },
    React.createElement(offsetAs, offsetElementProps),
    React.createElement(windowAs, windowElementProps, children),
  );
}
