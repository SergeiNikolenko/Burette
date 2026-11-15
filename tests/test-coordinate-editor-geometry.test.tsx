import { ensureGeometryViewerFrame } from "./fixtures/geometry-viewer-frame";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act } from "react";

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
for (const [name, value] of Object.entries({
  CSS: window.CSS, window, self: window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement, HTMLFormElement: window.HTMLFormElement, DocumentFragment: window.DocumentFragment,
  MutationObserver: window.MutationObserver, CustomEvent: window.CustomEvent, DOMRect: window.DOMRect, Event: window.Event,
  FocusEvent: window.FocusEvent, KeyboardEvent: window.KeyboardEvent, MouseEvent: window.MouseEvent, PointerEvent: window.PointerEvent,
  navigator: window.navigator, getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (callback: () => void) => window.setTimeout(callback, 0),
  cancelAnimationFrame: (id: number) => window.clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};
window.HTMLElement.prototype.hasPointerCapture = () => true;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { mock, test } = await import("bun:test");
const xyz = "3\nwater\nO 0 0 0\nH 0.9572 0 0\nH -0.24 0.927 0\n";
const writes: string[] = [];
const session = { content: xyz, dirty: false };
// The source controller commits a draft by making it the session's text.
const sourceEditing = await import("../apps/desktop/src/lib/source-editing/context");
mock.module("../apps/desktop/src/lib/source-editing/context", () => ({ ...sourceEditing, useSourceEditing: () => ({
  sessionForDocument: (document: { id: string } | null) => { if (document) ensureGeometryViewerFrame(document); return session; },
  updateDraft: (_document: unknown, text: string) => { session.content = text; writes.push(text); },
}) }));
// The panel reads the scene's own receipt; actual iframe/lease races are covered by test-geometry-binding.
const binding = await import("../apps/desktop/src/lib/geometry-binding");
mock.module("../apps/desktop/src/lib/geometry-binding", () => ({ ...binding,
  readGeometryBinding: async (document: { id: string }, _send: unknown, isCurrent: () => boolean) => ({
    lease: "panel-fixture", text: session.content, target: { documentId: document.id, source: window, isCurrent } }) }));
const { createRoot } = await import("react-dom/client");
const { GeometryPanel } = await import("../apps/desktop/src/components/geometry-panel");

const area = (host: Element) => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Coordinates"]')!;
const button = (host: Element, text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text || item.getAttribute("aria-label") === text)!;
const click = (element: HTMLElement) => act(async () => { element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as MouseEvent); });
const type = (host: Element, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(area(host), value);
  area(host).dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
});
async function until(condition: () => unknown, what: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("Cartesian coordinates of an XYZ source: invalid line, Revert, exact Apply, Undo and refused topology", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const viewer: { type: string; text?: string }[] = [];
  const doc = { id: "water", title: "water.xyz", path: "/water.xyz", extension: "xyz", renderer: "molstar" };
  try {
    await act(async () => root.render(React.createElement(GeometryPanel, {
      document: doc as never, actions: { runStructureViewerAction: async (_doc: unknown, action: { type: string; text?: string }) => { viewer.push(action); } } as never,
    })));
    await until(() => button(host, "Cartesian"), "the Geometry panel");
    await click(button(host, "Cartesian"));
    await until(() => area(host), "the coordinate editor");
    const generated = area(host).value;
    assert.equal(generated, "O      0.000000    0.000000    0.000000\nH      0.957200    0.000000    0.000000\nH     -0.240000    0.927000    0.000000\n");

    await type(host, generated.replace("H      0.957200", "H      0..9"));
    await until(() => host.querySelector('[aria-label="Invalid lines"]')?.textContent === "Line 2 Invalid coordinate.", "the invalid line");
    await click(button(host, "Revert"));
    assert.equal(area(host).value, generated);

    await type(host, generated.replace(/\n$/u, "\nH 1 1 1\n"));
    await click(button(host, "Apply"));
    await until(() => host.textContent?.includes("this structure has 3. Only positions can change here."), "the count refusal");
    assert.equal(writes.length, 0);
    // A unit change keeps an edited draft; Revert shows the structure in the new unit.
    await click(button(host, "Revert"));

    // Bohr input of the moved hydrogen; untouched fields and lines stay exactly as written.
    await click(button(host, "Bohr"));
    await until(() => area(host).value.split("\n")[1] === "H      1.808846    0.000000    0.000000", "the bohr block");
    const bohr = area(host).value.split("\n");
    bohr[1] = "H 2.0 0.0 0.0";
    await type(host, bohr.join("\n"));
    await click(button(host, "Apply"));
    await until(() => writes.length === 1, "the applied coordinates");
    assert.equal(writes[0], `3\nwater\nO 0 0 0\nH ${2 * 0.529177210544} 0 0\nH -0.24 0.927 0\n`);
    assert.equal(viewer.filter(action => action.type === "update_geometry").at(-1)?.text, writes[0], "the scene shows the applied positions");
    await until(() => button(host, "Apply").disabled && area(host).value.split("\n")[1] === "H      2.000000    0.000000    0.000000", "the regenerated block");

    await click(button(host, "Undo"));
    await until(() => writes.length === 2, "undo");
    assert.equal(writes[1], xyz);
    await until(() => area(host).value.split("\n")[1] === "H      1.808846    0.000000    0.000000", "the restored block");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}, 30_000);
