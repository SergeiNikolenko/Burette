import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "CustomEvent", "Event", "KeyboardEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Toaster, toast } = await import("../apps/desktop/src/components/ui/toast");
const { toast: sonner } = await import("sonner");
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
// Sonner publishes explicit dismissals over two animation frames before its exit timer.
const flushDismissal = async () => {
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  await act(async () => { await tick(250); });
};

test("toast stack preserves actions, independent dismissal, priority and timed notices", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  let actions = 0;
  const ids: Array<string | number> = [];
  try {
    await act(async () => root.render(<Toaster />));
    await act(async () => {
      ids.push(toast.add({ title: "Connection lost", description: "Reconnect to continue.", type: "error", priority: "high", timeout: 0,
        actionProps: { children: "Reconnect", onClick: () => actions++ } }));
      ids.push(toast.add({ title: "Saved", type: "success", timeout: 0, actionPlacement: "inline",
        actionProps: { children: "Open", onClick: () => actions++ } }));
      await tick();
    });
    const cards = () => [...shell.querySelectorAll<HTMLElement>('[data-slot="toast"]')];
    expect(cards().length).toBe(2);
    const error = cards().find(e => e.textContent?.includes("Connection lost"))!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(sonner.getToasts().find(t => t.id === ids[0])?.duration).toBe(Infinity);
    await act(async () => error.querySelector<HTMLButtonElement>('[data-slot="toast-action"]')!.click());
    expect(actions).toBe(1);
    const saved = cards().find(e => e.querySelector('[data-slot="toast-title"]')?.textContent === "Saved")!;
    await act(async () => saved.querySelector<HTMLButtonElement>('[data-slot="toast-action"]')!.click());
    expect(actions).toBe(2);
    expect(cards().length).toBe(2);
    await act(async () => error.querySelector<HTMLButtonElement>('[data-slot="toast-close"]')!.click());
    await flushDismissal();
    expect(cards().map(e => e.querySelector('[data-slot="toast-title"]')?.textContent)).toEqual(["Saved"]);
    expect(cards()[0].getAttribute("role")).toBe("status");
    await act(async () => { ids.push(toast.add({ title: "Temporary", timeout: 30 })); await tick(); });
    await act(async () => { await tick(60); });
    await flushDismissal();
    expect(cards().map(e => e.querySelector('[data-slot="toast-title"]')?.textContent)).toEqual(["Saved"]);
    await act(async () => toast.close(ids[1]));
    await flushDismissal();
    expect(cards().length).toBe(0);
  } finally {
    await act(async () => { ids.forEach(id => toast.close(id)); root.unmount(); }); shell.remove();
  }
});
