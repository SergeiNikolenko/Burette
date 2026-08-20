import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

import {
  resolveDocxTarget,
  targetKey,
  type DocxRenderIndex,
} from "./docx-viewer-targets";
import type { DocxTarget } from "./docx-viewer-types";
import { joinEffectKey } from "@/lib/effect-key";

export function useDocxHighlight({
  highlight,
  renderIndex,
  ready,
}: {
  highlight?: DocxTarget | null;
  renderIndex: DocxRenderIndex | null;
  ready: boolean;
}) {
  const highlightName = "docx-src-" + React.useId().replace(/:/g, "");
  const highlightKey = targetKey(highlight);

  useKeyedMountEffect(
    joinEffectKey([
      "docx-highlight",
      highlightKey,
      ready,
      highlightName,
      renderIndex,
    ]),
    () => {
      const registry =
        typeof CSS !== "undefined" && "highlights" in CSS
          ? CSS.highlights
          : null;
      if (!registry || typeof Highlight === "undefined") return;
      const deleteHighlight = () => {
        try {
          registry.delete(highlightName);
        } catch {
          // Highlighting is an enhancement; registry failures must not hide the document.
        }
      };
      if (!highlight || !ready || !renderIndex) {
        deleteHighlight();
        return;
      }
      try {
        const range = resolveDocxTarget(renderIndex, highlight);
        if (range) registry.set(highlightName, new Highlight(range));
        else deleteHighlight();
      } catch {
        deleteHighlight();
      }
      return deleteHighlight;
    },
  );

  return highlightName;
}
