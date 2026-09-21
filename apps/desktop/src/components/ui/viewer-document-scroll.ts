import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

import type {
  ViewerDocumentLayoutModel,
  ViewerDocumentPhysicalScrollPosition,
  ViewerDocumentResolvedScrollTarget,
  ViewerDocumentScrollMapper,
  ViewerDocumentScrollMetrics,
  ViewerDocumentScrollTargetResolver,
  ViewerDocumentZoomMotionController,
} from "./viewer-types";
import { useViewerDocumentGeometryTransaction } from "./viewer-document-geometry";

const VIEWER_DOCUMENT_SCROLL_IDLE_MS = 120;
const VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON = 1;
const VIEWER_DOCUMENT_SCROLL_RESTORE_MAX_FRAMES = 45;
const VIEWER_DOCUMENT_INTERNAL_SCROLL_SUPPRESS_MS = 120;
// A zoom intent is consumed by the geometry commit its gesture causes; if no
// commit claims it in this window (scale already clamped, controlled scale
// ignored by the owner), it is stale and must not re-anchor a later,
// unrelated geometry change.
const VIEWER_DOCUMENT_ZOOM_INTENT_MAX_AGE_MS = 400;

type ViewerDocumentScrollIntent<Target> =
  | {
      kind: "idle";
    }
  | {
      kind: "user";
    }
  | {
      behavior: ScrollBehavior;
      kind: "programmatic";
      sequence: number;
      target: Target;
      targetLeft?: number;
      targetTop: number;
    };

type PendingViewerDocumentScrollRestore = {
  attempts: number;
  options: ScrollToOptions;
  targetTop: number;
};

type ViewerDocumentScrollEventResult = {
  source: "internal" | "programmatic" | "user";
};

