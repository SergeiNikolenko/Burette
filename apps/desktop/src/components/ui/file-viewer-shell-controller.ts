"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

import { restoreFileViewerSidebarFocusOnClose } from "./file-viewer-accessibility";
import {
  DEFAULT_FILE_VIEWER_SIDEBAR_WIDTH,
  useFileViewerContext,
  type FileViewerContextValue,
  type FileViewerSetSidebarOpen,
  type FileViewerShellStaticContextValue,
  type FileViewerSidebarCollapsible,
  type FileViewerSidebarDynamicContextValue,
  type FileViewerSidebarMode,
  type FileViewerSidebarOpenProps,
  type FileViewerSidebarRegistration,
  type FileViewerSidebarRequestedMode,
  type FileViewerSidebarSide,
  type FileViewerSidebarState,
} from "./file-viewer-context";
import { createFileViewerElementRegistry } from "./file-viewer-elements";
import { useFileViewerShellKeyboard } from "./file-viewer-shell-keyboard";
import {
  createFileViewerMotionKernel,
  useFileViewerMotionFrame,
} from "./file-viewer-motion-kernel";
import { useFileViewerMotionTelemetry } from "./viewer-motion-telemetry";
import {
  FILE_VIEWER_MOTION_DURATION_MS,
  type FileViewerMotionTarget,
} from "./file-viewer-motion-plan";
import {
  readElementRectSnapshot,
  useStableElementSize,
} from "./viewer-measurement";

export const FILE_VIEWER_INLINE_BREAKPOINT = 768;

type FileViewerSidebarOpenController = {
  getSidebarOpen: () => boolean;
  isSidebarOpen: boolean;
  setSidebarOpen: (isSidebarOpen: boolean) => void;
};

// Bridges the controlled/uncontrolled `open` prop pair to real React state, so
// every toggle re-renders the tree and the declarative writers (data
// attributes, inert/aria, overlay translate classes) stay current.
function useFileViewerSidebarOpenController({
  collapsible,
  defaultOpen,
  onOpenChange,
  open,
}: FileViewerSidebarOpenProps & {
  collapsible: FileViewerSidebarCollapsible;
}): FileViewerSidebarOpenController {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen ?? false,
  );
  const isSidebarOpen =
    collapsible === "none" ? true : (open ?? uncontrolledOpen);
  const openRef = React.useRef(isSidebarOpen);
  // Not an inline render-time mirror: setSidebarOpen writes this ref eagerly
  // before a controlled parent applies the prop, and the kernel's flushSync
  // re-renders mid-click with the stale prop value. Assign only when the
  // committed value actually changes so the eager write survives that window.
  useKeyedLayoutEffect(
    joinEffectKey(["file-viewer-open-mirror", isSidebarOpen]),
    () => {
      openRef.current = isSidebarOpen;
    },
  );

  const getSidebarOpen = React.useCallback(() => openRef.current, []);

  const setSidebarOpen = React.useCallback(
    (nextIsSidebarOpen: boolean) => {
      openRef.current = nextIsSidebarOpen;
      if (!isControlled) {
        setUncontrolledOpen(nextIsSidebarOpen);
      }
      onOpenChange?.(nextIsSidebarOpen);
    },
    [isControlled, onOpenChange],
  );

  return React.useMemo(
    () => ({
      getSidebarOpen,
      isSidebarOpen,
      setSidebarOpen,
    }),
    [getSidebarOpen, isSidebarOpen, setSidebarOpen],
  );
}

type FileViewerSidebarRegistrationController = {
  canToggleSidebar: boolean;
  effectiveCollapsible: FileViewerSidebarCollapsible;
  registerSidebar: (registration: FileViewerSidebarRegistration) => () => void;
  side: FileViewerSidebarSide;
  sidebarId: string;
  sidebarWidth: string;
  sidebarWidthPixels: number;
};

// The mounted FileViewerSidebar is the single source of sidebar configuration
// (collapsible, side, width); the shell only holds neutral defaults until one
// registers. No sidebar registered means nothing to toggle and no motion, so
// no fallback width measurement is needed.
function useFileViewerSidebarRegistration({
  fallbackSidebarId,
}: {
  fallbackSidebarId: string;
}): FileViewerSidebarRegistrationController {
  const [sidebarRegistration, setSidebarRegistration] =
    React.useState<FileViewerSidebarRegistration | null>(null);
  const effectiveCollapsible = sidebarRegistration?.collapsible ?? "offcanvas";
  const side = sidebarRegistration?.side ?? "left";
  const sidebarId = sidebarRegistration?.id ?? fallbackSidebarId;
  const sidebarWidth =
    sidebarRegistration?.width ?? DEFAULT_FILE_VIEWER_SIDEBAR_WIDTH;
  const sidebarWidthPixels = sidebarRegistration?.widthPixels ?? 0;
  const canToggleSidebar =
    sidebarRegistration !== null && effectiveCollapsible !== "none";

  const registerSidebar = React.useCallback(
    (registration: FileViewerSidebarRegistration) => {
      setSidebarRegistration(registration);
      return () => {
        setSidebarRegistration((current) =>
          current?.id === registration.id ? null : current,
        );
      };
    },
    [],
  );

  return React.useMemo(
    () => ({
      canToggleSidebar,
      effectiveCollapsible,
      registerSidebar,
      side,
      sidebarId,
      sidebarWidth,
      sidebarWidthPixels,
    }),
    [
      canToggleSidebar,
      effectiveCollapsible,
      registerSidebar,
      side,
      sidebarId,
      sidebarWidth,
      sidebarWidthPixels,
    ],
  );
}

