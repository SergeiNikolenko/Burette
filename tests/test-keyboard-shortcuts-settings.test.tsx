import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { KeyboardShortcutsSection } = await import("../apps/desktop/src/components/settings-panel/keyboard-shortcuts-section");
const { SearchInput } = await import("../apps/desktop/src/components/ui/search-input");

test("shortcut search matches commands, descriptions and key combinations; clear restores focus and results", async () => {
  const shell = document.createElement("div"); document.body.append(shell);
  const root = createRoot(shell);
  try {
    await act(async () => root.render(<KeyboardShortcutsSection />));
    const input = shell.querySelector<HTMLInputElement>('input[aria-label="Search shortcuts"]')!;
    const rows = () => Array.from(shell.querySelectorAll('.settings-control-label')).map(row => row.textContent);
    const initial = rows();
    const fill = async (value: string) => { await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }); };
    await fill("  DOCK  "); expect(rows()).toEqual(["Toggle bottom dock", "Toggle right dock"]);
    await fill("molecular"); expect(rows()).toEqual(["Open structures"]);
    await fill("⌥⌘B"); expect(rows()).toEqual(["Toggle right dock"]);
    expect(shell.querySelector("kbd")?.textContent).toBe("⌥⌘B");
    await fill("no-such-shortcut"); expect(rows()).toEqual([]);
    expect(shell.querySelector('[role="status"]')?.textContent).toBe("No matching shortcuts");
    const clear = shell.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!;
    await act(async () => { clear.focus(); clear.click(); });
    expect(input.value).toBe(""); expect(document.activeElement).toBe(input);
    expect(rows()).toEqual(initial);
    expect(shell.querySelector('[role="status"]')).toBeNull();
    expect(shell.querySelector('button[aria-label="Clear search"]')).toBeNull();
  } finally { await act(async () => root.unmount()); shell.remove(); }
});

test("disabled page search does not clear its value", async () => {
  const shell = document.createElement("div"); document.body.append(shell);
  const root = createRoot(shell);
  const changes: string[] = [];
  try {
    await act(async () => root.render(<SearchInput disabled aria-label="Search" value="dock" onValueChange={value => changes.push(value)} />));
    const clear = shell.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!;
    expect(clear.disabled).toBe(true);
    await act(async () => clear.click());
    expect(changes).toEqual([]);
    expect(shell.querySelector<HTMLInputElement>("input")!.value).toBe("dock");
  } finally { await act(async () => root.unmount()); shell.remove(); }
});
