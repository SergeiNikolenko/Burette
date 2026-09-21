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

const originalWarn = console.warn;
console.warn = (...args) => {
  const message = String(args[0] ?? "");
  if (message.startsWith('You are trying to animate opacity from "undefined"')) {
    return;
  }
  originalWarn(...args);
};

const { createRoot } = await import("react-dom/client");
const { ScrubNumberField } = await import("../apps/desktop/src/components/ui/scrub-number-input.tsx");
const { RadixDropdownMenu } = await import("../apps/desktop/src/components/radix-menu.tsx");
const host = document.createElement("div");
document.body.append(host);
const changes = [];
const commits = [];
let submitted = null;

function Harness() {
  const [value, setValue] = useState(10);
  return React.createElement(
    "form",
    {
      onSubmit(event) {
        event.preventDefault();
        submitted = value;
      },
    },
    React.createElement("label", { htmlFor: "test-scrub-value" }, "Test value"),
    React.createElement(ScrubNumberField, {
      "aria-label": "Test value",
      id: "test-scrub-value",
      min: 0,
      max: 20,
      step: 0.5,
      value,
      onValueChange(next) {
        changes.push(next);
        setValue(next);
      },
      onValueCommitted(next) {
        commits.push(next);
      },
    }),
    React.createElement("button", { type: "submit" }, "Submit"),
  );
}

const root = createRoot(host);
await act(async () => root.render(React.createElement(Harness)));

const spinbutton = () => host.querySelector('[role="spinbutton"][aria-label="Test value"]');
const key = async (value) => {
  await act(async () => {
    spinbutton().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: value }));
  });
};

assert.equal(spinbutton()?.getAttribute("aria-valuenow"), "10");
assert.equal(spinbutton()?.id, "test-scrub-value");
assert.equal(host.querySelector("label").control, spinbutton(), "the external label resolves to the stable display control");
await key("ArrowUp");
assert.equal(spinbutton()?.getAttribute("aria-valuenow"), "10.5");
assert.equal(changes.at(-1), 10.5);

await key("End");
assert.equal(spinbutton()?.getAttribute("aria-valuenow"), "20");
await key("Home");
assert.equal(spinbutton()?.getAttribute("aria-valuenow"), "0");

await act(async () => {
  const control = spinbutton();
  control.dispatchEvent(new window.PointerEvent("pointerdown", {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 10,
    pointerId: 1,
    pointerType: "mouse",
  }));
  control.dispatchEvent(new window.PointerEvent("pointermove", {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: 30,
    clientY: 10,
    pointerId: 1,
    pointerType: "mouse",
  }));
  control.dispatchEvent(new window.PointerEvent("pointermove", {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: 40,
    clientY: 10,
    movementX: 10,
    pointerId: 1,
    pointerType: "mouse",
  }));
  control.dispatchEvent(new window.PointerEvent("pointerup", {
    bubbles: true,
    button: 0,
    clientX: 40,
    clientY: 10,
    pointerId: 1,
    pointerType: "mouse",
  }));
});
const scrubbedValue = Number(spinbutton()?.getAttribute("aria-valuenow"));
assert.ok(scrubbedValue > 0, "pointer movement scrubs the value");
assert.equal(commits.at(-1), scrubbedValue);

