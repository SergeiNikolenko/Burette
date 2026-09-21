"use client";

import { useEffect } from "react";

/**
 * Hook variant of <KeyedRunner>. Runs `effect` each time `key` changes
 * (including the first mount). Returned cleanup runs before the next run
 * and on unmount. No-ops when `key` is `null`.
 *
 * This exists ONLY for library hooks whose internals need reactive
 * post-commit side effects. Prefer <KeyedRunner> in component code.
 */
export function useKeyedMountEffect(
  key: string | null,
  effect: () => void | (() => void),
) {
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (key === null) return;
    return effect();
    // The effect closure is intentionally captured at each key change;
    // eslint's exhaustive-deps would demand we include `effect`, but
    // the semantics are key-driven, not effect-identity-driven.
     
  }, [key]);
}
