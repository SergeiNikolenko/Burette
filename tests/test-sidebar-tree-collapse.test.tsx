import { test, expect } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { TreeCollapse } = await import("../apps/desktop/src/components/sidebar/tree-collapse");

test("lazy tree preserves closing motion, survives reversal and releases hidden rows", async () => {
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const originalRequest = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = key => { frames.delete(key); };
  const tick = () => act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0));
  });
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  let renders = 0;
  const render = (open: boolean) => act(async () => root.render(
    <TreeCollapse open={open} className="project-tail-shell">{() => {
      renders++; return <div className="project-tail"><button>file.pdb</button></div>;
    }}</TreeCollapse>,
  ));
  try {
    await render(false);
    const shell = mount.firstElementChild as HTMLElement;
    let animations: { finished: Promise<void> }[] = [];
    shell.getAnimations = () => animations as Animation[];
    await tick(); await tick();
    expect(renders).toBe(0);
    await render(true);
    expect(shell.querySelector("button")).not.toBeNull();
    expect(shell.dataset.expanded).toBe("false");
    await tick(); await tick();
    expect(shell.dataset.expanded).toBe("true");
    let finish!: () => void;
    animations = [{ finished: new Promise(resolve => { finish = resolve; }) }];
    await render(false); await tick(); await tick();
    expect(shell.hasAttribute("inert")).toBe(true);
    expect(shell.querySelector("button")).not.toBeNull();
    await render(true); await tick(); await tick();
    await act(async () => finish());
    expect(shell.querySelector("button")).not.toBeNull();
    expect(shell.hasAttribute("inert")).toBe(false);
    animations = []; // Reduced motion: no transition to wait for.
    await render(false); await tick(); await tick();
    expect(shell.childElementCount).toBe(0);
    await render(true); // Unmount during pending opening frames.
  } finally {
    await act(async () => root.unmount());
    expect(frames.size).toBe(0);
    mount.remove();
    globalThis.requestAnimationFrame = originalRequest; globalThis.cancelAnimationFrame = originalCancel;
  }
});
