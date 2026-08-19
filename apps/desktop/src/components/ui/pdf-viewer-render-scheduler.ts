import * as React from "react";

import type { PdfPageRenderTiming } from "./pdf-viewer-types";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

export const PDF_PAGE_RENDER_CONCURRENCY = 2;
export const PDF_SCROLLING_PAGE_RENDER_CONCURRENCY = 4;

type PdfPageRenderKeyInput = {
  pageNumber: number;
  scale: number;
  rotation: number;
  devicePixelRatio: number;
};

type PdfPageRenderRequest = PdfPageRenderKeyInput;

export function getPdfPageRenderKey({
  pageNumber,
  scale,
  rotation,
  devicePixelRatio,
}: PdfPageRenderKeyInput) {
  return `${pageNumber}:${scale}:${rotation}:${devicePixelRatio}`;
}

export function usePdfPageRenderScheduler({
  isPaused = false,
  pageNumbers,
  warmPageNumbers = [],
  lowPriorityPageNumbers = [],
  scale,
  rotation,
  devicePixelRatio,
  resetKey,
  maxRunning = PDF_PAGE_RENDER_CONCURRENCY,
  maxLowPriorityRunning = 1,
}: {
  pageNumbers: readonly number[];
  warmPageNumbers?: readonly number[];
  lowPriorityPageNumbers?: readonly number[];
  isPaused?: boolean;
  scale: number;
  rotation: number;
  devicePixelRatio: number;
  resetKey: unknown;
  maxRunning?: number;
  maxLowPriorityRunning?: number;
}) {
  const requestedRenders = React.useMemo<PdfPageRenderRequest[]>(
    () =>
      mergePdfPageNumbers(pageNumbers).map((pageNumber) => ({
        pageNumber,
        scale,
        rotation,
        devicePixelRatio,
      })),
    [devicePixelRatio, pageNumbers, rotation, scale],
  );
  const warmRequestedRenders = React.useMemo<PdfPageRenderRequest[]>(() => {
    const primaryPageNumberSet = new Set(pageNumbers);
    return mergePdfPageNumbers(warmPageNumbers)
      .filter((pageNumber) => !primaryPageNumberSet.has(pageNumber))
      .map((pageNumber) => ({
        pageNumber,
        scale,
        rotation,
        devicePixelRatio,
      }));
  }, [devicePixelRatio, pageNumbers, rotation, scale, warmPageNumbers]);
  const lowPriorityRequestedRenders = React.useMemo<
    PdfPageRenderRequest[]
  >(() => {
    const primaryPageNumberSet = new Set(pageNumbers);
    const warmPageNumberSet = new Set(warmPageNumbers);
    return mergePdfPageNumbers(lowPriorityPageNumbers)
      .filter(
        (pageNumber) =>
          !primaryPageNumberSet.has(pageNumber) &&
          !warmPageNumberSet.has(pageNumber),
      )
      .map((pageNumber) => ({
        pageNumber,
        scale,
        rotation,
        devicePixelRatio,
      }));
  }, [
    devicePixelRatio,
    lowPriorityPageNumbers,
    pageNumbers,
    rotation,
    scale,
    warmPageNumbers,
  ]);
  const allRequestedRenders = React.useMemo(
    () => [
      ...requestedRenders,
      ...warmRequestedRenders,
      ...lowPriorityRequestedRenders,
    ],
    [lowPriorityRequestedRenders, requestedRenders, warmRequestedRenders],
  );
  const requestedRendersRef = React.useRef(allRequestedRenders);
  const resetKeyRef = React.useRef(resetKey);
  useKeyedLayoutEffect(joinEffectKey([allRequestedRenders, resetKey]), () => {
    requestedRendersRef.current = allRequestedRenders;
    resetKeyRef.current = resetKey;
  });

  const [state, setState] = React.useState<{
    resetKey: unknown;
    renderedByKey: ReadonlyMap<string, PdfPageRenderRequest>;
  }>(() => ({ resetKey, renderedByKey: new Map() }));
  const emptyRenderedByKey = React.useMemo<
    ReadonlyMap<string, PdfPageRenderRequest>
  >(() => new Map(), []);
  const renderedByKey = Object.is(state.resetKey, resetKey)
    ? state.renderedByKey
    : emptyRenderedByKey;

  useKeyedMountEffect(joinEffectKey([allRequestedRenders, resetKey]), () => {
    setState((previousState) => {
      if (!Object.is(previousState.resetKey, resetKey)) {
        return { resetKey, renderedByKey: new Map() };
      }

      const renderedByKey = new Map<string, PdfPageRenderRequest>();
      for (const [key, rendered] of previousState.renderedByKey) {
        if (
          allRequestedRenders.some((request) =>
            doesRenderedPageKeepRequestMounted(rendered, request),
          )
        ) {
          renderedByKey.set(key, rendered);
        }
      }

      return areMapsEqual(previousState.renderedByKey, renderedByKey)
        ? previousState
        : { resetKey, renderedByKey };
    });
  });

  const renderWindow = React.useMemo(() => {
    const renderedPageNumbers: number[] = [];
    const stalePageNumbers: number[] = [];
    const pendingPageNumbers: number[] = [];
    const warmRenderedPageNumbers: number[] = [];
    const warmStalePageNumbers: number[] = [];
    const warmPendingPageNumbers: number[] = [];
    const lowPriorityRenderedPageNumbers: number[] = [];
    const lowPriorityStalePageNumbers: number[] = [];
    const lowPriorityPendingPageNumbers: number[] = [];

    for (const request of requestedRenders) {
      if (isRenderRequestSatisfied(request, renderedByKey)) {
        renderedPageNumbers.push(request.pageNumber);
      } else if (isRenderRequestMountedStale(request, renderedByKey)) {
        stalePageNumbers.push(request.pageNumber);
      } else {
        pendingPageNumbers.push(request.pageNumber);
      }
    }
    for (const request of warmRequestedRenders) {
      if (isRenderRequestSatisfied(request, renderedByKey)) {
        warmRenderedPageNumbers.push(request.pageNumber);
      } else if (isRenderRequestMountedStale(request, renderedByKey)) {
        warmStalePageNumbers.push(request.pageNumber);
      } else {
        warmPendingPageNumbers.push(request.pageNumber);
      }
    }
    for (const request of lowPriorityRequestedRenders) {
      if (isRenderRequestSatisfied(request, renderedByKey)) {
        lowPriorityRenderedPageNumbers.push(request.pageNumber);
      } else if (isRenderRequestMountedStale(request, renderedByKey)) {
        lowPriorityStalePageNumbers.push(request.pageNumber);
      } else {
        lowPriorityPendingPageNumbers.push(request.pageNumber);
      }
    }

    const maxPrimaryRunning = Math.max(1, maxRunning);
    const activePrimaryPendingCount = isPaused
      ? 0
      : Math.min(pendingPageNumbers.length, maxPrimaryRunning);
    const activePrimaryPageNumbers = [
      ...renderedPageNumbers,
      ...stalePageNumbers,
      ...pendingPageNumbers.slice(0, activePrimaryPendingCount),
    ];
    const remainingWarmSlots = Math.max(
      0,
      maxRunning - activePrimaryPendingCount,
    );
    const activeWarmPendingCount = isPaused
      ? 0
      : Math.min(warmPendingPageNumbers.length, remainingWarmSlots);
    const activeWarmPageNumbers = [
      ...warmRenderedPageNumbers,
      ...warmStalePageNumbers,
      ...warmPendingPageNumbers.slice(0, activeWarmPendingCount),
    ];
    const activeLowPriorityPageNumbers =
      isPaused || activePrimaryPendingCount + activeWarmPendingCount > 0
        ? [...lowPriorityRenderedPageNumbers, ...lowPriorityStalePageNumbers]
        : [
            ...lowPriorityRenderedPageNumbers,
            ...lowPriorityStalePageNumbers,
            ...lowPriorityPendingPageNumbers.slice(
              0,
              Math.max(0, maxLowPriorityRunning),
            ),
          ];

    return {
      activePageNumbers: mergePdfPageNumbers([
        ...activePrimaryPageNumbers,
        ...activeWarmPageNumbers,
        ...activeLowPriorityPageNumbers,
      ]),
      pendingPageNumbers: mergePdfPageNumbers([
        ...pendingPageNumbers,
        ...warmPendingPageNumbers,
        ...lowPriorityPendingPageNumbers,
      ]),
    };
  }, [
    isPaused,
    lowPriorityRequestedRenders,
    maxLowPriorityRunning,
    maxRunning,
    renderedByKey,
    requestedRenders,
    warmRequestedRenders,
  ]);

  const onPageRenderTiming = React.useCallback(
    (timing: PdfPageRenderTiming) => {
      const key = getPdfPageRenderKey(timing);

      setState((previousState) => {
        const resetKey = resetKeyRef.current;
        const previousRenderedByKey = Object.is(
          previousState.resetKey,
          resetKey,
        )
          ? previousState.renderedByKey
          : new Map<string, PdfPageRenderRequest>();
        const nextRenderedByKey = new Map(previousRenderedByKey);
        const rendered: PdfPageRenderRequest = {
          pageNumber: timing.pageNumber,
          scale: timing.scale,
          rotation: timing.rotation,
          devicePixelRatio: timing.devicePixelRatio,
        };

        if (
          timing.status === "rendered" &&
          requestedRendersRef.current.some((request) =>
            doesRenderedPageKeepRequestMounted(rendered, request),
          )
        ) {
          nextRenderedByKey.set(key, rendered);
        } else {
          nextRenderedByKey.delete(key);
        }

        return areMapsEqual(previousRenderedByKey, nextRenderedByKey)
          ? previousState
          : { resetKey, renderedByKey: nextRenderedByKey };
      });
    },
    [],
  );

  return {
    activePageNumbers: renderWindow.activePageNumbers,
    isRenderQueueIdle: renderWindow.pendingPageNumbers.length === 0,
    onPageRenderTiming,
    pendingPageNumbers: renderWindow.pendingPageNumbers,
  };
}

