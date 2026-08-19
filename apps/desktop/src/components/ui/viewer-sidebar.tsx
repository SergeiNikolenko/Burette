"use client";

import * as React from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";
import { cn } from "@/lib/utils";

import {
  createViewerSlotAttributes,
  createViewerStateAttributes,
  pickCssCustomProperties,
  readViewerElementSize,
  useViewerDevelopmentLayoutWarning,
  useViewerSidebarState,
  useViewerGeometrySnapshot,
  useViewerSidebarRegistrationContext,
  VIEWER_SIDEBAR_WIDTH,
} from "./viewer-internals";
import { warnViewerDevelopmentOnce } from "./viewer-diagnostics";
import type { ViewerSidebarProps, ViewerSidebarState } from "./viewer-types";

export function ViewerSidebar({
  children,
  className,
  innerClassName,
  namespacedSlot,
  namespacedSlotNames,
  side: sideProp,
  slotNames,
  collapsible: collapsibleProp,
  width = VIEWER_SIDEBAR_WIDTH,
  style,
  id: idProp,
  ...props
}: ViewerSidebarProps) {
  const registrationContext =
    useViewerSidebarRegistrationContext("ViewerSidebar");
  const sidebarState = useViewerSidebarState("ViewerSidebar");
  const {
    defaultSidebarCollapsible,
    defaultSidebarSide,
    getRootElement,
    registerSidebar,
    rootId,
    sidebarGapTransition,
    geometryStore,
  } = registrationContext;
  const geometry = useViewerGeometrySnapshot(geometryStore);
  const reactId = React.useId();
  const instanceId = `${reactId}-viewer-sidebar-instance`;
  const generatedSidebarId = `${reactId}-viewer-sidebar`;
  const sidebarId = idProp ?? generatedSidebarId;
  const sidebarRef = React.useRef<HTMLElement | null>(null);
  const [transitionsReady, setTransitionsReady] = React.useState(false);
  const collapsible = collapsibleProp ?? defaultSidebarCollapsible;
  const side = sideProp ?? defaultSidebarSide;
  const open = collapsible === "none" ? true : sidebarState.open;
  const state: ViewerSidebarState = open ? "expanded" : "collapsed";
  const mode = sidebarState.mode;
  const visualOpen = mode === "inline" ? geometry.open : open;
  const visualState: ViewerSidebarState = visualOpen
    ? "expanded"
    : "collapsed";
  const isCollapsed = collapsible !== "none" && !open;
  const isOpening =
    collapsible !== "none" &&
    open &&
    geometry.isTransitioning;
  const frameSlot = props["data-slot"] ?? "viewer-sidebar";
  const sidebarProps = { ...props };
  delete sidebarProps["data-slot"];
  const styleWithoutWidth: React.CSSProperties = { ...style };
  delete styleWithoutWidth.width;
  const customProperties = pickCssCustomProperties(style);
  const frameStyle = {
    ...customProperties,
    "--viewer-sidebar-width": width,
  } as React.CSSProperties;
  const inlineFrameStyle = {
    ...frameStyle,
    flexBasis: `${geometry.sidebarInlineSize}px`,
    maxWidth: `${geometry.sidebarInlineSize}px`,
    width: `${geometry.sidebarInlineSize}px`,
  } as React.CSSProperties;
  const ariaLabel = sidebarProps["aria-label"];
  const ariaLabelledBy = sidebarProps["aria-labelledby"];
  const hasAccessibleName =
    (typeof ariaLabel === "string"
      ? ariaLabel.trim().length > 0
      : Boolean(ariaLabel)) ||
    (typeof ariaLabelledBy === "string"
      ? ariaLabelledBy.trim().length > 0
      : Boolean(ariaLabelledBy));

  useViewerDevelopmentLayoutWarning({
    enabled: mode === "inline" && open,
    elements: () => [getRootElement(), sidebarRef.current],
    inspect: () => {
      const rootElement = getRootElement();
      const sidebarElement = sidebarRef.current;
      const rootSize = readViewerElementSize(rootElement);
      const sidebarSize = readViewerElementSize(sidebarElement);

      if (rootSize.width > 0 && sidebarSize.width > rootSize.width) {
        warnViewerDevelopmentOnce({
          code: "viewer_sidebar_wider_than_root",
          message: "inline viewer sidebar is wider than its root.",
          rootId,
          details: {
            rootSlot: rootElement?.dataset.slot,
            rootWidth: rootSize.width,
            sidebarMode: mode,
            sidebarOpen: open,
            sidebarSide: side,
            sidebarSlot: sidebarElement?.dataset.slot,
            sidebarWidth: sidebarSize.width,
          },
        });
      }
    },
    keyParts: [
      "viewer-sidebar-wider-than-root",
      rootId,
      mode,
      open,
      side,
      width,
      getRootElement(),
      sidebarRef.current,
    ],
  });

  useMountEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      setTransitionsReady(true);
      return;
    }
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setTransitionsReady(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  });

  useKeyedLayoutEffect(
    joinEffectKey([
      collapsible,
      instanceId,
      registerSidebar,
      side,
      sidebarId,
      width,
    ]),
    () => {
      const element = sidebarRef.current;

      if (!element) {
        return;
      }

      return registerSidebar({
        collapsible,
        element,
        id: sidebarId,
        instanceId,
        side,
        width,
        widthPixels: resolveViewerSidebarWidthPixels(element, width),
      });
    },
  );

  useKeyedLayoutEffect(
    mode === "overlay" && open && !hasAccessibleName
      ? joinEffectKey([
          "viewer-overlay-sidebar-missing-accessible-name",
          rootId,
          sidebarId,
          side,
        ])
      : null,
    () => {
      warnViewerDevelopmentOnce({
        code: "viewer_overlay_sidebar_missing_accessible_name",
        message: "overlay viewer sidebar is missing an accessible name.",
        rootId,
        details: {
          sidebarId,
          sidebarMode: mode,
          sidebarSide: side,
        },
      });
    },
  );

  useKeyedLayoutEffect(
    isCollapsed
      ? joinEffectKey([
          "viewer-sidebar:move-focus-on-close",
          getRootElement,
          sidebarId,
        ])
      : null,
    () => {
      moveFocusOutOfViewerSidebar(
        sidebarRef.current,
        getRootElement(),
        sidebarId,
      );
    },
  );

  const hiddenProps = isCollapsed || isOpening
    ? ({
        "aria-hidden": true,
        inert: true,
      } as React.HTMLAttributes<HTMLElement>)
    : {};
  const namespacedSidebarStateAttributes = createViewerStateAttributes(
    registrationContext.stateNamespace,
    "sidebar",
    {
      sidebarCollapsible: collapsible,
      sidebarMode: mode,
      sidebarOpen: visualOpen,
      sidebarSide: side,
      sidebarState: visualState,
    },
  );
  const frameAttributes = {
    "data-slot": frameSlot,
    "data-collapsible": collapsible,
    "data-mode": mode,
    "data-side": side,
    "data-state": visualState,
    "data-viewer-sidebar-transitions": transitionsReady ? "ready" : undefined,
    "data-viewer-sidebar-mode": mode,
    "data-viewer-sidebar-open": visualOpen ? "true" : "false",
    "data-viewer-sidebar-state": visualState,
    "data-viewer-slot": "sidebar",
    ...createViewerSlotAttributes(
      registrationContext.stateNamespace,
      "sidebar",
      namespacedSlot,
    ),
    ...namespacedSidebarStateAttributes,
  };
  const sidebarElement = (
    <aside
      ref={sidebarRef}
      id={sidebarId}
      data-slot={slotNames?.container ?? "viewer-sidebar-container"}
      data-collapsible={collapsible}
      data-mode={mode}
      data-side={side}
      data-state={visualState}
      data-viewer-sidebar-transitions={transitionsReady ? "ready" : undefined}
      data-viewer-sidebar-mode={mode}
      data-viewer-sidebar-open={visualOpen ? "true" : "false"}
      data-viewer-sidebar-state={visualState}
      data-viewer-slot="sidebar-container"
      {...createViewerSlotAttributes(
        registrationContext.stateNamespace,
        "sidebar",
        namespacedSlotNames?.container,
      )}
      {...namespacedSidebarStateAttributes}
        className={cn(
          className,
          "z-30 flex w-(--viewer-sidebar-width) min-w-0 overflow-hidden",
          mode === "inline" &&
            "absolute inset-y-0 h-full min-w-(--viewer-sidebar-width) flex-shrink-0 transition-none",
        mode === "inline" && side === "left" && "right-0",
        mode === "inline" && side === "right" && "left-0",
        mode === "overlay" &&
          "absolute inset-y-0 transition-none data-[viewer-sidebar-transitions=ready]:transition-[translate,width,border-color] data-[viewer-sidebar-transitions=ready]:duration-150 data-[viewer-sidebar-transitions=ready]:ease-out",
        mode === "overlay" && side === "left" && "left-0",
        mode === "overlay" && side === "right" && "right-0",
        collapsible === "offcanvas" && mode === "overlay" && "shadow-lg",
        isCollapsed && "pointer-events-none",
        collapsible === "offcanvas" &&
          mode === "overlay" &&
          !visualOpen &&
          side === "left" &&
          "pointer-events-none -translate-x-full border-transparent",
        collapsible === "offcanvas" &&
          mode === "overlay" &&
          !visualOpen &&
          side === "right" &&
          "pointer-events-none translate-x-full border-transparent",
      )}
      style={
        {
          ...styleWithoutWidth,
          "--viewer-sidebar-width": width,
        } as React.CSSProperties
      }
      {...sidebarProps}
      {...hiddenProps}
    >
      <div
        data-slot={slotNames?.inner ?? "viewer-sidebar-inner"}
        data-viewer-slot="sidebar-inner"
        {...createViewerSlotAttributes(
          registrationContext.stateNamespace,
          "sidebar",
          namespacedSlotNames?.inner,
        )}
        className={cn(
          "flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden",
          innerClassName,
        )}
      >
        {children}
      </div>
    </aside>
  );

  if (mode === "inline") {
    return (
      <div
        {...frameAttributes}
        className={cn(
          "group/viewer-sidebar relative z-30 min-h-0 flex-shrink-0 overflow-hidden transition-none",
          side === "right" && "order-last",
        )}
        style={inlineFrameStyle}
      >
        {sidebarElement}
      </div>
    );
  }

  return (
    <div
      {...frameAttributes}
      className={cn(
        "group/viewer-sidebar relative z-30 min-h-0 flex-shrink-0",
        side === "right" && "order-last",
      )}
      style={frameStyle}
    >
      <div
        data-slot={slotNames?.gap ?? "viewer-sidebar-gap"}
        data-viewer-slot="sidebar-gap"
        {...createViewerSlotAttributes(
          registrationContext.stateNamespace,
          "sidebar",
          namespacedSlotNames?.gap,
        )}
        className={cn(
          "relative h-full w-(--viewer-sidebar-width) flex-shrink-0",
          sidebarGapTransition === "width" &&
            "transition-[width] duration-150 ease-out",
          collapsible === "offcanvas" && mode === "overlay" && "w-0",
        )}
      />
      {sidebarElement}
    </div>
  );
}

