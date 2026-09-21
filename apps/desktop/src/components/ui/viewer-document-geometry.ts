import * as React from "react";

import type {
  ViewerDocumentLayoutModel,
  ViewerDocumentTransition,
} from "./viewer-types";

const VIEWER_DOCUMENT_FLIP_LAYER_SELECTOR = "[data-viewer-document-flip-layer]";
const VIEWER_DOCUMENT_FLIP_TRANSITION_MS = 150;
const VIEWER_DOCUMENT_FLIP_TRANSITION_CLEANUP_MS =
  VIEWER_DOCUMENT_FLIP_TRANSITION_MS + 50;
const VIEWER_DOCUMENT_FLIP_EPSILON = 0.5;
const VIEWER_DOCUMENT_LAYOUT_EPSILON = 0.5;

type ViewerDocumentGeometryLayoutChange =
  | "geometry"
  | "metadata"
  | "reset"
  | "same";

type ViewerDocumentTransitionAnchor<Anchor> = {
  anchor: Anchor;
  transitionId: ViewerDocumentTransition["transitionId"];
  viewportBlockSize: number;
};

type ViewerDocumentReadingAnchor<Anchor> = {
  anchor: Anchor;
  resetKey: unknown;
  viewportBlockSize: number;
};

type ViewerDocumentFlipAnimation = {
  element: HTMLElement;
  frame: number;
  timeout: ReturnType<typeof setTimeout>;
};

export type ViewerDocumentGeometryTransaction<Anchor> = {
  anchor: Anchor;
  previousVisualLayerRect: DOMRectReadOnly | null;
  shouldAnimate: boolean;
  shouldRestoreScroll: boolean;
  viewportBlockSize: number;
};

