import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useState } from "react";
import type { XyzrenderControls } from "../apps/desktop/src/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLFormElement", "HTMLSelectElement", "HTMLOptionElement", "HTMLButtonElement", "DocumentFragment", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { XyzrenderProperties } = await import("../apps/desktop/src/components/xyzrender-properties");
const button = (mount: Element, text: string) => Array.from(mount.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === text)!;
const field = (mount: Element, label: string) => document.getElementById(Array.from(mount.querySelectorAll("label")).find(el => el.textContent === label)!.htmlFor) as HTMLInputElement;
const fill = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const click = (el: HTMLElement) => act(async () => el.click());
async function fixture(run: (mount: HTMLDivElement, changes: XyzrenderControls[]) => Promise<void>) {
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount); const root = createRoot(mount);
  const changes: XyzrenderControls[] = [];
  function Example() {
    const [controls, setControls] = useState<XyzrenderControls>({ atomScale: 0.4, extraArguments: "--unrelated 2" });
    return <XyzrenderProperties controls={controls} onChange={value => { changes.push(value); setControls(value); }} />;
  }
  try { await act(async () => root.render(<Example />)); await run(mount, changes); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}

test("render settings keep scientific hints accessible without permanent captions and search opens matching fields", async () => {
  await fixture(async (mount) => {
    await click(button(mount, "Atoms & bonds"));
    expect(mount.textContent).not.toContain("Size, outlines");
    expect(field(mount, "Molecule colour").getAttribute("aria-description")).toBe("Colour name or #hex; empty uses element colours");
    expect(mount.querySelector('[data-slot="field-description"]')).toBeNull();
    await fill(mount.querySelector('[aria-label="Find render settings"]')!, "sphere opacity");
    expect(field(mount, "Sphere opacity").type).toBe("number");
    expect(mount.textContent).not.toContain("Atom size");
    expect(button(mount, "van der Waals").getAttribute("aria-expanded")).toBe("true");
  });
});

test("numeric edits preserve bounds and default values through the shared input", async () => {
  await fixture(async (mount, changes) => {
    await click(button(mount, "Atoms & bonds"));
    const input = field(mount, "Atom size");
    const enter = () => act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await fill(input, "0.8"); await enter(); expect(changes.at(-1)).toEqual({ atomScale: 0.8, extraArguments: "--unrelated 2" });
    const before = changes.length;
    await fill(input, "-1"); await enter(); expect(changes.length).toBe(before); expect(input.value).toBe("0.8");
    await fill(input, ""); await enter(); expect(changes.at(-1)?.atomScale).toBeNull();
  });
});

test("selected atoms and multiline rules remain editable without replacing unrelated rendering options", async () => {
  await fixture(async (mount, changes) => {
    await fill(mount.querySelector('[aria-label="Find render settings"]')!, "highlight rules");
    await act(async () => window.dispatchEvent(new CustomEvent("burette:xyzrender-selection", { detail: [{ label: "Ligand", atoms: "1-4" }] })));
    await click(button(mount, "Use selected atoms"));
    expect(changes.at(-1)?.extraArguments).toBe('--unrelated "2" --hl "1-4" "steelblue"');
    const input = field(mount, "Highlight rules") as unknown as HTMLTextAreaElement;
    await fill(input, "1-4 red\n5 blue");
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(changes.at(-1)?.extraArguments).toBe('--unrelated "2" --hl "1-4" "red" --hl "5" "blue"');
    await act(async () => window.dispatchEvent(new CustomEvent("burette:xyzrender-selection", { detail: [{ label: "A", atoms: "1" }, { label: "B", atoms: "2" }] })));
    expect(mount.textContent).not.toContain("Use selected atoms");
  });
});
