import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { GridFilterModel, ShellActions } from "../apps/desktop/src/components/types";

const browser = new Window();
Object.defineProperty(globalThis, "HTMLFormElement", { configurable: true, value: browser.HTMLFormElement });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { GridFilterSection } = await import("../apps/desktop/src/components/grid-filter-section");
const click = (element: HTMLElement) => act(async () => element.click());
const input = (mount: Element, label: string) => mount.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const fill = (element: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
});
async function fixture(run: (mount: HTMLDivElement, calls: unknown[], render: (focusRequest?: { columnId: string; requestId: number }) => Promise<void>) => Promise<void>) {
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  const calls: unknown[] = [];
  const model: GridFilterModel = { documentId: "collection", total: 4, visible: 4, columns: [
    { id: "name", label: "Name", type: "text" },
    { id: "mass", label: "Mass", type: "number", min: 10, max: 50, bins: [1, 1, 1, 1], statsComplete: false, statsRows: 4, statsTotal: 10 },
  ] };
  // Model echoes stand in for the grid runtime, not local optimistic filter state.
  const actions = {
    setGridColumnFilter(id: string, field: "min" | "max" | "text", value: string) {
      calls.push([id, field, value]);
      const column = model.columns.find(column => column.id === id)!;
      column.filter = { min: "", max: "", text: "", ...column.filter, [field]: value };
    },
    clearGridColumnFilters(id?: string) {
      calls.push(["clear", id]);
      model.columns.forEach(column => { if (!id || column.id === id) column.filter = undefined; });
    },
  } as ShellActions;
  try {
    await run(mount, calls, focusRequest => act(async () => root.render(<GridFilterSection model={{ ...model, columns: [...model.columns] }} actions={actions} focusRequest={focusRequest} />)));
  } finally { await act(async () => root.unmount()); mount.remove(); }
}

test("column search, text edits and clear-all preserve disclosure and runtime-owned filters", async () => {
  await fixture(async (mount, calls, render) => {
    await render();
    await click(mount.querySelector<HTMLButtonElement>(".grid-filter-card-trigger")!);
    await fill(input(mount, "Filter Name"), "Water");
    await render();
    expect(calls).toEqual([["name", "text", "Water"]]);
    expect(input(mount, "Filter Name").value).toBe("Water");
    await fill(input(mount, "Find a column to filter"), "mass");
    expect([...mount.querySelectorAll(".grid-filter-card-trigger")].map(el => el.textContent)).toEqual(["Mass"]);
    await act(async () => { mount.querySelector("details")!.open = false; });
    const clear = mount.querySelector<HTMLButtonElement>("summary button")!;
    // Happy DOM incorrectly toggles details for interactive summary descendants.
    // Real-browser smoke covers that default action; isolate the React handler here.
    clear.addEventListener("click", event => event.preventDefault(), { once: true });
    await click(clear); await render();
    expect(calls).toEqual([["name", "text", "Water"], ["clear", undefined]]);
    expect(mount.querySelector("details")!.open).toBe(false);
    expect(mount.querySelector("summary button")).toBeNull();
    await render({ columnId: "name", requestId: 1 });
    expect(mount.querySelector("details")!.open).toBe(true);
    expect(input(mount, "Find a column to filter").value).toBe("Name");
    expect(input(mount, "Filter Name").value).toBe("");
    expect(mount.querySelector(".grid-filter-card-trigger")?.getAttribute("aria-expanded")).toBe("true");
  });
});

test("numeric filter commits only on blur and exposes the updated range and partial coverage", async () => {
  await fixture(async (mount, calls, render) => {
    await render();
    await click(mount.querySelectorAll<HTMLButtonElement>(".grid-filter-card-trigger")[1]!);
    expect(mount.textContent).toContain("Loaded-page range · 4 of 10 rows");
    const minimum = input(mount, "Minimum Mass");
    await act(async () => minimum.focus());
    await fill(minimum, "20");
    expect(calls).toEqual([]);
    await act(async () => minimum.blur()); await render();
    expect(calls).toEqual([["mass", "min", "20"]]);
    expect([...mount.querySelectorAll('[role="slider"]')].map(el => el.getAttribute("aria-valuenow"))).toEqual(["20", "50"]);
    await click(mount.querySelector<HTMLButtonElement>('[aria-label="Clear the Mass filter"]')!); await render();
    expect([...mount.querySelectorAll('[role="slider"]')].map(el => el.getAttribute("aria-valuenow"))).toEqual(["10", "50"]);
  });
});
