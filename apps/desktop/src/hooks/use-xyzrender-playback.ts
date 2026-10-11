import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { AnimationFrames } from '../lib/xyzrender-animation';
import { postToXyzrenderViewer } from '../lib/viewer-bridge';

// The canvas runs on the display clock. Only the item open in the inspector
// shows its preview; hiding it restores the item's own artwork.
export function useXyzrenderPlayback(animation: AnimationFrames | null, playing: boolean, fps: number, range: number[], itemId: string | undefined, documentId: string | undefined, suspended: boolean, visible: boolean) {
  const current = useRef(0);
  const [frame, setDisplayedFrame] = useState(0);
  const last = Math.max(0, (animation?.frames.length ?? 1) - 1);
  const start = Math.min(last, Math.max(0, Math.trunc(Number.isFinite(range[0]) ? range[0] : 0)));
  const end = Math.min(last, Math.max(start, Math.trunc(Number.isFinite(range[1]) ? range[1] : last)));
  const setFrame = useCallback((value: SetStateAction<number>) => {
    const next = typeof value === 'function' ? value(current.current) : value;
    // Render completion may replace the animation and seek in the same batch.
    // Its new bounds are only available on the next render, not in this closure.
    current.current = Number.isFinite(next) ? Math.max(0, Math.trunc(next)) : 0;
    setDisplayedFrame(current.current);
  }, []);
  const previewing = Boolean(animation) && !suspended && visible;
  const lastPaint = useRef<{ animation: AnimationFrames; index: number; itemId: string | undefined; documentId: string | undefined } | null>(null);
  const paint = useCallback(() => {
    if (!animation) return;
    const index = current.current;
    const pixels = animation.frames[index];
    const previous = lastPaint.current;
    if (!pixels || (previous?.animation === animation && previous.index === index && previous.itemId === itemId && previous.documentId === documentId)) return;
    postToXyzrenderViewer(documentId, {
      type: 'applyXyzrenderAnimationFrame', itemId,
      width: animation.width, height: animation.height, pixels,
    });
    lastPaint.current = { animation, index, itemId, documentId };
  }, [animation, itemId, documentId]);
  useEffect(() => {
    if (!previewing) return;
    return () => {
      lastPaint.current = null;
      postToXyzrenderViewer(documentId, { type: 'clearXyzrenderAnimationPreview', itemId });
    };
  }, [previewing, documentId, itemId]);
  useEffect(() => {
    if (!previewing || !animation) return;
    current.current = playing ? Math.max(start, Math.min(end, current.current)) : Math.min(last, current.current);
    setDisplayedFrame(current.current);
    if (!playing) return;
    paint();
    if (start === end || !Number.isFinite(fps) || fps <= 0) return;
    let request = 0, previous = performance.now(), elapsed = 0, lastUi = previous;
    const tick = (now: number) => {
      elapsed += Math.max(0, Math.min(now - previous, 250));
      previous = now;
      const steps = Math.floor(elapsed * fps / 1000);
      if (steps) {
        elapsed -= steps * 1000 / fps;
        current.current = start + ((Math.max(start, current.current) - start + steps) % (end - start + 1));
        paint();
        if (now - lastUi >= 100) { setDisplayedFrame(current.current); lastUi = now; }
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [animation, playing, fps, start, end, last, paint, previewing]);
  // Scrubbing while paused must paint immediately without starting playback.
  useEffect(() => {
    if (playing || !previewing || !animation) return;
    // The rotation slider spans the entire animation, not just the export range.
    current.current = Math.min(last, current.current);
    setDisplayedFrame(current.current);
    paint();
  }, [animation, frame, start, end, last, paint, playing, previewing]);
  return [frame, setFrame] as const;
}
