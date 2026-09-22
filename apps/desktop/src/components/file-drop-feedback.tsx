import type { CSSProperties } from "react";
import type { FileDropPreview } from "../lib/drop-preview";

export function FileDropFeedback({ preview }: { preview: FileDropPreview | null }) {
  if (!preview) return null;
  const { bounds } = preview;
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  // The action belongs to the destination. Only the native drag image follows
  // the pointer: no second floating object, edge-flipping or position animation.
  const compactTarget = bounds.height < 80;
  const left = Math.max(8, Math.min(bounds.left + 8, viewportWidth - 248));
  const top = Math.max(8, Math.min(compactTarget ? bounds.top + bounds.height + 6 : bounds.top + 10, viewportHeight - 40));
  const style = {
    "--file-drop-target-left": `${bounds.left}px`,
    "--file-drop-target-top": `${bounds.top}px`,
    "--file-drop-target-width": `${bounds.width}px`,
    "--file-drop-target-height": `${bounds.height}px`,
    "--file-drop-card-left": `${left}px`,
    "--file-drop-card-top": `${top}px`,
  } as CSSProperties;

  return (
    <div className="file-drop-feedback" data-target-kind={preview.targetKind} style={style}>
      <div className="file-drop-target" aria-hidden="true" />
      <div className="file-drop-card" role="status" aria-live="polite" aria-atomic="true">
        <span className="file-drop-action">{preview.actionLabel}</span>
        <span className="file-drop-destination">{preview.targetLabel}</span>
      </div>
    </div>
  );
}
