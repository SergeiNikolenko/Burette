import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../lib/tauri";

// Last on-screen image of each tab, shown by the tab hover preview. Hidden
// tabs cannot be drawn, so the active page is captured while it is visible.
const thumbnails = new Map<string, string>();
const listeners = new Set<() => void>();
let capturing = false;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTabThumbnail(tabId: string | null) {
  return useSyncExternalStore(subscribe, () => (tabId ? thumbnails.get(tabId) ?? null : null));
}

export function pruneTabThumbnails(openTabIds: ReadonlySet<string>) {
  let changed = false;
  for (const tabId of thumbnails.keys()) {
    if (openTabIds.has(tabId)) continue;
    thumbnails.delete(tabId);
    changed = true;
  }
  if (changed) notify();
}

export async function captureTabThumbnail(tabId: string) {
  if (capturing || document.visibilityState !== "visible") return;
  const page = document.querySelector<HTMLElement>(".page-surface[data-active]");
  const rect = page?.getBoundingClientRect();
  if (!page || !rect || rect.width < 1 || rect.height < 1) return;
  capturing = true;
  try {
    const image = isTauriRuntime()
      ? await invoke<string | null>("capture_tab_thumbnail", {
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      })
      : await composeFrameThumbnail(page, rect);
    if (!image) return;
    thumbnails.set(tabId, image);
    notify();
  } catch {
    // A missed capture keeps the previous image.
  } finally {
    capturing = false;
  }
}

// Browser runtimes render viewers in same-origin srcdoc frames, so the page can
// be redrawn from the frame's own pixels: WebGL canvases (Mol* keeps its drawing
// buffer), images, and the inline SVG drawings of grid cards and Ketcher.
const THUMBNAIL_WIDTH_PX = 640;
const MAX_FRAME_SVGS = 48;

async function composeFrameThumbnail(page: HTMLElement, pageRect: DOMRect) {
  const frame = page.querySelector<HTMLIFrameElement>("iframe.viewer-iframe, iframe");
  let frameDocument: Document | null = null;
  try {
    frameDocument = frame?.contentDocument ?? null;
  } catch {
    return null;
  }
  if (!frame || !frameDocument) return null;
  const frameRect = frame.getBoundingClientRect();
  const scale = THUMBNAIL_WIDTH_PX / pageRect.width;
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_WIDTH_PX;
  canvas.height = Math.round(pageRect.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  const backgrounds: Element[] = [frameDocument.body, frameDocument.documentElement];
  for (let element: Element | null = page; element; element = element.parentElement) backgrounds.push(element);
  context.fillStyle = backgrounds
    .map((element) => (element.ownerDocument.defaultView ?? window).getComputedStyle(element).backgroundColor)
    .find((color) => color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) ?? "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);

  const offsetX = frameRect.left - pageRect.left;
  const offsetY = frameRect.top - pageRect.top;
  let drawn = 0;
  const place = (element: Element) => {
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2 || box.bottom < 0 || box.top > frameRect.height) return null;
    return { x: offsetX + box.left, y: offsetY + box.top, width: box.width, height: box.height };
  };

  for (const source of frameDocument.querySelectorAll("canvas")) {
    const box = place(source);
    if (!box) continue;
    try {
      context.drawImage(source, box.x, box.y, box.width, box.height);
      drawn += 1;
    } catch {
      // A tainted canvas is skipped.
    }
  }
  const pictures = [
    ...Array.from(frameDocument.querySelectorAll("img")).filter((image) => image.complete && image.naturalWidth > 0),
    ...Array.from(frameDocument.querySelectorAll("svg")).filter((svg) => !svg.parentElement?.closest("svg")).slice(0, MAX_FRAME_SVGS),
  ];
  await Promise.all(pictures.map(async (source) => {
    const box = place(source);
    if (!box || box.width < 24 || box.height < 24) return;
    const image = source instanceof HTMLImageElement ? source : await svgImage(source as SVGSVGElement, box);
    if (!image) return;
    try {
      context.drawImage(image, box.x, box.y, box.width, box.height);
      drawn += 1;
    } catch {
      // Cross-origin images taint nothing here but may still refuse to draw.
    }
  }));
  if (drawn === 0) return null;
  try {
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

function svgImage(svg: SVGSVGElement, box: { width: number; height: number }) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!copy.getAttribute("width")) copy.setAttribute("width", String(box.width));
  if (!copy.getAttribute("height")) copy.setAttribute("height", String(box.height));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
