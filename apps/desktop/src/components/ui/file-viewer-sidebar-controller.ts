"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

import { resolveFileViewerSidebarAccessibilityProps } from "./file-viewer-accessibility";
import {
  type FileViewerSidebarCollapsible,
  type FileViewerSidebarMode,
  type FileViewerSidebarSide,
  type FileViewerSidebarState,
  useFileViewerShell,
} from "./file-viewer-context";
import { useIsInsideFileViewerContent } from "./file-viewer-layout";
import { useStableCssLength, useStableElementSize } from "./viewer-measurement";

export type FileViewerSidebarController = {
  accessibilityProps: ReturnType<
    typeof resolveFileViewerSidebarAccessibilityProps
  >;
  customProperties: React.CSSProperties;
  isInline: boolean;
  isSidebarOpen: boolean;
  mode: FileViewerSidebarMode;
  panelStyle: React.CSSProperties;
  resolvedCollapsible: FileViewerSidebarCollapsible;
  resolvedSide: FileViewerSidebarSide;
  setSidebarGapElement: (element: HTMLDivElement | null) => void;
  setSidebarPanelElement: (element: HTMLElement | null) => void;
  sidebarId: string;
  sidebarState: FileViewerSidebarState;
};

export function useFileViewerSidebarController({
  collapsible,
  id,
  side,
  style,
  width,
}: {
  collapsible: FileViewerSidebarCollapsible | undefined;
  id: string | undefined;
  side: FileViewerSidebarSide | undefined;
  style: React.CSSProperties | undefined;
  width: string;
}): FileViewerSidebarController {
  const isInsideContent = useIsInsideFileViewerContent();
  const shell = useFileViewerShell("FileViewerSidebar");
  const registerSidebar = shell.registerSidebar;
  // Observed, not measured-once: the panel's resolved pixel width is the same
  // number the motion kernel animates the gap to, so it must stay fresh across
  // font-size and container changes or the panel edge and the layout width
  // drift apart.
  const sidebarSize = useStableElementSize<HTMLElement>({
    retainLastNonZero: true,
  });
  const reactId = React.useId();
  const sidebarId = id ?? `${reactId}-file-viewer-sidebar`;
  const resolvedCollapsible = collapsible ?? shell.collapsible;
  const resolvedSide = side ?? shell.side;
  const isSidebarOpen =
    resolvedCollapsible === "none" ? true : shell.isSidebarOpen;
  const isSidebarInteractive =
    resolvedCollapsible === "none" ? true : shell.isSidebarInteractive;
  const sidebarState = isSidebarOpen ? "expanded" : "collapsed";
  const isInline = shell.mode === "inline";
  const declaredWidthPixels = useStableCssLength({
    element: sidebarSize.element,
    value: width,
  });
  const widthPixels =
    declaredWidthPixels > 0 ? declaredWidthPixels : (sidebarSize.width ?? 0);
  const setSidebarGapElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      shell.elementRegistry.registerSidebarGapElement(element);
    },
    [shell.elementRegistry],
  );
  const setSidebarSizeElement = sidebarSize.setElement;
  const setSidebarPanelElement = React.useCallback(
    (element: HTMLElement | null) => {
      setSidebarSizeElement(element);
      shell.elementRegistry.registerSidebarElement(element);
    },
    [setSidebarSizeElement, shell.elementRegistry],
  );

  if (process.env.NODE_ENV !== "production" && !isInsideContent) {
    throw new Error(
      "FileViewerSidebar must be rendered inside FileViewerContent.",
    );
  }

  useKeyedLayoutEffect(
    joinEffectKey([
      "file-viewer-sidebar-registration",
      registerSidebar,
      resolvedCollapsible,
      resolvedSide,
      sidebarId,
      width,
      widthPixels,
    ]),
    () =>
      registerSidebar({
        collapsible: resolvedCollapsible,
        id: sidebarId,
        side: resolvedSide,
        width,
        widthPixels,
      }),
  );

  const accessibilityProps = resolveFileViewerSidebarAccessibilityProps({
    collapsible: resolvedCollapsible,
    deferInert:
      !isSidebarOpen && !isSidebarInteractive && shell.isSidebarTransitioning,
    isSidebarInteractive,
  });
  const customProperties = pickCssCustomProperties(style);
  const panelStyle: React.CSSProperties = {
    width,
    // Overlay slides on a CSS transition; its duration is the same constant
    // that drives the kernel clock, so the two timelines cannot drift.
    ...(isInline
      ? null
      : { transitionDuration: `${shell.motionDurationMs}ms` }),
    ...style,
    ...(isSidebarInteractive ? null : { pointerEvents: "none" as const }),
  };

  // No memo: `panelStyle` and `customProperties` are fresh objects every
  // render, so the controller value can never be referentially stable anyway.
  return {
    accessibilityProps,
    customProperties,
    isInline,
    isSidebarOpen,
    mode: shell.mode,
    panelStyle,
    resolvedCollapsible,
    resolvedSide,
    setSidebarGapElement,
    setSidebarPanelElement,
    sidebarId,
    sidebarState,
  };
}

function pickCssCustomProperties(style: React.CSSProperties | undefined) {
  if (!style) return {};

  return Object.fromEntries(
    Object.entries(style).filter(([name]) => name.startsWith("--")),
  ) as React.CSSProperties;
}
