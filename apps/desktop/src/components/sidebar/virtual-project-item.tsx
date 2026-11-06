import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { SidebarProjectItem } from "../../lib/sidebar-projects";
import { rendererLabel } from "../format";

// Keep lightweight row anchors for the sidebar's DOM-based keyboard navigation
// and Shift selection. Only the viewport and overscan mount file controls.
const observers = new WeakMap<Element, {
  observer: IntersectionObserver;
  rows: Map<Element, (visible: boolean) => void>;
}>();

export function VirtualProjectItem({ item, selected, retainMounted, children }: {
  item: SidebarProjectItem;
  selected: boolean;
  retainMounted: boolean;
  children: () => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [focused, setFocused] = useState(false);
  const wasMounted = useRef(false);
  const focusRequested = useRef(false);
  const pendingKey = useRef<KeyboardEvent | null>(null);
  // Unmounting a file row cleans up its drag hook. Retain the currently
  // mounted rows until the shared drag ends so another row cannot cancel it.
  const mounted = visible || focused || (retainMounted && wasMounted.current);
  useLayoutEffect(() => { wasMounted.current = mounted; });

  useLayoutEffect(() => {
    const row = ref.current;
    const root = row?.closest(".sidebar-scroll");
    if (!row || !root || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    let shared = observers.get(root);
    if (!shared) {
      const rows = new Map<Element, (visible: boolean) => void>();
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) rows.get(entry.target)?.(entry.isIntersecting);
      }, { root, rootMargin: "240px 0px" });
      shared = { observer, rows };
      observers.set(root, shared);
    }
    shared.rows.set(row, setVisible);
    shared.observer.observe(row);
    return () => {
      shared.rows.delete(row);
      shared.observer.unobserve(row);
      if (!shared.rows.size) {
        shared.observer.disconnect();
        observers.delete(root);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!mounted || !focusRequested.current) return;
    const row = ref.current?.querySelector<HTMLElement>('[data-sidebar-structure-path]');
    if (!row) return;
    focusRequested.current = false;
    row.focus({ preventScroll: true });
    const key = pendingKey.current;
    pendingKey.current = null;
    if (key) row.dispatchEvent(new KeyboardEvent("keydown", {
      key: key.key, code: key.code, bubbles: true, cancelable: true,
      shiftKey: key.shiftKey, ctrlKey: key.ctrlKey, metaKey: key.metaKey, altKey: key.altKey,
    }));
  }, [mounted]);

  return <div ref={ref} data-sidebar-virtual-item={item.path}
    className={mounted ? undefined : "project nested-project"}
    role={mounted ? undefined : "treeitem"}
    tabIndex={mounted ? undefined : 0}
    aria-selected={mounted ? undefined : selected}
    aria-label={mounted ? undefined : `${item.relativePath}, ${rendererLabel(item.renderer)}${item.isPinned ? ", pinned" : ""}`}
    data-sidebar-structure-path={mounted ? undefined : item.path}
    data-sidebar-structure-renderer={mounted ? undefined : item.renderer}
    data-sidebar-structure-document-id={mounted ? undefined : item.documentId ?? undefined}
    onFocus={event => {
      if (event.target === event.currentTarget) focusRequested.current = true;
      setFocused(true);
    }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    }}
    onKeyDownCapture={event => {
      if (mounted || event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      pendingKey.current = event.nativeEvent;
      focusRequested.current = true;
      setFocused(true);
    }}
  >{mounted ? children() : null}</div>;
}
