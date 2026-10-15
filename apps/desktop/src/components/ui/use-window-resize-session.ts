import { useEffect, useRef, type RefObject } from "react";
import { pinViewerFrames } from "../editor-area/viewer-frame";

// A native window resize is a layout gesture too. Keep WebGL iframe viewports
// fixed while the window moves, then commit bounds and release after the panel
// observers have settled. No React or persistence update runs per resize event.
export function useWindowResizeSession(shellRef: RefObject<HTMLElement | null>, commit: () => void) {
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    let timer = 0;
    let frame = 0;
    let release: (() => void) | undefined;
    const finish = () => {
      release?.();
      release = undefined;
    };
    const resize = () => {
      if (!release && shellRef.current) release = pinViewerFrames(shellRef.current);
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      timer = window.setTimeout(() => {
        commitRef.current();
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(finish);
        });
      }, 120);
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      finish();
    };
  }, [shellRef]);
}
