// Build model end to end in the shell: the dialog reads the collection through
// the grid channel, trains in the real worker, shows the cross-validated score
// and the neighbours of a prediction, and writes predictions back - a new
// column for every row, or values for the empty cells only.
import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["CSS", "MessageEvent", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLFormElement", "HTMLButtonElement", "SVGElement", "DocumentFragment", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { BuildModelDialogHost } = await import("../apps/desktop/src/components/build-model-dialog");
const { closeWorkbenchDialog, openWorkbenchDialog } = await import("../apps/desktop/src/lib/workbench/dialog-store");

type GridMessage = { source: string; body: Record<string, unknown> & { type: string; requestId: string } };

// Thirty rows whose logS is a plain function of two numeric columns. Rows 4, 11
// and 20 have no logS; row 7 holds a censored value that is not a number.
const EMPTY_ROWS = [4, 11, 20];
const tableRows = Array.from({ length: 30 }, (_, index) => {
  const x1 = Math.sin(index * 1.7) * 3;
  const x2 = Math.cos(index * 0.9) * 2;
  const logS = (2 * x1 - x2).toFixed(3);
  return {
    index: index + 100,
    name: `Compound ${index + 1}`,
    text: [EMPTY_ROWS.includes(index) ? "" : index === 7 ? "<0.1" : logS],
    numbers: [x1, x2],
    expected: Number(logS),
  };
});
const columns = [
  { id: "prop:logS", label: "logS", type: "number", kind: "property" },
  { id: "prop:x1", label: "x1", type: "number", kind: "property" },
  { id: "descriptor:x2", label: "x2", type: "number", kind: "descriptor" },
  { id: "prop:Series", label: "Series", type: "text", kind: "property" },
];

async function fixture(run: (mount: HTMLDivElement, messages: GridMessage[], statuses: string[][]) => Promise<void>) {
  const iframe = document.createElement("iframe"); iframe.className = "viewer-iframe";
  iframe.dataset.documentId = "series"; iframe.dataset.renderer = "grid2d"; document.body.append(iframe);
  const messages: GridMessage[] = [];
  iframe.contentWindow!.postMessage = (value: GridMessage) => { messages.push(value); };
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount);
  const statuses: string[][] = [];
  try {
    await act(async () => root.render(<BuildModelDialogHost onStatus={(...status) => statuses.push(status as string[])} />));
    await act(async () => openWorkbenchDialog({ kind: "model", document: { id: "series", title: "Series", renderer: "grid2d" } as never }));
    await run(mount, messages, statuses);
  } finally {
    await act(async () => closeWorkbenchDialog());
    await act(async () => root.unmount());
    mount.remove(); iframe.remove();
  }
}
const reply = (type: string, requestId: string, body: Record<string, unknown>) => act(async () => {
  window.dispatchEvent(new MessageEvent("message", { data: { source: "burette-grid", body: { type, requestId, ...body } } }));
});
const until = async (ready: () => boolean) => {
  for (let attempt = 0; attempt < 400 && !ready(); attempt++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(ready()).toBe(true);
};
const button = (mount: Element, name: string) => Array.from(mount.querySelectorAll("button")).find((element) => element.textContent?.trim() === name);
const select = (mount: Element, name: string, value: string) => act(async () => {
  const element = mount.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
});
const checkbox = (mount: Element, name: string) => Array.from(mount.querySelectorAll("label")).find((element) => element.textContent === name)!.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
const scores = (mount: Element) => Object.fromEntries(Array.from(mount.querySelectorAll(".build-model-scores > div"), (item) => [item.querySelector("dt")!.textContent, item.querySelector("dd")!.textContent]));

async function openWithColumns(mount: HTMLDivElement, messages: GridMessage[]) {
  expect(messages[0].body).toMatchObject({ type: "chemicalSpaceRequestColumns", documentId: "series", includeAllColumns: true });
  await reply("chemicalSpaceColumns", messages[0].body.requestId, { columns });
  expect(mount.querySelector<HTMLSelectElement>('select[name="target"]')!.value).toBe("prop:logS");
}

test("a model on numeric columns reports its score, shows neighbours and writes predictions back", async () => {
  await fixture(async (mount, messages, statuses) => {
    await openWithColumns(mount, messages);
    await select(mount, "descriptors", "columns");
    expect(button(mount, "Build model")!.disabled).toBe(true);
    expect(Array.from(mount.querySelectorAll(".build-model-columns label"), (label) => label.textContent)).toEqual(["x1", "x2"]);
    await act(async () => { checkbox(mount, "x1").click(); checkbox(mount, "x2").click(); });
    await select(mount, "method", "knn");
    expect(mount.querySelector<HTMLInputElement>('input[name="setting"]')!.value).toBe("5");
    expect(mount.querySelector<HTMLInputElement>('input[name="setting"]')!.closest("label")!.textContent).toBe("Neighbours");

    await act(async () => button(mount, "Build model")!.click());
    expect(messages[1].body).toMatchObject({
      type: "gridRequestTableRows", documentId: "series", textColumnIds: ["prop:logS"],
      numberColumnIds: ["prop:x1", "descriptor:x2"], includeStructures: false,
    });
    expect(mount.querySelector('[role="status"]')!.textContent).toBe("Reading the collection");
    expect(button(mount, "Stop")).toBeDefined();
    await reply("gridTableRows", messages[1].body.requestId, { rows: tableRows, truncated: false });
    await until(() => mount.querySelector(".build-model-result") !== null);

    const shown = scores(mount);
    expect(Object.keys(shown)).toEqual(["Cross-validated R²", "RMSE", "Training rows", "Left out"]);
    expect(Number(shown["Cross-validated R²"])).toBeGreaterThan(0.8);
    expect(shown["Training rows"]).toBe("26");
    expect(shown["Left out"]).toBe("1");

    // The rows without a value lead the list, and the first of them is inspected.
    const listed = Array.from(mount.querySelectorAll(".build-model-predictions tbody tr"));
    expect(listed).toHaveLength(29);
    expect(listed.slice(0, 3).map((row) => [row.children[0].textContent, row.children[1].textContent])).toEqual([["Compound 5", ""], ["Compound 12", ""], ["Compound 21", ""]]);
    expect(listed[0].getAttribute("aria-selected")).toBe("true");
    for (const [position, index] of EMPTY_ROWS.entries()) {
      expect(Math.abs(Number(listed[position].children[2].textContent) - tableRows[index].expected)).toBeLessThan(2.5);
    }
    expect(mount.querySelector("h3")!.textContent).toBe("Nearest training rows to Compound 5");
    const neighbours = Array.from(mount.querySelectorAll(".build-model-neighbours li"), (item) => Array.from(item.children, (child) => child.textContent));
    expect(neighbours).toHaveLength(5);
    const distances = neighbours.map((entry) => Number(entry[2]!.replace("Distance ", "")));
    expect(distances).toEqual([...distances].sort((left, right) => left - right));
    for (const entry of neighbours) {
      expect(entry[1]).toMatch(/^logS -?\d/u);
      expect(["Compound 5", "Compound 12", "Compound 21", "Compound 8"]).not.toContain(entry[0]);
    }
    await act(async () => (listed[4] as HTMLElement).click());
    expect(mount.querySelector("h3")!.textContent).toBe(`Nearest training rows to ${listed[4].children[0].textContent}`);

    await act(async () => button(mount, "Fill 3 missing values")!.click());
    expect(messages[2].body).toMatchObject({ type: "gridFillEmptyCells", documentId: "series", columnId: "prop:logS", columnLabel: "logS" });
    const filled = messages[2].body.values as Array<[number, string]>;
    expect(filled.map(([index]) => index)).toEqual(EMPTY_ROWS.map((index) => index + 100));
    expect(filled.map(([, value]) => value)).toEqual(listed.slice(0, 3).map((row) => row.children[2].textContent!));
    await reply("gridCellsFilled", messages[2].body.requestId, { filled: 3 });
    expect(statuses).toEqual([["Filled 3 missing values of logS", "success"]]);
    expect(button(mount, "Fill 3 missing values")!.disabled).toBe(true);

    await act(async () => button(mount, "Add column")!.click());
    expect(messages[3].body.type).toBe("gridDescriptorResults");
    const added = messages[3].body.rows as Array<{ index: number; descriptors: Record<string, { label: string; value: number }> }>;
    expect(added.map((row) => row.index)).toEqual(tableRows.filter((_, index) => index !== 7).map((row) => row.index));
    expect(added.every((row) => Number.isFinite(row.descriptors.model_Predicted_logS.value))).toBe(true);
    expect(added[0].descriptors.model_Predicted_logS.label).toBe("Predicted logS");
    expect(statuses[1]).toEqual(["Predicted logS added to Series", "success"]);
    expect(button(mount, "Add column")!.disabled).toBe(true);

    // Changing a choice withdraws the result it no longer describes.
    await select(mount, "method", "pls");
    expect(mount.querySelector(".build-model-result")).toBeNull();
    expect(mount.querySelector<HTMLInputElement>('input[name="setting"]')!.closest("label")!.textContent).toBe("Components");
  });
});

test("a categorical column reports accuracy and offers no fill for a computed column", async () => {
  await fixture(async (mount, messages) => {
    await reply("chemicalSpaceColumns", messages[0].body.requestId, {
      columns: [{ id: "descriptor:Class", label: "Class", type: "text", kind: "descriptor" }, ...columns.slice(1, 3)],
    });
    await select(mount, "descriptors", "columns");
    await act(async () => { checkbox(mount, "x1").click(); checkbox(mount, "x2").click(); });
    await act(async () => button(mount, "Build model")!.click());
    expect(messages[1].body.textColumnIds).toEqual(["descriptor:Class"]);
    await reply("gridTableRows", messages[1].body.requestId, {
      rows: tableRows.map((row, index) => ({ ...row, text: [EMPTY_ROWS.includes(index) ? "" : row.numbers[0] > 0 ? "soluble" : "insoluble"] })),
      truncated: false,
    });
    await until(() => mount.querySelector(".build-model-result") !== null);
    const shown = scores(mount);
    expect(Object.keys(shown)).toEqual(["Cross-validated accuracy", "Training rows"]);
    expect(Number(shown["Cross-validated accuracy"]!.replace("%", ""))).toBeGreaterThan(85);
    const listed = Array.from(mount.querySelectorAll(".build-model-predictions tbody tr"));
    for (const [position, index] of EMPTY_ROWS.entries()) {
      expect(listed[position].children[2].textContent).toBe(tableRows[index].numbers[0] > 0 ? "soluble" : "insoluble");
    }
    expect(Array.from(mount.querySelectorAll("button"), (element) => element.textContent?.trim()).filter((name) => name?.startsWith("Fill"))).toEqual([]);
    expect(button(mount, "Add column")).toBeDefined();
  });
});

test("an unusable setting, a small table and an oversized collection are refused in plain words", async () => {
  await fixture(async (mount, messages) => {
    await openWithColumns(mount, messages);
    const setting = mount.querySelector<HTMLInputElement>('input[name="setting"]')!;
    expect(setting.value).toBe("100");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(setting, "5000");
      setting.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(setting.getAttribute("aria-invalid")).toBe("true");
    expect(setting.title).toBe("Trees must be a whole number from 10 to 500.");
    expect(button(mount, "Build model")!.disabled).toBe(true);

    await select(mount, "method", "knn");
    await select(mount, "descriptors", "columns");
    await act(async () => checkbox(mount, "x1").click());
    await act(async () => button(mount, "Build model")!.click());
    await reply("gridTableRows", messages[1].body.requestId, { rows: tableRows.slice(0, 6), truncated: false });
    await until(() => mount.querySelector('[role="alert"]') !== null);
    expect(mount.querySelector('[role="alert"]')!.textContent).toBe("Build model needs at least 10 rows with a value.");
    expect(mount.querySelector(".build-model-result")).toBeNull();

    await act(async () => button(mount, "Build model")!.click());
    await reply("gridTableRows", messages[2].body.requestId, { rows: tableRows, truncated: true });
    await until(() => mount.querySelector('[role="alert"]') !== null);
    expect(mount.querySelector('[role="alert"]')!.textContent).toBe("Build model works on up to 20,000 rows.");
  });
});
