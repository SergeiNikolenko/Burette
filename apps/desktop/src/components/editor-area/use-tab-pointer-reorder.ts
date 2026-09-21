import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

/** Host iframes cannot reliably start an OS HTML drag; capture the pointer instead. */
export function useTabPointerReorder(
  move: (tabId: string, clientX: number) => void,
  setDragging: (tabId: string | null) => void,
) {
  const callbacks = useRef({ move, setDragging });
  callbacks.current = { move, setDragging };
  const cleanup = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => cleanup.current?.(), []);

  const start = (tabId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary || event.ctrlKey || event.metaKey || event.shiftKey) return;
    cleanup.current?.();
    suppressClick.current = false;
    const button = event.currentTarget;
    const strip = button.closest<HTMLElement>(".tab-scroll-region");
    // Capture on the stable strip, not the tab node React moves during reorder.
    const captureTarget = strip ?? button;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    let clientX = startX;
    let active = false;
    let frame = 0;

    const tick = () => {
      if (strip) {
        const rect = strip.getBoundingClientRect();
        const speed = clientX < rect.left + 24 ? -8 : clientX > rect.right - 24 ? 8 : 0;
        if (speed) strip.scrollLeft += speed;
      }
      callbacks.current.move(tabId, clientX);
      frame = requestAnimationFrame(tick);
    };
    const onMove = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      clientX = next.clientX;
      if (!active && Math.abs(clientX - startX) >= 8) {
        active = true;
        suppressClick.current = true;
        captureTarget.setPointerCapture(pointerId);
        callbacks.current.setDragging(tabId);
        frame = requestAnimationFrame(tick);
      }
      if (active) next.preventDefault();
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      captureTarget.removeEventListener("lostpointercapture", onCancel);
      window.removeEventListener("blur", stop);
      window.removeEventListener("keydown", onKeyDown);
      if (captureTarget.hasPointerCapture(pointerId)) captureTarget.releasePointerCapture(pointerId);
      if (active) callbacks.current.setDragging(null);
      cleanup.current = null;
    };
    const onUp = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (active) callbacks.current.move(tabId, next.clientX);
      stop();
    };
    const onCancel = (next: PointerEvent) => {
      if (next.pointerId === pointerId) stop();
    };
    const onKeyDown = (next: KeyboardEvent) => {
      if (next.key === "Escape") stop();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    captureTarget.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("blur", stop);
    window.addEventListener("keydown", onKeyDown);
    cleanup.current = stop;
  };

  return { start, consumeClick: () => {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  } };
}
