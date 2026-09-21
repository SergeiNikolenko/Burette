"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { getPdfPageResource } from "@/lib/pdf-document-resource";
import type { PdfDocumentProxy } from "@/lib/pdf-document-types";

import { normalizeThumbnailPage } from "./pdf-thumbnail-layout";
import { joinEffectKey } from "@/lib/effect-key";

export const PDF_THUMBNAIL_PAGE_METRIC_CONCURRENCY = 4;

export interface PdfThumbnailPageMetric {
  pageNumber: number;
  width: number;
  height: number;
}

export interface PdfThumbnailPageMetrics {
  pageCount: number;
  metricByPageNumber: ReadonlyMap<number, PdfThumbnailPageMetric>;
  requestPageMetrics: (pageNumbers: Iterable<number>) => void;
  status: "idle" | "loading";
}

interface MetricControllerState {
  documentKey: unknown;
  pageCount: number;
  metricByPageNumber: ReadonlyMap<number, PdfThumbnailPageMetric>;
  queuedPageNumbers: readonly number[];
  loadingPageNumbers: ReadonlySet<number>;
  error: unknown;
}

type MetricAction =
  | { type: "reset"; documentKey: unknown; pageCount: number }
  | {
      type: "enqueue";
      documentKey: unknown;
      pageCount: number;
      pageNumbers: readonly number[];
    }
  | { type: "start"; documentKey: unknown; pageNumbers: readonly number[] }
  | { type: "resolve"; documentKey: unknown; metric: PdfThumbnailPageMetric }
  | { type: "reject"; documentKey: unknown; error: unknown };

export function usePdfThumbnailPageMetrics(
  doc: PdfDocumentProxy,
  resetKey: unknown,
): PdfThumbnailPageMetrics {
  const workerSequenceRef = React.useRef(0);
  const [state, dispatch] = React.useReducer(
    metricControllerReducer,
    undefined,
    () => createMetricControllerState(resetKey, doc.numPages),
  );
  const visibleState = Object.is(state.documentKey, resetKey)
    ? state
    : createMetricControllerState(resetKey, doc.numPages);
  const status = getMetricStatus(visibleState);

  const resetEffectKey = joinEffectKey(["reset", doc, resetKey]);
  useKeyedMountEffect(resetEffectKey, () => {
    workerSequenceRef.current += 1;
    dispatch({
      type: "reset",
      documentKey: resetKey,
      pageCount: doc.numPages,
    });
  });

  const requestPageMetrics = React.useCallback(
    (pageNumbers: Iterable<number>) => {
      const requestedPageNumbers = Array.from(pageNumbers)
        .map((pageNumber) => normalizeThumbnailPage(pageNumber, doc.numPages))
        .filter((pageNumber): pageNumber is number => pageNumber != null);

      if (requestedPageNumbers.length === 0) return;

      dispatch({
        type: "enqueue",
        documentKey: resetKey,
        pageCount: doc.numPages,
        pageNumbers: requestedPageNumbers,
      });
    },
    [doc.numPages, resetKey],
  );

  const loadEffectKey = joinEffectKey([
    "load",
    doc,
    resetKey,
    state.documentKey,
    state.error,
    state.loadingPageNumbers,
    state.queuedPageNumbers,
  ]);
  useKeyedMountEffect(loadEffectKey, () => {
    if (!Object.is(state.documentKey, resetKey)) return;
    if (state.error) return;

    const availableSlotCount =
      PDF_THUMBNAIL_PAGE_METRIC_CONCURRENCY - state.loadingPageNumbers.size;
    if (availableSlotCount <= 0) return;

    const startingPageNumbers = state.queuedPageNumbers.slice(
      0,
      availableSlotCount,
    );
    if (startingPageNumbers.length === 0) return;

    const sequence = workerSequenceRef.current;
    dispatch({
      type: "start",
      documentKey: resetKey,
      pageNumbers: startingPageNumbers,
    });

    for (const pageNumber of startingPageNumbers) {
      void getPdfPageResource(doc, pageNumber, { retainRejected: true })
        .then((page) => {
          if (workerSequenceRef.current !== sequence) return;

          const viewport = page.getViewport({ scale: 1 });
          dispatch({
            type: "resolve",
            documentKey: resetKey,
            metric: {
              pageNumber,
              width: viewport.width,
              height: viewport.height,
            },
          });
        })
        .catch((error: unknown) => {
          if (workerSequenceRef.current !== sequence) return;
          dispatch({ type: "reject", documentKey: resetKey, error });
        });
    }
  });

  if (visibleState.error) throw visibleState.error;

  return {
    pageCount: visibleState.pageCount,
    metricByPageNumber: visibleState.metricByPageNumber,
    requestPageMetrics,
    status,
  };
}

