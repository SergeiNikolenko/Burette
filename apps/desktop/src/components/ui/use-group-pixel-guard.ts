import { useEffect, useRef, type RefObject } from "react";
import type { PanelImperativeHandle } from "./resizable";

type PixelGuardEntry = {
  panelRef: RefObject<PanelImperativeHandle | null>;
  openRef: RefObject<boolean>;
  sizePxRef: RefObject<number>;
};

// groupResizeBehavior="preserve-pixel-size" is inert in react-resizable-panels
// 4.12.2: any container resize (window resize, or the sidebar moving the
// workbench) redistributes panel sizes proportionally, so the right dock used
// to drift through the 360px tab-label container-query threshold and flicker.
// Re-assert the stored pixel size of fixed panels whenever the group's element
// resizes. The observer fires between layout and paint, so the proportional
// intermediate state is corrected before it becomes visible, and correcting the
// group's inner layout does not resize the group element again (no loop).
export function useGroupPixelGuard(entries: PixelGuardEntry[]) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let frame = 0;
    const correct = () => {
      frame = 0;
      for (const { panelRef, openRef, sizePxRef } of entriesRef.current) {
        const panel = panelRef.current;
        if (!panel || !openRef.current) continue;
        // A panel the group collapsed under pressure is restored here once the
        // room is back: the open flag stays true through a squeeze, so this is
        // the other half of not persisting a forced collapse.
        if (panel.isCollapsed()) panel.expand();
        const want = sizePxRef.current;
        if (want <= 1) continue;
        if (Math.abs(panel.getSize().inPixels - want) > 0.75) panel.resize(`${want}px`);
      }
    };
    // Correct on the next frame, not inside the observer callback: the library
    // processes the same container resize in its own observer and converts
    // px→% through a cached group size, so a same-frame resize() races it and
    // lands on a stale conversion. By the rAF the library has settled; if the
    // container moves again the observer refires and schedules another pass.
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(correct);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return elementRef;
}

