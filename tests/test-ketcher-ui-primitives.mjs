#!/usr/bin/env bun
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act, useState } from "react";

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({
  matches: false,
  media: "(prefers-reduced-motion: reduce)",
  addEventListener() {},
  removeEventListener() {},
});

for (const [name, value] of Object.entries({
  window,
  self: window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  MutationObserver: window.MutationObserver,
  NodeFilter: window.NodeFilter,
  DocumentFragment: window.DocumentFragment,
  CustomEvent: window.CustomEvent,
  DOMRect: window.DOMRect,
  Event: window.Event,
  FocusEvent: window.FocusEvent,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  navigator: window.navigator,
  requestAnimationFrame: (callback) => window.setTimeout(callback, 0),
  cancelAnimationFrame: (id) => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}

window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};
window.HTMLElement.prototype.hasPointerCapture = () => true;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { KetcherGenericInput, KetcherButton, KetcherSelect, KetcherSwitch, KetcherDialog, KetcherSettingsAccordion } = await import("../apps/desktop/src/components/ketcher/primitives.tsx");
const { KetcherNaturalAnaloguePicker } = await import("../apps/desktop/src/components/ketcher/natural-analogue.tsx");
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const changes = [];
const options = [{ value: true, label: "On" }, { value: "paste", label: "After Paste" }, { value: false, label: "Off" }, { value: "", label: "Unspecified" }];
function Harness({ initial }) {
  const [value, setValue] = useState(initial);
  return React.createElement("form", null, React.createElement(KetcherSelect, {
    options, value, name: "resetToSelect", onChange(next) { changes.push(next); setValue(next); },
  }));
}
for (const initial of [false, "", "paste", true]) {
  await act(async () => { root.render(React.createElement(Harness, { initial, key: String(initial) })); });
  const trigger = host.querySelector('[role="combobox"]');
  assert.equal(trigger.textContent, options.find(option => option.value === initial).label);
  assert.deepEqual(changes, [], "mounting a select must not overwrite its current value");
}
await act(async () => root.render(React.createElement(KetcherButton, { primary: true, isActive: true }, "Cancel")));
const rnaButton = host.querySelector("button");
assert.equal(rnaButton.getAttribute("aria-label"), "Cancel");
assert.equal(rnaButton.getAttribute("aria-pressed"), "true");
assert.equal(rnaButton.getAttribute("data-variant"), "default");
assert.equal(rnaButton.hasAttribute("primary"), false);
assert.equal(rnaButton.hasAttribute("isActive"), false);
await act(async () => root.render(React.createElement(KetcherButton, { primary: false }, "Duplicate and Edit")));
assert.equal(host.querySelector("button"), rnaButton, "button state changes preserve the same interactive element");
assert.equal(rnaButton.getAttribute("aria-label"), "Duplicate and Edit", "RNA action label tracks current visible text");
await act(async () => root.render(React.createElement(KetcherButton, { "aria-label": "Explicit action label" }, "Edit")));
assert.equal(rnaButton.getAttribute("aria-label"), "Explicit action label");
await act(async () => root.render(React.createElement(KetcherGenericInput, {
  value: "2", onChange() {}, extraValue: "px", extraSchema: { type: "string" }, onExtraChange() {},
  "data-testid": "size-input", "aria-label": "Size",
})));
const genericInput = host.querySelector("input");
assert.equal(genericInput.value, "2");
assert.equal(genericInput.getAttribute("aria-label"), "Size");
assert.equal(genericInput.hasAttribute("extraValue"), false);
assert.equal(genericInput.hasAttribute("extraSchema"), false);
assert.equal(genericInput.hasAttribute("onExtraChange"), false);
let checked = false;
await act(async () => root.render(React.createElement(KetcherSwitch, { value: checked, name: "warnings", onChange(event) { checked = event.target.checked; changes.push(checked); } })));
await act(async () => host.querySelector('[role="switch"]').click());
assert.equal(checked, true);
assert.deepEqual(changes, [true], "one click must emit exactly one checked event");
let accepted = null;
let cancelled = [];
await act(async () => root.render(React.createElement(KetcherDialog, {
  title: "Test properties", buttons: ["Cancel", "OK"], result: () => ({ charge: 2 }), valid: () => true,
  params: { onOk(value) { accepted = value; }, onCancel(value) { cancelled.push(value); } },
}, React.createElement("input", { defaultValue: "2" }))));
await act(async () => document.querySelector('[data-testid="OK"]').click());
assert.deepEqual(accepted, { charge: 2 });
await act(async () => document.querySelector('[data-testid="Cancel"]').click());
assert.deepEqual(cancelled, [{ charge: 2 }], "cancel preserves the upstream result payload");
accepted = null;
await act(async () => {
  const dialog = document.querySelector('[role="dialog"]');
  dialog.focus();
  dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
});
assert.deepEqual(accepted, { charge: 2 }, "Enter on the focused dialog confirms as upstream does");
await act(async () => root.render(React.createElement(KetcherSettingsAccordion, {
  tabs: [{ key: "general", label: "General", content: React.createElement("input", { defaultValue: "draft" }) },
    { key: "other", label: "Other", content: React.createElement("input", { defaultValue: "hidden value" }) }],
  changedGroups: new Set(),
})));
assert.equal(host.querySelectorAll("input").length, 2, "collapsed settings remain mounted for upstream form registration");
const draft = host.querySelector("input");
draft.value = "unsaved edit";
await act(async () => host.querySelector('[data-testid="General-accordion"]').click());
await act(async () => host.querySelector('[data-testid="General-accordion"]').click());
assert.equal(host.querySelector("input").value, "unsaved edit", "collapsing settings must preserve edited field state");
const fullscreen = document.createElement("div");
document.body.append(fullscreen);
Object.defineProperty(document, "fullscreenElement", { configurable: true, value: fullscreen });
await act(async () => root.render(React.createElement(KetcherDialog, {
  title: "Fullscreen properties", buttons: [], params: { onCancel() {}, onOk() {} },
})));
assert.ok(fullscreen.querySelector('[role="dialog"]'), "dialogs portal inside the active fullscreen element");
Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
const analogueChanges = [];
const analogueOptions = [{ value: "A", label: "A", color: "#00aa00" }, { value: "C", label: "C", color: "#0000aa" }];
await act(async () => root.render(React.createElement(KetcherNaturalAnaloguePicker, {
  value: "A", options: analogueOptions, disabled: false, onChange: (value) => analogueChanges.push(value),
})));
assert.equal(host.querySelector('[data-testid="natural-analogue-picker-selected-A"]').textContent, "A");
assert.deepEqual(analogueChanges, [], "presenting an analogue must not modify the monomer");
await act(async () => root.render(React.createElement(KetcherNaturalAnaloguePicker, {
  value: null, options: analogueOptions, disabled: true, onChange: (value) => analogueChanges.push(value),
})));
assert.equal(host.querySelector('[data-testid="natural-analogue-picker"]').disabled, true);
assert.equal(host.querySelector('[data-testid="natural-analogue-picker"]').textContent, "Select an analogue");
await act(async () => root.unmount());
await window.happyDOM.abort();
console.log("Ketcher primitives: typed select values, switch event, dialog keyboard/cancel/fullscreen, settings state passed");