function moveFocusOutOfViewerSidebar(
  sidebarElement: HTMLElement | null,
  rootElement: HTMLElement | null,
  sidebarId: string,
) {
  if (typeof document === "undefined" || !sidebarElement) return;

  const activeElement = document.activeElement;
  if (
    !(activeElement instanceof HTMLElement) ||
    !sidebarElement.contains(activeElement)
  ) {
    return;
  }

  const trigger = findViewerSidebarTrigger(rootElement, sidebarId);
  if (trigger) {
    trigger.focus({ preventScroll: true });
    return;
  }

  activeElement.blur();
}

function findViewerSidebarTrigger(
  rootElement: HTMLElement | null,
  sidebarId: string,
) {
  if (!rootElement) return null;

  for (const element of rootElement.querySelectorAll<HTMLElement>(
    "[aria-controls]",
  )) {
    if (element.getAttribute("aria-controls") === sidebarId) {
      return element;
    }
  }

  return null;
}

function resolveViewerSidebarWidthPixels(element: HTMLElement, width: string) {
  const declaredWidth = parseViewerSidebarCssLength(width, element);
  if (declaredWidth !== null) return declaredWidth;

  if (typeof window !== "undefined") {
    const computedWidth = parseViewerSidebarCssLength(
      window.getComputedStyle(element).width,
      element,
    );
    if (computedWidth !== null) return computedWidth;
  }

  const measuredWidth = readViewerElementSize(element).width;
  return Number.isFinite(measuredWidth) && measuredWidth > 0
    ? measuredWidth
    : 0;
}

function parseViewerSidebarCssLength(value: string, element: HTMLElement) {
  const trimmedValue = value.trim();
  const length = Number.parseFloat(trimmedValue);
  if (!Number.isFinite(length) || length <= 0) return null;

  if (trimmedValue.endsWith("px")) return length;
  if (trimmedValue.endsWith("rem")) {
    return length * readRootFontSize();
  }
  if (trimmedValue.endsWith("em")) {
    return length * readElementFontSize(element);
  }

  return null;
}

function readRootFontSize() {
  if (typeof window === "undefined") return 16;

  const rootFontSize = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(rootFontSize) && rootFontSize > 0
    ? rootFontSize
    : 16;
}

function readElementFontSize(element: HTMLElement) {
  if (typeof window === "undefined") return 16;

  const elementFontSize = Number.parseFloat(
    window.getComputedStyle(element).fontSize,
  );
  return Number.isFinite(elementFontSize) && elementFontSize > 0
    ? elementFontSize
    : readRootFontSize();
}
