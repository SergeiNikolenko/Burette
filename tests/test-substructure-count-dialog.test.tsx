import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { SubstructureCountDialog } = await import("../apps/desktop/src/components/substructure-count-dialog");
type Props = React.ComponentProps<typeof SubstructureCountDialog>;
const request = { documentId: "series", documentTitle: "Series" };
async function fixture(validateQuery: Props["validateQuery"], run: (mount: HTMLDivElement, calls: unknown[][], render: (open: boolean) => Promise<void>) => Promise<void>) {
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount); const calls: unknown[][] = [];
  const render = (open: boolean) => act(async () => root.render(<SubstructureCountDialog request={open ? request : null} validateQuery={validateQuery} onDismiss={() => calls.push(["close"])} onRun={(...args) => calls.push(args)} />));
  try { await render(true); await run(mount, calls, render); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}
const button = (mount: Element, label: string) => Array.from(mount.querySelectorAll("button")).find(el => el.textContent === label)!;
async function fill(mount: Element, name: string, value: string) {
  await act(async () => {
    const input = mount.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const debounce = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 230)); });
const submit = (mount: Element) => act(async () => mount.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

test("query presets validate before submission, preserve a custom label and reset when reopened", async () => {
  const queries: string[] = [];
  await fixture(async query => { queries.push(query); return null; }, async (mount, calls, render) => {
    await fill(mount, "label", " Aromatic rings ");
    await act(async () => button(mount, "Benzene ring").click());
    await submit(mount); expect(calls).toEqual([]);
    expect(mount.querySelector('[role="status"]')?.textContent).toBe("Checking…");
    await debounce(); await submit(mount);
    expect([queries, calls]).toEqual([["c1ccccc1"], [["series", "Aromatic rings", "c1ccccc1"], ["close"]]]);
    calls.length = 0; await render(false); await render(true);
    expect(mount.querySelector<HTMLInputElement>('input[name="query"]')?.value).toBe("");
    expect(button(mount, "Add column").disabled).toBe(true);
    await fill(mount, "query", "  CCO  "); await debounce(); await submit(mount);
    expect(calls).toEqual([["series", "Count of CCO", "CCO"], ["close"]]);
  });
});

test("late validation of a previous query cannot enable the current query", async () => {
  const pending = new Map<string, (value: string | null) => void>();
  await fixture(query => new Promise(resolve => pending.set(query, resolve)), async (mount, calls) => {
    await fill(mount, "query", "CC"); await debounce();
    await fill(mount, "query", "CO"); await debounce();
    await act(async () => pending.get("CC")!(null));
    await submit(mount); expect(calls).toEqual([]);
    expect(button(mount, "Add column").disabled).toBe(true);
    await act(async () => pending.get("CO")!(null)); await submit(mount);
    expect(calls).toEqual([["series", "Count of CO", "CO"], ["close"]]);
  });
});

test("parse errors block submission and validation failures stay friendly and recoverable", async () => {
  const oldError = console.error; console.error = () => {};
  try {
    await fixture(async query => {
      if (query === "bad") return "SmilesParser: Unclosed ring.";
      if (query === "broken") throw new Error("internal module /private/engine");
      return null;
    }, async (mount, calls) => {
      await fill(mount, "query", "bad"); await debounce(); await submit(mount);
      const input = mount.querySelector('input[name="query"]')!;
      expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Unclosed ring.");
      expect(calls).toEqual([]);
      await fill(mount, "query", "broken"); await debounce();
      expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Could not check this query. Edit it to try again.");
      expect(mount.textContent).not.toContain("/private/engine");
      await fill(mount, "query", "CCO"); await debounce();
      expect(button(mount, "Add column").disabled).toBe(false);
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(calls).toEqual([["close"]]);
    });
  } finally { console.error = oldError; }
});
