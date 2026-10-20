import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { SshConnectionDialog } = await import("../apps/desktop/src/components/ssh/ssh-connection-dialog");
const registryKey = "burette.ssh-projects.v1";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const flushFocus = () => new Promise(resolve => setTimeout(resolve, 0));
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === name)!;

test("unavailable SSH discovery offers manual entry without exposing backend diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => json({ error: "Private backend diagnostic" }, 500)) as typeof fetch;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SshConnectionDialog open onOpenChange={() => {}} />));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Couldn’t load connections. Add a hostname manually.");
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    await act(async () => button("Add manually").click());
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement?.getAttribute("name")).toBe("displayName");
  } finally {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch;
  }
});

test("SSH choices exclude saved aliases, deduplicate, and support arrow selection without connecting", async () => {
  localStorage.setItem(registryKey, JSON.stringify({ projects: [], connections: [{ host: "SAVED", name: "Saved", enabled: true }] }));
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    requests.push(String(url));
    return json(["saved", "alpha", "ALPHA", "beta"].map(alias => ({ alias })));
  }) as typeof fetch;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SshConnectionDialog open onOpenChange={() => {}} />));
    const radios = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.map(item => item.value)).toEqual(["alpha", "beta"]);
    await act(async () => radios[0].click());
    await act(async () => { radios[0].focus(); radios[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); await flushFocus(); });
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown", bubbles: true })));
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radios[1]);
    expect(button("Add").disabled).toBe(false);
    expect(requests).toEqual(["/__burette/ssh/hosts"]);
  } finally {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; localStorage.clear();
  }
});

test("manual submission trims values, locks while connecting, and saves only after success", async () => {
  const originalFetch = globalThis.fetch;
  let finish!: (response: Response) => void;
  const requests: unknown[] = [];
  globalThis.fetch = ((url: unknown, options: RequestInit) => {
    if (String(url).endsWith("/hosts")) return Promise.resolve(json([]));
    requests.push(JSON.parse(String(options.body)));
    return new Promise<Response>(resolve => { finish = resolve; });
  }) as typeof fetch;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const added: string[] = []; const opened: boolean[] = [];
  try {
    await act(async () => root.render(<SshConnectionDialog open onOpenChange={value => opened.push(value)} onAdded={host => added.push(host)} />));
    await act(async () => button("Add manually").click());
    expect(document.activeElement?.getAttribute("name")).toBe("displayName");
    const fill = async (name: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await fill("displayName", "  Research  "); await fill("hostname", "  fixture-host  ");
    const submit = async () => { await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); };
    await submit(); await submit();
    expect(requests).toEqual([{ host: "fixture-host", root: "~", path: ".", chemical: false }]);
    expect(button("Connecting…").disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="hostname"]')!.disabled).toBe(true);
    expect(localStorage.getItem(registryKey)).toBeNull();
    await act(async () => finish(json({ error: "Private backend diagnostic" }, 500)));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Couldn’t connect. Check the hostname and your SSH access.");
    expect(localStorage.getItem(registryKey)).toBeNull();
    expect(added).toEqual([]); expect(opened).toEqual([]);
    await submit();
    await act(async () => finish(json({ root: "/home/test", path: ".", entries: [], truncated: false })));
    const saved = JSON.parse(localStorage.getItem(registryKey)!);
    expect(saved.projects).toEqual([]);
    expect(saved.connections).toEqual([{ host: "fixture-host", name: "Research", enabled: true, color: expect.any(String) }]);
    expect(added).toEqual(["fixture-host"]); expect(opened).toEqual([false]);
  } finally {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; localStorage.clear();
  }
});
