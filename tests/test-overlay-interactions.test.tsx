import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "HTMLInputElement", "Node", "NodeFilter", "CustomEvent", "Event", "KeyboardEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } = await import("../apps/desktop/src/components/ui/dialog");
const { Popover, PopoverTrigger, PopoverContent } = await import("../apps/desktop/src/components/ui/popover");
const { Input } = await import("../apps/desktop/src/components/ui/input");

// Let Radix finish the scheduled focus restoration, not a CSS-animation delay.
const flushFocus = () => new Promise(resolve => setTimeout(resolve, 0));
test("nested popover inherits the shell and Escape unwinds one overlay at a time", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  try {
    await act(async () => root.render(<Dialog><DialogTrigger>Rename</DialogTrigger><DialogContent variant="form" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Rename series</DialogTitle></DialogHeader><Input aria-label="Name" defaultValue="Series" />
      <Popover><PopoverTrigger>Options</PopoverTrigger><PopoverContent aria-label="Options"><Input aria-label="Prefix" /></PopoverContent></Popover>
    </DialogContent></Dialog>));
    const trigger = shell.querySelector<HTMLButtonElement>('[data-slot="dialog-trigger"]')!;
    await act(async () => trigger.click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Name");
    const options = shell.querySelector<HTMLButtonElement>('[data-slot="popover-trigger"]')!;
    await act(async () => options.click());
    expect(shell.querySelector('[data-slot="popover-content"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Prefix");
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await flushFocus(); });
    expect(shell.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(shell.querySelector('[data-slot="dialog-content"]')).not.toBeNull();
    expect(document.activeElement === options).toBe(true);
    await act(async () => { options.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await flushFocus(); });
    expect(shell.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(document.activeElement === trigger).toBe(true);
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

test("explicit popover containers stay authoritative over the shell default", async () => {
  const shell = document.createElement("div"); shell.className = "app-shell";
  const portal = document.createElement("div"); document.body.append(shell, portal);
  const root = createRoot(shell);
  try {
    await act(async () => root.render(<Popover defaultOpen><PopoverTrigger>Open</PopoverTrigger><PopoverContent container={portal} aria-label="Options"><Input aria-label="Label" /></PopoverContent></Popover>));
    expect(portal.querySelector('[data-slot="popover-content"]')).not.toBeNull();
    expect(shell.querySelector('[data-slot="popover-content"]')).toBeNull();
  } finally { await act(async () => root.unmount()); shell.remove(); portal.remove(); }
});
