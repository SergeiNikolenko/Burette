"use client";

import * as React from "react";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

export function FileThumbnailShimmer() {
  const highlightRef = React.useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useKeyedMountEffect(joinEffectKey([prefersReducedMotion]), () => {
    const highlight = highlightRef.current;
    if (!highlight || prefersReducedMotion || !highlight.animate) return;

    const animation = highlight.animate(
      [{ backgroundPosition: "200% 0" }, { backgroundPosition: "-200% 0" }],
      {
        duration: 1600,
        iterations: Infinity,
        easing: "linear",
      },
    );

    return () => animation.cancel();
  });

  return (
    <div
      aria-hidden
      data-slot="file-thumbnail-shimmer"
      className="bg-muted absolute inset-0 overflow-hidden"
    >
      <div
        ref={highlightRef}
        data-slot="file-thumbnail-shimmer-highlight"
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(120deg, transparent 35%, var(--skeleton-highlight, color-mix(in oklab, var(--background) 85%, transparent)) 50%, transparent 65%)",
          backgroundSize: "200% 100%",
          backgroundRepeat: "no-repeat",
          backgroundPosition: prefersReducedMotion ? "50% 0" : "200% 0",
        }}
      />
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    () => false,
  );
}

function subscribeToReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};

  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (query.addEventListener) {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }

  const legacyQuery = query as MediaQueryList & {
    addListener?: (listener: () => void) => void;
    removeListener?: (listener: () => void) => void;
  };
  legacyQuery.addListener?.(onChange);
  return () => legacyQuery.removeListener?.(onChange);
}

function getReducedMotionSnapshot() {
  if (typeof window === "undefined" || !window.matchMedia) return false;

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