export function useViewerDocumentScroll<Anchor, Target, ZoomTransaction = unknown>({
  copyScrollTarget,
  layout,
  resetKey,
  resolveScrollTarget,
  scrollMapper,
  zoomMotion,
}: {
  copyScrollTarget?: (target: Target) => Target;
  layout: ViewerDocumentLayoutModel<Anchor>;
  resetKey?: unknown;
  resolveScrollTarget?: ViewerDocumentScrollTargetResolver<Anchor, Target>;
  scrollMapper: ViewerDocumentScrollMapper;
  zoomMotion?: ViewerDocumentZoomMotionController<ZoomTransaction>;
}) {
  const viewportElementRef = React.useRef<HTMLDivElement | null>(null);
  const scrollPageOffsetRef = React.useRef(0);
  const pendingZoomIntentRef = React.useRef<{
    capturedAt: number;
    transaction: ZoomTransaction;
  } | null>(null);
  const activeZoomMotionCancelRef = React.useRef<(() => void) | null>(null);
  const pendingScrollRestoreRef =
    React.useRef<PendingViewerDocumentScrollRestore | null>(null);
  const pendingScrollRestoreFrameRef = React.useRef(0);
  const flushPendingScrollRestoreRef = React.useRef<() => void>(() => {});
  const isInternalScrollWriteRef = React.useRef(false);
  const internalScrollWriteTimeoutRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const viewportResetKeyRef = React.useRef<unknown>(resetKey);
  const didMountResetEffectRef = React.useRef(false);
  const committedLayoutRef = React.useRef(layout);
  const committedResetKeyRef = React.useRef<unknown>(resetKey);
  const geometryTransaction = useViewerDocumentGeometryTransaction({
    layout,
    resetKey,
  });
  const {
    cacheAnchor,
    cacheReadingAnchor,
    cacheVisualLayerRect,
    cancel: cancelGeometryTransaction,
    classifyLayoutChange,
    commit,
    prepare,
    recordStableState,
    reset: resetGeometryTransaction,
  } = geometryTransaction;
  const scrollIntent = useViewerDocumentScrollIntentController<Target>();
  const [viewportElement, setViewportElementState] =
    React.useState<HTMLDivElement | null>(null);

  const cancelPendingScrollRestore = React.useCallback(() => {
    pendingScrollRestoreRef.current = null;
    if (pendingScrollRestoreFrameRef.current === 0) return;
    cancelAnimationFrame(pendingScrollRestoreFrameRef.current);
    pendingScrollRestoreFrameRef.current = 0;
  }, []);

  // Interrupting a zoom relax snaps to its committed endpoint: the layout and
  // scroll landed in the zoom's own commit, so clearing the transform is
  // always safe and never moves the settled geometry.
  const cancelZoomMotion = React.useCallback(() => {
    pendingZoomIntentRef.current = null;
    const cancelActiveZoomMotion = activeZoomMotionCancelRef.current;
    activeZoomMotionCancelRef.current = null;
    cancelActiveZoomMotion?.();
  }, []);

  const captureZoomIntent = React.useCallback(() => {
    const viewportElement = viewportElementRef.current;
    if (!viewportElement || !zoomMotion) {
      pendingZoomIntentRef.current = null;
      return;
    }
    const metrics = readViewerDocumentScrollMetrics({
      layout,
      scrollMapper,
      scrollPageOffset: scrollPageOffsetRef.current,
      viewportElement,
    });
    const transaction = zoomMotion.capture({
      scrollTop: metrics.scrollTop,
      viewportElement,
    });
    pendingZoomIntentRef.current =
      transaction == null
        ? null
        : { capturedAt: readViewerDocumentNow(), transaction };
  }, [layout, scrollMapper, zoomMotion]);

  const clearInternalScrollWrite = React.useCallback(() => {
    isInternalScrollWriteRef.current = false;
    if (internalScrollWriteTimeoutRef.current === null) return;
    clearTimeout(internalScrollWriteTimeoutRef.current);
    internalScrollWriteTimeoutRef.current = null;
  }, []);

  const markInternalScrollWrite = React.useCallback(() => {
    isInternalScrollWriteRef.current = true;
    if (internalScrollWriteTimeoutRef.current !== null) {
      clearTimeout(internalScrollWriteTimeoutRef.current);
    }
    internalScrollWriteTimeoutRef.current = setTimeout(() => {
      internalScrollWriteTimeoutRef.current = null;
      isInternalScrollWriteRef.current = false;
    }, VIEWER_DOCUMENT_INTERNAL_SCROLL_SUPPRESS_MS);
  }, []);

  const resetViewportForKey = React.useCallback(
    (element: HTMLDivElement, key: unknown) => {
      cancelPendingScrollRestore();
      cancelZoomMotion();
      viewportResetKeyRef.current = key;
      scrollPageOffsetRef.current = 0;
      resetGeometryTransaction(element);
      scrollIntent.reset();
      markInternalScrollWrite();
      setViewportPhysicalScrollTop(element, 0);
      element.scrollTo?.({ top: 0, behavior: "auto" });
    },
    [
      cancelPendingScrollRestore,
      cancelZoomMotion,
      markInternalScrollWrite,
      resetGeometryTransaction,
      scrollIntent,
    ],
  );

  const setViewportElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      viewportElementRef.current = element;
      if (element && !Object.is(viewportResetKeyRef.current, resetKey)) {
        resetViewportForKey(element, resetKey);
      }
      setViewportElementState(element);
    },
    [resetKey, resetViewportForKey],
  );

  const readScrollMetrics = React.useCallback(
    () =>
      readViewerDocumentScrollMetrics({
        layout,
        scrollMapper,
        scrollPageOffset: scrollPageOffsetRef.current,
        viewportElement: viewportElementRef.current,
      }),
    [layout, scrollMapper],
  );

  const syncViewportScrollPosition = React.useCallback(
    (viewportElement: HTMLDivElement, blockSize = layout.blockSize) => {
      const metrics = readViewerDocumentScrollMetrics({
        layout: {
          ...layout,
          blockSize,
        },
        scrollMapper,
        scrollPageOffset: scrollPageOffsetRef.current,
        viewportElement,
      });

      if (metrics.physicalScrollSize >= blockSize) {
        const nextMetrics = {
          ...metrics,
          scrollPageOffset: hasViewerDocumentScrollPageOffset(
            scrollPageOffsetRef.current,
          )
            ? metrics.scrollPageOffset
            : 0,
        };
        scrollPageOffsetRef.current = nextMetrics.scrollPageOffset;
        cacheReadingAnchor(nextMetrics);
        cacheVisualLayerRect(viewportElement);
        return nextMetrics;
      }

      const position = scrollMapper.resolvePhysicalScrollPosition({
        blockSize,
        logicalScrollTop: metrics.scrollTop,
        scrollPageOffset: metrics.scrollPageOffset,
        viewportBlockSize: metrics.viewportBlockSize,
      });
      scrollPageOffsetRef.current = position.scrollPageOffset;
      markInternalScrollWrite();
      setViewportPhysicalScrollTop(viewportElement, position.physicalScrollTop);

      const nextMetrics = {
        ...metrics,
        physicalScrollTop: position.physicalScrollTop,
        scrollPageOffset: position.scrollPageOffset,
      };
      cacheReadingAnchor(nextMetrics);
      cacheVisualLayerRect(viewportElement);
      return nextMetrics;
    },
    [
      cacheReadingAnchor,
      cacheVisualLayerRect,
      layout,
      markInternalScrollWrite,
      scrollMapper,
    ],
  );

  const syncScrollPosition = React.useCallback(() => {
    const viewportElement = viewportElementRef.current;
    return viewportElement ? syncViewportScrollPosition(viewportElement) : null;
  }, [syncViewportScrollPosition]);

  const schedulePendingScrollRestore = React.useCallback(
    (restore: PendingViewerDocumentScrollRestore) => {
      pendingScrollRestoreRef.current = restore;
      if (pendingScrollRestoreFrameRef.current !== 0) return;
      pendingScrollRestoreFrameRef.current = requestAnimationFrame(() => {
        pendingScrollRestoreFrameRef.current = 0;
        flushPendingScrollRestoreRef.current();
      });
    },
    [],
  );

  const resolveLogicalScrollPosition = React.useCallback(
    (viewportElement: HTMLDivElement, targetTop: number) => {
      const viewportBlockSize = viewportElement.clientHeight;
      const position = scrollMapper.resolvePhysicalScrollPosition({
        blockSize: layout.blockSize,
        logicalScrollTop: targetTop,
        scrollPageOffset: scrollPageOffsetRef.current,
        viewportBlockSize,
      });
      const expectedPhysicalScrollSize = scrollMapper.getPhysicalScrollSize({
        blockSize: layout.blockSize,
        viewportBlockSize,
      });

      return {
        expectedMaxPhysicalScrollTop: Math.max(
          0,
          expectedPhysicalScrollSize - viewportBlockSize,
        ),
        position,
      };
    },
    [layout.blockSize, scrollMapper],
  );

  const applyLogicalScrollTop = React.useCallback(
    (
      viewportElement: HTMLDivElement,
      targetTop: number,
      options: ScrollToOptions,
      {
        allowDefer,
        preservePhysicalScrollTop = false,
      }: { allowDefer: boolean; preservePhysicalScrollTop?: boolean },
    ) => {
      if (preservePhysicalScrollTop) {
        scrollPageOffsetRef.current = targetTop - viewportElement.scrollTop;
        cacheReadingAnchor({
          scrollTop: targetTop,
          viewportBlockSize: viewportElement.clientHeight,
        });
        cacheVisualLayerRect(viewportElement);
        return true;
      }

      const { expectedMaxPhysicalScrollTop, position } =
        resolveLogicalScrollPosition(viewportElement, targetTop);
      const currentMaxPhysicalScrollTop =
        getViewportMaxPhysicalScrollTop(viewportElement);
      const shouldDefer =
        allowDefer &&
        position.physicalScrollTop >
          currentMaxPhysicalScrollTop +
            VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON &&
        position.physicalScrollTop <=
          expectedMaxPhysicalScrollTop +
            VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON;

      if (shouldDefer) {
        schedulePendingScrollRestore({
          attempts: 0,
          options: {
            ...options,
            behavior: "auto",
          },
          targetTop,
        });
        return false;
      }

      scrollPageOffsetRef.current = position.scrollPageOffset;
      markInternalScrollWrite();
      scrollViewportToPhysicalTop(viewportElement, position.physicalScrollTop, {
        behavior: "auto",
        ...options,
      });
      return true;
    },
    [
      cacheReadingAnchor,
      cacheVisualLayerRect,
      markInternalScrollWrite,
      resolveLogicalScrollPosition,
      schedulePendingScrollRestore,
    ],
  );

  const flushPendingScrollRestore = React.useCallback(() => {
    const pendingRestore = pendingScrollRestoreRef.current;
    const viewportElement = viewportElementRef.current;
    if (!pendingRestore || !viewportElement) return;

    const { expectedMaxPhysicalScrollTop, position } =
      resolveLogicalScrollPosition(viewportElement, pendingRestore.targetTop);
    const currentMaxPhysicalScrollTop =
      getViewportMaxPhysicalScrollTop(viewportElement);
    const shouldWaitForRange =
      position.physicalScrollTop >
        currentMaxPhysicalScrollTop + VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON &&
      position.physicalScrollTop <=
        expectedMaxPhysicalScrollTop +
          VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON &&
      pendingRestore.attempts < VIEWER_DOCUMENT_SCROLL_RESTORE_MAX_FRAMES;

    if (shouldWaitForRange) {
      schedulePendingScrollRestore({
        ...pendingRestore,
        attempts: pendingRestore.attempts + 1,
      });
      return;
    }

    pendingScrollRestoreRef.current = null;
    scrollPageOffsetRef.current = position.scrollPageOffset;
    markInternalScrollWrite();
    scrollViewportToPhysicalTop(
      viewportElement,
      position.physicalScrollTop,
      pendingRestore.options,
    );
  }, [
    markInternalScrollWrite,
    resolveLogicalScrollPosition,
    schedulePendingScrollRestore,
  ]);

  useKeyedLayoutEffect(joinEffectKey([flushPendingScrollRestore]), () => {
    flushPendingScrollRestoreRef.current = flushPendingScrollRestore;
    flushPendingScrollRestore();
  });

  const materializeScrollPageOffset = React.useCallback(() => {
    const viewportElement = viewportElementRef.current;
    if (
      !viewportElement ||
      !hasViewerDocumentScrollPageOffset(scrollPageOffsetRef.current)
    ) {
      return;
    }

    const metrics = readViewerDocumentScrollMetrics({
      layout,
      scrollMapper,
      scrollPageOffset: scrollPageOffsetRef.current,
      viewportElement,
    });
    const position = scrollMapper.resolvePhysicalScrollPosition({
      blockSize: layout.blockSize,
      logicalScrollTop: metrics.scrollTop,
      scrollPageOffset: 0,
      viewportBlockSize: metrics.viewportBlockSize,
    });
    scrollPageOffsetRef.current = position.scrollPageOffset;
    markInternalScrollWrite();
    scrollViewportToPhysicalTop(viewportElement, position.physicalScrollTop, {
      behavior: "auto",
    });
    cacheReadingAnchor({
      scrollTop: metrics.scrollTop,
      viewportBlockSize: metrics.viewportBlockSize,
    });
    cacheVisualLayerRect(viewportElement);
  }, [
    cacheReadingAnchor,
    cacheVisualLayerRect,
    layout,
    markInternalScrollWrite,
    scrollMapper,
  ]);

  const scrollViewportToLogicalTop = React.useCallback(
    (
      viewportElement: HTMLDivElement,
      targetTop: number,
      options?: ScrollToOptions,
      behavior?: {
        preservePhysicalScrollTop?: boolean;
      },
    ) => {
      applyLogicalScrollTop(
        viewportElement,
        targetTop,
        {
          behavior: "auto",
          ...options,
        },
        {
          allowDefer: true,
          preservePhysicalScrollTop: behavior?.preservePhysicalScrollTop,
        },
      );
      cacheReadingAnchor({
        scrollTop: targetTop,
        viewportBlockSize: viewportElement.clientHeight,
      });
    },
    [applyLogicalScrollTop, cacheReadingAnchor],
  );

  const scrollViewportToResolvedTarget = React.useCallback(
    (
      viewportElement: HTMLDivElement,
      target: ViewerDocumentResolvedScrollTarget,
      options: ScrollToOptions,
    ) => {
      const physicalScrollSize = scrollMapper.getPhysicalScrollSize({
        blockSize: layout.blockSize,
        viewportBlockSize: viewportElement.clientHeight,
      });
      const position =
        physicalScrollSize < layout.blockSize
          ? scrollMapper.resolvePhysicalScrollPosition({
              blockSize: layout.blockSize,
              logicalScrollTop: target.top,
              scrollPageOffset: scrollPageOffsetRef.current,
              viewportBlockSize: viewportElement.clientHeight,
            })
          : {
              physicalScrollTop: Math.max(0, target.top),
              scrollPageOffset: 0,
            };
      scrollPageOffsetRef.current = position.scrollPageOffset;
      viewportElement.scrollTo({
        top: position.physicalScrollTop,
        ...(target.left == null ? null : { left: target.left }),
        ...options,
      });
    },
    [layout.blockSize, scrollMapper],
  );

  useKeyedLayoutEffect(
    joinEffectKey([
      applyLogicalScrollTop,
      copyScrollTarget,
      cacheAnchor,
      cacheReadingAnchor,
      cacheVisualLayerRect,
      cancelZoomMotion,
      classifyLayoutChange,
      commit,
      layout,
      markInternalScrollWrite,
      prepare,
      recordStableState,
      resetKey,
      resetGeometryTransaction,
      resolveScrollTarget,
      scrollIntent,
      scrollMapper,
      scrollViewportToLogicalTop,
      scrollViewportToResolvedTarget,
      syncViewportScrollPosition,
      zoomMotion,
    ]),
    () => {
      const previousLayout = committedLayoutRef.current;
      const previousResetKey = committedResetKeyRef.current;
      committedLayoutRef.current = layout;
      committedResetKeyRef.current = resetKey;

      const viewportElement = viewportElementRef.current;
      if (!viewportElement) return;

      const layoutChange = classifyLayoutChange({
        previousLayout,
        previousResetKey,
      });
      if (layoutChange === "reset") {
        cancelZoomMotion();
        resetGeometryTransaction(viewportElement);
        return;
      }

      const currentLogicalScrollTop = scrollMapper.getLogicalScrollTop({
        blockSize: layout.blockSize,
        physicalScrollTop: viewportElement.scrollTop,
        scrollPageOffset: scrollPageOffsetRef.current,
        viewportBlockSize: viewportElement.clientHeight,
      });
      if (layoutChange !== "geometry") {
        recordStableState({
          clearTransition:
            layoutChange === "metadata" && !layout.isTransitioning,
          scrollTop: currentLogicalScrollTop,
          viewportBlockSize: viewportElement.clientHeight,
          viewportElement,
        });
        return;
      }

      // A fresh geometry commit owns the visual layer; an in-flight zoom
      // relax against the previous geometry can no longer settle correctly.
      const pendingZoomIntent = pendingZoomIntentRef.current;
      cancelZoomMotion();

      const transition = layout.transition;
      if (pendingZoomIntent && zoomMotion) {
        if (transition?.source === "viewer-shell") {
          zoomMotion.noteBypass?.("shell-transition");
        } else if (
          readViewerDocumentNow() - pendingZoomIntent.capturedAt >
          VIEWER_DOCUMENT_ZOOM_INTENT_MAX_AGE_MS
        ) {
          zoomMotion.noteBypass?.("stale-intent");
        } else {
          const zoomTarget = zoomMotion.resolveScrollTarget({
            transaction: pendingZoomIntent.transaction,
            viewportElement,
          });
          if (!zoomTarget) {
            zoomMotion.noteBypass?.("resolve-failed");
          } else {
            // Commit-then-relax: land the centered scroll inside this commit
            // (never deferred), then relax the painted FLIP over it.
            applyLogicalScrollTop(
              viewportElement,
              zoomTarget.top,
              { behavior: "auto" },
              { allowDefer: false },
            );
            if (zoomTarget.left != null) {
              markInternalScrollWrite();
              setViewportPhysicalScrollLeft(viewportElement, zoomTarget.left);
            }
            cacheReadingAnchor({
              scrollTop: zoomTarget.top,
              viewportBlockSize: viewportElement.clientHeight,
            });
            cacheVisualLayerRect(viewportElement);
            activeZoomMotionCancelRef.current = zoomMotion.play({
              transaction: pendingZoomIntent.transaction,
              viewportElement,
            });
            return;
          }
        }
      }

      const activeIntent = scrollIntent.current();
      if (
        activeIntent.kind === "programmatic" &&
        resolveScrollTarget &&
        transition?.source !== "viewer-shell"
      ) {
        const metrics = syncViewportScrollPosition(viewportElement);
        const target = resolveScrollTarget({
          layout,
          scrollTop: metrics.scrollTop,
          target: activeIntent.target,
          viewportElement,
        });
        if (!target) return;

        const { intent, targetChanged } = scrollIntent.updateProgrammaticTarget(
          activeIntent,
          target,
        );

        if (targetChanged) {
          scrollViewportToResolvedTarget(viewportElement, target, {
            behavior: intent.behavior,
          });
          scrollIntent.scheduleProgrammaticCompletion(intent.sequence);
        }
        cacheVisualLayerRect(viewportElement);
        return;
      }

      const previousLogicalScrollTop = scrollMapper.getLogicalScrollTop({
        blockSize: previousLayout.blockSize,
        physicalScrollTop: viewportElement.scrollTop,
        scrollPageOffset: scrollPageOffsetRef.current,
        viewportBlockSize: viewportElement.clientHeight,
      });
      const viewportBlockSize = viewportElement.clientHeight;
      const transaction = prepare({
        previousLayout,
        scrollTop: previousLogicalScrollTop,
        viewportBlockSize,
      });
      if (!transaction) return;

      if (transaction.shouldRestoreScroll) {
        const targetTop = layout.getReadingAnchorScrollTop({
          anchor: transaction.anchor,
          viewportBlockSize: transaction.viewportBlockSize,
        });
        if (targetTop != null) {
          // Shell motions always rebase (commit-then-relax rebases scroll in
          // the slide-start commit), so the restore is a real scroll write.
          scrollViewportToLogicalTop(viewportElement, targetTop);
        } else {
          cacheAnchor({
            anchor: transaction.anchor,
            viewportBlockSize,
          });
        }
      } else {
        cacheAnchor({
          anchor: transaction.anchor,
          viewportBlockSize: transaction.viewportBlockSize,
        });
      }

      commit({
        transaction,
        viewportElement,
      });
    },
  );

  const handleScroll = React.useCallback((): ViewerDocumentScrollEventResult => {
    const viewportElement = viewportElementRef.current;
    if (viewportElement && isInternalScrollWriteRef.current) {
      const metrics = readScrollMetrics();
      cacheReadingAnchor(metrics);
      cacheVisualLayerRect(viewportElement);
      return { source: "internal" };
    }

    if (viewportElement) {
      syncViewportScrollPosition(viewportElement);
    }

    const activeIntent = scrollIntent.current();
    if (activeIntent.kind === "programmatic") {
      scrollIntent.scheduleProgrammaticCompletion(activeIntent.sequence);
      return { source: "programmatic" };
    } else {
      scrollIntent.markUser();
      return { source: "user" };
    }
  }, [
    cacheReadingAnchor,
    cacheVisualLayerRect,
    readScrollMetrics,
    scrollIntent,
    syncViewportScrollPosition,
  ]);

  const markUserScrollIntent = React.useCallback(() => {
    cancelZoomMotion();
    materializeScrollPageOffset();
    cancelPendingScrollRestore();
    scrollIntent.markUser();
  }, [
    cancelPendingScrollRestore,
    cancelZoomMotion,
    materializeScrollPageOffset,
    scrollIntent,
  ]);

  useKeyedMountEffect(joinEffectKey([resetKey, resetViewportForKey]), () => {
    if (!didMountResetEffectRef.current) {
      didMountResetEffectRef.current = true;
      return;
    }
    const viewportElement = viewportElementRef.current;
    if (viewportElement) {
      resetViewportForKey(viewportElement, resetKey);
    }
  });

  useKeyedMountEffect(
    joinEffectKey([markUserScrollIntent, scrollIntent, viewportElement]),
    () => {
      const viewportElement = viewportElementRef.current;
      if (!viewportElement) return;

      const handleScrollEnd = () => {
        const activeIntent = scrollIntent.current();
        if (activeIntent.kind === "programmatic") {
          scrollIntent.completeProgrammatic(activeIntent.sequence);
        } else {
          scrollIntent.reset();
        }
      };

      viewportElement.addEventListener?.("wheel", markUserScrollIntent, {
        passive: true,
      });
      viewportElement.addEventListener?.("touchstart", markUserScrollIntent, {
        passive: true,
      });
      viewportElement.addEventListener?.("pointerdown", markUserScrollIntent);
      viewportElement.addEventListener?.("keydown", markUserScrollIntent);
      viewportElement.addEventListener?.("scrollend", handleScrollEnd);

      return () => {
        viewportElement.removeEventListener?.("wheel", markUserScrollIntent);
        viewportElement.removeEventListener?.(
          "touchstart",
          markUserScrollIntent,
        );
        viewportElement.removeEventListener?.(
          "pointerdown",
          markUserScrollIntent,
        );
        viewportElement.removeEventListener?.("keydown", markUserScrollIntent);
        viewportElement.removeEventListener?.("scrollend", handleScrollEnd);
      };
    },
  );

  const scrollToTarget = React.useCallback(
    (target: Target, options?: ScrollToOptions) => {
      const viewportElement = viewportElementRef.current;
      const metrics = readScrollMetrics();
      const resolvedTarget =
        viewportElement && resolveScrollTarget
          ? resolveScrollTarget({
              layout,
              scrollTop: metrics.scrollTop,
              target,
              viewportElement,
            })
          : null;
      if (!viewportElement || !resolvedTarget) return;

      cancelPendingScrollRestore();
      cancelZoomMotion();
      const behavior = options?.behavior ?? "smooth";
      const intent = scrollIntent.startProgrammatic({
        behavior,
        copyScrollTarget,
        resolvedTarget,
        target,
      });
      scrollViewportToResolvedTarget(viewportElement, resolvedTarget, {
        behavior: "smooth",
        ...options,
      });
      scrollIntent.scheduleProgrammaticCompletion(intent.sequence);
    },
    [
      cancelPendingScrollRestore,
      cancelZoomMotion,
      copyScrollTarget,
      layout,
      readScrollMetrics,
      resolveScrollTarget,
      scrollIntent,
      scrollViewportToResolvedTarget,
    ],
  );
  const getViewportElement = React.useCallback(
    () => viewportElementRef.current,
    [],
  );

  useMountEffect(() => () => {
    clearInternalScrollWrite();
    cancelPendingScrollRestore();
    cancelZoomMotion();
    cancelGeometryTransaction();
    scrollIntent.clearProgrammaticTimeout();
  });

  return React.useMemo(
    () => ({
      captureZoomIntent,
      getScrollMetrics: readScrollMetrics,
      getViewportElement,
      handleScroll,
      scrollToTarget,
      scrollViewportToLogicalTop,
      setViewportElement,
      syncScrollPosition,
      viewportElement,
    }),
    [
      captureZoomIntent,
      getViewportElement,
      handleScroll,
      readScrollMetrics,
      scrollToTarget,
      scrollViewportToLogicalTop,
      setViewportElement,
      syncScrollPosition,
      viewportElement,
    ],
  );
}

