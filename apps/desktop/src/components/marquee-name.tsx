import { useEffect, useRef } from "react";

// Sidebar names are cut to keep rows narrow, which hides exactly the tail that tells
// two files apart. Hovering the row slides the name through its window to show it,
// the same way the viewer's trajectory control does. The distance is measured rather
// than guessed, but only for the hovered or keyboard-focused row. Moving an inner element by transform keeps it off the
// layout path, so the row itself never reflows.
export function MarqueeName({ className, children }: { className: string; children: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const measure = () => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    const overflow = Math.max(0, text.scrollWidth - box.clientWidth);
    box.style.setProperty("--marquee-shift", `${overflow}px`);
    // A steady reading pace, so a long tail does not race past a short one.
    box.style.setProperty("--marquee-duration", `${Math.max(0.45, overflow / 34).toFixed(2)}s`);
  };
  useEffect(() => {
    const box = boxRef.current;
    const row = box?.closest<HTMLElement>(".tab, .project, .project-folder-row, .project-group-row") ?? box;
    if (!box || !row) return;
    let observer: ResizeObserver | undefined;
    let hovered = row.matches(":hover");
    let focused = row.contains(document.activeElement);
    const update = () => {
      if (hovered || focused) {
        measure();
        if (!observer) {
          observer = new ResizeObserver(measure);
          observer.observe(box);
        }
      } else {
        observer?.disconnect();
        observer = undefined;
      }
    };
    const enter = () => { hovered = true; update(); };
    const leave = () => { hovered = false; update(); };
    const focus = () => { focused = true; update(); };
    const blur = (event: FocusEvent) => { focused = event.relatedTarget instanceof Node && row.contains(event.relatedTarget); update(); };
    row.addEventListener("pointerenter", enter);
    row.addEventListener("pointerleave", leave);
    row.addEventListener("focusin", focus);
    row.addEventListener("focusout", blur);
    update();
    return () => {
      observer?.disconnect();
      row.removeEventListener("pointerenter", enter);
      row.removeEventListener("pointerleave", leave);
      row.removeEventListener("focusin", focus);
      row.removeEventListener("focusout", blur);
    };
  }, [children]);
  return (
    <span ref={boxRef} className={className}>
      <span ref={textRef} className="marquee-text">{children}</span>
    </span>
  );
}
