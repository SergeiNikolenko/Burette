import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { registerTextFind, requestTextFind } from "../apps/desktop/src/lib/text-find.ts";

const window = new Window();
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const previousStyle = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: window.getComputedStyle.bind(window) });

const calls = [];
const disposers = [];
function viewer(name, visible = true) {
  const element = window.document.createElement("div");
  const input = window.document.createElement("input");
  element.append(input);
  window.document.body.append(element);
  element.getBoundingClientRect = () => new window.DOMRect(0, 0, visible ? 300 : 0, visible ? 400 : 0);
  disposers.push(registerTextFind(element, () => calls.push(name)));
  return { element, input };
}

try {
  const main = viewer("main");
  const dock = viewer("dock");
  viewer("hidden tab", false);
  assert.equal(requestTextFind(), true);
  assert.deepEqual(calls.splice(0), ["dock"], "Find reaches the visible text dock when focus is elsewhere");

  main.input.focus();
  requestTextFind();
  assert.deepEqual(calls.splice(0), ["main"], "Find respects a focused main text viewer");

  dock.input.focus();
  requestTextFind();
  assert.deepEqual(calls.splice(0), ["dock"]);

  const modal = window.document.createElement("div");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("data-state", "open");
  window.document.body.append(modal);
  assert.equal(requestTextFind(), false, "a modal must not send Find to an obscured text viewer");
  assert.deepEqual(calls.splice(0), []);
  modal.remove();

  disposers[1]();
  requestTextFind();
  assert.deepEqual(calls.splice(0), ["main"], "closed viewers unregister their Find handler");
  main.element.remove();
  assert.equal(requestTextFind(), false, "detached and hidden viewers do not claim Find");
} finally {
  disposers.forEach((dispose) => dispose());
  if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
  else delete globalThis.document;
  if (previousStyle) Object.defineProperty(globalThis, "getComputedStyle", previousStyle);
  else delete globalThis.getComputedStyle;
  await window.happyDOM.close();
}

console.log("text Find routing tests passed");
