import { test, expect } from "bun:test";
import React, { act } from "react";
import { createResizableFixture } from "./resizable-panel-fixture";

let width = 1280;
let behavior: "preserve-pixel-size" | "preserve-relative-size" = "preserve-pixel-size";
const { browser, size, createRoot, Group, Panel, Separator, ref, notify, expectPixels } =
  await createResizableFixture(() => width, () => behavior);

Object.defineProperties(browser.HTMLElement.prototype, {
  offsetWidth: { get() { return this.getAttribute("role") === "separator" ? 0 : size(this); } },
  offsetLeft: { get() {
    let x = 0; for (let node = this.previousElementSibling; node; node = node.previousElementSibling) if (node.hasAttribute("data-panel")) x += size(node as unknown as HTMLElement);
    return x;
  } },
});
let lastInteraction = false;
function KeyboardFixture({ bound }: { bound: number }) {
  return <Group onLayoutChanged={(_layout, meta) => { lastInteraction = meta.isUserInteraction; }}><Panel id="left" panelRef={ref} defaultSize="360px" minSize="100px" maxSize={`${bound}px`} groupResizeBehavior="preserve-pixel-size" collapsible collapsedSize="0px" /><Separator /><Panel id="main" minSize="0px" /></Group>;
}
test("independent: Enter expansion retains pixel basis before the next ResizeObserver delivery", async () => {
  width = 1280;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = () => act(async () => root.render(<KeyboardFixture bound={width} />));
  const enter = () => act(async () => host.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  try {
    await render(); await notify(); expectPixels(360);
    await enter(); expectPixels(0);
    width = 760; await notify(); await render(); await notify(); expectPixels(0);
    await enter(); expectPixels(360);
    await enter(); expectPixels(0);
    width = 1280;
    await enter();
    expect(lastInteraction).toBe(true);
    await notify(); await render(); await notify();
    expectPixels(360);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
