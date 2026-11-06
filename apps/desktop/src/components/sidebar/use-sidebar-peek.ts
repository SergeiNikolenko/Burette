import { useEffect, useRef, useState, type RefObject } from "react";

// Sidebar peek, after the Codex slate sidebar peek: while the sidebar is
// hidden, resting the pointer on its toggle (or on the window's left edge)
// slides the sidebar over the content, and moving away slides it back. The
// pinned sidebar is untouched; clicking the toggle still pins it.
//
// Phases: `open` slides in, `closing` plays the exit, and `settling` covers a
// peek that was pinned — the overlay stays in place while the panel underneath
// animates open, so the sidebar does not blink out and slide in again.
export type SidebarPeekPhase = "closed" | "open" | "closing" | "settling";

const PEEK_AREA_SELECTOR = "[data-sidebar-peek-area]";
// Menus and dialogs opened from the sidebar render in portals outside it.
const LAYER_SELECTOR = "[data-radix-popper-content-wrapper], [role='menu'], [role='dialog'], .sidebar-hover-card";
const OPEN_DELAY_MS = 100;
const CLOSE_DELAY_MS = 100;
const EXIT_MS = 200;
// Outlasts the 140ms flex-grow toggle animation of the pinned panel.
const SETTLE_MS = 200;
const EDGE_PX = 4;

export function useSidebarPeek({
  enabled,
  panelRef,
  closeKey,
}: {
  enabled: boolean;
  panelRef: RefObject<HTMLElement | null>;
  // Any change (the active tab) closes the peek, as navigation does in Codex.
  closeKey: unknown;
}) {
  const [phase, setPhase] = useState<SidebarPeekPhase>("closed");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const hideRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) {
      setPhase(current => current === "open" ? "settling" : "closed");
      return;
    }
    const hover = window.matchMedia("(hover: hover) and (pointer: fine)");
    let openTimer = 0;
    let closeTimer = 0;
    let exitTimer = 0;
    let dragging = false;
    const clearTimers = () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(closeTimer);
      openTimer = closeTimer = 0;
    };
    const show = () => {
      clearTimers();
      window.clearTimeout(exitTimer);
      setPhase("open");
    };
    const hide = () => {
      clearTimers();
      if (phaseRef.current !== "open") return;
      setPhase("closing");
      window.clearTimeout(exitTimer);
      exitTimer = window.setTimeout(() => setPhase("closed"), EXIT_MS);
    };
    hideRef.current = hide;
    const insidePanel = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(LAYER_SELECTOR)) return true;
      const rect = panelRef.current?.getBoundingClientRect();
      return Boolean(rect && event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.buttons > 0 || !hover.matches) return;
      const target = event.target instanceof Element ? event.target : null;
      const onTrigger = Boolean(target?.closest(PEEK_AREA_SELECTOR)) || event.clientX <= EDGE_PX;
      if (phaseRef.current === "open") {
        if (onTrigger || insidePanel(event)) {
          window.clearTimeout(closeTimer);
          closeTimer = 0;
        } else if (!closeTimer && !dragging) {
          // A context menu or rename dialog opened from the sidebar keeps it
          // until the layer closes. Keep re-checking: over the viewer iframe
          // the document sees no further pointer events to retry on.
          const closeWhenUnblocked = () => {
            closeTimer = document.querySelector("[role='menu'], [role='dialog']")
              ? window.setTimeout(closeWhenUnblocked, CLOSE_DELAY_MS)
              : 0;
            if (!closeTimer) hide();
          };
          closeTimer = window.setTimeout(closeWhenUnblocked, CLOSE_DELAY_MS);
        }
      } else if (onTrigger) {
        if (!openTimer) openTimer = window.setTimeout(show, OPEN_DELAY_MS);
      } else {
        window.clearTimeout(openTimer);
        openTimer = 0;
      }
    };
    const onLeaveDocument = () => {
      window.clearTimeout(openTimer);
      openTimer = 0;
      if (!dragging) hide();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (phaseRef.current === "open" && !insidePanel(event)) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || phaseRef.current !== "open") return;
      if (document.querySelector("[role='menu'], [role='dialog']")) return;
      hide();
    };
    // Dragging a file out of the peek keeps it open until the drop.
    const onDragStart = () => { dragging = phaseRef.current === "open"; };
    const onDragEnd = () => {
      if (!dragging) return;
      dragging = false;
      hide();
    };
    document.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("pointerover", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeaveDocument);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("drop", onDragEnd);
    return () => {
      clearTimers();
      window.clearTimeout(exitTimer);
      hideRef.current = () => {};
      document.removeEventListener("pointermove", onPointer);
      document.removeEventListener("pointerover", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeaveDocument);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragend", onDragEnd);
      document.removeEventListener("drop", onDragEnd);
    };
  }, [enabled, panelRef]);

  useEffect(() => {
    if (phase !== "settling") return;
    const timer = window.setTimeout(() => setPhase("closed"), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => hideRef.current(), [closeKey]);

  return phase;
}