export function useViewerDocumentGeometryTransaction<Anchor>({
  layout,
  resetKey,
}: {
  layout: ViewerDocumentLayoutModel<Anchor>;
  resetKey: unknown;
}) {
  const transitionAnchorRef =
    React.useRef<ViewerDocumentTransitionAnchor<Anchor> | null>(null);
  const readingAnchorRef =
    React.useRef<ViewerDocumentReadingAnchor<Anchor> | null>(null);
  const visualLayerRectRef = React.useRef<DOMRectReadOnly | null>(null);
  const flipAnimationRef = React.useRef<ViewerDocumentFlipAnimation | null>(
    null,
  );

  const cancel = React.useCallback(() => {
    cancelViewerDocumentFlipAnimation(flipAnimationRef.current);
    flipAnimationRef.current = null;
  }, []);

  const cacheVisualLayerRect = React.useCallback(
    (viewportElement: HTMLDivElement) => {
      if (flipAnimationRef.current) return;
      visualLayerRectRef.current =
        readViewerDocumentVisualLayerRect(viewportElement);
    },
    [],
  );

  const cacheReadingAnchor = React.useCallback(
    ({
      scrollTop,
      viewportBlockSize,
    }: {
      scrollTop: number;
      viewportBlockSize: number;
    }) => {
      const anchor = layout.captureReadingAnchor({
        scrollTop,
        viewportBlockSize,
      });
      readingAnchorRef.current = anchor
        ? {
            anchor,
            resetKey,
            viewportBlockSize,
          }
        : null;
      return anchor;
    },
    [layout, resetKey],
  );

  const classifyLayoutChange = React.useCallback(
    ({
      previousLayout,
      previousResetKey,
    }: {
      previousLayout: ViewerDocumentLayoutModel<Anchor>;
      previousResetKey: unknown;
    }): ViewerDocumentGeometryLayoutChange => {
      if (!Object.is(previousResetKey, resetKey)) return "reset";
      if (Object.is(previousLayout, layout)) return "same";
      if (!hasViewerDocumentLayoutGeometryChange(previousLayout, layout)) {
        return "metadata";
      }
      return "geometry";
    },
    [layout, resetKey],
  );

  const reset = React.useCallback(
    (viewportElement: HTMLDivElement) => {
      transitionAnchorRef.current = null;
      readingAnchorRef.current = null;
      cancel();
      cacheVisualLayerRect(viewportElement);
    },
    [cacheVisualLayerRect, cancel],
  );

  const recordStableState = React.useCallback(
    ({
      clearTransition = false,
      scrollTop,
      viewportBlockSize,
      viewportElement,
    }: {
      clearTransition?: boolean;
      scrollTop: number;
      viewportBlockSize: number;
      viewportElement: HTMLDivElement;
    }) => {
      if (clearTransition) transitionAnchorRef.current = null;
      const anchor = cacheReadingAnchor({ scrollTop, viewportBlockSize });
      if (anchor && shouldRetainViewerDocumentTransitionAnchor(layout)) {
        const transition = getViewerDocumentTransition(layout);
        transitionAnchorRef.current = {
          anchor,
          transitionId: transition.transitionId,
          viewportBlockSize,
        };
      }
      cacheVisualLayerRect(viewportElement);
    },
    [cacheReadingAnchor, cacheVisualLayerRect, layout],
  );

  const prepare = React.useCallback(
    ({
      previousLayout,
      scrollTop,
      viewportBlockSize,
    }: {
      previousLayout: ViewerDocumentLayoutModel<Anchor>;
      scrollTop: number;
      viewportBlockSize: number;
    }): ViewerDocumentGeometryTransaction<Anchor> | null => {
      const isLayoutTransition = isViewerDocumentLayoutTransition({
        layout,
        previousLayout,
      });
      const transition = resolveViewerDocumentTransition({
        layout,
        previousLayout,
      });
      const previousTransitionAnchor =
        getReusableViewerDocumentTransitionAnchor({
          anchor: transitionAnchorRef.current,
          transition,
        });
      const cachedReadingAnchor = Object.is(
        readingAnchorRef.current?.resetKey,
        resetKey,
      )
        ? readingAnchorRef.current
        : null;
      const shouldUseCachedShellTransitionAnchor =
        isLayoutTransition &&
        transition.source === "viewer-shell" &&
        transition.layoutPolicy === "target" &&
        Boolean(cachedReadingAnchor);
      const shouldCaptureLiveShellTransitionAnchor =
        isLayoutTransition &&
        transition.source === "viewer-shell" &&
        !previousTransitionAnchor &&
        !shouldUseCachedShellTransitionAnchor;
      const liveReadingAnchor = shouldCaptureLiveShellTransitionAnchor
        ? previousLayout.captureReadingAnchor({
            scrollTop,
            viewportBlockSize,
          })
        : null;
      const anchor =
        isLayoutTransition && previousTransitionAnchor
          ? previousTransitionAnchor.anchor
          : liveReadingAnchor
            ? liveReadingAnchor
            : isLayoutTransition && cachedReadingAnchor
              ? cachedReadingAnchor.anchor
              : previousLayout.captureReadingAnchor({
                  scrollTop,
                  viewportBlockSize,
                });
      if (!anchor) return null;

      const transactionViewportBlockSize =
        previousTransitionAnchor?.viewportBlockSize ??
        (liveReadingAnchor ? viewportBlockSize : null) ??
        cachedReadingAnchor?.viewportBlockSize ??
        viewportBlockSize;

      if (shouldRetainViewerDocumentTransitionAnchor(layout)) {
        transitionAnchorRef.current = {
          anchor,
          transitionId: transition.transitionId,
          viewportBlockSize: transactionViewportBlockSize,
        };
      } else {
        transitionAnchorRef.current = null;
      }

      return {
        anchor,
        previousVisualLayerRect: visualLayerRectRef.current,
        shouldAnimate:
          isLayoutTransition && transition.visualPolicy === "document-flip",
        // Every remaining scroll policy restores (rebase) or preserves through
        // an explicit restore target; nothing defers anymore.
        shouldRestoreScroll: true,
        viewportBlockSize: transactionViewportBlockSize,
      };
    },
    [layout, resetKey],
  );

  const cacheAnchor = React.useCallback(
    ({
      anchor,
      viewportBlockSize,
    }: {
      anchor: Anchor;
      viewportBlockSize: number;
    }) => {
      readingAnchorRef.current = {
        anchor,
        resetKey,
        viewportBlockSize,
      };
    },
    [resetKey],
  );

  const commit = React.useCallback(
    ({
      transaction,
      viewportElement,
    }: {
      transaction: ViewerDocumentGeometryTransaction<Anchor>;
      viewportElement: HTMLDivElement;
    }) => {
      visualLayerRectRef.current = playViewerDocumentFlipAnimation({
        animationRef: flipAnimationRef,
        enabled: transaction.shouldAnimate,
        previousRect: transaction.previousVisualLayerRect,
        viewportElement,
      });
    },
    [],
  );

  return React.useMemo(
    () => ({
      cacheAnchor,
      cacheReadingAnchor,
      cacheVisualLayerRect,
      cancel,
      classifyLayoutChange,
      commit,
      prepare,
      recordStableState,
      reset,
    }),
    [
      cacheAnchor,
      cacheReadingAnchor,
      cacheVisualLayerRect,
      cancel,
      classifyLayoutChange,
      commit,
      prepare,
      recordStableState,
      reset,
    ],
  );
}

