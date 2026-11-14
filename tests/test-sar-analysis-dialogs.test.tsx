// The Matched pairs and SAR table dialogs on the factor Xa series, driven
// through the grid's message channel. The pairs come from the real module on
// RDKit WASM (the worker's body, run inline); only the drawings are stubbed.
import { afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act } from "react";
import initRDKitModule from "@rdkit/rdkit";
import { findMatchedPairs, type MatchedPairInput } from "../apps/desktop/src/lib/matched-pairs/matched-pairs";
import { buildSarTable } from "../apps/desktop/src/lib/sar-table";

const browser = new Window();
for (const key of ["CSS", "MessageEvent", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLFormElement", "DocumentFragment", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : (browser as any)[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const rdkit = await initRDKitModule();
mock.module("../apps/desktop/src/components/rgroup-preview", () => ({
  Structure: ({ smiles }: { smiles: string }) => <span data-structure={smiles} />,
}));
mock.module("../apps/desktop/src/lib/matched-pairs/matched-pairs-task", () => ({
  runMatchedPairs: async (molecules: MatchedPairInput[]) => findMatchedPairs(rdkit, molecules),
}));
const { createRoot } = await import("react-dom/client");
const { MatchedPairsDialog } = await import("../apps/desktop/src/components/matched-pairs-dialog");
const { SarTableDialog } = await import("../apps/desktop/src/components/sar-table-dialog");

const records = readFileSync(new URL("./fixtures/matched-pairs/chembl-fxa-benzamides.sdf", import.meta.url), "utf8")
  .split("$$$$\n").filter((record) => record.trim()).map((record, index) => {
    const end = record.indexOf("M  END\n") + "M  END\n".length;
    const tags = Object.fromEntries([...record.slice(end).matchAll(/>  <([^>]+)>.*\n(.+)\n/g)].map((match) => [match[1], match[2]]));
    return { index, name: record.slice(0, record.indexOf("\n")), molblock: record.slice(0, end), tags };
  });
const column = (tag: string) => records.flatMap(({ index, tags }) => (tags[tag] ? [[index, tags[tag]] as [number, string]] : []));

// The grid iframe: answers the record and column requests, keeps the rest.
type Body = Record<string, any>;
const sent: Body[] = [];
const fromGrid = (body: Body) => act(async () => { window.dispatchEvent(new MessageEvent("message", { data: { source: "burette-grid", body } })); });
const iframe = document.createElement("iframe");
iframe.className = "viewer-iframe"; iframe.dataset.documentId = "fxa"; iframe.dataset.renderer = "grid2d"; document.body.append(iframe);
iframe.contentWindow!.postMessage = ({ body }: { body: Body }) => {
  sent.push(body);
  const columnId = String(body.columnId ?? "").replace(/^prop:/, "");
  const answer = body.type === "chemicalSpaceRequestRecords"
    ? { type: "chemicalSpaceRecords", records: records.map(({ index, molblock }) => ({ sourceRecordId: index, format: "molblock", input: molblock })) }
    : body.type === "chemicalSpaceRequestColumnText"
      ? { type: "chemicalSpaceColumnText", values: columnId === "name" ? records.map(({ index, name }) => [index, name]) : column(columnId) }
      : body.type === "chemicalSpaceRequestColumnValues"
        ? { type: "chemicalSpaceColumnValues", values: column(columnId).map(([index, value]) => [index, Number(value)]) }
        : null;
  if (answer) queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { data: { source: "burette-grid", body: { ...answer, requestId: body.requestId } } })));
};
const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
const root = createRoot(mount);
let dismissed = 0;
const settle = async () => { for (let turn = 0; turn < 20; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
afterEach(async () => { await act(async () => root.render(null)); sent.length = 0; dismissed = 0; });

const numeric = [{ id: "prop:pKi", label: "pKi", type: "number" as const, kind: "property" }];
const text = (selector: string) => [...document.querySelectorAll(selector)].map((node) => node.textContent ?? "");
const button = (label: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === label) as HTMLButtonElement;
const choose = (name: string, value: string) => act(async () => {
  const select = document.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
});

test("matched pairs lists mmpdb's transformations, shows the pairs and selects them", async () => {
  await act(async () => root.render(<MatchedPairsDialog request={{ documentId: "fxa", documentTitle: "fxa.sdf", columns: numeric }} onDismiss={() => { dismissed += 1; }} />));
  await settle();
  const rows = () => [...document.querySelectorAll("tbody tr")];
  // The three commonest transformations with mmpdb's count, mean and deviation.
  expect(rows().slice(0, 3).map((row) => [row.getAttribute("aria-label"), ...[...row.querySelectorAll("td")].slice(2).map((cell) => cell.textContent)])).toEqual([
    ["[*:1]Cl to [*:1]F, 13 pairs", "13", "−0.31", "0.34"],
    ["[*:1]Cl to [*:1]OC, 8 pairs", "8", "−0.54", "0.52"],
    ["[*:1]C to [*:1][H], 8 pairs", "8", "+0.21", "0.60"],
  ]);
  expect(rows()[0].querySelector("[data-structure]")?.getAttribute("data-structure")).toBe("*Cl");
  expect(text('[role="status"]')).toEqual(["1–6 of 317", "1 molecule was left out."]);
  expect(button("Select in grid").disabled).toBe(true);

  await act(async () => (rows()[0] as HTMLElement).click());
  expect(rows()[0].getAttribute("aria-selected")).toBe("true");
  const pairs = document.querySelector('[aria-label="Pairs"]')!;
  expect([...pairs.querySelectorAll("figcaption")].map((caption) => caption.textContent)).toEqual(["CHEMBL926137.44", "CHEMBL3286117.15", "CHEMBL3272535.81", "CHEMBL3164815.34"]);
  expect(text(".matched-pairs-delta")).toEqual(["−0.29", "−0.47"]);
  expect(pairs.querySelectorAll("figure")).toHaveLength(4);
  expect(text('[aria-label="Pairs"] [role="status"]')).toEqual(["1–2 of 13"]);

  await choose("sort", "increase");
  expect(rows()[0].querySelectorAll("td")[3].textContent).toMatch(/^\+/);
  await choose("sort", "pairs");
  await act(async () => button("Select in grid").click());
  const selection = sent.find((body) => body.type === "chemicalSpaceSelectionChanged")!;
  expect(selection.filterToSelection).toBe(false);
  expect(selection.sourceRecordIds).toHaveLength(new Set(selection.sourceRecordIds).size);
  expect(selection.sourceRecordIds.length).toBeGreaterThan(13);
  expect(dismissed).toBe(1);
});

const sarRequest = {
  documentId: "fxa", documentTitle: "fxa.sdf", columns: numeric, seriesColumnId: "prop:RGroup_Series",
  positions: [1, 2, 3, 4, 5, 6].map((position) => ({ id: `prop:RGroup_R${position}`, label: `RGroup_R${position}`, type: "text" as const, kind: "property" })),
};

test("the SAR table lays the largest series out by its two most varied positions", async () => {
  await act(async () => root.render(<SarTableDialog request={sarRequest} onDismiss={() => { dismissed += 1; }} />));
  await settle();
  const value = (name: string) => document.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!.value;
  expect([value("series"), value("rows"), value("columns"), value("colour")]).toEqual(["S1", "prop:RGroup_R4", "prop:RGroup_R1", "prop:pKi"]);
  const table = document.querySelector("table.sar-table")!;
  expect(table.querySelectorAll("tbody tr")).toHaveLength(18);
  expect([...table.querySelectorAll("thead th")].slice(1).map((cell) => cell.getAttribute("title"))).toEqual(
    ["Cl[*:1]", "[H][*:1]", "Br[*:1]", "CO[*:1]", "C[*:1]", "F[*:1]", "N#C[*:1]", "N[*:1]", "CC(C)(C)OC(=O)N[*:1]"]);
  // Hydrogen is written, every other substituent is drawn.
  expect(table.querySelector("thead th:nth-child(3)")?.textContent).toBe("H");
  expect(table.querySelector("thead th:nth-child(2) [data-structure]")?.getAttribute("data-structure")).toBe("Cl*");
  const row = (index: number) => [...table.querySelectorAll("tbody tr")[index].querySelectorAll("td")];
  expect(table.querySelectorAll("tbody tr")[0].querySelector("th")?.getAttribute("title")).toBe("Cl[*:4]");
  expect(row(0).map((cell) => cell.textContent)).toEqual(["7.76", "5.65", "7.44", "6.50", "6.91", "6.99", "5.81", "6.38", "5.34"]);
  expect(row(2).map((cell) => cell.textContent)).toEqual(["7.13", "", "", "", "", "", "", "", ""]);
  expect(row(0)[0].getAttribute("title")).toBe("Mean of 3 of 3 molecules");
  // The scale runs over the cell means: the best cell is the strongest tint.
  expect([row(0)[0], row(0)[8]].map((cell) => (cell as HTMLElement).style.getPropertyValue("--sar-shade"))).toEqual(["60%", "10%"]);

  // Hovering asks the grid for the cell's molecules one at a time.
  await act(async () => row(0)[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  const hovers = () => sent.filter((body) => body.type === "chemicalSpaceHoverChanged").map((body) => body.sourceRecordId);
  expect(hovers()).toEqual([17]);
  await fromGrid({ type: "chemicalSpaceMoleculePreview", sourceRecordId: 17, name: records[17].name, svgBase64: "PHN2Zy8+" });
  expect(hovers()).toEqual([17, 38]);
  const molecules = document.querySelector('[aria-label="Molecules in the cell"]')!;
  expect(molecules.querySelector("img")?.getAttribute("src")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
  expect(molecules.querySelector("figcaption")?.textContent).toBe(`${records[17].name}${Number(records[17].tags.pKi).toFixed(2)}`);

  expect(button("Select in grid").disabled).toBe(true);
  await act(async () => row(0)[1].click());
  await act(async () => button("Select in grid").click());
  expect(sent.find((body) => body.type === "chemicalSpaceSelectionChanged")?.sourceRecordIds).toEqual([27, 28]);
  expect(dismissed).toBe(1);
});

test("a series with one varied position has no table to show", async () => {
  await act(async () => root.render(<SarTableDialog request={sarRequest} onDismiss={() => {}} />));
  await settle();
  await choose("series", "S2");
  expect(document.querySelector("table.sar-table")).toBeNull();
  expect(text('[role="status"]')).toEqual(["This series varies at fewer than two positions."]);
});

test("cells hold the molecules of one substituent pair and the mean of their values", () => {
  const rowsOf = new Map([[0, "A"], [1, "A"], [2, "B"], [3, "B"], [4, "C"], [5, ""]]);
  const columnsOf = new Map([[0, "x"], [1, "x"], [2, "x"], [3, "y"], [4, "y"], [5, "x"]]);
  const values = new Map([[0, 5], [1, 7], [2, 4], [4, 9]]);
  expect(buildSarTable(rowsOf, columnsOf, values, null)).toEqual({
    rowGroups: ["A", "B", "C"], columnGroups: ["x", "y"],
    cells: [
      [{ ids: [0, 1], mean: 6, valued: 2 }, null],
      [{ ids: [2], mean: 4, valued: 1 }, { ids: [3], mean: null, valued: 0 }],
      [null, { ids: [4], mean: 9, valued: 1 }],
    ],
    min: 4, max: 9, capped: { rows: false, columns: false },
  });
  // A series keeps only its members; past the limit the rarest groups go.
  expect(buildSarTable(rowsOf, columnsOf, values, new Set([2, 3])).rowGroups).toEqual(["B"]);
  expect(buildSarTable(rowsOf, columnsOf, values, null, 2)).toMatchObject({ rowGroups: ["A", "B"], capped: { rows: true, columns: false } });
});
