import { useEffect, type RefObject } from "react";

// Codex viewer header geometry: 32px controls 8px inside a 48px band, 6px apart.
const INSET = 8;
const GAP = 6;

// In the native Codex widget the file header and the Mol* viewer's own top
// controls share one row. The viewer keeps a band free at its top edge
// (html[data-burette-header-band] in viewer-runtime.css) and the header floats
// over it; each side is told how much of the row the other one occupies.
export function useWorkspaceHeaderBand(header: RefObject<HTMLElement | null>, documentId: string | null) {
  useEffect(() => {
    const root = header.current;
    if (!root || !documentId) return;
    const frame = document.querySelector<HTMLIFrameElement>(`iframe.viewer-iframe[data-document-id="${CSS.escape(documentId)}"]`);
    if (!frame) return;
    let viewerObserver: ResizeObserver | undefined;
    let scheduled = 0;
    let retry = 0;
    const measure = () => {
      scheduled = 0;
      const viewer = frame.contentDocument?.documentElement;
      const slot = root.querySelector(".workspace-file-band-slot");
      if (!viewer || !slot) return;
      viewer.dataset.buretteHeaderBand = "";
      const frameRect = frame.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const doc = frame.contentDocument;
      const navigationWidth = root.querySelector(".workspace-file-navigation")?.getBoundingClientRect().width ?? 0;
      const cornerLeft = Math.max(INSET, rootRect.left + INSET + (navigationWidth ? navigationWidth + GAP : 0) - frameRect.left);
      viewer.style.setProperty("--burette-header-band-corner-left", `${cornerLeft}px`);
      const corner = doc?.getElementById("buret-viewport-corner")?.getBoundingClientRect();
      const leading = Math.max(INSET, Math.ceil(frameRect.left - rootRect.left + (corner?.right ?? 0) + GAP));
      root.style.setProperty("--band-leading", `${leading}px`);
      // The toolbar's right edge follows the slot, whose width follows the
      // toolbar. The slot ends before the trailing pills, or before the
      // viewer's own edge when the right dock takes that part of the row;
      // neither bound depends on the slot, so nothing feeds back.
      let trailing = slot.nextElementSibling;
      while (trailing && trailing.getBoundingClientRect().width === 0) trailing = trailing.nextElementSibling;
      const trailingLeft = trailing?.getBoundingClientRect().left ?? frameRect.right;
      const slotEnd = Math.min(trailingLeft - GAP, frameRect.right - INSET);
      // The file title gives way; the annotation toggle keeps its width.
      // Bound the viewer's scrollable toolbar before measuring its resulting width.
      const annotateWidth = root.querySelector(".annotate-toggle")?.getBoundingClientRect().width ?? 0;
      const fixedEnd = rootRect.left + leading + annotateWidth;
      const available = Math.max(0, Math.floor(slotEnd - fixedEnd - GAP));
      // A narrow viewer needs a second row to keep Seq/Style readable.
      // Navigation keeps the first row, including when a dock is open.
      const stacked = available < 160;
      root.style.setProperty("--band-slot-margin", `${stacked ? 0 : Math.max(0, Math.round(trailingLeft - GAP - slotEnd))}px`);
      viewer.style.setProperty("--burette-header-band-height", stacked ? "88px" : "48px");
      viewer.style.setProperty("--burette-header-band-toolbar-top", stacked ? "48px" : `${INSET}px`);
      viewer.style.setProperty("--burette-header-band-right", `${stacked ? INSET : Math.max(INSET, Math.round(frameRect.right - slotEnd))}px`);
      viewer.style.setProperty("--burette-header-band-width", `${stacked ? Math.max(0, Math.floor(frameRect.width - 2 * INSET)) : available}px`);
      const toolbar = doc?.getElementById("buret-toolbar")?.getBoundingClientRect();
      root.style.setProperty("--band-controls", `${stacked ? 0 : Math.ceil(toolbar?.width ?? 0)}px`);
      // A title squeezed below a readable width is dropped rather than shown as a stub.
      const titleSpace = slotEnd - fixedEnd - 2 * GAP - (stacked ? 0 : toolbar?.width ?? 0);
      root.toggleAttribute("data-band-compact", titleSpace < 120);
    };
    const schedule = () => { scheduled ||= requestAnimationFrame(measure); };
    const attach = () => {
      // A frame load can arrive while a retry is pending; keep a single chain.
      clearTimeout(retry);
      viewerObserver?.disconnect();
      const view = frame.contentWindow as (Window & typeof globalThis) | null;
      const doc = frame.contentDocument;
      if (!view?.ResizeObserver || !doc) return;
      viewerObserver = new view.ResizeObserver(schedule);
      for (const id of ["buret-toolbar", "buret-viewport-corner"]) {
        const element = doc.getElementById(id);
        if (element) viewerObserver.observe(element);
      }
      // The toolbar and corner mount after the runtime scripts finish loading.
      if (!doc.getElementById("buret-toolbar")) retry = window.setTimeout(attach, 250);
      schedule();
    };
    const hostObserver = new ResizeObserver(schedule);
    hostObserver.observe(root);
    hostObserver.observe(frame);
    frame.addEventListener("load", attach);
    attach();
    return () => {
      cancelAnimationFrame(scheduled);
      clearTimeout(retry);
      hostObserver.disconnect();
      viewerObserver?.disconnect();
      frame.removeEventListener("load", attach);
      delete frame.contentDocument?.documentElement.dataset.buretteHeaderBand;
      frame.contentDocument?.documentElement.style.removeProperty("--burette-header-band-right");
      frame.contentDocument?.documentElement.style.removeProperty("--burette-header-band-width");
      frame.contentDocument?.documentElement.style.removeProperty("--burette-header-band-height");
      frame.contentDocument?.documentElement.style.removeProperty("--burette-header-band-toolbar-top");
      frame.contentDocument?.documentElement.style.removeProperty("--burette-header-band-corner-left");
      root.style.removeProperty("--band-controls");
      root.style.removeProperty("--band-leading");
      root.style.removeProperty("--band-slot-margin");
      root.removeAttribute("data-band-compact");
    };
  }, [header, documentId]);
}
