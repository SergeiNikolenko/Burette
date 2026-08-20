"use client";

import { useEffect, useLayoutEffect } from "react";

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Layout-timed variant for DOM measurement/scroll/focus lifecycles that must
 * run before paint. Prefer `use-keyed-mount-effect` for ordinary post-commit
 * effects.
 */
export function useKeyedLayoutEffect(
  key: string | null,
  effect: () => void | (() => void),
) {
  useIsomorphicLayoutEffect(() => {
    if (key === null) return;
    return effect();
    // The effect closure is intentionally captured at each key change.
  }, [key]);
}
