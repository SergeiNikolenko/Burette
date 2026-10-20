import { useEffect, useRef, useState, type ComponentType } from "react";
import { createPreviewScheduler } from "./library-preview-scheduler";
import "./library-preview.css";

type PreviewProps = {
  struct: unknown; options?: Record<string, unknown>; update?: unknown;
  className?: string; fullsize?: boolean; testId?: string;
};
const scheduler = createPreviewScheduler(callback => requestAnimationFrame(callback), id => cancelAnimationFrame(id));
const observers = new Map<Element | null, {
  observer: IntersectionObserver; callbacks: Map<Element, (visible: boolean) => void>;
}>();

function observePreview(element: Element, callback: (visible: boolean) => void) {
  const root = element.closest('[class*="template-lib-module_tabsContent"]');
  let group = observers.get(root);
  if (!group) {
    const callbacks = new Map<Element, (visible: boolean) => void>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
    }, { root, rootMargin: "80px 0px" });
    group = { observer, callbacks };
    observers.set(root, group);
  }
  group.callbacks.set(element, callback);
  group.observer.observe(element);
  return () => {
    group.callbacks.delete(element);
    group.observer.unobserve(element);
    if (!group.callbacks.size) { group.observer.disconnect(); observers.delete(root); }
  };
}

function sameOptions(a: PreviewProps["options"], b: PreviewProps["options"]) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.is(a[key], b[key]));
}

// Keep every library item, label, selection and export. Only its expensive
// stock chemistry leaf is mounted near the library's own scroll viewport.
export function KetcherLibraryPreview({ renderer: Renderer, className, options, struct, update, ...props }:
  PreviewProps & { renderer: ComponentType<PreviewProps> }) {
  const ref = useRef<HTMLDivElement>(null);
  const stableOptions = useRef(options);
  if (!sameOptions(stableOptions.current, options)) stableOptions.current = options;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setVisible(false);
    const show = (near: boolean) => {
      if (near) scheduler.schedule(element, () => setVisible(true));
      else { scheduler.cancel(element); setVisible(false); }
    };
    const stop = typeof IntersectionObserver === "undefined" ? (show(true), () => {}) : observePreview(element, show);
    return () => { stop(); scheduler.cancel(element); };
  }, [struct, update]);
  return <div ref={ref} className={`ketcher-library-preview ${className ?? ""}`} data-preview-mounted={visible}>
    {visible ? <Renderer {...props} struct={struct} update={update} options={stableOptions.current} className="ketcher-library-preview-content" /> : null}
  </div>;
}
