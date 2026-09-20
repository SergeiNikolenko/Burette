import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act } from "react";

const window = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};
const { createRoot } = await import("react-dom/client");
const { GridFilterNumberInput } = await import("../apps/desktop/src/components/grid-filter-number-input.tsx");
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const commits = [];
const render = (value = "") => act(() => root.render(React.createElement(GridFilterNumberInput, {
  value, fallback: 1, step: 1, label: "Minimum CSV row", placeholder: "1", onCommit: (next) => commits.push(next),
})));
await render();
const input = host.querySelector("input");
const type = async (value) => act(() => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
});
await act(() => input.focus());
await type("2");
await render("7"); // A runtime model update must not replace an active edit.
assert.equal(input.value, "2");
await type("20");
assert.deepEqual(commits, []);
await act(() => input.blur());
assert.deepEqual(commits, ["20"]);
await render("20");
await act(() => input.focus());
await type("");
await act(() => input.blur());
assert.deepEqual(commits, ["20", ""]);
await render("20");
await act(() => input.focus());
await type("-");
await act(() => input.blur());
assert.deepEqual(commits, ["20", ""]);
const edge = host.querySelector("button");
const pointer = (type, x) => act(() => edge.dispatchEvent(new window.PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x })));
await pointer("pointerdown", 100);
await pointer("pointermove", 120);
assert.equal(input.value, "25");
assert.equal(commits.length, 2);
await pointer("pointerup", 120);
assert.deepEqual(commits, ["20", "", "25"]);
await pointer("pointerdown", 100);
await pointer("pointermove", 140);
await pointer("pointercancel", 140);
assert.equal(commits.length, 3);
await act(() => root.unmount());
console.log("Grid filter draft, model refresh, clearing, invalid input, drag commit and cancellation passed.");
