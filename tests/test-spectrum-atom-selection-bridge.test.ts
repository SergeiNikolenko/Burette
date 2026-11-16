import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { captureViewerActionTarget, requestViewerAction } from "../apps/desktop/src/lib/viewer-bridge";
import { isRetiredGeometryActionResult } from "../apps/desktop/src/lib/geometry-action-status";
const dom = new Window(), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, CSS: dom.CSS, getComputedStyle: dom.getComputedStyle.bind(dom) })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
}
afterAll(async () => { await dom.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
test("source atom ACK keeps its exact frame and retires cancellation before a late reply", async () => {
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = "nmr"; document.body.append(frame);
  const source = frame.contentWindow!, sent: { source: string; body: { type: string; id: string } }[] = []; source.postMessage = value => sent.push(value);
  const target = captureViewerActionTarget("nmr")!, controller = new AbortController();
  const pending = requestViewerAction("nmr", { type: "select_source_atom" }, 2000, controller.signal, { target }).catch(error => error.name);
  controller.abort(); expect(await pending).toBe("AbortError");
  expect(sent[1]).toEqual({ source: "burette-agent-host", body: { type: "agent-action-cancel", id: sent[0].body.id } });
  expect(isRetiredGeometryActionResult(sent[0].body.id, source)).toBe(true);
  const replacement = document.createElement("iframe"); replacement.className = frame.className; replacement.dataset.documentId = "nmr";
  frame.replaceWith(replacement);
  expect(isRetiredGeometryActionResult(sent[0].body.id, replacement.contentWindow!)).toBe(false);
  await expect(requestViewerAction("nmr", { type: "select_source_atom" }, 2000, undefined, { target })).rejects.toThrow("viewer changed");
  replacement.remove();
});


test("source atom deadline cancels its native request before reporting timeout", async () => {
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = "nmr-timeout"; document.body.append(frame);
  const source = frame.contentWindow!, sent: { source: string; body: { type: string; id: string } }[] = []; source.postMessage = value => sent.push(value);
  try {
    await expect(requestViewerAction("nmr-timeout", { type: "select_source_atom" }, 5)).rejects.toThrow("did not respond");
    expect(sent.map(value => value.body.type)).toEqual(["agent-action", "agent-action-cancel"]);
    expect(sent[1].body.id).toBe(sent[0].body.id);
    expect(isRetiredGeometryActionResult(sent[0].body.id, source)).toBe(true);
  } finally { frame.remove(); }
});
