"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";
import { cn } from "@/lib/utils";

import {
  findClosestViewerBody,
  readViewerElementSize,
  useOptionalViewerSidebarRegistration,
  useOptionalViewerSurfaceMeasurementContext,
  useViewerDevelopmentLayoutWarning,
  useViewerViewportPresence,
  ViewerSurfaceMeasurementProvider,
  ViewerViewportPresenceProvider,
} from "./viewer-internals";
import { useOptionalViewerRootDiagnostics } from "./viewer-root";
import { warnViewerDevelopmentOnce } from "./viewer-diagnostics";
import { useStableElementSize } from "./viewer-measurement";
import type {
  ViewerDocumentFrameAlign,
  ViewerDocumentFrameProps,
  ViewerGeometryStore,
  ViewerSurfaceMeasurement,
  ViewerSurfaceProps,
  ViewerViewportProps,
  ViewerGeometrySnapshot,
} from "./viewer-types";

export type ViewerDocumentFrameLayout = {
  activeInlineSize: number | null;
  isTransitioning: boolean;
  maxInlineSize: number | null;
  settledInlineSize: number | null;
};

export type ViewerDocumentFrameState = {
  align: ViewerDocumentFrameAlign;
  element: HTMLDivElement | null;
  geometryStore: ViewerGeometryStore | null;
  inlineSize: number | null;
};

const ViewerDocumentFrameContext =
  React.createContext<ViewerDocumentFrameState | null>(null);

function getDocumentFrameAlignClass(align: ViewerDocumentFrameAlign) {
  switch (align) {
    case "center":
      return "mx-auto";
    case "end":
      return "ml-auto";
    case "start":
      return "mr-auto";
  }
}

export function useOptionalViewerDocumentFrame(): ViewerDocumentFrameState | null {
  return React.useContext(ViewerDocumentFrameContext);
}

export function useViewerDocumentFrameLayout({
  documentFrame,
  fallbackInlineSize,
}: {
  documentFrame: ViewerDocumentFrameState | null;
  fallbackInlineSize: number | null;
}): ViewerDocumentFrameLayout {
  const element = documentFrame?.element ?? null;
  const geometryStore = documentFrame?.geometryStore ?? null;
  const snapshotCacheRef = React.useRef<ViewerDocumentFrameLayout | null>(null);
  const subscribe = React.useCallback(
    (listener: () => void) =>
      geometryStore ? geometryStore.subscribe(listener) : () => {},
    [geometryStore],
  );
  const getSnapshot = React.useCallback(() => {
    const geometry = geometryStore?.getSnapshot() ?? null;
    const previousLayout = snapshotCacheRef.current;
    const nextLayout =
      geometry && geometry.hasMeasuredBody
        ? createViewerDocumentFrameLayoutFromGeometry({
            element,
            fallbackInlineSize,
            geometry,
          })
        : createViewerDocumentFrameFallbackLayout(fallbackInlineSize);

    if (
      previousLayout &&
      areViewerDocumentFrameLayoutsEqual(previousLayout, nextLayout)
    ) {
      return previousLayout;
    }

    snapshotCacheRef.current = nextLayout;
    return nextLayout;
  }, [element, fallbackInlineSize, geometryStore]);
  const activeLayout = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  const [settledInlineSize, setSettledInlineSize] = React.useState<
    number | null
  >(() => activeLayout.activeInlineSize);

  useKeyedLayoutEffect(
    joinEffectKey([
      "viewer-document-frame-layout:settled-inline-size",
      activeLayout.activeInlineSize,
      activeLayout.isTransitioning,
      geometryStore,
    ]),
    () => {
      if (activeLayout.isTransitioning) return;

      setSettledInlineSize((currentInlineSize) =>
        currentInlineSize === activeLayout.activeInlineSize
          ? currentInlineSize
          : activeLayout.activeInlineSize,
      );
    },
  );
  return React.useMemo(
    () => ({
      ...activeLayout,
      settledInlineSize:
        settledInlineSize ?? activeLayout.activeInlineSize ?? null,
    }),
    [activeLayout, settledInlineSize],
  );
}

