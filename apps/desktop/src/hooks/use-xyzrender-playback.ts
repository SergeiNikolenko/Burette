import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { AnimationFrames } from '../lib/xyzrender-animation';
import { postToXyzrenderViewer } from '../lib/viewer-bridge';

// The canvas runs on the display clock. Only the item open in the inspector
// shows its preview; hiding it restores the item's own artwork.
export function useXyzrenderPlayback(animation: AnimationFrames | null, playing: boolean, fps: number, range: number[], itemId: string | undefined, documentId: string | undefined, suspended: boolean, visible: boolean) {
  const current = useRef(0);
  const [frame, setDisplayedFrame] = useState(0);
  const setFrame = useCallback((value: SetStateAction<number>) => {
    current.current = typeof value === 'function' ? value(current.current) : value;
    setDisplayedFrame(current.current);
  }, []);
  const previewing = Boolean(animation) && !suspended && visible;
  useEffect(() => {
    if (!previewing) return;
    return () => postToXyzrenderViewer(documentId, { type: 'clearXyzrenderAnimationPreview', itemId });
  }, [previewing, documentId, itemId]);
  useEffect(() => {
    if (!previewing || !animation) return;
    const paint = () => {
      const pixels = animation.frames[current.current];
      if (!pixels) return;
      postToXyzrenderViewer(documentId, {
        type: 'applyXyzrenderAnimationFrame', itemId,
        width: animation.width, height: animation.height, pixels,
      });
    };
    paint();
    setDisplayedFrame(current.current);
    if (!playing) return;
    let request = 0, previous = performance.now(), elapsed = 0, lastUi = previous;
    const tick = (now: number) => {
      elapsed += Math.max(0, Math.min(now - previous, 250));
      previous = now;
      const steps = Math.floor(elapsed * fps / 1000);
      if (steps) {
        elapsed -= steps * 1000 / fps;
        current.current = range[0] + ((Math.max(range[0], current.current) - range[0] + steps) % (range[1] - range[0] + 1));
        paint();
        if (now - lastUi >= 100) { setDisplayedFrame(current.current); lastUi = now; }
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [animation, playing, fps, range, itemId, documentId, previewing]);
  // Scrubbing while paused must paint immediately without starting playback.
  useEffect(() => {
    if (playing || !previewing || !animation) return;
    const pixels = animation.frames[frame];
    if (!pixels) return;
    postToXyzrenderViewer(documentId, {
      type: 'applyXyzrenderAnimationFrame', itemId, width: animation.width, height: animation.height, pixels,
    });
  }, [animation, frame, itemId, documentId, playing, previewing]);
  return [frame, setFrame] as const;
}