await act(async () => {
  const control = spinbutton();
  control.dispatchEvent(new window.PointerEvent("pointerdown", {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 10,
    pointerId: 2,
    pointerType: "mouse",
  }));
  control.dispatchEvent(new window.PointerEvent("pointerup", {
    bubbles: true,
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 2,
    pointerType: "mouse",
  }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
});

const editInput = host.querySelector('input[role="spinbutton"]');
assert.ok(editInput, "click without a drag enters edit mode");
await act(async () => {
  editInput.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(editInput, "7.25");
  editInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  editInput.blur();
});
assert.equal(spinbutton()?.getAttribute("aria-valuenow"), "7.25");
assert.equal(commits.at(-1), 7.25);

await act(async () => host.querySelector('button[type="submit"]').click());
assert.equal(submitted, 7.25, "the form observes the value committed by the field");

await act(async () => root.unmount());
host.remove();

const menuHost = document.createElement("div");
menuHost.className = "app-shell";
document.body.append(menuHost);
const menuChanges = [];
const menuRoot = createRoot(menuHost);

await act(async () => {
  menuRoot.render(React.createElement(RadixDropdownMenu, {
    items: [{
      kind: "number",
      id: "test-menu-number",
      label: "Iterations",
      value: 2,
      min: 0,
      max: 10,
      step: 1,
      action(next) {
        menuChanges.push(next);
      },
    }],
    trigger: React.createElement("button", { type: "button", "aria-label": "Open parameters" }, "Open"),
  }));
});

await act(async () => {
  menuHost.querySelector('[aria-label="Open parameters"]').dispatchEvent(new window.PointerEvent("pointerdown", {
    bubbles: true,
    button: 0,
    buttons: 1,
    pointerId: 10,
    pointerType: "mouse",
  }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
});

const openMenu = () => document.querySelector('[role="menu"][data-state="open"]');
const menuSpinbutton = () => document.querySelector('[role="spinbutton"][aria-label="Iterations"]');
assert.ok(openMenu(), "the real Radix dropdown opens");
assert.ok(menuSpinbutton(), "the number item renders inside the open menu");
const implicitLabel = menuSpinbutton().closest("label");
assert.equal(implicitLabel?.control, menuSpinbutton(), "the implicit label resolves to the visible control");

await act(async () => {
  menuSpinbutton().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
});
assert.equal(menuChanges.at(-1), 3);
assert.equal(menuSpinbutton()?.getAttribute("aria-valuenow"), "3");
assert.ok(openMenu(), "editing a number does not close the Radix menu");

await act(async () => {
  const control = menuSpinbutton();
  control.dispatchEvent(new window.PointerEvent("pointerdown", {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 10,
    pointerId: 11,
    pointerType: "mouse",
  }));
  control.dispatchEvent(new window.PointerEvent("pointerup", {
    bubbles: true,
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 11,
    pointerType: "mouse",
  }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
});

const menuEditInput = document.querySelector('input[role="spinbutton"][aria-label="Iterations"]');
assert.ok(menuEditInput, "clicking the menu control enters edit mode");
await act(async () => {
  menuEditInput.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(menuEditInput, "5");
  menuEditInput.dispatchEvent(new window.Event("input", { bubbles: true }));
});
assert.equal(menuChanges.at(-1), 5, "valid typed drafts propagate before blur");
await act(async () => {
  menuEditInput.blur();
});
assert.equal(menuChanges.at(-1), 5);
assert.ok(openMenu(), "committing typed input keeps the Radix menu open");

await act(async () => {
  const control = menuSpinbutton();
  control.dispatchEvent(new window.PointerEvent("pointerdown", {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 10,
    pointerId: 12,
    pointerType: "mouse",
  }));
  control.dispatchEvent(new window.PointerEvent("pointermove", {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: 30,
    clientY: 10,
    pointerId: 12,
    pointerType: "mouse",
  }));
  control.dispatchEvent(new window.PointerEvent("pointermove", {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: 40,
    clientY: 10,
    movementX: 10,
    pointerId: 12,
    pointerType: "mouse",
  }));
  control.dispatchEvent(new window.PointerEvent("pointerup", {
    bubbles: true,
    button: 0,
    clientX: 40,
    clientY: 10,
    pointerId: 12,
    pointerType: "mouse",
  }));
});
assert.ok(menuChanges.at(-1) > 5, "pointer scrub dispatches the menu action");
assert.ok(openMenu(), "pointer scrub keeps the Radix menu open");

await act(async () => {
  const control = menuSpinbutton();
  control.dispatchEvent(new window.PointerEvent("pointerdown", {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 10,
    pointerId: 13,
    pointerType: "mouse",
  }));
  control.dispatchEvent(new window.PointerEvent("pointerup", {
    bubbles: true,
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 13,
    pointerType: "mouse",
  }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
});

const dismissInput = document.querySelector('input[role="spinbutton"][aria-label="Iterations"]');
const outsideButton = document.createElement("button");
document.body.append(outsideButton);
await act(async () => {
  dismissInput.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(dismissInput, "7");
  dismissInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  outsideButton.dispatchEvent(new window.PointerEvent("pointerdown", {
    bubbles: true,
    button: 0,
    buttons: 1,
    pointerId: 14,
    pointerType: "mouse",
  }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
});
assert.equal(menuChanges.at(-1), 7, "outside dismissal cannot lose a valid typed value");
outsideButton.remove();

await act(async () => menuRoot.unmount());
menuHost.remove();
console.warn = originalWarn;

console.log("scrub number field interaction tests passed");