function useViewerDocumentScrollIntentController<Target>() {
  const scrollIntentRef = React.useRef<ViewerDocumentScrollIntent<Target>>({
    kind: "idle",
  });
  const scrollIntentSequenceRef = React.useRef(0);
  const programmaticScrollIdleTimeoutRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const clearProgrammaticTimeout = React.useCallback(() => {
    if (programmaticScrollIdleTimeoutRef.current) {
      clearTimeout(programmaticScrollIdleTimeoutRef.current);
      programmaticScrollIdleTimeoutRef.current = null;
    }
  }, []);

  const reset = React.useCallback(() => {
    clearProgrammaticTimeout();
    scrollIntentRef.current = { kind: "idle" };
  }, [clearProgrammaticTimeout]);

  const completeProgrammatic = React.useCallback(
    (sequence: number) => {
      if (
        scrollIntentRef.current.kind === "programmatic" &&
        scrollIntentRef.current.sequence === sequence
      ) {
        scrollIntentRef.current = { kind: "idle" };
      }
      clearProgrammaticTimeout();
    },
    [clearProgrammaticTimeout],
  );

  const scheduleProgrammaticCompletion = React.useCallback(
    (sequence: number) => {
      clearProgrammaticTimeout();
      programmaticScrollIdleTimeoutRef.current = setTimeout(() => {
        completeProgrammatic(sequence);
      }, VIEWER_DOCUMENT_SCROLL_IDLE_MS);
    },
    [clearProgrammaticTimeout, completeProgrammatic],
  );

  const markUser = React.useCallback(() => {
    clearProgrammaticTimeout();
    scrollIntentRef.current = { kind: "user" };
  }, [clearProgrammaticTimeout]);

  const startProgrammatic = React.useCallback(
    ({
      behavior,
      copyScrollTarget,
      resolvedTarget,
      target,
    }: {
      behavior: ScrollBehavior;
      copyScrollTarget?: (target: Target) => Target;
      resolvedTarget: ViewerDocumentResolvedScrollTarget;
      target: Target;
    }) => {
      const sequence = scrollIntentSequenceRef.current + 1;
      scrollIntentSequenceRef.current = sequence;
      clearProgrammaticTimeout();

      const intent: Extract<
        ViewerDocumentScrollIntent<Target>,
        { kind: "programmatic" }
      > = {
        behavior,
        kind: "programmatic",
        sequence,
        target: copyScrollTarget ? copyScrollTarget(target) : target,
        targetLeft: resolvedTarget.left,
        targetTop: resolvedTarget.top,
      };
      scrollIntentRef.current = intent;
      return intent;
    },
    [clearProgrammaticTimeout],
  );

  const updateProgrammaticTarget = React.useCallback(
    (
      intent: Extract<
        ViewerDocumentScrollIntent<Target>,
        { kind: "programmatic" }
      >,
      target: ViewerDocumentResolvedScrollTarget,
    ) => {
      const targetChanged =
        Math.abs(intent.targetTop - target.top) >
          VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON ||
        Math.abs((intent.targetLeft ?? 0) - (target.left ?? 0)) >
          VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON;
      const nextIntent = {
        ...intent,
        targetLeft: target.left,
        targetTop: target.top,
      };
      scrollIntentRef.current = nextIntent;
      return { intent: nextIntent, targetChanged };
    },
    [],
  );

  useKeyedMountEffect(joinEffectKey([clearProgrammaticTimeout]), () => () => {
    clearProgrammaticTimeout();
  });

  return React.useMemo(
    () => ({
      clearProgrammaticTimeout,
      completeProgrammatic,
      current: () => scrollIntentRef.current,
      markUser,
      reset,
      scheduleProgrammaticCompletion,
      startProgrammatic,
      updateProgrammaticTarget,
    }),
    [
      clearProgrammaticTimeout,
      completeProgrammatic,
      markUser,
      reset,
      scheduleProgrammaticCompletion,
      startProgrammatic,
      updateProgrammaticTarget,
    ],
  );
}