function metricControllerReducer(
  state: MetricControllerState,
  action: MetricAction,
): MetricControllerState {
  switch (action.type) {
    case "reset":
      return createMetricControllerState(action.documentKey, action.pageCount);
    case "enqueue":
      return enqueuePageMetrics(state, action);
    case "start":
      return startPageMetrics(state, action);
    case "resolve":
      return resolvePageMetric(state, action);
    case "reject":
      if (!Object.is(state.documentKey, action.documentKey)) return state;
      return {
        ...state,
        queuedPageNumbers: [],
        loadingPageNumbers: new Set(),
        error: action.error,
      };
  }
}

function createMetricControllerState(
  documentKey: unknown,
  pageCount: number,
): MetricControllerState {
  return {
    documentKey,
    pageCount,
    metricByPageNumber: new Map(),
    queuedPageNumbers: [],
    loadingPageNumbers: new Set(),
    error: null,
  };
}

function enqueuePageMetrics(
  state: MetricControllerState,
  action: Extract<MetricAction, { type: "enqueue" }>,
): MetricControllerState {
  const baseState = Object.is(state.documentKey, action.documentKey)
    ? state
    : createMetricControllerState(action.documentKey, action.pageCount);
  const queuedPageNumberSet = new Set(baseState.queuedPageNumbers);
  const queuedPageNumbers = [...baseState.queuedPageNumbers];

  for (const pageNumber of action.pageNumbers) {
    if (baseState.metricByPageNumber.has(pageNumber)) continue;
    if (baseState.loadingPageNumbers.has(pageNumber)) continue;
    if (queuedPageNumberSet.has(pageNumber)) continue;

    queuedPageNumberSet.add(pageNumber);
    queuedPageNumbers.push(pageNumber);
  }

  if (queuedPageNumbers.length === baseState.queuedPageNumbers.length) {
    return baseState;
  }

  return {
    ...baseState,
    queuedPageNumbers,
  };
}

function startPageMetrics(
  state: MetricControllerState,
  action: Extract<MetricAction, { type: "start" }>,
): MetricControllerState {
  if (!Object.is(state.documentKey, action.documentKey)) return state;

  const startingPageNumberSet = new Set(action.pageNumbers);
  const queuedPageNumbers = state.queuedPageNumbers.filter(
    (pageNumber) => !startingPageNumberSet.has(pageNumber),
  );
  const loadingPageNumbers = new Set(state.loadingPageNumbers);

  for (const pageNumber of action.pageNumbers) {
    if (state.metricByPageNumber.has(pageNumber)) continue;
    loadingPageNumbers.add(pageNumber);
  }

  return {
    ...state,
    queuedPageNumbers,
    loadingPageNumbers,
  };
}

function resolvePageMetric(
  state: MetricControllerState,
  action: Extract<MetricAction, { type: "resolve" }>,
): MetricControllerState {
  if (!Object.is(state.documentKey, action.documentKey)) return state;

  const loadingPageNumbers = new Set(state.loadingPageNumbers);
  loadingPageNumbers.delete(action.metric.pageNumber);

  const metricByPageNumber = new Map(state.metricByPageNumber);
  metricByPageNumber.set(action.metric.pageNumber, action.metric);

  return {
    ...state,
    metricByPageNumber,
    loadingPageNumbers,
  };
}

function getMetricStatus(state: MetricControllerState): "idle" | "loading" {
  return state.queuedPageNumbers.length > 0 || state.loadingPageNumbers.size > 0
    ? "loading"
    : "idle";
}
