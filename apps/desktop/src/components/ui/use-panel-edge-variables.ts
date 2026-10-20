import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

type Edge = "--sidebar-edge" | "--right-dock-edge";
type Entry = { elementRef: RefObject<HTMLDivElement | null>; property: Edge };

// The absolute chrome follows measured panel bounds before paint. Scope these
// frequently changing properties to its two consumers: inheriting them from the
// app root invalidates style throughout the workspace on every resize frame.
export function usePanelEdgeVariables(entries: Entry[]) {
  const shellRef = useRef<HTMLElement | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const edges = useRef(new Map<Edge, number>());
  const publishRef = useRef<() => void>(() => {});
  publishRef.current = () => {
    const shell = shellRef.current;
    if (!shell) return;
    const topbar = shell.querySelector<HTMLElement>(".topbar");
    const dragRegion = shell.querySelector<HTMLElement>(".drag-region");
    for (const [property, width] of edges.current) {
      const targets = property === "--sidebar-edge" ? [topbar] : [topbar, dragRegion];
      for (const target of targets) {
        if (target && target.style.getPropertyValue(property) !== `${width}px`) {
          target.style.setProperty(property, `${width}px`);
        }
      }
    }
  };
  // Settings can unmount the chrome without unmounting the panel observers.
  // Republish cached measurements on return, without a synchronous layout read.
  useLayoutEffect(() => publishRef.current());
  useEffect(() => {
    const observer = new ResizeObserver((records) => {
      for (const record of records) {
        const entry = entriesRef.current.find(candidate => candidate.elementRef.current === record.target);
        if (entry) edges.current.set(entry.property, record.borderBoxSize?.[0]?.inlineSize ?? record.contentRect.width);
      }
      publishRef.current();
    });
    // Until the initial observer delivery, CSS uses the stored layout widths.
    for (const { elementRef } of entriesRef.current) {
      if (elementRef.current) observer.observe(elementRef.current);
    }
    return () => observer.disconnect();
  }, []);
  return shellRef;
}
