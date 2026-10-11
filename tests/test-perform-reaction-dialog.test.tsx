import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { PerformReactionDialog } = await import("../apps/desktop/src/components/perform-reaction-dialog");
const request = { documentId: "series", documentTitle: "Series" };
async function fixture(run: (mount: HTMLDivElement, calls: unknown[][], render: (open: boolean) => Promise<void>) => Promise<void>) {
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount); const calls: unknown[][] = [];
  const render = (open: boolean) => act(async () => root.render(<PerformReactionDialog request={open ? request : null}
    onDismiss={() => calls.push(["close"])} onRun={(...args) => calls.push(args)} />));
  try { await render(true); await run(mount, calls, render); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}
const button = (mount: Element, label: string) => Array.from(mount.querySelectorAll("button")).find(el => el.textContent === label)!;
async function fill(mount: Element, name: string, value: string) {
  await act(async () => {
    const input = mount.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
    const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = (mount: Element) => act(async () => mount.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

test("reaction presets populate the form, submit exact values, and reset on reopening", async () => {
  await fixture(async (mount, calls, render) => {
    expect(button(mount, "Add column").disabled).toBe(true);
    await act(async () => button(mount, "Suzuki coupling").click());
    await submit(mount);
    expect(calls).toEqual([["series", "Suzuki coupling", "[c:1][Br,I,Cl].[c:2][B]([OH])[OH]>>[c:1][c:2]", ["OB(O)c1ccncc1"]], ["close"]]);
    await render(false); await render(true);
    expect(Array.from(mount.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")).map(el => el.value)).toEqual(["Product", "", ""]);
    expect(button(mount, "Add column").disabled).toBe(true);
  });
});

test("reaction syntax and co-reactant errors block form submission and identify the invalid field", async () => {
  await fixture(async (mount, calls) => {
    await fill(mount, "reaction", "[C:1]"); await submit(mount);
    expect(calls).toEqual([]);
    expect(mount.querySelector('[aria-invalid="true"]')?.getAttribute("name")).toBe("reaction");
    await fill(mount, "reaction", "[C:1].[N:2]>>[C:1][N:2]"); await submit(mount);
    const invalid = mount.querySelector('[aria-invalid="true"]')!;
    expect([invalid.getAttribute("name"), document.getElementById(invalid.getAttribute("aria-describedby")!)?.textContent]).toEqual([
      "coReactants", "This reaction takes 2 reactants, so it needs 1 co-reactant beside each row's structure.",
    ]);
    await fill(mount, "coReactants", "NCC, CCO"); await submit(mount); expect(calls).toEqual([]);
    await fill(mount, "coReactants", "  NCC  "); await fill(mount, "label", "  Amine product  ");
    await submit(mount);
    expect(calls).toEqual([["series", "Amine product", "[C:1].[N:2]>>[C:1][N:2]", ["NCC"]], ["close"]]);
  });
});

test("recursive SMARTS dots do not add reactants and cancelling never starts a calculation", async () => {
  await fixture(async (mount, calls) => {
    const reaction = "[C;$([C].[N]):1].[O:2].[N:3]>>[C:1][O:2][N:3]";
    await fill(mount, "reaction", `  ${reaction}  `); await fill(mount, "coReactants", " CCO,  NCC ");
    expect(button(mount, "Add column").disabled).toBe(false);
    await fill(mount, "label", "  "); await submit(mount); expect(calls).toEqual([]);
    await fill(mount, "label", "Product"); await submit(mount);
    expect(calls).toEqual([["series", "Product", reaction, ["CCO", "NCC"]], ["close"]]);
    calls.length = 0; await act(async () => button(mount, "Cancel").click()); expect(calls).toEqual([["close"]]);
    calls.length = 0; await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(calls).toEqual([["close"]]);
  });
});
