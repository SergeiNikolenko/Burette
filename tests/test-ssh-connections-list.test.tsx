import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { SshConnections } = await import("../apps/desktop/src/components/ssh/ssh-projects");
const registryKey = "burette.ssh-projects.v1";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const flushFocus = () => new Promise(resolve => setTimeout(resolve, 0));
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === name)!;

const seed = {
  connections: [{ host: "alpha", name: "Research", enabled: true, color: "blue" }, { host: "beta", name: "Archive", enabled: false, color: "cyan" }],
  projects: [{ id: "a", host: "alpha", name: "Structures", root: "/data" }, { id: "b", host: "beta", name: "Archive", root: "/archive" }],
};
const saved = () => JSON.parse(localStorage.getItem(registryKey)!);
const menuAction = async (name: string) => {
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Options for Research"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent === name)!;
  expect(item).toBeDefined();
  await act(async () => item.click());
  await act(flushFocus);
};

test("removal requires confirmation, Cancel preserves registry, and only the selected host is removed", async () => {
  localStorage.setItem(registryKey, JSON.stringify(seed));
  const container = document.createElement("div"); container.className = "app-shell"; document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SshConnections />));
    await menuAction("Remove connection");
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Remote files are kept.");
    expect(saved()).toEqual(seed);
    await act(async () => button("Cancel").click()); await act(flushFocus);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Options for Research");
    expect(saved()).toEqual(seed);
    await menuAction("Remove connection");
    await act(async () => button("Remove").click()); await act(flushFocus);
    expect(document.activeElement?.textContent).toBe("Add");
    expect(saved()).toEqual({ connections: [seed.connections[1]], projects: [seed.projects[1]] });
    expect(document.querySelector('[role="group"][aria-label="Research"]')).toBeNull();
    expect(document.querySelector('[role="group"][aria-label="Archive"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); localStorage.clear(); }
});

test("checks report availability without raw errors and disabling retains saved projects", async () => {
  localStorage.setItem(registryKey, JSON.stringify(seed));
  const originalFetch = globalThis.fetch;
  let finish!: (response: Response) => void;
  const requests: unknown[] = [];
  globalThis.fetch = ((_url: unknown, options: RequestInit) => {
    requests.push(JSON.parse(String(options.body)));
    return new Promise<Response>(resolve => { finish = resolve; });
  }) as typeof fetch;
  const container = document.createElement("div"); container.className = "app-shell"; document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SshConnections />));
    const control = () => document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Enable Research"]')!;
    const status = () => document.querySelector('[role="group"][aria-label="Research"] [role="status"]')!.textContent;
    expect(status()).toBe("Not checked");
    await menuAction("Check connection");
    expect(status()).toBe("Connecting…"); expect(control().disabled).toBe(true);
    expect(requests).toEqual([{ host: "alpha", root: "~", path: ".", chemical: false }]);
    await act(async () => finish(json({ error: "Private SSH diagnostic" }, 500)));
    expect(status()).toBe("Unavailable"); expect(control().disabled).toBe(false);
    expect(container.textContent).not.toContain("Private SSH diagnostic");
    await menuAction("Check connection");
    await act(async () => finish(json({ root: "/home/test", path: ".", entries: [] })));
    expect(status()).toBe("Available");
    await act(async () => control().click());
    expect(status()).toBe("Disabled");
    expect(saved().projects).toEqual(seed.projects);
    expect(saved().connections.find((item: { host: string }) => item.host === "alpha").enabled).toBe(false);
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Options for Research"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map(item => [item.textContent, item.getAttribute("aria-disabled")])).toEqual([
      ["Check connection", "true"], ["Add folder", "true"], ["Remove connection", null],
    ]);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; localStorage.clear(); }
});
