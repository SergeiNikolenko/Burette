import { test, expect } from "bun:test";
import React, { act } from "react";
import { createResizableFixture } from "./resizable-panel-fixture";

let width = 1280;
let behavior: "preserve-pixel-size" | "preserve-relative-size" = "preserve-pixel-size";
const { size, createRoot, ref, Fixture, notify, expectPixels } =
  await createResizableFixture(() => width, () => behavior);

async function mounted() {
  behavior = "preserve-pixel-size"; width = 1280;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = () => act(async () => root.render(<Fixture bound={width} />));
  await render(); await notify(); expectPixels(360);
  return { host, root, render, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
}
test("independent: hidden zero-size re-registration retains the cached pixel basis", async () => {
  const fixture = await mounted();
  try {
    width = 760; await notify(); await fixture.render(); await notify(); expectPixels(360);
    width = 0; await fixture.render(); await notify();
    width = 760; await notify(); await fixture.render(); await notify();
    expectPixels(360);
  } finally { await fixture.dispose(); }
});
test("independent: collapsed pixel panel expands to its prior pixels after group resize", async () => {
  const fixture = await mounted();
  try {
    await act(async () => ref.current!.collapse()); expectPixels(0);
    width = 760; await notify(); await fixture.render(); await notify(); expectPixels(0);
    await act(async () => ref.current!.expand());
    expectPixels(360);
  } finally { await fixture.dispose(); }
});
test("independent: pixel resize before ResizeObserver delivery retains the actual request", async () => {
  const fixture = await mounted();
  try {
    width = 760;
    await act(async () => ref.current!.resize("450px")); expectPixels(450);
    await notify(); await fixture.render(); await notify();
    expectPixels(450);
  } finally { await fixture.dispose(); }
});

test("same pixel request before observer delivery synchronizes the rendered layout", async () => {
  const fixture = await mounted();
  try {
    width = 760;
    await act(async () => ref.current!.resize("360px")); expectPixels(360);
    await notify(); await fixture.render(); await notify(); expectPixels(360);
  } finally { await fixture.dispose(); }
});

test("independent: an imperative request after leaving a deferred hidden group is not discarded by ResizeObserver", async () => {
  width = 1280; behavior = "preserve-pixel-size";
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = (bound: number) => act(async () => root.render(<Fixture bound={bound} />));
  try {
    await render(1280); await notify(); expectPixels(360);
    await act(async () => ref.current!.resize("450px")); expectPixels(450);
    width = 0; await render(1000); await notify();
    width = 760;
    await act(async () => ref.current!.resize("500px")); expectPixels(500);
    await notify(); expectPixels(500);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("collapse after showing before observer remembers expanded size", async () => {
 width=1280; const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {await act(async()=>root.render(<Fixture bound={1280}/>));await notify();await act(async()=>ref.current!.resize('450px'));
 width=0;await act(async()=>root.render(<Fixture bound={1000}/>));await notify();width=760;
 await act(async()=>ref.current!.collapse());await notify();expectPixels(0);await act(async()=>ref.current!.expand());expectPixels(450);
 } finally {await act(async()=>root.unmount());host.remove();}
});
