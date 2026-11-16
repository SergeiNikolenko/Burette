import { test, expect } from "bun:test";
import React, { act } from "react";
import { createResizableFixture } from "./resizable-panel-fixture";

let width = 1280;
let behavior: "preserve-pixel-size" | "preserve-relative-size" = "preserve-pixel-size";
const { browser, size, createRoot, Fixture, notify, expectPixels } =
  await createResizableFixture(() => width, () => behavior);

Object.defineProperty(browser.HTMLElement.prototype, "ariaDisabled", { configurable: true, get() { return this.getAttribute("aria-disabled"); } });
const captures = new WeakMap<object, Set<number>>();
browser.HTMLElement.prototype.setPointerCapture = function(id: number) { const set = captures.get(this) ?? new Set(); set.add(id); captures.set(this, set); };
browser.HTMLElement.prototype.hasPointerCapture = function(id: number) { return captures.get(this)?.has(id) ?? false; };
browser.HTMLElement.prototype.releasePointerCapture = function(id: number) { captures.get(this)?.delete(id); };
browser.HTMLElement.prototype.getBoundingClientRect = function() {
  const panel = this.hasAttribute("data-panel");
  const separator = this.getAttribute("role") === "separator";
  const right = this.parentElement?.querySelector('[data-panel][id="right"]') as unknown as HTMLElement | null;
  const x = panel && this.id === "right" ? width - size(this as unknown as HTMLElement) : separator && right ? width - size(right) : 0;
  return new browser.DOMRect(x, 0, separator ? 0 : panel ? size(this as unknown as HTMLElement) : width, 800);
};
test("independent: active pointer remount cannot resurrect the old axis and a new drag stays pixel-based", async () => {
  behavior = "preserve-pixel-size"; width = 1280;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = () => act(async () => root.render(<Fixture bound={width} />));
  const pointer = async (target: EventTarget, type: string, x: number, buttons = 1) => act(async () => {
    target.dispatchEvent(new browser.PointerEvent(type, { pointerId: 1, pointerType: "mouse", button: 0, buttons, clientX: x, clientY: 200, bubbles: true, cancelable: true }) as unknown as PointerEvent);
  });
  try {
    await render(); await notify(); expectPixels(360);
    await pointer(host.querySelector('[role="separator"]')!, "pointerdown", 920);
    await pointer(document, "pointermove", 880);
    expectPixels(400);
    width = 760; await notify(); await render(); await notify(); expectPixels(400);
    await pointer(document, "pointermove", 860);
    await pointer(document, "pointerup", 860, 0);
    expectPixels(400);
    await pointer(host.querySelector('[role="separator"]')!, "pointerdown", 360);
    await pointer(document, "pointermove", 340);
    await pointer(document, "pointerup", 340, 0);
    expectPixels(420);
    width = 1280; await notify(); await render(); await notify(); expectPixels(420);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
