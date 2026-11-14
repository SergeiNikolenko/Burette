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
    { id: "class", label: "Class", type: "text", categories: [["NSAID", 5], ["Stimulant", 3], ["", 1]] },
  ] };
  // Model echoes stand in for the grid runtime, not local optimistic filter state.
  const actions = {
    setGridColumnFilter(id: string, field: "min" | "max" | "text" | "values", value: string | string[]) {
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

test("a category column lists its values with counts and filters by the ticked ones", async () => {
  await fixture(async (mount, calls, render) => {
    await render();
    await click(mount.querySelectorAll<HTMLButtonElement>(".grid-filter-card-trigger")[2]!);
    const rows = () => [...mount.querySelectorAll<HTMLLabelElement>(".grid-filter-category")];
    const box = (index: number) => rows()[index].querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    expect(rows().map(row => [row.querySelector(".grid-filter-category-value")!.textContent, row.querySelector(".grid-filter-category-count")!.textContent]))
      .toEqual([["NSAID", "5"], ["Stimulant", "3"], ["Empty", "1"]]);
    expect(mount.querySelector(".grid-filter-categories")!.getAttribute("aria-label")).toBe("Class values");
    // The text filter stays available next to the values.
    expect(input(mount, "Filter Class").value).toBe("");

    await click(box(1)); await render();
    expect(calls).toEqual([["class", "values", ["Stimulant"]]]);
    expect([0, 1, 2].map(index => box(index).getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(mount.querySelectorAll(".grid-filter-card")[2].getAttribute("data-active")).toBe("true");

    await click(box(2)); await render();
    await click(box(1)); await render();
    expect(calls.slice(1)).toEqual([["class", "values", ["Stimulant", ""]], ["class", "values", [""]]]);
    expect([0, 1, 2].map(index => box(index).getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);

    await click(mount.querySelector<HTMLButtonElement>('[aria-label="Clear the Class filter"]')!); await render();
    expect([0, 1, 2].map(index => box(index).getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);
  });
});