function readViewerDocumentScrollMetrics<Anchor>({
  layout,
  scrollMapper,
  scrollPageOffset,
  viewportElement,
}: {
  layout: ViewerDocumentLayoutModel<Anchor>;
  scrollMapper: ViewerDocumentScrollMapper;
  scrollPageOffset: number;
  viewportElement: HTMLDivElement | null;
}): ViewerDocumentScrollMetrics {
  const viewportBlockSize = viewportElement?.clientHeight ?? 0;
  const physicalScrollTop = viewportElement?.scrollTop ?? 0;
  const physicalScrollSize = scrollMapper.getPhysicalScrollSize({
    blockSize: layout.blockSize,
    viewportBlockSize,
  });
  const isRebased = physicalScrollSize < layout.blockSize;
  const hasLogicalOffset = hasViewerDocumentScrollPageOffset(scrollPageOffset);
  const shouldUseLogicalOffset = isRebased || hasLogicalOffset;

  return {
    physicalScrollSize,
    physicalScrollTop,
    scrollPageOffset: shouldUseLogicalOffset ? scrollPageOffset : 0,
    scrollTop: shouldUseLogicalOffset
      ? scrollMapper.getLogicalScrollTop({
          blockSize: layout.blockSize,
          physicalScrollTop,
          scrollPageOffset,
          viewportBlockSize,
        })
      : Math.max(0, physicalScrollTop),
    viewportBlockSize,
  };
}

