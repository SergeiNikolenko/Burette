import { afterEach } from "bun:test";

// Panel fixtures replace runtime I/O; the host still owns a real iframe target before reading.
const frames = new Set<HTMLIFrameElement>();
export function ensureGeometryViewerFrame(document: { id: string }) {
  const existing = [...frames].find(frame => frame.isConnected && frame.ownerDocument === globalThis.document
    && frame.dataset.documentId === document.id);
  if (existing) return existing;
  const frame = globalThis.document.createElement("iframe");
  frame.className = "viewer-iframe";
  frame.dataset.documentId = document.id;
  frame.dataset.renderer = "molstar";
  globalThis.document.body.append(frame); frames.add(frame);
  return frame;
}
afterEach(() => { for (const frame of frames) frame.remove(); frames.clear(); });
