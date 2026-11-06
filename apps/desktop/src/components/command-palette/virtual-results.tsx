import { useId, useLayoutEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Command as CommandPrimitive } from "cmdk";

export function PaletteResultItem({ id, index, count, virtual, children, ...props }: {
  id: string; index: number; count: number; virtual: boolean; children: ReactNode; value: string; title: string; onSelect: () => void;
}) {
  return <CommandPrimitive.Item {...props} forceMount={virtual} asChild
    style={virtual ? { contentVisibility: "visible" } : undefined}
    className="relative gap-2 outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4">
    <div id={id} data-slot="command-item" aria-posinset={index + 1} aria-setsize={count}>{children}</div>
  </CommandPrimitive.Item>;
}

const OVERSCAN = 4;
const INITIAL_ROW_HEIGHT = 31;

export function useVirtualResults<T extends { id: string }>({ items, query, selectedValue, select, run, listRef }: {
  items: T[];
  query: string;
  selectedValue: string;
  select: (value: string) => void;
  run: (item: T) => void;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const enabled = Boolean(query.trim()) && items.length > 100;
  const id = useId();
  const [viewport, setViewport] = useState({ top: 0, height: 440, rowHeight: INITIAL_ROW_HEIGHT });
  const selectedIndex = Math.max(0, items.findIndex(item => item.id === selectedValue));
  const itemId = (index: number) => `${id}-result-${index}`;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) return;
    const measure = () => {
      const row = list.querySelector<HTMLElement>("[cmdk-item]");
      const next = { top: list.scrollTop, height: list.clientHeight || 440, rowHeight: row?.offsetHeight || INITIAL_ROW_HEIGHT };
      setViewport(previous => previous.top === next.top && previous.height === next.height && previous.rowHeight === next.rowHeight ? previous : next);
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => { list.removeEventListener("scroll", measure); observer.disconnect(); };
  }, [enabled, listRef]);

  useLayoutEffect(() => {
    if (!enabled || !listRef.current) return;
    const list = listRef.current;
    const heading = list.querySelector<HTMLElement>("[cmdk-group-heading]");
    const top = selectedIndex * viewport.rowHeight + (heading?.offsetHeight ?? 0) + 4;
    const bottom = top + viewport.rowHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + viewport.height) list.scrollTop = bottom - viewport.height;
    setViewport(previous => previous.top === list.scrollTop ? previous : { ...previous, top: list.scrollTop });
  }, [enabled, selectedIndex, query, viewport.height, viewport.rowHeight, listRef]);

  const start = Math.max(0, Math.floor(viewport.top / viewport.rowHeight) - OVERSCAN);
  const end = Math.min(items.length, Math.ceil((viewport.top + viewport.height) / viewport.rowHeight) + OVERSCAN);
  // Keep the selected option mounted when the user scrolls away from it.
  const indices = [...new Set([...Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index), selectedIndex])].sort((a, b) => a - b);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!enabled || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const page = Math.max(1, Math.floor(viewport.height / viewport.rowHeight));
    let index = selectedIndex;
    switch (event.key) {
      case "ArrowDown": index = event.metaKey ? items.length - 1 : index + 1; break;
      case "ArrowUp": index = event.metaKey ? 0 : index - 1; break;
      case "Home": index = 0; break;
      case "End": index = items.length - 1; break;
      case "PageDown": index += page; break;
      case "PageUp": index -= page; break;
      case "n": case "j": if (!event.ctrlKey) return; index++; break;
      case "p": case "k": if (!event.ctrlKey) return; index--; break;
      case "Enter": event.preventDefault(); run(items[selectedIndex]); return;
      default: return;
    }
    event.preventDefault();
    select(items[Math.max(0, Math.min(items.length - 1, index))].id);
  };
  return { enabled, indices, itemId, activeId: itemId(selectedIndex), rowHeight: viewport.rowHeight, onKeyDown };
}

export function VirtualResults({ count, rowHeight, indices, renderItem }: {
  count: number; rowHeight: number; indices: number[]; renderItem: (index: number) => ReactNode;
}) {
  return <div data-virtual-command-results style={{ position: "relative", height: count * rowHeight }}>
    {indices.map(index => <div key={index} style={{ position: "absolute", top: index * rowHeight, left: 0, right: 0 }}>{renderItem(index)}</div>)}
  </div>;
}
