import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FocusEvent } from "react";

const GAP = 4;
const ESTIMATED_WIDTH = 160;
const WINDOW_THRESHOLD = 40;
const OVERSCAN = 3;

function indexAt(offsets: number[], offset: number) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (offsets[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

// Virtualize only controls, never their pages. Natural tab widths are measured
// after mounting so pinned pills, close buttons and titles keep their geometry.
export function useTabWindow(tabs: readonly { id: string }[], activeId: string | null, draggingId: string | null) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const shells = useRef(new Map<string, HTMLDivElement>());
  const widths = useRef(new Map<string, number>());
  const [measurement, setMeasurement] = useState(0);
  const [viewport, setViewport] = useState({ left: 0, width: 800 });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const windowed = tabs.length > WINDOW_THRESHOLD;
  const offsets = useMemo(() => {
    const result = [0];
    for (const tab of tabs) result.push(result[result.length - 1] + (widths.current.get(tab.id) ?? ESTIMATED_WIDTH) + GAP);
    return result;
  }, [tabs, measurement]);
  const previousLayout = useRef({ tabs, offsets });

  const syncViewport = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    setViewport(current => current.left === element.scrollLeft && current.width === element.clientWidth
      ? current : { left: element.scrollLeft, width: element.clientWidth });
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    syncViewport();
    const observer = new ResizeObserver(syncViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [syncViewport]);

  useLayoutEffect(() => {
    const previous = previousLayout.current;
    const element = viewportRef.current;
    let changed = false;
    for (const [id, shell] of shells.current) {
      const width = shell.getBoundingClientRect().width;
      if (width > 0 && widths.current.get(id) !== width) {
        widths.current.set(id, width);
        changed = true;
      }
    }
    // Keep the leading visible pill anchored as estimated widths become known.
    if (windowed && element && previous.tabs === tabs && previous.offsets !== offsets) {
      const anchor = indexAt(previous.offsets, element.scrollLeft);
      element.scrollLeft += offsets[anchor] - previous.offsets[anchor];
      syncViewport();
    }
    previousLayout.current = { tabs, offsets };
    if (changed) setMeasurement(value => value + 1);
  });

  useLayoutEffect(() => {
    const ids = new Set(tabs.map(tab => tab.id));
    for (const id of widths.current.keys()) if (!ids.has(id)) widths.current.delete(id);
  }, [tabs]);

  const reveal = useCallback((id: string) => {
    const element = viewportRef.current;
    const index = tabs.findIndex(tab => tab.id === id);
    if (!element || index < 0) return;
    if (!windowed) {
      const shell = shells.current.get(id);
      if (shell) {
        const viewportRect = element.getBoundingClientRect();
        const rect = shell.getBoundingClientRect();
        if (rect.left < viewportRect.left) element.scrollLeft += rect.left - viewportRect.left;
        else if (rect.right > viewportRect.right) element.scrollLeft += rect.right - viewportRect.right;
      }
    } else {
      const left = offsets[index];
      const right = left + (widths.current.get(id) ?? ESTIMATED_WIDTH);
      if (left < element.scrollLeft) element.scrollLeft = left;
      else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
    }
    syncViewport();
  }, [offsets, syncViewport, tabs, windowed]);

  // Width measurements must not pull a manually scrolled strip back to active.
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useLayoutEffect(() => { if (activeId) revealRef.current(activeId); }, [activeId, viewport.width, windowed]);

  const indices = useMemo(() => {
    if (!windowed) return tabs.map((_, index) => index);
    const first = Math.max(0, indexAt(offsets, viewport.left) - OVERSCAN);
    const last = Math.min(tabs.length, indexAt(offsets, viewport.left + viewport.width) + OVERSCAN + 1);
    const result = new Set(Array.from({ length: last - first }, (_, index) => index + first));
    // Preserve roving focus and the drag source even outside the scroll window.
    for (const id of [activeId, draggingId, focusedId]) {
      const index = tabs.findIndex(tab => tab.id === id);
      if (index >= 0) result.add(index);
    }
    return [...result].sort((a, b) => a - b);
  }, [activeId, draggingId, focusedId, offsets, tabs, viewport, windowed]);

  const onFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    setFocusedId((event.target as HTMLElement).closest<HTMLElement>(".tab-shell")?.dataset.tabId ?? null);
  }, []);
  const onBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocusedId(null);
  }, []);

  const reorderIndex = useCallback((id: string, pointerX: number) => {
    const element = viewportRef.current;
    if (!element || !windowed) return null;
    const rect = element.getBoundingClientRect();
    if (pointerX < rect.left + 28) element.scrollLeft = Math.max(0, element.scrollLeft - 24);
    else if (pointerX > rect.right - 28) element.scrollLeft += 24;
    syncViewport();
    const offset = pointerX - rect.left + element.scrollLeft;
    let insertion = 0;
    for (let index = 0; index < tabs.length; index += 1) {
      if (tabs[index].id === id) continue;
      if (offset < (offsets[index] + offsets[index + 1] - GAP) / 2) break;
      insertion += 1;
    }
    return insertion;
  }, [offsets, syncViewport, tabs, windowed]);

  return { viewportRef, shells, syncViewport, reveal, reorderIndex, windowed, indices, offsets, onFocus, onBlur, viewportWidth: viewport.width,
    totalWidth: Math.max(0, offsets[offsets.length - 1] - GAP) };
}
