import { FileImportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CSSProperties } from "react";
import type { FileDropPreview } from "../lib/drop-preview";

const CARD_WIDTH = 286;
const CARD_HEIGHT = 68;
const VIEWPORT_MARGIN = 12;

export function FileDropFeedback({ preview }: { preview: FileDropPreview | null }) {
  if (!preview) return null;
  const cardPosition = placeCard(preview.point);
  const style = {
    "--file-drop-target-left": `${preview.bounds.left}px`,
    "--file-drop-target-top": `${preview.bounds.top}px`,
    "--file-drop-target-width": `${preview.bounds.width}px`,
    "--file-drop-target-height": `${preview.bounds.height}px`,
    "--file-drop-card-left": `${cardPosition.left}px`,
    "--file-drop-card-top": `${cardPosition.top}px`,
  } as CSSProperties;

  return (
    <div className="file-drop-feedback" data-target-kind={preview.targetKind} style={style}>
      <div className="file-drop-target" aria-hidden="true" />
      <div className="file-drop-card" role="status" aria-live="polite" aria-atomic="true">
        <span className="file-drop-card-icon" aria-hidden="true">
          <HugeiconsIcon icon={FileImportIcon} size={18} color="currentColor" strokeWidth={2} />
        </span>
        <span className="file-drop-card-copy">
          <strong>{preview.actionLabel}</strong>
          <span>
            <span>{preview.itemLabel}</span>
            <span>{preview.targetLabel}</span>
          </span>
        </span>
        {preview.choiceCount > 1 ? (
          <span className="file-drop-choice-count">{preview.choiceCount} actions</span>
        ) : null}
      </div>
    </div>
  );
}

function placeCard(point: FileDropPreview["point"]) {
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  return {
    left: clamp(point.x + 16, VIEWPORT_MARGIN, viewportWidth - CARD_WIDTH - VIEWPORT_MARGIN),
    top: clamp(point.y + 18, 44, viewportHeight - CARD_HEIGHT - VIEWPORT_MARGIN),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
}
