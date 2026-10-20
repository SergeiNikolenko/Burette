import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
Object.defineProperty(globalThis, "DocumentFragment", { configurable: true, value: browser.DocumentFragment });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { SetValueRangeDialog } = await import("../apps/desktop/src/components/set-value-range-dialog");
const { SplitValueRowsDialog } = await import("../apps/desktop/src/components/split-value-rows-dialog");
const { BinsColumnDialog } = await import("../apps/desktop/src/components/bins-column-dialog");
const { DeleteColumnsDialog } = await import("../apps/desktop/src/components/delete-columns-dialog");
type Request = NonNullable<React.ComponentProps<typeof SetValueRangeDialog>["request"]>;
const request: Request = { documentId: "series", documentTitle: "Series", columns: [
  { id: "mass", label: "Mass", type: "number", kind: "property" },
  { id: "activity", label: "Activity", type: "number", kind: "property" },
] };
async function fixture(kind: "range" | "split" | "bins" | "delete", run: (mount: HTMLDivElement, calls: unknown[][], render: (value: Request | null) => Promise<void>) => Promise<void>) {
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount); const calls: unknown[][] = [];
  const Component = { range: SetValueRangeDialog, split: SplitValueRowsDialog, bins: BinsColumnDialog, delete: DeleteColumnsDialog }[kind];
  const render = (value: Request | null) => act(async () => root.render(<Component request={value} onDismiss={() => calls.push(["close"])} onRun={(...args: unknown[]) => calls.push(args)} />));
  try { await render(request); await run(mount, calls, render); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}
async function fill(mount: Element, name: string, value: string) {
  await act(async () => {
    const input = mount.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function column(mount: Element, value: string) {
  await act(async () => { const el = mount.querySelector("select")!; el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}
const submit = (mount: Element) => act(async () => mount.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

test("range submits trimmed bounds, scientific notation, and an empty pair to clear", async () => {
  await fixture("range", async (mount, calls, render) => {
    await column(mount, "activity"); await fill(mount, "min", "  -2.5e1  "); await fill(mount, "max", " 100 ");
    await submit(mount);
    expect(calls).toEqual([["series", { id: "activity", label: "Activity" }, "-2.5e1", "100"], ["close"]]);
    calls.length = 0; await render(null); await render(request); await submit(mount);
    expect(calls).toEqual([["series", { id: "mass", label: "Mass" }, "", ""], ["close"]]);
  });
});

test("range associates finite-number and reversed-limit errors with inputs and prevents invalid submission", async () => {
  await fixture("range", async (mount, calls) => {
    for (const value of ["abc", "Infinity", "1e999"]) {
      await fill(mount, "min", value); await submit(mount);
      const input = mount.querySelector('input[name="min"]')!;
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe(`${value} is not a number.`);
    }
    await fill(mount, "min", "20"); await fill(mount, "max", "10"); await submit(mount);
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("The lower limit cannot exceed the upper one.");
    expect(calls).toEqual([]);
    await fill(mount, "max", "20"); await submit(mount);
    expect(calls).toEqual([["series", { id: "mass", label: "Mass" }, "20", "20"], ["close"]]);
  });
});

test("split preserves delimiter whitespace, prevents empty separators and resets on reopen", async () => {
  await fixture("split", async (mount, calls, render) => {
    await fill(mount, "separator", ""); await submit(mount); expect(calls).toEqual([]);
    await column(mount, "activity"); await fill(mount, "separator", " | "); await submit(mount);
    expect(calls).toEqual([["series", { id: "activity", label: "Activity" }, " | "], ["close"]]);
    calls.length = 0; await render(null); await render(request); await submit(mount);
    expect(calls).toEqual([["series", { id: "mass", label: "Mass" }, ";"], ["close"]]);
  });
});

test("empty column catalogs and cancellation do not dispatch transformations", async () => {
  for (const kind of ["range", "split", "bins"] as const) await fixture(kind, async (mount, calls, render) => {
    await render({ ...request, columns: [] }); await submit(mount); expect(calls).toEqual([]);
    await act(async () => Array.from(mount.querySelectorAll("button")).find(button => button.textContent === "Cancel")!.click());
    expect(calls).toEqual([["close"]]);
    await render(null); await render(request);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(calls).toEqual([["close"], ["close"]]);
  });
});

test("bins accepts positive finite widths and preserves a numeric callback payload", async () => {
  await fixture("bins", async (mount, calls, render) => {
    for (const value of ["", "0", "-1", "NaN", "Infinity", "1e999"]) {
      await fill(mount, "width", value); await submit(mount);
      expect(mount.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    }
    expect(calls).toEqual([]);
    const input = mount.querySelector('input[name="width"]')!;
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("1e999 is not a number.");
    await column(mount, "activity"); await fill(mount, "width", " 2.5e-1 "); await submit(mount);
    expect(calls).toEqual([["series", { id: "activity", label: "Activity" }, 0.25], ["close"]]);
    calls.length = 0; await render(null); await render(request); await submit(mount);
    expect(calls).toEqual([["series", { id: "mass", label: "Mass" }, 1], ["close"]]);
  });
});

test("column deletion requires explicit confirmation, sends only selected ids and resets selection", async () => {
  await fixture("delete", async (mount, calls, render) => {
    const button = (text: string) => Array.from(mount.querySelectorAll("button")).find(el => el.textContent === text)!;
    expect(button("Delete").disabled).toBe(true);
    await act(async () => mount.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
    expect(calls).toEqual([]);
    expect(mount.querySelector('[role="status"]')?.textContent).toBe("1 selected");
    await act(async () => button("Cancel").click());
    expect(calls).toEqual([["close"]]);
    calls.length = 0; await render(null); await render(request);
    expect(button("Delete").disabled).toBe(true);
    await act(async () => mount.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1]!.click());
    await act(async () => button("Delete").click());
    expect(calls).toEqual([["series", ["activity"]], ["close"]]);
  });
});
