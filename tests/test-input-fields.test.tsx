import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, createRef } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node", "NodeFilter", "CustomEvent", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Input } = await import("../apps/desktop/src/components/ui/input");
const { MergeColumnsDialog } = await import("../apps/desktop/src/components/merge-columns-dialog");
const { CalculatedColumnDialog } = await import("../apps/desktop/src/components/calculated-column-dialog");

test("field variant preserves ref, native constraints, disabled state and accessible error", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<HTMLInputElement>();
  try {
    await act(async () => root.render(<>
      <label>Count<Input ref={ref} variant="field" type="number" name="count" min={1} max={16} defaultValue={5} required aria-invalid aria-describedby="count-error" /></label>
      <span id="count-error">Choose a valid count</span>
      <Input variant="compact" disabled aria-label="Locked" />
    </>));
    expect(ref.current).toBe(container.querySelector("input"));
    expect(ref.current!.validity.valid).toBe(true);
    ref.current!.value = "20";
    expect(ref.current!.validity.rangeOverflow).toBe(true);
    expect(ref.current!.getAttribute("aria-describedby")).toBe("count-error");
    expect(ref.current!.hasAttribute("variant")).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Locked"]')!.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("merge dialog forwards edited fields and selected columns without rewriting whitespace", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const calls: unknown[] = [];
  const columns = [{ id: "mass", label: "Mass", type: "number" as const, kind: "property" }, { id: "logp", label: "LogP", type: "number" as const, kind: "property" }];
  try {
    await act(async () => root.render(<MergeColumnsDialog request={{ documentId: "series", documentTitle: "Series", columns }} onDismiss={() => {}} onRun={(...args) => calls.push(args)} />));
    const dialog = document.querySelector('[role="dialog"]')!;
    const inputs = dialog.querySelectorAll<HTMLInputElement>('input[data-slot="input"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(inputs[0], " / "); inputs[0]!.dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(inputs[1], "Properties"); inputs[1]!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const merge = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Merge")!;
    await act(async () => merge.click());
    expect(calls).toEqual([["series", "Properties", " / ", [{ id: "mass", label: "Mass" }, { id: "logp", label: "LogP" }]]]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("merge form blocks duplicate columns and derives a title for a valid keyboard submission", async () => {
  const container = document.createElement("div"); container.className = "app-shell"; document.body.append(container);
  const root = createRoot(container);
  const calls: unknown[] = [];
  const columns = [{ id: "name", label: "Name", type: "text" as const, kind: "property" }, { id: "id", label: "Identifier", type: "text" as const, kind: "property" }];
  const request = { documentId: "series", documentTitle: "Series", columns };
  try {
    await act(async () => root.render(<MergeColumnsDialog request={request} onDismiss={() => calls.push("close")} onRun={(...args) => calls.push(args)} />));
    const second = container.querySelector<HTMLSelectElement>('select[name="second"]')!;
    const form = container.querySelector("form")!;
    await act(async () => { second.value = "name"; second.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(calls).toEqual([]);
    expect(second.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(second.getAttribute("aria-describedby")!)?.textContent).toBe("Pick two different columns.");
    await act(async () => { second.value = "id"; second.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(calls).toEqual([["series", "Name + Identifier", " ", [{ id: "name", label: "Name" }, { id: "id", label: "Identifier" }]], "close"]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("calculated values expose only numeric columns, preserve insertions, and submit the exact expression", async () => {
  const container = document.createElement("div"); container.className = "app-shell"; document.body.append(container);
  const root = createRoot(container); const calls: unknown[] = [];
  const request = { documentId: "series", documentTitle: "Series", columns: [
    { id: "mass", label: "Mass", type: "number" as const, kind: "property" },
    { id: "name", label: "Molecule name", type: "text" as const, kind: "property" },
  ], seedLabel: "Scaled mass", seedFormula: "sqrt(" };
  try {
    await act(async () => root.render(<CalculatedColumnDialog request={request} onDismiss={() => calls.push("close")} onRun={(...args) => calls.push(args)} />));
    const button = (text: string) => Array.from(container.querySelectorAll("button")).find(el => el.textContent === text);
    expect(button("Molecule name")).toBeUndefined();
    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe("sqrt(");
    await act(async () => button("Mass")!.click());
    expect(textarea.value).toBe("sqrt( [Mass]");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "  sqrt([Mass])  ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(calls).toEqual([["series", "Scaled mass", "sqrt([Mass])"], "close"]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("calculated values associate parser and unknown-column errors without dispatching invalid formulas", async () => {
  const container = document.createElement("div"); container.className = "app-shell"; document.body.append(container);
  const root = createRoot(container); const calls: unknown[] = [];
  const request = { documentId: "series", documentTitle: "Series", columns: [], seedLabel: "Result", seedFormula: "[Missing] + 1" };
  try {
    const render = (seedFormula: string) => act(async () => root.render(<CalculatedColumnDialog request={{ ...request, seedFormula }} onDismiss={() => {}} onRun={(...args) => calls.push(args)} />));
    await render(request.seedFormula);
    const textarea = container.querySelector("textarea")!;
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(textarea.getAttribute("aria-describedby")!)?.textContent).toBe("No numeric column named “Missing”.");
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await render("sqrt(");
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(calls).toEqual([]);
    await render("2 + 2");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(calls).toEqual([["series", "Result", "2 + 2"]]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
