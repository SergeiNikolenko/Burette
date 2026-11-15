import { test, expect } from "bun:test";
import React, { act } from "react";
import { createResizableFixture } from "./resizable-panel-fixture";

let width = 1280;
let behavior: "preserve-pixel-size" | "preserve-relative-size" = "preserve-pixel-size";
const layoutEvents: { layout: Record<string, number>; user: boolean }[] = [];
const { size, createRoot, ref, Fixture, notify, expectPixels } =
  await createResizableFixture(() => width, () => behavior, { layoutEvents });

test("independent: getters are pure and a pending same-size request publishes one completed layout", async () => {
  width = 1280;
  behavior = "preserve-pixel-size";
  layoutEvents.length = 0;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Fixture bound={1280} />));
    expectPixels(360);
    const initialEvents = layoutEvents.length;
    width = 760;
    const pendingStyle = document.getElementById("right")!.style.cssText;
    for (let i = 0; i < 5; i++) {
      expect(ref.current!.isCollapsed()).toBe(false);
      expect(ref.current!.getSize().inPixels).toBeCloseTo(213.75, 1);
    }
    expect(document.getElementById("right")!.style.cssText).toBe(pendingStyle);
    expect(layoutEvents.length).toBe(initialEvents);
    await act(async () => ref.current!.resize("360px"));
    expectPixels(360);
    expect(layoutEvents.length).toBe(initialEvents + 1);
    expect(layoutEvents.at(-1)!.user).toBe(false);
    await notify();
    expectPixels(360);
    expect(layoutEvents.length).toBe(initialEvents + 1);
    await act(async () => ref.current!.collapse());
    expectPixels(0);
    const collapsedEvents = layoutEvents.length;
    width = 1280;
    for (let i = 0; i < 5; i++) {
      expect(ref.current!.isCollapsed()).toBe(true);
      expect(ref.current!.getSize().inPixels).toBeCloseTo(0, 1);
    }
    expect(layoutEvents.length).toBe(collapsedEvents);
    await act(async () => ref.current!.expand());
    expectPixels(360);
    expect(layoutEvents.length).toBe(collapsedEvents + 1);
    expect(layoutEvents.at(-1)!.user).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test("independent: relative collapse restoration keeps percentages across re-registration", async () => {
  width = 1280;
  behavior = "preserve-relative-size";
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Fixture bound={1280} />));
    expectPixels(360);
    await act(async () => ref.current!.collapse());
    expectPixels(0);
    width = 760;
    await notify();
    await act(async () => root.render(<Fixture bound={760} />));
    await notify();
    await act(async () => ref.current!.expand());
    expectPixels(213.75);
    expect(ref.current!.getSize().asPercentage).toBeCloseTo(28.125, 2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