function hasViewerDocumentScrollPageOffset(scrollPageOffset: number) {
  return Math.abs(scrollPageOffset) > VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON;
}

function scrollViewportToPhysicalTop(
  viewportElement: HTMLDivElement,
  targetTop: number,
  options: ScrollToOptions,
) {
  if (
    Math.abs(viewportElement.scrollTop - targetTop) <=
    VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON
  ) {
    return;
  }

  if (typeof viewportElement.scrollTo === "function") {
    viewportElement.scrollTo({
      top: targetTop,
      ...options,
    });
    return;
  }

  setViewportPhysicalScrollTop(viewportElement, targetTop);
}

function getViewportMaxPhysicalScrollTop(viewportElement: HTMLDivElement) {
  return Math.max(
    0,
    viewportElement.scrollHeight - viewportElement.clientHeight,
  );
}

function setViewportPhysicalScrollTop(
  viewportElement: HTMLDivElement,
  targetTop: number,
) {
  if (
    Math.abs(viewportElement.scrollTop - targetTop) <=
    VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON
  ) {
    return;
  }

  viewportElement.scrollTop = targetTop;
}

// Raw assignment on purpose: the browser clamps to the live scrollable range
// (including RTL's negative coordinate space), which is exactly the clamp the
// centered zoom wants at the document's inline edges.
function setViewportPhysicalScrollLeft(
  viewportElement: HTMLDivElement,
  targetLeft: number,
) {
  if (
    !Number.isFinite(targetLeft) ||
    Math.abs(viewportElement.scrollLeft - targetLeft) <=
      VIEWER_DOCUMENT_SCROLL_POSITION_EPSILON
  ) {
    return;
  }

  viewportElement.scrollLeft = targetLeft;
}

function readViewerDocumentNow() {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
