import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { requestViewerAction } from "../apps/desktop/src/lib/viewer-bridge";

const dom = new Window(), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, CSS: dom.CSS, getComputedStyle: dom.getComputedStyle.bind(dom) })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
}
afterAll(async () => { await dom.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });

function scene(documentId: string) {
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = documentId; document.body.append(frame);
  const sent: { source: string; body: { type: string; id: string } }[] = [];
  frame.contentWindow!.postMessage = value => sent.push(value);
  return { frame, sent };
}
const movie = { type: "record_movie", seconds: 60, fps: 60, spin: true };

test("a dismissed recording is cancelled in the viewer, which is still turning the camera", async () => {
  const { frame, sent } = scene("movie");
  try {
    const controller = new AbortController();
    const pending = requestViewerAction("movie", movie, 60_000, controller.signal).catch(error => error.name);
    controller.abort();
    expect(await pending).toBe("AbortError");
    expect(sent.map(value => value.body.type)).toEqual(["agent-action", "agent-action-cancel"]);
    expect(sent[1].body.id).toBe(sent[0].body.id);
  } finally { frame.remove(); }
});

test("a recording that outlives its deadline is cancelled too", async () => {
  const { frame, sent } = scene("movie-timeout");
  try {
    await expect(requestViewerAction("movie-timeout", movie, 5)).rejects.toThrow("did not respond");
    expect(sent.map(value => value.body.type)).toEqual(["agent-action", "agent-action-cancel"]);
  } finally { frame.remove(); }
});