type FileViewerShellControllerOptions = {
  inlineBreakpoint: number;
  sidebarMode: FileViewerSidebarRequestedMode;
};

export type FileViewerShellController = {
  effectiveCollapsible: FileViewerSidebarCollapsible;
  headerMode: FileViewerContextValue["headerMode"];
  isSidebarOpen: boolean;
  mode: FileViewerSidebarMode;
  resourceCategory: FileViewerContextValue["resourceCategory"];
  rootId: string;
  setRootElement: (element: HTMLDivElement | null) => void;
  shellStaticContext: FileViewerShellStaticContextValue;
  side: FileViewerSidebarSide;
  sidebarDynamicContext: FileViewerSidebarDynamicContextValue;
  sidebarState: FileViewerSidebarState;
};

export function useFileViewerShellController({
  inlineBreakpoint,
  sidebarMode,
}: FileViewerShellControllerOptions): FileViewerShellController {
  const context = useFileViewerContext();

  if (!context.isInsideFileViewer) {
    throw new Error("FileViewer must be rendered within FileViewerProvider.");
  }

  const rootId = React.useId();
  const fallbackSidebarId = `${rootId}-sidebar`;
  // The kernel owns time + style writes only; its settle-hold layout reads are
  // injected from the quarantined measurement module here at the controller
  // layer.
  const motionKernel = React.useMemo(
    () => createFileViewerMotionKernel({ readElementRectSnapshot }),
    [],
  );
  const size = useStableElementSize<HTMLDivElement>({
    retainLastNonZero: true,
  });
  const elementRegistry = React.useMemo(
    () =>
      createFileViewerElementRegistry({
        motionKernel,
        onViewerShellElementChange: size.setElement,
      }),
    [motionKernel, size.setElement],
  );
  const {
    canToggleSidebar,
    effectiveCollapsible,
    registerSidebar,
    side,
    sidebarId,
    sidebarWidth,
    sidebarWidthPixels,
  } = useFileViewerSidebarRegistration({
    fallbackSidebarId,
  });
  const openController = useFileViewerSidebarOpenController({
    ...context.sidebarOpenProps,
    collapsible: effectiveCollapsible,
  });
  const isSidebarOpen = openController.isSidebarOpen;
  const motionFrame = useFileViewerMotionFrame(motionKernel);
  const isSidebarTransitioning = motionFrame.phase === "sliding";
  const mode = resolveFileViewerSidebarMode({
    inlineBreakpoint,
    requestedMode: sidebarMode,
    width: size.width,
  });
  const isSidebarInteractive = resolveFileViewerSidebarInteractive({
    canToggleSidebar,
    collapsible: effectiveCollapsible,
    isSidebarOpen,
    isSidebarTransitioning,
    mode,
  });
  const sidebarState: FileViewerSidebarState = isSidebarOpen
    ? "expanded"
    : "collapsed";
  const motionTarget = React.useMemo<FileViewerMotionTarget>(
    () => ({
      shellInlineSize: size.width ?? 0,
      durationMs: FILE_VIEWER_MOTION_DURATION_MS,
      mode,
      open: isSidebarOpen,
      side,
      sidebarWidth: sidebarWidthPixels,
    }),
    [isSidebarOpen, mode, side, sidebarWidthPixels, size.width],
  );
  const motionTargetRef = React.useRef(motionTarget);
  // Same two-writer shape as openRef above: setSidebarOpen stores the eager
  // nextTarget before React commits, so only adopt the rendered target when
  // it is a genuinely new object.
  useKeyedLayoutEffect(
    joinEffectKey(["file-viewer-motion-target-mirror", motionTarget]),
    () => {
      motionTargetRef.current = motionTarget;
    },
  );

  const setRootElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      elementRegistry.registerViewerShellElement(element);
    },
    [elementRegistry],
  );

  // Adopt idle geometry (mount, resizes, mode flips) without animating. While
  // a motion is in flight the kernel owns the target — EXCEPT on a mode flip:
  // React renders the new mode immediately, so the kernel must be told (it
  // snaps the motion) or an inline slide keeps writing gap widths against
  // overlay DOM until settle.
  useKeyedLayoutEffect(
    joinEffectKey([
      "file-viewer-sync-target",
      motionFrame.mode,
      motionFrame.phase,
      motionKernel,
      motionTarget,
    ]),
    () => {
      if (
        motionFrame.phase !== "idle" &&
        motionFrame.mode === motionTarget.mode
      ) {
        return;
      }
      motionKernel.syncTarget(motionTarget);
    },
  );

  // Single owner of focus restoration: when the sidebar stops being
  // interactive while focus is inside it, hand focus back to the trigger.
  const previousIsSidebarInteractiveRef = React.useRef(isSidebarInteractive);
  useKeyedLayoutEffect(
    joinEffectKey([
      "file-viewer-sidebar-focus-restore",
      elementRegistry,
      isSidebarInteractive,
    ]),
    () => {
      restoreFileViewerSidebarFocusOnClose({
        elements: elementRegistry.getElements(),
        isSidebarInteractive,
        previousIsSidebarInteractive: previousIsSidebarInteractiveRef.current,
      });
      previousIsSidebarInteractiveRef.current = isSidebarInteractive;
    },
  );

  const setSidebarOpen = React.useCallback<FileViewerSetSidebarOpen>(
    (value) => {
      // Toggling requires a registered, collapsible sidebar; a non-collapsible
      // sidebar is pinned open and an unregistered one has nothing to move.
      if (!canToggleSidebar) return;

      const currentOpen = openController.getSidebarOpen();
      const nextOpen = typeof value === "function" ? value(currentOpen) : value;
      if (nextOpen === currentOpen) return;

      openController.setSidebarOpen(nextOpen);
      const nextTarget: FileViewerMotionTarget = {
        ...motionTargetRef.current,
        open: nextOpen,
      };
      motionTargetRef.current = nextTarget;
      motionKernel.startMotion(nextTarget);
    },
    [canToggleSidebar, motionKernel, openController],
  );
  const toggleSidebar = React.useCallback(
    () => setSidebarOpen((open) => !open),
    [setSidebarOpen],
  );
  const closeSidebar = React.useCallback(
    () => setSidebarOpen(false),
    [setSidebarOpen],
  );

  useFileViewerShellKeyboard({
    canToggleSidebar,
    closeSidebar,
    elementRegistry,
    isSidebarInteractive,
    isSidebarOverlayDismissible:
      mode === "overlay" && canToggleSidebar && isSidebarOpen,
    viewerShellElement: size.element,
  });

  useFileViewerMotionTelemetry({
    getElements: elementRegistry.getElements,
    getIsSidebarOpen: openController.getSidebarOpen,
    motionDurationMs: FILE_VIEWER_MOTION_DURATION_MS,
    motionKernel,
    toggleSidebar,
  });

  const shellStaticContext = React.useMemo<FileViewerShellStaticContextValue>(
    () => ({
      canToggleSidebar,
      collapsible: effectiveCollapsible,
      elementRegistry,
      mode,
      motionDurationMs: FILE_VIEWER_MOTION_DURATION_MS,
      motionKernel,
      registerSidebar,
      rootId,
      setSidebarOpen,
      side,
      sidebarId,
      sidebarWidth,
      toggleSidebar,
    }),
    [
      canToggleSidebar,
      effectiveCollapsible,
      elementRegistry,
      mode,
      motionKernel,
      registerSidebar,
      rootId,
      setSidebarOpen,
      side,
      sidebarId,
      sidebarWidth,
      toggleSidebar,
    ],
  );
  const sidebarDynamicContext =
    React.useMemo<FileViewerSidebarDynamicContextValue>(
      () => ({
        isSidebarInteractive,
        isSidebarOpen,
        isSidebarTransitioning,
        sidebarState,
      }),
      [
        isSidebarInteractive,
        isSidebarOpen,
        isSidebarTransitioning,
        sidebarState,
      ],
    );

  return {
    effectiveCollapsible,
    headerMode: context.headerMode,
    isSidebarOpen,
    mode,
    resourceCategory: context.resourceCategory,
    rootId,
    setRootElement,
    shellStaticContext,
    side,
    sidebarDynamicContext,
    sidebarState,
  };
}

// An inline sidebar stays non-interactive while its geometry is in motion:
// closing makes it inert immediately, opening keeps it inert until the
// settle publish leaves the "sliding" phase.
function resolveFileViewerSidebarInteractive({
  canToggleSidebar,
  collapsible,
  isSidebarOpen,
  isSidebarTransitioning,
  mode,
}: {
  canToggleSidebar: boolean;
  collapsible: FileViewerSidebarCollapsible;
  isSidebarOpen: boolean;
  isSidebarTransitioning: boolean;
  mode: FileViewerSidebarMode;
}): boolean {
  if (collapsible === "none") return true;
  if (!isSidebarOpen) return false;
  return !(mode === "inline" && canToggleSidebar && isSidebarTransitioning);
}

function resolveFileViewerSidebarMode({
  inlineBreakpoint,
  requestedMode,
  width,
}: {
  inlineBreakpoint: number;
  requestedMode: FileViewerSidebarRequestedMode;
  width: number | null;
}): FileViewerSidebarMode {
  if (requestedMode !== "auto") return requestedMode;
  if (width === null) return "overlay";
  return width >= inlineBreakpoint ? "inline" : "overlay";
}