const VIEWER_DOCUMENT_STABLE_TRANSITION: ViewerDocumentTransition = {
  layoutPolicy: "live",
  scrollPolicy: "preserve",
  source: "none",
  transitionId: null,
  visualPolicy: "none",
};

function getViewerDocumentTransition<Anchor>(
  layout: ViewerDocumentLayoutModel<Anchor>,
) {
  return layout.transition ?? VIEWER_DOCUMENT_STABLE_TRANSITION;
}

function isViewerDocumentLayoutTransition<Anchor>({
  layout,
  previousLayout,
}: {
  layout: ViewerDocumentLayoutModel<Anchor>;
  previousLayout: ViewerDocumentLayoutModel<Anchor>;
}) {
  return (
    previousLayout.isTransitioning === true ||
    layout.isTransitioning === true ||
    getViewerDocumentTransition(previousLayout).source !== "none" ||
    getViewerDocumentTransition(layout).source !== "none"
  );
}

function resolveViewerDocumentTransition<Anchor>({
  layout,
  previousLayout,
}: {
  layout: ViewerDocumentLayoutModel<Anchor>;
  previousLayout: ViewerDocumentLayoutModel<Anchor>;
}) {
  const transition = getViewerDocumentTransition(layout);
  if (transition.source !== "none") return transition;

  const previousTransition = getViewerDocumentTransition(previousLayout);
  if (previousTransition.source !== "none") return previousTransition;

  if (
    previousLayout.isTransitioning === true ||
    layout.isTransitioning === true
  ) {
    return {
      layoutPolicy: "live",
      scrollPolicy: "preserve",
      source: "document-layout",
      transitionId: null,
      visualPolicy: "document-flip",
    } satisfies ViewerDocumentTransition;
  }

  return VIEWER_DOCUMENT_STABLE_TRANSITION;
}

function shouldRetainViewerDocumentTransitionAnchor<Anchor>(
  layout: ViewerDocumentLayoutModel<Anchor>,
) {
  const transition = getViewerDocumentTransition(layout);
  return layout.isTransitioning === true;
}

function getReusableViewerDocumentTransitionAnchor<Anchor>({
  anchor,
  transition,
}: {
  anchor: ViewerDocumentTransitionAnchor<Anchor> | null;
  transition: ViewerDocumentTransition;
}) {
  if (!anchor) return null;
  if (transition.source === "viewer-shell") {
    return anchor.transitionId !== null &&
      transition.transitionId !== null &&
      Object.is(anchor.transitionId, transition.transitionId)
      ? anchor
      : null;
  }
  if (anchor.transitionId === null || transition.transitionId === null) {
    return anchor;
  }
  return Object.is(anchor.transitionId, transition.transitionId)
    ? anchor
    : null;
}