export function ViewerDocumentFrame({
  align = "start",
  children,
  className,
  maxInlineSize,
  style,
  ...props
}: ViewerDocumentFrameProps) {
  const size = useStableElementSize<HTMLDivElement>({
    retainLastNonZero: true,
  });
  const sidebarRegistration = useOptionalViewerSidebarRegistration();
  const value = React.useMemo<ViewerDocumentFrameState>(
    () => ({
      align,
      element: size.element,
      geometryStore: sidebarRegistration?.geometryStore ?? null,
      inlineSize: size.width,
    }),
    [align, sidebarRegistration?.geometryStore, size.element, size.width],
  );

  return (
    <ViewerDocumentFrameContext.Provider value={value}>
      <div
        ref={size.setElement}
        data-slot="viewer-document-frame"
        className={cn(
          "[container-type:inline-size] relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col",
          getDocumentFrameAlignClass(align),
          className,
        )}
        style={
          {
            maxInlineSize,
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
      </div>
    </ViewerDocumentFrameContext.Provider>
  );
}

function createViewerDocumentFrameLayoutFromGeometry({
  element,
  fallbackInlineSize,
  geometry,
}: {
  element: HTMLDivElement | null;
  fallbackInlineSize: number | null;
  geometry: ViewerGeometrySnapshot;
}): ViewerDocumentFrameLayout {
  const maxCssInlineSize = element
    ? readViewerDocumentFrameMaxInlineSize(element)
    : null;
  const measuredFrameInlineSize =
    fallbackInlineSize != null &&
    Number.isFinite(fallbackInlineSize) &&
    fallbackInlineSize > 0
      ? fallbackInlineSize
      : null;
  const usesSidebarGeometry =
    geometry.sidebarWidth > 0 ||
    geometry.sidebarInlineSize > 0 ||
    geometry.isTransitioning;
  const activeSourceInlineSize = usesSidebarGeometry
    ? geometry.documentInlineSize
    : (measuredFrameInlineSize ?? geometry.documentInlineSize);
  const maxSourceInlineSize = usesSidebarGeometry
    ? Math.max(geometry.bodyInlineSize, activeSourceInlineSize)
    : activeSourceInlineSize;
  const activeInlineSize = constrainViewerDocumentFrameInlineSize(
    activeSourceInlineSize,
    maxCssInlineSize,
  );
  const maxInlineSize = constrainViewerDocumentFrameInlineSize(
    maxSourceInlineSize,
    maxCssInlineSize,
  );

  return {
    activeInlineSize,
    isTransitioning: geometry.isTransitioning,
    maxInlineSize,
    settledInlineSize: null,
  };
}

function createViewerDocumentFrameFallbackLayout(
  fallbackInlineSize: number | null,
): ViewerDocumentFrameLayout {
  const inlineSize =
    fallbackInlineSize != null &&
    Number.isFinite(fallbackInlineSize) &&
    fallbackInlineSize > 0
      ? fallbackInlineSize
      : null;

  return {
    activeInlineSize: inlineSize,
    isTransitioning: false,
    maxInlineSize: inlineSize,
    settledInlineSize: inlineSize,
  };
}

function areViewerDocumentFrameLayoutsEqual(
  previousLayout: ViewerDocumentFrameLayout,
  nextLayout: ViewerDocumentFrameLayout,
) {
  return (
    previousLayout.activeInlineSize === nextLayout.activeInlineSize &&
    previousLayout.isTransitioning === nextLayout.isTransitioning &&
    previousLayout.maxInlineSize === nextLayout.maxInlineSize
  );
}

function readViewerDocumentFrameMaxInlineSize(element: HTMLElement) {
  if (typeof window === "undefined") return null;

  const value = window.getComputedStyle(element).maxInlineSize;
  if (!value || value === "none") return null;

  const size = Number.parseFloat(value);
  return Number.isFinite(size) && size > 0 ? size : null;
}

function constrainViewerDocumentFrameInlineSize(
  inlineSize: number,
  maxInlineSize: number | null,
) {
  const safeInlineSize =
    Number.isFinite(inlineSize) && inlineSize > 0 ? inlineSize : 0;
  const constrainedInlineSize =
    maxInlineSize == null
      ? safeInlineSize
      : Math.min(safeInlineSize, maxInlineSize);
  return constrainedInlineSize > 0 ? constrainedInlineSize : null;
}

function useViewerSurfaceMeasurementValue(): ViewerSurfaceMeasurement {
  const size = useStableElementSize<HTMLDivElement>({
    retainLastNonZero: true,
  });

  return React.useMemo(
    () => ({
      hasMeasured: size.hasMeasured,
      setViewportElement: size.setElement,
      viewportElement: size.element,
      viewportHeight: size.height,
      viewportWidth: size.width,
    }),
    [size.element, size.hasMeasured, size.height, size.setElement, size.width],
  );
}

export function useOptionalViewerSurfaceMeasurement(): ViewerSurfaceMeasurement | null {
  return useOptionalViewerSurfaceMeasurementContext();
}

export function useViewerSurfaceMeasurement(): ViewerSurfaceMeasurement {
  const context = useOptionalViewerSurfaceMeasurement();
  if (!context) {
    throw new Error(
      "useViewerSurfaceMeasurement must be used within a ViewerSurface.",
    );
  }
  return context;
}

export function useIsInsideViewerViewport(): boolean {
  return useViewerViewportPresence();
}

export function ViewerSurface({ className, ...props }: ViewerSurfaceProps) {
  const measurement = useViewerSurfaceMeasurementValue();

  return (
    <ViewerSurfaceMeasurementProvider value={measurement}>
      <div
        data-slot="viewer-surface"
        data-viewer-surface="inset"
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          className,
        )}
        {...props}
      />
    </ViewerSurfaceMeasurementProvider>
  );
}

