import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { WelcomeScreen } = await import("../apps/desktop/src/components/welcome");

test("new tab preserves the file-open action and shortcut without redundant copy", async () => {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  let opens = 0;
  try {
    await act(async () => root.render(<WelcomeScreen actions={{ chooseFiles: () => { opens++; } } as ShellActions} />));
    expect(mount.querySelector('[role="heading"][aria-level="1"]')?.textContent?.trim()).toBe("Open a structure");
    const button = mount.querySelector<HTMLButtonElement>('button[data-analytics-control="open_structure"]')!;
    await act(async () => button.click()); expect(opens).toBe(1);
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+O");
    expect(mount.querySelector("kbd")?.textContent).toBe("⌘O");
    expect(mount.querySelector('[data-slot="empty-description"]')).toBeNull();
  } finally { await act(async () => root.unmount()); mount.remove(); }
});

test("hosted loading times out truthfully, stops its spinner and cancels its timer on unmount", async () => {
  const originalTimeout = window.setTimeout, originalClear = window.clearTimeout;
  let timeout: (() => void) | undefined; let cleared = false;
  window.setTimeout = ((callback: () => void, delay: number) => { expect(delay).toBe(15_000); timeout = callback; return 44; }) as typeof window.setTimeout;
  window.clearTimeout = ((id: number) => { expect(id).toBe(44); cleared = true; }) as typeof window.clearTimeout;
  window.__BURETTE_HOSTED_MCP_WIDGET__ = true;
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<WelcomeScreen actions={{} as ShellActions} />));
    expect(mount.querySelector('[role="status"][aria-live]')?.textContent).toContain("Loading molecular structure…");
    expect(mount.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(mount.querySelector("button")).toBeNull();
    await act(async () => timeout!());
    expect(mount.textContent).toContain("Structure has not loaded");
    expect(mount.textContent).toContain("Reopen this result to try again.");
    expect(mount.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(mount.textContent).not.toContain("Scene actions");
  } finally {
    await act(async () => root.unmount()); mount.remove();
    delete window.__BURETTE_HOSTED_MCP_WIDGET__;
    window.setTimeout = originalTimeout; window.clearTimeout = originalClear;
  }
  expect(cleared).toBe(true);
});
