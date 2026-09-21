"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

import type {
  ViewerDataAttributes,
  ViewerPortalContainmentAttributes,
  ViewerSidebarStateValue,
  ViewerGeometrySnapshot,
  ViewerGeometryStore,
  ViewerGeometryTarget,
  ViewerSidebarRegistrationState,
  ViewerSidebarRequestedMode,
  ViewerSidebarMode,
  ViewerStateAttributeNamespace,
  ViewerStateAttributeSlot,
  ViewerStateAttributeValues,
  ViewerSurfaceMeasurement,
} from "./viewer-types";

export const VIEWER_SIDEBAR_INLINE_BREAKPOINT = 768;
export const VIEWER_SIDEBAR_WIDTH = "10rem";
export const VIEWER_ROOT_ID_ATTRIBUTE = "data-viewer-root-id";
export const VIEWER_PORTAL_ROOT_ID_ATTRIBUTE = "data-viewer-portal-root-id";

const VIEWER_SIDEBAR_MODE_HYSTERESIS = 16;

const DEFAULT_VIEWER_GEOMETRY_SNAPSHOT: ViewerGeometrySnapshot = {
  bodyInlineSize: 0,
  documentInlineSize: 0,
  hasMeasuredBody: false,
  isTransitioning: false,
  mode: "overlay",
  open: false,
  progress: 1,
  sidebarGapTransition: "width",
  sidebarInlineSize: 0,
  sidebarWidth: 0,
  side: "left",
  state: "collapsed",
  transitionPhase: "idle",
};

const ViewerSidebarStateContext =
  React.createContext<ViewerSidebarStateValue | null>(null);
const ViewerSidebarRegistrationContext =
  React.createContext<ViewerSidebarRegistrationState | null>(null);
const ViewerSurfaceMeasurementContext =
  React.createContext<ViewerSurfaceMeasurement | null>(null);
const ViewerViewportPresenceContext = React.createContext(false);
const VIEWER_GEOMETRY_TRANSITION_MS = 150;

type ViewerGeometryBaseSnapshot = Pick<
  ViewerGeometrySnapshot,
  | "bodyInlineSize"
  | "documentInlineSize"
  | "hasMeasuredBody"
  | "mode"
  | "open"
  | "sidebarGapTransition"
  | "sidebarInlineSize"
  | "sidebarWidth"
  | "side"
  | "state"
>;

export function ViewerSidebarStateProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: ViewerSidebarStateValue;
}) {
  return React.createElement(
    ViewerSidebarStateContext.Provider,
    { value },
    children,
  );
}

export function ViewerSidebarRegistrationProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: ViewerSidebarRegistrationState;
}) {
  return React.createElement(
    ViewerSidebarRegistrationContext.Provider,
    { value },
    children,
  );
}

export function ViewerSurfaceMeasurementProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: ViewerSurfaceMeasurement;
}) {
  return React.createElement(
    ViewerSurfaceMeasurementContext.Provider,
    { value },
    children,
  );
}

export function ViewerViewportPresenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return React.createElement(
    ViewerViewportPresenceContext.Provider,
    { value: true },
    children,
  );
}

export function useOptionalViewerSidebarState(): ViewerSidebarStateValue | null {
  return React.useContext(ViewerSidebarStateContext);
}

export function useViewerSidebarState(
  consumer: string,
): ViewerSidebarStateValue {
  const context = useOptionalViewerSidebarState();
  if (!context) {
    throw new Error(`${consumer} must be used within a ViewerRoot.`);
  }
  return context;
}

export function useOptionalViewerSidebarRegistration(): ViewerSidebarRegistrationState | null {
  return React.useContext(ViewerSidebarRegistrationContext);
}

export function useOptionalViewerSurfaceMeasurementContext(): ViewerSurfaceMeasurement | null {
  return React.useContext(ViewerSurfaceMeasurementContext);
}

export function useViewerViewportPresence(): boolean {
  return React.useContext(ViewerViewportPresenceContext);
}