export const ViewerViewport = React.forwardRef<
  HTMLDivElement,
  ViewerViewportProps
>(function ViewerViewport({ children, className, ...props }, forwardedRef) {
  const measurement = useOptionalViewerSurfaceMeasurement();
  const rootDiagnostics = useOptionalViewerRootDiagnostics();
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const setViewportElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      viewportRef.current = element;
      measurement?.setViewportElement(element);

      if (typeof forwardedRef === "function") {
        forwardedRef(element);
        return;
      }

      if (forwardedRef) {
        forwardedRef.current = element;
      }
    },
    [forwardedRef, measurement],
  );

  useViewerDevelopmentLayoutWarning({
    enabled: Boolean(rootDiagnostics),
    elements: () => [
      findClosestViewerBody(viewportRef.current),
      viewportRef.current,
    ],
    inspect: () => {
      const viewportElement = viewportRef.current;
      const bodyElement = findClosestViewerBody(viewportElement);
      const bodySize = readViewerElementSize(bodyElement);
      const viewportSize = readViewerElementSize(viewportElement);

      if (bodySize.width > 0 && viewportSize.width === 0) {
        warnViewerDevelopmentOnce({
          code: "viewer_viewport_zero_width",
          message:
            "viewer body has nonzero width but surface viewport width is zero.",
          rootId: rootDiagnostics?.rootId ?? "unknown-root",
          details: {
            bodyHeight: bodySize.height,
            bodySlot: bodyElement?.dataset.slot,
            bodyWidth: bodySize.width,
            viewportHeight: viewportSize.height,
            viewportSlot: viewportElement?.dataset.slot,
            viewportWidth: viewportSize.width,
          },
        });
      }
    },
    keyParts: [
      "viewer-viewport-zero-width",
      rootDiagnostics?.rootId,
      viewportRef.current,
    ],
  });

  return (
    <div
      ref={setViewportElement}
      data-slot="viewer-viewport"
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        className,
      )}
      {...props}
    >
      <ViewerViewportPresenceProvider>
        {children}
      </ViewerViewportPresenceProvider>
    </div>
  );
});
