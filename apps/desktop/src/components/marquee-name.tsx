import { useEffect, useRef } from "react";

// Sidebar names are cut to keep rows narrow, which hides exactly the tail that tells
// two files apart. Hovering the row slides the name through its window to show it,
// the same way the viewer's trajectory control does. The distance is measured rather
// than guessed: on mount so a hover works immediately, and again on enter because the
// sidebar can be resized. Moving an inner element by transform keeps it off the
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
    measure();
    const observer = new ResizeObserver(measure);
    if (boxRef.current) observer.observe(boxRef.current);
    return () => observer.disconnect();
  }, [children]);
  return (
    <span ref={boxRef} className={className} onPointerEnter={measure}>
      <span ref={textRef} className="marquee-text">{children}</span>
    </span>
  );
}
