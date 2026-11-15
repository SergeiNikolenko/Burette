import { afterAll, expect, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { useAtomMove } from "../apps/desktop/src/components/workbench/structure-edit/move-tool";
import type { GeometryBinding } from "../apps/desktop/src/lib/geometry-binding";
import type { ViewerDocument } from "../apps/desktop/src/types";

const dom = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, CSS: dom.CSS, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
}
afterAll(async () => { await dom.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });

const doc = { id: "move-renewal", renderer: "molstar" } as ViewerDocument;
const scene = () => {
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = doc.id; frame.dataset.renderer = "molstar";
  document.body.append(frame);
  return frame;
};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("the Move tool asks for a new binding when the scene moves to another frame, also after a failed read", async () => {
  let stale = 0;
  function Tool({ binding }: { binding: GeometryBinding | null }) {
    useAtomMove(doc, binding, async () => ({}), () => {}, () => {}, () => { stale++; }, true);
    return null;
  }
  const first = scene(), host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    // An edit that changes the atom count leaves no binding: the old frame's scene no longer matches the draft.
    await act(async () => { root.render(<Tool binding={null} />); });
    await pause(500);
    expect(stale).toBe(0);
    // The draft's new scene replaces the old frame.
    first.remove();
    const second = scene();
    await pause(900);
    expect(stale).toBe(1);
    second.remove();
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});
