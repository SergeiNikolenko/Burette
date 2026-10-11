import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { GroupImperativeHandle } from "../ui/resizable";

export type WorkbenchColumn = { id: string; open: boolean; px: number };

// Lays out the trailing columns of the workbench (side panel, right dock) in
// one pass. Expanding or resizing one collapsible panel takes its room from
// the neighbouring panel, so opening the side panel collapsed the right dock
// and opening the dock squeezed the side panel. Setting the whole layout at
// once lets the main column absorb the difference instead. Columns are given
// their stored widths in order until the room runs out.
export function useWorkbenchColumns(
  groupRef: RefObject<GroupImperativeHandle | null>,
  elementRef: RefObject<HTMLDivElement | null>,
  mainId: string,
  columns: WorkbenchColumn[],
) {
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const apply = useRef(() => {
    const group = groupRef.current;
    const width = elementRef.current?.getBoundingClientRect().width ?? 0;
    if (!group || width <= 0) return;
    const layout: Record<string, number> = {};
    // Opening panels must leave a usable main view. Scale both trailing
    // columns together rather than allowing the first one to consume it all.
    const requested = columnsRef.current.reduce((sum, column) => sum + (column.open ? column.px : 0), 0);
    const budget = width - Math.min(320, width * .4);
    const scale = requested > budget ? budget / requested : 1;
    let remaining = 100;
    for (const column of columnsRef.current) {
      const share = column.open ? column.px * scale / width * 100 : 0;
      layout[column.id] = share;
      remaining -= share;
    }
    layout[mainId] = remaining;
    group.setLayout(layout);
  }).current;

  const openKey = columns.map((column) => (column.open ? "1" : "0")).join("");
  const involved = columns.some((column) => column.id === "side-pane" && column.open);
  const previousKey = useRef(openKey);
  // Runs after the per-panel collapse sync (hook order), before paint.
  useLayoutEffect(() => {
    if (previousKey.current === openKey) return;
    previousKey.current = openKey;
    apply();
  }, [apply, openKey]);

  // While the side panel is open, a container resize is re-laid out the same
  // way; the per-panel pixel guard would otherwise trade width between the two.
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !involved) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; apply(); });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [apply, elementRef, involved]);
}
