import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Retain rows only during the closing transition, not while a folder is idle
// and hidden. A render callback also avoids building React elements for its tail.
export function TreeCollapse({ open, className, children }: {
  open: boolean;
  className: string;
  children: () => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [present, setPresent] = useState(open);
  const [expanded, setExpanded] = useState(open);
  useLayoutEffect(() => {
    let cancelled = false;
    if (open) setPresent(true);
    else setExpanded(false);
    // Mount at 0fr before opening. When closing, let the transition start
    // before reading it; no fixed timer that can expire before a busy paint.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (open) setExpanded(true);
        else void Promise.allSettled((ref.current?.getAnimations() ?? []).map(a => a.finished)).then(() => {
          if (!cancelled) setPresent(false);
        });
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [open]);
  return <div ref={ref} className={className} data-expanded={expanded ? "true" : "false"}
    aria-hidden={!open} inert={!open}>
    {present ? children() : null}
  </div>;
}