function playViewerDocumentFlipAnimation({
  animationRef,
  enabled,
  previousRect,
  viewportElement,
}: {
  animationRef: React.MutableRefObject<ViewerDocumentFlipAnimation | null>;
  enabled: boolean;
  previousRect: DOMRectReadOnly | null;
  viewportElement: HTMLDivElement;
}) {
  const visualLayer = findViewerDocumentVisualLayer(viewportElement);
  const currentRect = readElementRect(visualLayer);
  if (!currentRect) return null;

  if (
    !visualLayer ||
    !enabled ||
    !previousRect ||
    typeof requestAnimationFrame !== "function"
  ) {
    return currentRect;
  }

  const transform = getViewerDocumentFlipTransform({
    currentRect,
    previousRect,
  });
  if (!transform) return currentRect;

  cancelViewerDocumentFlipAnimation(animationRef.current);

  visualLayer.style.transition = "none";
  visualLayer.style.transformOrigin = "top left";
  visualLayer.style.transform = transform;
  visualLayer.style.willChange = "transform";

  const frame = requestAnimationFrame(() => {
    visualLayer.style.transition = `transform ${VIEWER_DOCUMENT_FLIP_TRANSITION_MS}ms linear`;
    visualLayer.style.transform = "translate3d(0px, 0px, 0px) scale(1, 1)";
  });
  const timeout = setTimeout(() => {
    if (animationRef.current?.element !== visualLayer) return;
    finishViewerDocumentFlipAnimation(visualLayer);
    animationRef.current = null;
  }, VIEWER_DOCUMENT_FLIP_TRANSITION_CLEANUP_MS);

  animationRef.current = {
    element: visualLayer,
    frame,
    timeout,
  };
  return currentRect;
}

function cancelViewerDocumentFlipAnimation(
  animation: ViewerDocumentFlipAnimation | null,
) {
  if (!animation) return;
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animation.frame);
  }
  clearTimeout(animation.timeout);
  finishViewerDocumentFlipAnimation(animation.element);
}

function finishViewerDocumentFlipAnimation(element: HTMLElement) {
  element.style.transition = "";
  element.style.transform = "";
  element.style.transformOrigin = "";
  element.style.willChange = "";
}

function getViewerDocumentFlipTransform({
  currentRect,
  previousRect,
}: {
  currentRect: DOMRectReadOnly;
  previousRect: DOMRectReadOnly;
}) {
  if (
    previousRect.width <= 0 ||
    previousRect.height <= 0 ||
    currentRect.width <= 0 ||
    currentRect.height <= 0
  ) {
    return null;
  }

  const translateX = previousRect.left - currentRect.left;
  const translateY = previousRect.top - currentRect.top;
  const scaleX = previousRect.width / currentRect.width;
  const scaleY = previousRect.height / currentRect.height;
  const hasVisibleDelta =
    Math.abs(translateX) > VIEWER_DOCUMENT_FLIP_EPSILON ||
    Math.abs(translateY) > VIEWER_DOCUMENT_FLIP_EPSILON ||
    Math.abs(1 - scaleX) > 0.001 ||
    Math.abs(1 - scaleY) > 0.001;

  if (!hasVisibleDelta) return null;

  return `translate3d(${translateX}px, ${translateY}px, 0px) scale(${scaleX}, ${scaleY})`;
}

function hasViewerDocumentLayoutGeometryChange<Anchor>(
  previousLayout: ViewerDocumentLayoutModel<Anchor>,
  nextLayout: ViewerDocumentLayoutModel<Anchor>,
) {
  return (
    !areViewerDocumentLayoutSizesEqual(
      previousLayout.inlineSize,
      nextLayout.inlineSize,
    ) ||
    !areViewerDocumentLayoutSizesEqual(
      previousLayout.blockSize,
      nextLayout.blockSize,
    )
  );
}

function areViewerDocumentLayoutSizesEqual(previous: number, next: number) {
  return Math.abs(previous - next) < VIEWER_DOCUMENT_LAYOUT_EPSILON;
}

function readViewerDocumentVisualLayerRect(
  viewportElement: HTMLDivElement | null,
) {
  return readElementRect(findViewerDocumentVisualLayer(viewportElement));
}

function findViewerDocumentVisualLayer(viewportElement: HTMLDivElement | null) {
  if (!viewportElement || typeof viewportElement.querySelector !== "function") {
    return null;
  }

  return viewportElement.querySelector<HTMLElement>(
    VIEWER_DOCUMENT_FLIP_LAYER_SELECTOR,
  );
}

function readElementRect(element: HTMLElement | null | undefined) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}