function mergePdfPageNumbers(pageNumbers: readonly number[]) {
  return [...new Set(pageNumbers)].sort((left, right) => left - right);
}

function isRenderRequestSatisfied(
  request: PdfPageRenderRequest,
  renderedByKey: ReadonlyMap<string, PdfPageRenderRequest>,
) {
  for (const rendered of renderedByKey.values()) {
    if (doesRenderedPageSatisfyRequest(rendered, request)) return true;
  }
  return false;
}

function isRenderRequestMountedStale(
  request: PdfPageRenderRequest,
  renderedByKey: ReadonlyMap<string, PdfPageRenderRequest>,
) {
  for (const rendered of renderedByKey.values()) {
    if (
      !doesRenderedPageSatisfyRequest(rendered, request) &&
      doesRenderedPageKeepRequestMounted(rendered, request)
    ) {
      return true;
    }
  }
  return false;
}

function doesRenderedPageSatisfyRequest(
  rendered: PdfPageRenderRequest,
  request: PdfPageRenderRequest,
) {
  return (
    rendered.pageNumber === request.pageNumber &&
    rendered.scale === request.scale &&
    rendered.rotation === request.rotation &&
    rendered.devicePixelRatio >= request.devicePixelRatio
  );
}

function doesRenderedPageKeepRequestMounted(
  rendered: PdfPageRenderRequest,
  request: PdfPageRenderRequest,
) {
  return (
    rendered.pageNumber === request.pageNumber &&
    rendered.rotation === request.rotation
  );
}

function areMapsEqual(
  left: ReadonlyMap<string, PdfPageRenderRequest>,
  right: ReadonlyMap<string, PdfPageRenderRequest>,
) {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}
