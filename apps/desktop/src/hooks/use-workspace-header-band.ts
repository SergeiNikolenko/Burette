import { useEffect, type RefObject } from "react";

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
      const corner = doc?.getElementById("buret-viewport-corner")?.getBoundingClientRect();
      root.style.setProperty("--band-leading", `${Math.max(10, Math.ceil(frameRect.left - rootRect.left + (corner?.right ?? 0) + 8))}px`);
      // The toolbar's right edge follows the slot, whose width follows the
      // toolbar. The slot ends before the trailing pills, or before the
      // viewer's own edge when the right dock takes that part of the row;
      // neither bound depends on the slot, so nothing feeds back.
      let trailing = slot.nextElementSibling;
      while (trailing && trailing.getBoundingClientRect().width === 0) trailing = trailing.nextElementSibling;
      const trailingLeft = trailing?.getBoundingClientRect().left ?? frameRect.right;
      const slotEnd = Math.min(trailingLeft - 8, frameRect.right - 12);
      const slotRight = slotEnd;
      // Fixed navigation/annotation pills cannot give up their space. Bound
      // the viewer's scrollable toolbar before measuring its resulting width.
      const pathStart = root.querySelector(".workspace-file-path")?.previousElementSibling?.getBoundingClientRect().right ?? frameRect.left;
      const available = Math.max(0, Math.floor(slotEnd - pathStart - 8));
      // A narrow viewer needs a second row to keep Seq/Style readable.
      // Navigation keeps the first row, including when a dock is open.
      const stacked = available < 160;
      root.style.setProperty("--band-slot-margin", `${stacked ? 0 : Math.max(0, Math.round(trailingLeft - 8 - slotEnd))}px`);
      viewer.style.setProperty("--burette-header-band-height", stacked ? "100px" : "50px");
      viewer.style.setProperty("--burette-header-band-toolbar-top", stacked ? "58px" : "8px");
      viewer.style.setProperty("--burette-header-band-right", stacked ? "12px" : `${Math.max(12, Math.round(frameRect.right - slotRight))}px`);
      viewer.style.setProperty("--burette-header-band-width", `${stacked ? Math.max(0, Math.floor(frameRect.width - 24)) : available}px`);
      const toolbar = doc?.getElementById("buret-toolbar")?.getBoundingClientRect();
      root.style.setProperty("--band-controls", `${stacked ? 0 : Math.ceil(toolbar?.width ?? 0)}px`);
      // A path squeezed below a readable width is dropped rather than shown as a stub.
      root.toggleAttribute("data-band-compact", stacked || slotEnd - (toolbar?.width ?? 0) - pathStart - 16 < 120);
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
      root.style.removeProperty("--band-controls");
      root.style.removeProperty("--band-leading");
      root.style.removeProperty("--band-slot-margin");
      root.removeAttribute("data-band-compact");
    };
  }, [header, documentId]);
}
