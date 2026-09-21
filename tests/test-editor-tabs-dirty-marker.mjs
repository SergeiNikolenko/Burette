import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorTabs } from "../apps/desktop/src/components/editor-area/editor-tabs.tsx";
const documents = ["a", "b"].map(id => ({ id, path: `/${id}.sdf`, title: `${id}.sdf`, renderer: "grid2d" }));
const state = {
  documents, textDocuments: [], sidebarProjects: [], activeTabId: "tab-a", activeDocument: documents[0],
  tabs: documents.map(document => ({ id: `tab-${document.id}`, location: { kind: "file", documentId: document.id, path: document.path }, back: [], forward: [] })),
  dirtyGridDocuments: new Set(["a", "b"]),
};
const actions = new Proxy({}, { get: () => () => {} });
const render = () => renderToStaticMarkup(React.createElement(EditorTabs, { state, actions }));
let html = render();
assert.match(html, /aria-label="a.sdf, Unsaved changes"/);
assert.match(html, /aria-label="b.sdf, Unsaved changes"/);
assert.equal((html.match(/data-slot="badge"/g) ?? []).length, 2);
state.dirtyGridDocuments.delete("a");
html = render();
assert.doesNotMatch(html, /aria-label="a.sdf, Unsaved changes"/);
assert.match(html, /aria-label="b.sdf, Unsaved changes"/);
assert.equal((html.match(/data-slot="badge"/g) ?? []).length, 1);
console.log("Editor tab dirty-marker render checks passed.");

// Exercise the actual tab component with native-host pointer events. Layout and
// pointer capture are provided by the DOM harness; real iframe drag QA is separate.
const { Window } = await import("happy-dom");
const dom = new Window({ url: "http://localhost/" });
let frameId = 0;
const frames = new Map();
for (const [name, value] of Object.entries({
  window: dom, document: dom.document, navigator: dom.navigator,
  Element: dom.Element, HTMLElement: dom.HTMLElement, Node: dom.Node,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
  cancelAnimationFrame: id => frames.delete(id),
  ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
})) Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
window.BuretteMcpWorkspace = {};
const captured = new WeakMap();
dom.HTMLElement.prototype.setPointerCapture = function(id) { captured.set(this, id); };
dom.HTMLElement.prototype.hasPointerCapture = function(id) { return captured.get(this) === id; };
dom.HTMLElement.prototype.releasePointerCapture = function() { captured.delete(this); };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { act } = React;
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const moves = [];
const selects = [];
state.tabs.push({ id: "tab-c", location: { kind: "ketcher" }, back: [], forward: [] });
const pointerActions = {
  ...actions,
  moveTab(id, index) {
    const tab = state.tabs.find(tab => tab.id === id);
    state.tabs = state.tabs.filter(tab => tab.id !== id);
    state.tabs.splice(index, 0, tab);
    moves.push([id, index]);
    renderLive();
  },
  selectTab: id => selects.push(id),
};
const renderLive = () => root.render(React.createElement(EditorTabs, { state, actions: pointerActions }));
await act(renderLive);
const strip = host.querySelector(".tab-scroll-region");
strip.getBoundingClientRect = () => ({ left: 0, right: 260 });
for (const shell of host.querySelectorAll(".tab-shell")) {
  shell.getBoundingClientRect = () => {
    const index = [...strip.querySelectorAll(".tab-shell")].indexOf(shell);
    return { left: index * 100, right: (index + 1) * 100, top: 0, bottom: 30, width: 100 };
  };
}
const button = host.querySelector('[role="tab"]');
assert.equal(button.getAttribute("draggable"), "false", "native tabs must not hand pointer drag to the OS");
const pointer = async (type, x, extras = {}) => act(() => button.dispatchEvent(new dom.PointerEvent(type, {
  bubbles: true, cancelable: true, button: 0, buttons: 1,
  pointerId: 1, isPrimary: true, clientX: x, clientY: 15, ...extras,
})));
const tick = async () => act(() => { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn()); });
await pointer("pointerdown", 50);
await pointer("pointermove", 54);
await pointer("pointerup", 54);
await act(() => button.click());
assert.deepEqual(selects, ["tab-a"]);
assert.deepEqual(moves, [], "small pointer movement remains a normal click");
await pointer("pointerdown", 50);
await pointer("pointermove", 275);
assert.equal(strip.hasPointerCapture(1), true, "capture belongs to the stable strip, not the moving tab");
await tick();
assert.deepEqual(state.tabs.map(tab => tab.id), ["tab-b", "tab-c", "tab-a"]);
assert.equal(strip.scrollLeft > 0, true, "drag at the strip edge scrolls overflow");
await pointer("pointerup", 275);
await act(() => button.click());
assert.deepEqual(selects, ["tab-a"], "drop must not activate a different document");
assert.equal(button.hasPointerCapture(1), false);
assert.equal(frames.size, 0);
await pointer("pointerdown", 275);
await pointer("pointermove", 15);
await tick();
assert.deepEqual(state.tabs.map(tab => tab.id), ["tab-a", "tab-b", "tab-c"]);
await pointer("pointercancel", 15);
assert.equal(host.querySelector('[data-dragging="true"]'), null);
assert.equal(frames.size, 0);
await pointer("pointerdown", 50);
await pointer("pointermove", 270, { pointerId: 2 });
await tick();
assert.equal(host.querySelector('[data-dragging="true"]'), null, "other pointers cannot reorder tabs");
await pointer("pointermove", 270);
await tick();
await act(() => window.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape" })));
assert.equal(frames.size, 0);
await pointer("pointerdown", 270);
await pointer("pointermove", 15);
await tick();
await act(() => root.unmount());
assert.equal(frames.size, 0, "host teardown cancels pending drag frames");
await dom.happyDOM.close();
console.log("Native tab pointer reorder, click isolation, overflow and cancellation checks passed.");
