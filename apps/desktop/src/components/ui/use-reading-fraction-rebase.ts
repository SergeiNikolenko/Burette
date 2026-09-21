"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

// Preserve the reader's place across a fit-width resize.
//
// When the sidebar toggles, a document that fits its width re-fits to the new
// inset: a wider page is a taller document, so its absolute scroll size changes
// and a frozen scrollTop would drop the reader to a different place. The fix is
// format-agnostic: continuously record the document fraction at the viewport
// top, and the moment the layout changes, restore the viewport top to that
// fraction of the new document — synchronously, before paint, so the visible
// content never jumps.
//
// Renderers that already carry a richer per-page reading anchor (PDF, DOCX)
// keep theirs; this is for the ones whose content simply scales with width
// (image, PPTX, markdown), where the document fraction is the reading position.
export function useReadingFractionRebase({
  scrollerRef,
  layoutKey,
  enabled = true,
}: {
  scrollerRef: React.RefObject<HTMLElement | null>;
  // Anything that changes when the document re-fits (the fit width or scale).
  // The rebase restores the captured fraction whenever this changes.
  layoutKey: unknown;
  enabled?: boolean;
}) {
  const fractionRef = React.useRef(0);
  const committedKeyRef = React.useRef(layoutKey);

  const captureReadingFraction = React.useCallback(() => {
    const viewport = scrollerRef.current;
    if (!viewport) return;
    // The DOCUMENT fraction at the viewport top — never the fraction of the
    // scroll range. Range fraction breaks down when the document barely
    // overflows: 28px into a 28px range reads as "scrolled to the bottom",
    // and restoring that bottom against a grown document teleports the
    // camera to its middle. Content height is the linear coordinate the
    // re-fit actually scales, so its fraction IS the reading position.
    fractionRef.current =
      viewport.scrollHeight > 0
        ? viewport.scrollTop / viewport.scrollHeight
        : 0;
  }, [scrollerRef]);

  useKeyedLayoutEffect(
    joinEffectKey(["reading-fraction-rebase", layoutKey]),
    () => {
      const previousKey = committedKeyRef.current;
      committedKeyRef.current = layoutKey;
      if (!enabled) return;
      if (Object.is(previousKey, layoutKey)) return;

      const viewport = scrollerRef.current;
      if (!viewport) return;
      const range = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      viewport.scrollTop = Math.min(
        fractionRef.current * viewport.scrollHeight,
        range,
      );
    },
  );

  return { captureReadingFraction };
}
