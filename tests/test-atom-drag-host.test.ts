import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { parseAtomDragMessage, setAtomDragMode, subscribeAtomDrag } from "../apps/desktop/src/lib/atom-drag";
import type { GeometryBinding } from "../apps/desktop/src/lib/geometry-binding";
import type { ViewerDocument } from "../apps/desktop/src/types";

const dom = new Window({ url: "http://localhost/" }), previous = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
afterAll(async () => {
  await dom.happyDOM.close();
  if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
});

const frame = new Window(), other = new Window();
let current = true;
const document = { id: "doc-1" } as ViewerDocument;
const binding: GeometryBinding = { lease: "lease-1", text: "1\n\nH 0 0 0\n",
  target: { documentId: "doc-1", source: frame as unknown as globalThis.Window, isCurrent: () => current } };
const body = { type: "atom-drag", phase: "move", lease: "lease-1", atoms: [2, 5], positions: [[0, 1, 2], [-1.5, 0, 3]], documentId: "runtime-id" };

test("drag mode is an acknowledged action on the binding's own frame", async () => {
  const calls: unknown[] = [], signal = new AbortController().signal;
  await setAtomDragMode(document, binding, true, async (...args) => { calls.push(args); }, signal);
  expect(calls).toEqual([[document, { type: "atom_drag", enabled: true, lease: "lease-1", label: "Atom drag", notify: false },
    { target: binding.target, signal }]]);
  await expect(setAtomDragMode({ id: "doc-2" } as ViewerDocument, binding, false, async () => {})).rejects.toThrow(/another document/);
});

test("only valid gestures from the bound frame and lease arrive", () => {
  const received: unknown[] = [];
  const unsubscribe = subscribeAtomDrag(document, binding, event => received.push(event));
  const send = (data: unknown, source: unknown = frame) => dom.dispatchEvent(new dom.MessageEvent("message", { data, source: source as never }));
  send({ source: "burette-viewer", body });
  send({ source: "burette-viewer", body }, other);
  send({ source: "burette-viewer", body: { ...body, lease: "lease-0" } });
  send({ source: "burette-viewer", body: { ...body, phase: "drop" } });
  send({ source: "burette-viewer", body: { ...body, positions: [[0, 1, 2]] } });
  send({ source: "burette-viewer", body: { ...body, atoms: [2, -1] } });
  send({ source: "burette-grid", body });
  current = false; send({ source: "burette-viewer", body }); current = true;
  unsubscribe();
  send({ source: "burette-viewer", body });
  expect(received).toEqual([{ phase: "move", lease: "lease-1", atoms: [2, 5], positions: [[0, 1, 2], [-1.5, 0, 3]] }]);
});

test("payload validation rejects non-finite coordinates", () => {
  expect(parseAtomDragMessage({ source: "burette-viewer", body: { ...body, positions: [[0, 1, 2], [0, Number.NaN, 0]] } }, "lease-1")).toBeNull();
});