export function useViewerGeometrySnapshot(
  geometryStore: ViewerGeometryStore,
): ViewerGeometrySnapshot {
  return React.useSyncExternalStore(
    geometryStore.subscribe,
    geometryStore.getSnapshot,
    geometryStore.getSnapshot,
  );
}

export function createViewerGeometryStore(): ViewerGeometryStore {
  const listeners = new Set<() => void>();
  let snapshot = DEFAULT_VIEWER_GEOMETRY_SNAPSHOT;
  let transitionTargetSnapshot: ViewerGeometryBaseSnapshot | null = null;
  let transitionFrame = 0;
  let transitionStartTime: number | null = null;
  let transitionStartSidebarInlineSize =
    DEFAULT_VIEWER_GEOMETRY_SNAPSHOT.sidebarInlineSize;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const commitSnapshot = (nextSnapshot: ViewerGeometrySnapshot) => {
    if (areViewerGeometrySnapshotsEqual(snapshot, nextSnapshot)) return;

    snapshot = nextSnapshot;
    notify();
  };

  const cancelTransitionFrame = () => {
    if (transitionFrame === 0) return;
    const cancelAnimationFrame =
      globalThis.cancelAnimationFrame ??
      (typeof window === "undefined" ? undefined : window.cancelAnimationFrame);
    cancelAnimationFrame?.(transitionFrame);
    transitionFrame = 0;
  };

  const commitGeometryProgress = (progress: number) => {
    if (!transitionTargetSnapshot) return;

    const sidebarInlineSize = lerp(
      transitionStartSidebarInlineSize,
      transitionTargetSnapshot.sidebarInlineSize,
      progress,
    );

    commitSnapshot({
      ...transitionTargetSnapshot,
      documentInlineSize: getViewerGeometryDocumentInlineSize({
        bodyInlineSize: transitionTargetSnapshot.bodyInlineSize,
        mode: transitionTargetSnapshot.mode,
        sidebarGapTransition: transitionTargetSnapshot.sidebarGapTransition,
        sidebarInlineSize,
      }),
      isTransitioning: progress < 1,
      progress,
      sidebarInlineSize,
      transitionPhase: progress < 1 ? "sliding" : "idle",
    });

    if (progress >= 1) {
      transitionTargetSnapshot = null;
    }
  };

  const scheduleTransitionFrame = () => {
    const requestAnimationFrame =
      globalThis.requestAnimationFrame ??
      (typeof window === "undefined" ? undefined : window.requestAnimationFrame);

    if (typeof requestAnimationFrame !== "function") {
      commitGeometryProgress(1);
      return;
    }

    transitionFrame = requestAnimationFrame((timestamp) => {
      transitionFrame = 0;
      if (!transitionTargetSnapshot) return;
      if (transitionStartTime === null) transitionStartTime = timestamp;

      const progress = clamp01(
        (timestamp - transitionStartTime) / VIEWER_GEOMETRY_TRANSITION_MS,
      );
      commitGeometryProgress(progress);

      if (progress < 1) scheduleTransitionFrame();
    });
  };

  const startTransition = (targetSnapshot: ViewerGeometryBaseSnapshot) => {
    cancelTransitionFrame();

    transitionTargetSnapshot = targetSnapshot;
    transitionStartSidebarInlineSize = snapshot.sidebarInlineSize;
    transitionStartTime = readViewerGeometryNow();

    commitGeometryProgress(0);
    scheduleTransitionFrame();
  };

  return {
    getSnapshot: () => snapshot,
    setTarget: (target) => {
      const resolvedSidebarWidth =
        Number.isFinite(target.sidebarWidth) && target.sidebarWidth > 0
          ? target.sidebarWidth
          : readViewerGeometrySidebarWidth(target);
      const sidebarWidth =
        resolvedSidebarWidth > 0 ? resolvedSidebarWidth : snapshot.sidebarWidth;
      const measuredBodyInlineSize = readViewerGeometryBodyInlineSize(target);
      const bodyInlineSize =
        measuredBodyInlineSize > 0
          ? measuredBodyInlineSize
          : snapshot.bodyInlineSize;
      const hasMeasuredBody =
        measuredBodyInlineSize > 0 || snapshot.hasMeasuredBody;
      const sidebarInlineSize = getViewerGeometryTargetSidebarInlineSize({
        mode: target.mode,
        open: target.open,
        sidebarGapTransition: target.sidebarGapTransition,
        sidebarWidth,
      });
      const nextBaseSnapshot: ViewerGeometryBaseSnapshot = {
        bodyInlineSize,
        documentInlineSize: getViewerGeometryDocumentInlineSize({
          bodyInlineSize,
          mode: target.mode,
          sidebarGapTransition: target.sidebarGapTransition,
          sidebarInlineSize,
        }),
        hasMeasuredBody,
        mode: target.mode,
        open: target.open,
        sidebarGapTransition: target.sidebarGapTransition,
        sidebarInlineSize,
        sidebarWidth,
        side: target.side,
        state: target.state,
      };

      if (
        snapshot.isTransitioning &&
        transitionTargetSnapshot &&
        areViewerGeometryTargetsEqual(
          transitionTargetSnapshot,
          nextBaseSnapshot,
        )
      ) {
        return;
      }

      const shouldAnimate = shouldAnimateViewerGeometry({
        previousSnapshot: snapshot,
        targetSnapshot: nextBaseSnapshot,
      });

      if (!shouldAnimate) {
        cancelTransitionFrame();
        transitionTargetSnapshot = null;
        commitSnapshot({
          ...nextBaseSnapshot,
          isTransitioning: false,
          progress: 1,
          transitionPhase: "idle",
        });
        return;
      }

      startTransition(nextBaseSnapshot);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function resolveSidebarMode({
  requestedMode,
  width,
  inlineBreakpoint,
}: {
  requestedMode: ViewerSidebarRequestedMode;
  width: number | null;
  inlineBreakpoint: number;
}): ViewerSidebarMode {
  if (requestedMode !== "auto") return requestedMode;
  if (width === null) return "overlay";
  return width >= inlineBreakpoint ? "inline" : "overlay";
}

export function resolveMeasuredSidebarMode({
  currentMode,
  hasMeasured,
  inlineBreakpoint,
  requestedMode,
  width,
}: {
  currentMode: ViewerSidebarMode;
  hasMeasured: boolean;
  inlineBreakpoint: number;
  requestedMode: ViewerSidebarRequestedMode;
  width: number;
}): ViewerSidebarMode {
  if (requestedMode !== "auto") return requestedMode;
  if (!hasMeasured) {
    return width >= inlineBreakpoint ? "inline" : "overlay";
  }

  if (currentMode === "inline") {
    return width < inlineBreakpoint - VIEWER_SIDEBAR_MODE_HYSTERESIS
      ? "overlay"
      : "inline";
  }

  return width > inlineBreakpoint + VIEWER_SIDEBAR_MODE_HYSTERESIS
    ? "inline"
    : "overlay";
}

export function isAriaDisabled(value: unknown): boolean {
  return value === true || value === "true";
}

export function pickCssCustomProperties(
  style: React.CSSProperties | undefined,
): React.CSSProperties {
  if (!style) return {};

  return Object.fromEntries(
    Object.entries(style).filter(([name]) => name.startsWith("--")),
  ) as React.CSSProperties;
}

function isViewerStateNamespaceEnabled(
  namespace: ViewerStateAttributeNamespace | undefined,
  slot: ViewerStateAttributeSlot,
): namespace is ViewerStateAttributeNamespace {
  if (!namespace) return false;
  return namespace.slots?.[slot] ?? true;
}

export function createViewerStateAttributes(
  namespace: ViewerStateAttributeNamespace | undefined,
  slot: ViewerStateAttributeSlot,
  values: ViewerStateAttributeValues,
): ViewerDataAttributes {
  if (!isViewerStateNamespaceEnabled(namespace, slot)) return {};

  const attributes: ViewerDataAttributes = {};
  const prefix = namespace.prefix;

  if (values.hasSidebar !== undefined) {
    attributes[`data-${prefix}-has-sidebar`] = values.hasSidebar
      ? "true"
      : "false";
  }
  if (values.sidebarCollapsible !== undefined) {
    attributes[`data-${prefix}-sidebar-collapsible`] =
      values.sidebarCollapsible;
  }
  if (values.sidebarMode !== undefined) {
    attributes[`data-${prefix}-sidebar-mode`] = values.sidebarMode;
  }
  if (values.sidebarOpen !== undefined) {
    attributes[`data-${prefix}-sidebar-open`] = values.sidebarOpen
      ? "true"
      : "false";
  }
  if (values.sidebarSide !== undefined) {
    attributes[`data-${prefix}-sidebar-side`] = values.sidebarSide;
  }
  if (values.sidebarState !== undefined) {
    attributes[`data-${prefix}-sidebar-state`] = values.sidebarState;
  }

  return attributes;
}

export function createViewerSlotAttributes(
  namespace: ViewerStateAttributeNamespace | undefined,
  slot: ViewerStateAttributeSlot,
  value: string | undefined,
): ViewerDataAttributes {
  if (!value || !isViewerStateNamespaceEnabled(namespace, slot)) return {};
  return {
    [`data-${namespace.prefix}-slot`]: value,
  };
}

export function createViewerPortalContainmentAttributes(
  rootId: string,
): ViewerPortalContainmentAttributes {
  return {
    [VIEWER_PORTAL_ROOT_ID_ATTRIBUTE]: rootId,
  };
}

export function readViewerElementSize(element: HTMLElement | null) {
  if (!element) return { height: 0, width: 0 };

  const rect =
    typeof element.getBoundingClientRect === "function"
      ? element.getBoundingClientRect()
      : null;
  return {
    height: rect?.height || element.clientHeight || 0,
    width: rect?.width || element.clientWidth || 0,
  };
}

function readViewerGeometrySidebarWidth({
  rootElement,
  sidebarElement,
}: ViewerGeometryTarget) {
  const elementSize = readViewerElementSize(sidebarElement);
  if (Number.isFinite(elementSize.width) && elementSize.width > 0) {
    return elementSize.width;
  }

  return readViewerSidebarDeclaredWidth(rootElement, sidebarElement);
}

function readViewerGeometryBodyInlineSize({
  bodyElement,
  rootElement,
}: ViewerGeometryTarget) {
  const bodySize = readViewerElementSize(bodyElement);
  if (Number.isFinite(bodySize.width) && bodySize.width > 0) {
    return bodySize.width;
  }

  const rootSize = readViewerElementSize(rootElement);
  return Number.isFinite(rootSize.width) && rootSize.width > 0
    ? rootSize.width
    : 0;
}

function readViewerSidebarDeclaredWidth(
  rootElement: HTMLElement | null,
  sidebarElement: HTMLElement | null,
) {
  return (
    readViewerCssLength(rootElement, "--viewer-sidebar-width") ??
    readViewerCssLength(sidebarElement, "--viewer-sidebar-width") ??
    0
  );
}

function readViewerCssLength(
  element: HTMLElement | null,
  propertyName: string,
) {
  if (!element || typeof window === "undefined") return null;

  const styleValue = element.style.getPropertyValue(propertyName);
  const computedValue =
    window.getComputedStyle(element).getPropertyValue(propertyName);
  return parseViewerCssLength(styleValue) ?? parseViewerCssLength(computedValue);
}

function parseViewerCssLength(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue.endsWith("px")) return null;

  const length = Number.parseFloat(trimmedValue);
  return Number.isFinite(length) && length > 0 ? length : null;
}

function areViewerGeometrySnapshotsEqual(
  previous: ViewerGeometrySnapshot,
  next: ViewerGeometrySnapshot,
) {
  return (
    previous.bodyInlineSize === next.bodyInlineSize &&
    previous.documentInlineSize === next.documentInlineSize &&
    previous.hasMeasuredBody === next.hasMeasuredBody &&
    previous.isTransitioning === next.isTransitioning &&
    previous.mode === next.mode &&
    previous.open === next.open &&
    previous.progress === next.progress &&
    previous.sidebarGapTransition === next.sidebarGapTransition &&
    previous.sidebarInlineSize === next.sidebarInlineSize &&
    previous.sidebarWidth === next.sidebarWidth &&
    previous.side === next.side &&
    previous.state === next.state &&
    previous.transitionPhase === next.transitionPhase
  );
}

function areViewerGeometryTargetsEqual(
  previous: ViewerGeometryBaseSnapshot,
  next: ViewerGeometryBaseSnapshot,
) {
  return (
    previous.bodyInlineSize === next.bodyInlineSize &&
    previous.documentInlineSize === next.documentInlineSize &&
    previous.hasMeasuredBody === next.hasMeasuredBody &&
    previous.mode === next.mode &&
    previous.open === next.open &&
    previous.sidebarGapTransition === next.sidebarGapTransition &&
    previous.sidebarInlineSize === next.sidebarInlineSize &&
    previous.sidebarWidth === next.sidebarWidth &&
    previous.side === next.side &&
    previous.state === next.state
  );
}

function shouldAnimateViewerGeometry({
  previousSnapshot,
  targetSnapshot,
}: {
  previousSnapshot: ViewerGeometrySnapshot;
  targetSnapshot: ViewerGeometryBaseSnapshot;
}) {
  return (
    previousSnapshot.sidebarWidth > 0 &&
    targetSnapshot.mode === "inline" &&
    targetSnapshot.sidebarGapTransition === "width" &&
    targetSnapshot.sidebarWidth > 0 &&
    hasViewerGeometryAnimationSupport() &&
    !prefersReducedViewerGeometryMotion() &&
    !areViewerGeometryInlineSizesEqual(
      previousSnapshot.sidebarInlineSize,
      targetSnapshot.sidebarInlineSize,
    )
  );
}

function getViewerGeometryTargetSidebarInlineSize(
  snapshot: Pick<
    ViewerGeometryBaseSnapshot,
    "mode" | "open" | "sidebarGapTransition" | "sidebarWidth"
  >,
) {
  return snapshot.mode === "inline" && snapshot.open && snapshot.sidebarWidth > 0
    ? snapshot.sidebarWidth
    : 0;
}

function getViewerGeometryDocumentInlineSize({
  bodyInlineSize,
  mode,
  sidebarGapTransition,
  sidebarInlineSize,
}: {
  bodyInlineSize: number;
  mode: ViewerSidebarMode;
  sidebarGapTransition: string;
  sidebarInlineSize: number;
}) {
  if (bodyInlineSize <= 0) return 0;
  if (mode !== "inline" || sidebarGapTransition !== "width") {
    return bodyInlineSize;
  }
  return Math.max(1, bodyInlineSize - sidebarInlineSize);
}

function areViewerGeometryInlineSizesEqual(
  previousInlineSize: number,
  nextInlineSize: number,
) {
  return Math.abs(previousInlineSize - nextInlineSize) < 0.5;
}

function hasViewerGeometryAnimationSupport() {
  const requestAnimationFrame =
    globalThis.requestAnimationFrame ??
    (typeof window === "undefined" ? undefined : window.requestAnimationFrame);
  return typeof requestAnimationFrame === "function";
}

function prefersReducedViewerGeometryMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function readViewerGeometryNow() {
  const performanceNow =
    globalThis.performance?.now ??
    (typeof window === "undefined" ? undefined : window.performance?.now);

  return typeof performanceNow === "function"
    ? performanceNow.call(globalThis.performance ?? window.performance)
    : Date.now();
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export function elementContainsTarget(
  element: HTMLElement | null | undefined,
  target: unknown,
): boolean {
  if (!element || target === null || target === undefined) return false;
  if (element === target) return true;

  if (typeof element.contains === "function") {
    try {
      if (element.contains(target as Node)) return true;
    } catch {
      // Some test and embedded DOM hosts do not share a Node prototype chain.
    }
  }

  if (typeof target !== "object") return false;

  let current: unknown = (target as { parentNode?: unknown }).parentNode;
  while (current && typeof current === "object") {
    if (current === element) return true;
    current = (current as { parentNode?: unknown }).parentNode;
  }

  return false;
}

export function targetHasViewerPortalContainment({
  rootId,
  target,
}: {
  rootId: string;
  target: unknown;
}): boolean {
  if (!target || typeof target !== "object") return false;

  if (typeof (target as { closest?: unknown }).closest === "function") {
    try {
      const ownerElement = (
        target as {
          closest: (selector: string) => {
            getAttribute?: (attributeName: string) => string | null;
          } | null;
        }
      ).closest(`[${VIEWER_PORTAL_ROOT_ID_ATTRIBUTE}]`);

      if (
        ownerElement?.getAttribute?.(VIEWER_PORTAL_ROOT_ID_ATTRIBUTE) === rootId
      ) {
        return true;
      }
    } catch {
      // Some test and embedded DOM hosts do not support Element.closest.
    }
  }

  let current: unknown = target;
  while (current && typeof current === "object") {
    const getAttribute = (current as { getAttribute?: unknown }).getAttribute;
    if (
      typeof getAttribute === "function" &&
      getAttribute.call(current, VIEWER_PORTAL_ROOT_ID_ATTRIBUTE) === rootId
    ) {
      return true;
    }
    current = (current as { parentNode?: unknown }).parentNode;
  }

  return false;
}

export function targetViewerRootId(target: unknown): string | null {
  if (!target || typeof target !== "object") return null;

  if (typeof (target as { closest?: unknown }).closest === "function") {
    try {
      const rootElement = (
        target as {
          closest: (selector: string) => {
            getAttribute?: (attributeName: string) => string | null;
          } | null;
        }
      ).closest(`[${VIEWER_ROOT_ID_ATTRIBUTE}]`);
      const rootId = rootElement?.getAttribute?.(VIEWER_ROOT_ID_ATTRIBUTE);
      if (rootId) return rootId;
    } catch {
      // Some test and embedded DOM hosts do not support Element.closest.
    }
  }

  let current: unknown = target;
  while (current && typeof current === "object") {
    const getAttribute = (current as { getAttribute?: unknown }).getAttribute;
    if (typeof getAttribute === "function") {
      const rootId = getAttribute.call(current, VIEWER_ROOT_ID_ATTRIBUTE);
      if (typeof rootId === "string" && rootId) {
        return rootId;
      }
    }
    current = (current as { parentNode?: unknown }).parentNode;
  }

  return null;
}

export function findClosestViewerBody(
  element: HTMLDivElement | null,
): HTMLElement | null {
  if (!element || typeof element.closest !== "function") return null;
  return element.closest<HTMLElement>('[data-viewer-slot="body"]');
}

export function useViewerDevelopmentLayoutWarning({
  enabled = true,
  elements,
  inspect,
  keyParts,
}: {
  enabled?: boolean;
  elements: () => Array<HTMLElement | null>;
  inspect: () => void;
  keyParts: unknown[];
}) {
  useKeyedLayoutEffect(enabled ? joinEffectKey(keyParts) : null, () => {
    if (process.env.NODE_ENV === "production" || !enabled) return;

    const observedElements = elements().filter(
      (element): element is HTMLElement => Boolean(element),
    );

    let frame: number | null = null;
    const run = () => {
      frame = null;
      inspect();
    };
    const schedule = () => {
      if (frame !== null) return;

      if (typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(run);
        return;
      }

      run();
    };

    schedule();

    const ResizeObserverConstructor = globalThis.ResizeObserver;
    if (
      observedElements.length === 0 ||
      typeof ResizeObserverConstructor === "undefined"
    ) {
      return () => {
        if (frame !== null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(frame);
        }
      };
    }

    const observer = new ResizeObserverConstructor(schedule);
    for (const element of observedElements) {
      observer.observe(element);
    }

    return () => {
      if (frame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  });
}

export function useViewerSidebarRegistrationContext(
  consumer: string,
): ViewerSidebarRegistrationState {
  const context = useOptionalViewerSidebarRegistration();
  if (!context) {
    throw new Error(`${consumer} must be used within a ViewerRoot.`);
  }
  return context;
}
