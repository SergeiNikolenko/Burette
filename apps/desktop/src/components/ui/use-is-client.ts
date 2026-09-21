"use client";

import * as React from "react";

const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * SSR gate: `false` on the server (and during hydration's first pass),
 * `true` on the client.
 *
 * This must stay a synchronous external-store read, NOT the
 * `useState(false)` + mount-effect flip. The flip pattern makes every
 * viewer mount its Suspense boundary in a later update; when two such
 * boundaries suspend on pending resources in the same flush as other
 * commit-phase updates (viewer sidebar/geometry registration), React 19's
 * retry lanes desynchronize and re-attempt each other's boundary on every
 * commit — an unbounded synchronous suspend/retry loop that starves the
 * event loop (jsdom tests OOM; browsers busy-spin until the resource
 * resolves). With the store read, client renders suspend on mount, which
 * never enters that loop. Regression-guarded in
 * tests/pdf-viewer-thumbnails.test.tsx ("shares one document resource…").
 */
export function useIsClient(): boolean {
  return React.useSyncExternalStore(
    emptySubscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
}
