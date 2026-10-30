import { test, expect } from "bun:test";
import React, { act } from "react";
import { createResizableFixture } from "./resizable-panel-fixture";

let width = 1280;
let behavior: "preserve-pixel-size" | "preserve-relative-size" = "preserve-pixel-size";
const { size, createRoot, ref, Fixture, notify, expectPixels } =
  await createResizableFixture(() => width, () => behavior);

test("pixel basis survives bounds re-registration, reopen, and constrained restoration", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = async () => act(async () => root.render(<Fixture bound={width} />));
  const resize = async (next: number) => {
    width = next;
    await notify();
    await render();
    await notify();
  };
  try {
    width = 1280;
    await render();
    await notify();
    expectPixels(360);
    await resize(760);
    expectPixels(360);
    await act(async () => {
      ref.current!.collapse();
    });
    expectPixels(0);
    await act(async () => {
      ref.current!.expand();
      ref.current!.resize("360px");
    });
    expectPixels(360);
    for (const next of [1280, 760, 1280]) {
      await resize(next);
      expectPixels(360);
    }
    // User-requested sizes remain authoritative; no application reset to 360.
    await act(async () => ref.current!.resize("450px"));
    expectPixels(450);
    for (const next of [760, 1280]) {
      await resize(next);
      expectPixels(450);
    }
    await resize(300);
    expectPixels(300);
    await resize(1280);
    expectPixels(450);
    const separator = host.querySelector('[role="separator"]')!;
    await act(async () =>
      separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
    const keyboardWidth = ref.current!.getSize().inPixels;
    expect(keyboardWidth).toBeGreaterThan(450);
    await resize(760);
    expectPixels(keyboardWidth);
    await resize(1280);
    expectPixels(keyboardWidth);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test("relative panels retain percentages when bounds re-register", async () => {
  behavior = "preserve-relative-size";
  width = 1280;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Fixture bound={width} />));
    await notify();
    expectPixels(360);
    width = 760;
    await notify();
    await act(async () => root.render(<Fixture bound={width} />));
    await notify();
    expectPixels(213.75);
    width = 1280;
    await notify();
    await act(async () => root.render(<Fixture bound={width} />));
    await notify();
    expectPixels(360);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    behavior = "preserve-pixel-size";
  }
});
