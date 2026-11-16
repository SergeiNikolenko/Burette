import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
Object.defineProperty(globalThis, "HTMLFormElement", { configurable: true, value: browser.HTMLFormElement });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MessageEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame", "CSS"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Lists saved by an earlier session of the same file; read when the store is first used.
const STORAGE_KEY = "burette.grid.row-lists.v1";
localStorage.setItem(STORAGE_KEY, JSON.stringify({
  "/data/series.sdf": [{ id: "kept", name: "Actives", rows: "2-4,9" }, { id: "broken", name: "No rows", rows: "x" }],
  "/data/other.sdf": [{ id: "other", name: "Elsewhere", rows: "0" }],
}));

const { createRoot } = await import("react-dom/client");
const { TooltipProvider } = await import("../apps/desktop/src/components/ui/tooltip");
const { GridRowListsSection } = await import("../apps/desktop/src/components/grid-row-lists-section");
const rowLists = await import("../apps/desktop/src/lib/grid-row-lists");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");

test("row ranges round-trip and ignore what is not a row", () => {
  expect(rowLists.encodeRowRanges([7, 1, 0, 2, 2, 10, 9, -1, 3.5])).toBe("0-2,7,9-10");
  expect(rowLists.decodeRowRanges("0-2,7,9-10")).toEqual([0, 1, 2, 7, 9, 10]);
  expect(rowLists.decodeRowRanges("4-2, x, 5 , 6-6")).toEqual([5, 6]);
  expect(rowLists.encodeRowRanges([])).toBe("");
});

test("lists are kept per file and written back as ranges", () => {
  expect(rowLists.rowListsFor("/data/series.sdf")).toEqual([{ id: "kept", name: "Actives", indexes: [2, 3, 4, 9] }]);
  expect(rowLists.rowListsFor("/data/unknown.sdf")).toEqual([]);

  const saved = rowLists.saveRowList("/data/new.sdf", "", [5, 3, 4])!;
  expect(saved).toMatchObject({ name: "List 1", indexes: [3, 4, 5] });
  expect(rowLists.saveRowList("/data/new.sdf", "  Hits  ", [1])!.name).toBe("Hits");
  expect(rowLists.nextRowListName(rowLists.rowListsFor("/data/new.sdf"))).toBe("List 2");
  expect(rowLists.saveRowList("/data/new.sdf", "Nothing", [])).toBeNull();
  rowLists.renameRowList("/data/new.sdf", saved.id, "Series A");
  rowLists.renameRowList("/data/new.sdf", saved.id, "   ");
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)["/data/new.sdf"]).toEqual([
    { id: saved.id, name: "Series A", rows: "3-5" },
    { id: expect.any(String), name: "Hits", rows: "1" },
  ]);
  for (const list of rowLists.rowListsFor("/data/new.sdf")) rowLists.deleteRowList("/data/new.sdf", list.id);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
    "/data/series.sdf": [{ id: "kept", name: "Actives", rows: "2-4,9" }],
    "/data/other.sdf": [{ id: "other", name: "Elsewhere", rows: "0" }],
  });
});

test("the section saves the grid's selection, selects and shows a list, and hides when there is nothing to show", async () => {
  useMoleculeStore.setState({ documents: [{ id: "doc", path: "/data/series.sdf" }] as never });
  // Stands in for the grid frame: it answers the two requests and records the commands.
  const commands: Array<Record<string, unknown>> = [];
  const fromGrid = (body: Record<string, unknown>) => window.dispatchEvent(new MessageEvent("message", { data: { source: "burette-grid", body } }) as never);
  let selection = [0, 1, 5];
  const frame = document.createElement("div");
  frame.className = "viewer-iframe";
  frame.dataset.documentId = "doc";
  frame.dataset.renderer = "grid2d";
  Object.defineProperty(frame, "contentWindow", { value: { postMessage({ body }: { body: Record<string, unknown> }) {
    if (body.type === "chemicalSpaceRequestState") fromGrid({ type: "gridMenuStateChanged", documentId: "doc", selectedCount: selection.length });
    else if (body.type === "gridRequestSelection") fromGrid({ type: "gridSelection", requestId: body.requestId, indexes: selection });
    else commands.push(body);
  } } });
  document.body.append(frame);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  const render = (shownListId: string | null) => act(async () => root.render(
    <TooltipProvider><GridRowListsSection documentId="doc" shownListId={shownListId} /></TooltipProvider>,
  ));
  const rows = () => [...mount.querySelectorAll(".grid-row-list")].map((row) => [
    row.querySelector(".grid-row-list-name")?.textContent ?? "(renaming)",
    row.querySelector(".grid-row-list-count")!.textContent,
  ]);
  const button = (label: string) => [...mount.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent === label)!;
  try {
    await render(null);
    expect(rows()).toEqual([["Actives", "4"]]);
    const save = [...mount.querySelectorAll<HTMLButtonElement>("summary button")][0];
    expect(save.textContent).toBe("Save selection3");
    expect(save.disabled).toBe(false);

    // Saving opens the new list's name for typing; Enter keeps what was typed.
    save.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await act(async () => { save.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(rows()).toEqual([["Actives", "4"], ["(renaming)", "3"]]);
    const name = mount.querySelector<HTMLInputElement>('input[aria-label="Row list name"]')!;
    expect(name.value).toBe("List 1");
    await act(async () => {
      Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(name, "COX series");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as never); });
    expect(rows()).toEqual([["Actives", "4"], ["COX series", "3"]]);
    expect(rowLists.rowListsFor("/data/series.sdf")[1]).toMatchObject({ name: "COX series", indexes: [0, 1, 5] });

    await act(async () => button("COX series").click());
    await act(async () => button("Show only Actives").click());
    expect(commands).toEqual([
      { type: "gridRowListCommand", documentId: "doc", action: "select", id: expect.any(String), name: "COX series", indexes: [0, 1, 5] },
      { type: "gridRowListCommand", documentId: "doc", action: "filter", id: "kept", name: "Actives", indexes: [2, 3, 4, 9] },
    ]);

    // The grid's next model says which list it shows; the same button then lifts the filter.
    await render("kept");
    expect(rows()[0]).toEqual(["ActivesShown", "4"]);
    expect(button("Show all rows again").getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Show all rows again").click());
    expect(commands.at(-1)).toEqual({ type: "gridRowListCommand", documentId: "doc", action: "filter", id: null, indexes: [] });

    // Nothing selected: the lists stay, saving is off. No lists either: the section is gone.
    selection = [];
    await act(async () => { fromGrid({ type: "gridMenuStateChanged", documentId: "doc", selectedCount: 0 }); });
    await render(null);
    expect([...mount.querySelectorAll<HTMLButtonElement>("summary button")][0].disabled).toBe(true);
    await act(async () => {
      for (const list of rowLists.rowListsFor("/data/series.sdf")) rowLists.deleteRowList("/data/series.sdf", list.id);
    });
    expect(mount.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
    mount.remove();
    frame.remove();
  }
});
