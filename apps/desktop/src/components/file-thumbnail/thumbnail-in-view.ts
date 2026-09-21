"use client";

import * as React from "react";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

export function useThumbnailInView() {
  const [seen, setSeen] = React.useState(false);
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const seenRef = React.useRef(false);
  const ref = React.useCallback((el: HTMLElement | null) => setNode(el), []);

  useKeyedMountEffect(joinEffectKey([node]), () => {
    if (!node || seenRef.current) return;
    if (typeof IntersectionObserver === "undefined") {
      seenRef.current = true;
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          seenRef.current = true;
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  });

  return { ref, seen };
}
