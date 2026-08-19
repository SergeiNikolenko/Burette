"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import {
  type ViewerContentBytes,
  type ViewerContentIdentity,
} from "@/lib/viewer-resource";

import { type PptxSourceLoadTiming } from "./pptx-viewer-core";
import {
  getPptxSource,
  subscribePptxSourceLoadTiming,
  type PptxSource,
} from "./pptx-viewer-source";

const pptxHookSourceKeys = new WeakMap<PptxSource, string>();
let nextPptxHookSourceKey = 1;

/** Retains the cached source for the mounted lifetime of the viewer. */
export function useRetainedPptxSource(
  content: ViewerContentBytes & ViewerContentIdentity,
  onLoadTiming?: (timing: PptxSourceLoadTiming) => void,
): PptxSource {
  const sourcePromise = React.useMemo(() => getPptxSource(content), [content]);
  const source = React.use(sourcePromise);
  const onLoadTimingRef = React.useRef(onLoadTiming);
  onLoadTimingRef.current = onLoadTiming;

  useKeyedMountEffect(getPptxHookSourceKey(source), () => source.retain());
  useKeyedMountEffect(
    onLoadTiming ? `timing:${content.sourceKind}:${content.key}` : null,
    () =>
      subscribePptxSourceLoadTiming(content, (timing) => {
        onLoadTimingRef.current?.(timing);
      }),
  );
  return source;
}

function getPptxHookSourceKey(source: PptxSource) {
  const existingKey = pptxHookSourceKeys.get(source);
  if (existingKey) return existingKey;
  const key = String(nextPptxHookSourceKey);
  nextPptxHookSourceKey += 1;
  pptxHookSourceKeys.set(source, key);
  return key;
}
