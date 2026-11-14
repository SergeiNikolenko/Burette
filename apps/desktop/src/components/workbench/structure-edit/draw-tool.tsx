import { useEffect, useRef, useState } from "react";
import { parseAtomDrawMessage, setAtomDrawMode, type DrawGesture } from "../../../lib/atom-draw";
import { activeViewerIframeForDocument, captureViewerActionTarget } from "../../../lib/viewer-bridge";
import { isAbortError } from "../../../lib/viewer-errors";
import type { ViewerDocument } from "../../../types";
import type { ShellActions } from "../../types";
import { Checkbox } from "../../ui/checkbox";
import { SegmentedControl, SegmentedControlItem } from "../../ui/segmented-control";

export type DrawSettings = { order: 1 | 2 | 3; hydrogens: boolean };

/**
 * Keeps the viewer's Draw mode on while `enabled` and hands its gestures to
 * `onGesture`. A draft write reloads the scene into a second frame that becomes
 * visible only after it renders, so the mode is renewed with a new lease
 * whenever the document's active frame changes; gestures from older frames are
 * ignored.
 */
const FRAME_CHECK_MS = 400;

export function useAtomDraw(document: ViewerDocument, send: ShellActions["runStructureViewerAction"], enabled: boolean, revision: unknown,
  onGesture: (gesture: DrawGesture) => void, onError: (message: string) => void) {
  const handlers = useRef({ onGesture, onError, send });
  handlers.current = { onGesture, onError, send };
  const [renewal, renew] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const target = captureViewerActionTarget(document.id);
    if (!target) { handlers.current.onError("Open the scene and wait for it to load."); return undefined; }
    const lease = crypto.randomUUID();
    const listener = (event: MessageEvent) => {
      if (event.source !== target.source || !target.isCurrent()) return;
      const gesture = parseAtomDrawMessage(event.data, lease);
      if (gesture) handlers.current.onGesture(gesture);
    };
    window.addEventListener("message", listener);
    const check = window.setInterval(() => {
      if (!target.isCurrent() || activeViewerIframeForDocument(document.id)?.contentWindow !== target.source) renew((count) => count + 1);
    }, FRAME_CHECK_MS);
    setAtomDrawMode(document, target, lease, true, handlers.current.send).catch((caught) => {
      if (!isAbortError(caught) && target.isCurrent()) handlers.current.onError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => {
      window.removeEventListener("message", listener);
      window.clearInterval(check);
      if (target.isCurrent()) void setAtomDrawMode(document, target, lease, false, handlers.current.send).catch(() => {});
    };
  }, [enabled, document, revision, renewal]);
}

export function DrawSettingsRow({ settings, onChange }: { settings: DrawSettings; onChange: (settings: DrawSettings) => void }) {
  return (
    <div className="structure-edit-draw">
      <SegmentedControl aria-label="Bond order" value={String(settings.order)}
        onValueChange={(value) => { if (value) onChange({ ...settings, order: Number(value) as DrawSettings["order"] }); }}>
        <SegmentedControlItem value="1">Single</SegmentedControlItem>
        <SegmentedControlItem value="2">Double</SegmentedControlItem>
        <SegmentedControlItem value="3">Triple</SegmentedControlItem>
      </SegmentedControl>
      <label className="structure-edit-draw-hydrogens">
        <Checkbox checked={settings.hydrogens} onCheckedChange={(checked) => onChange({ ...settings, hydrogens: checked === true })} />
        Adjust hydrogens
      </label>
    </div>
  );
}
