import { Window } from "happy-dom";
import React, { act, type ReactNode } from "react";

export const browser = new Window({ url: "http://localhost/" });
for (const name of ["document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "localStorage", "DocumentFragment", "NodeFilter", "DOMRect", "MouseEvent", "KeyboardEvent"] as const) {
  const value = browser[name];
  Object.defineProperty(globalThis, name, { configurable: true, value: value });
}
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: (callback: () => void) => browser.setTimeout(callback, 0),
  cancelAnimationFrame: (id: ReturnType<typeof browser.setTimeout>) => browser.clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});
const { createRoot } = await import("react-dom/client");
export async function mount(content: ReactNode) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(content));
  return { host, render: (next: ReactNode) => act(async () => root.render(next)), close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
export function button(host: ParentNode, label: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label || item.getAttribute("aria-label") === label);
  if (!node) throw new Error(`Missing button: ${label}`);
  return node;
}
export async function click(node: Element) {
  await act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}
export async function input(host: ParentNode, label: string, value: string) {
  const node = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!node) throw new Error(`Missing input: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
