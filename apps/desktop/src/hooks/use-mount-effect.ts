"use client";

import { useEffect } from "react";

/**
 * Run an effect exactly once on mount. The returned cleanup (if any) runs on unmount.
 *
 * Use this instead of `useEffect(fn, [])` so intent is explicit and the escape
 * hatch is greppable. See `no-use-effect.md` for the five replacement patterns
 * and when this hook is actually the right answer (DOM integration, third-party
 * widget lifecycles, browser API subscriptions, stable singleton dependencies).
 */
export function useMountEffect(effect: () => void | (() => void)) {
  // eslint-disable-next-line no-restricted-syntax
  useEffect(effect, []);
}
