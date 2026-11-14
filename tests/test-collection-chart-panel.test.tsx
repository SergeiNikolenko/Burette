import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { createGrid, type GridRow, type Posted } from "./fixtures/collection-chart/grid-harness";

const browser = new Window();
for (const key of ["window", "document", "navigator", "DocumentFragment", "HTMLElement", "HTMLFormElement", "HTMLSelectElement",
  "HTMLInputElement", "HTMLButtonElement", "SVGElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "KeyboardEvent",
  "PointerEvent", "FocusEvent", "MessageEvent", "CustomEvent", "MutationObserver", "getComputedStyle", "DOMRect", "CSS",
  "DOMException"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : (browser as any)[key] });
}
// The canvas has a size as soon as it is observed, and frames run on a timer.
const WIDTH = 640;
const HEIGHT = 360;
class ImmediateResizeObserver {
  constructor(private readonly callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void) {}
  observe() { this.callback([{ contentRect: { width: WIDTH, height: HEIGHT } }]); }
  disconnect() {}
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: ImmediateResizeObserver,
  requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});
Object.assign(browser, { ResizeObserver: ImmediateResizeObserver, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });

// happy-dom has no canvas renderer. This context records what the charts draw
// and gives text a width, which is all the layout reads back from it.
const drawn: Array<{ call: string; args: unknown[] }> = [];
const frames: Array<{ width: number; height: number; pixels: Uint32Array }> = [];
const context = new Proxy({} as Record<string, unknown>, {
  get(target, property: string) {
    if (property in target) return target[property];
    if (property === "measureText") return (text: string) => ({ width: text.length * 6 });
    if (property === "createImageData") return (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
    if (property === "getImageData") return () => ({ data: Uint8ClampedArray.from([30, 30, 30, 255]) });
    if (property === "putImageData") {
      return (image: { width: number; height: number; data: Uint8ClampedArray }) => {
        frames.push({ width: image.width, height: image.height, pixels: new Uint32Array(image.data.buffer.slice(0)) });
      };
    }
    return (...args: unknown[]) => { drawn.push({ call: property, args }); };
  },
  set(target, property: string, value) {
    target[property] = value;
    return true;
  },
});
const canvasPrototype = (browser as any).HTMLCanvasElement.prototype;
canvasPrototype.getContext = function getContext(this: HTMLCanvasElement) {
  (context as any).canvas = this;
  return context;
};
canvasPrototype.setPointerCapture = () => {};

const { createRoot } = await import("react-dom/client");
const { CollectionChartPanel } = await import("../apps/desktop/src/components/collection-chart-panel");

const records = readFileSync("tests/fixtures/collection-chart/moses-properties.sdf", "utf8")
  .split("$$$$\n").filter(block => block.trim())
  .map(block => Object.fromEntries([...block.matchAll(/> <([^>]+)>\n([^\n]*)/gu)].map(match => [match[1], match[2]])));
const reference = JSON.parse(readFileSync("tests/fixtures/collection-chart/reference.json", "utf8"));
const rows: GridRow[] = records.map((props, index) => ({ index, name: `MOSES ${index + 1}`, props }));
const columns = ["MolWt", "SLogP", "TPSA", "Rings", "Halogen"].map(name => ({
  id: `prop:${name}`, label: name, type: name === "Halogen" ? "text" : "number", kind: "property",
}));

test("the Chart tab draws the fixture, selects grid rows from every chart type and follows grid filters", async () => {
  document.body.innerHTML = '<div class="app-shell"><iframe class="viewer-iframe" data-document-id="grid" data-renderer="grid2d"></iframe><div id="host"></div></div>';
  const gridWindow = document.querySelector("iframe")!.contentWindow as unknown as Window;
  const grid = createGrid(rows);
  const hostMessages: Posted[] = [];
  const dispatch = (body: Record<string, unknown>) => {
    window.dispatchEvent(new MessageEvent("message", { source: gridWindow, data: { source: "burette-grid", body: { documentId: "grid", ...body } } }));
  };
  gridWindow.postMessage = ((message: { body: Posted }) => {
    hostMessages.push(message.body);
    if (message.body.type === "chemicalSpaceRequestColumns") {
      setTimeout(() => dispatch({ type: "chemicalSpaceColumns", requestId: message.body.requestId, columns }), 0);
    }
    if (message.body.type === "collectionChartRequestData") {
      void grid.request(message.body).then(() => setTimeout(() => dispatch(grid.posted.pop()!), 0));
    }
    // The grid reports its selection back, as it does after any selection change.
    if (message.body.type === "chemicalSpaceSelectionChanged") {
      setTimeout(() => dispatch({ type: "gridMenuStateChanged", selectedSourceIndexes: message.body.sourceRecordIds }), 0);
    }
  }) as typeof gridWindow.postMessage;

  const host = document.getElementById("host")!;
  const root = createRoot(host);
  const settle = async (turns = 4) => {
    for (let turn = 0; turn < turns; turn += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  };
  const panel = () => host.querySelector<HTMLElement>('[data-testid="collection-chart-panel"]')!;
  const choose = async (label: string, value: string) => {
    const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
      ?? [...host.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`)].map(element => element.parentElement!.querySelector("select")).find(Boolean)!;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  };
  const pointer = (type: string, x: number, y: number, init: Record<string, unknown> = {}) => {
    const canvas = [...host.querySelectorAll("canvas")].at(-1)!;
    const event = new Event(type, { bubbles: true }) as any;
    Object.assign(event, { clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: false, ...init });
    canvas.dispatchEvent(event);
  };
  const click = async (x: number, y: number, init: Record<string, unknown> = {}) => {
    await act(async () => { pointer("pointerdown", x, y, init); pointer("pointerup", x, y, init); });
    await settle();
  };
  const selections = () => hostMessages.filter(message => message.type === "chemicalSpaceSelectionChanged");
  const table = () => [...host.querySelectorAll("canvas table tbody tr")].map(row => [...row.children].map(cell => cell.textContent));

  try {
    await act(async () => root.render(<CollectionChartPanel document={{ id: "grid", renderer: "grid2d" } as ViewerDocument} visible />));
    await settle();

    // Two number columns: the tab opens on a scatter of the first against the second.
    expect(panel().dataset).toMatchObject({ chartType: "scatter", rows: "47", selected: "0" });
    expect(host.querySelector('canvas[aria-label="Scatter chart of SLogP against MolWt"]')).not.toBeNull();
    expect(host.querySelector("canvas p")!.textContent).toBe("47 points, 0 selected");
    // The frame holds points: pixels that are neither background nor grid line.
    const frame = frames.at(-1)!;
    expect([frame.width, frame.height]).toEqual([WIDTH, HEIGHT]);
    const background = frame.pixels[0];
    expect(new Set(frame.pixels).size).toBeGreaterThan(3);
    expect(frame.pixels.filter(pixel => pixel !== background).length).toBeGreaterThan(47 * 9);

    // A lasso around the whole plot selects every row; a click on empty space clears it.
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Lasso selection"]')!.click());
    await act(async () => {
      pointer("pointerdown", 2, 2);
      for (const [x, y] of [[WIDTH - 2, 2], [WIDTH - 2, HEIGHT - 2], [2, HEIGHT - 2], [2, 4]]) pointer("pointermove", x, y);
      pointer("pointerup", 2, 4);
    });
    await settle();
    expect(selections().at(-1)).toMatchObject({ filterToSelection: false, focusSourceRecordId: null });
    expect(selections().at(-1)!.sourceRecordIds.length).toBe(47);
    expect(panel().dataset.selected).toBe("47");
    expect(host.textContent).toContain("47 selected");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Lasso selection"]')!.click());
    await click(WIDTH - 3, HEIGHT - 3);
    expect(selections().at(-1)!.sourceRecordIds).toEqual([]);
    expect(panel().dataset.selected).toBe("0");

    // Colour by a category shows its legend, and a legend entry selects its rows.
    await choose("Colour column", "prop:Halogen");
    const legend = host.querySelector('[data-testid="collection-chart-legend"]')!;
    expect([...legend.querySelectorAll("button")].map(button => button.textContent)).toEqual(["none", "F", "Cl", "Br+F", "Cl+F"]);
    await act(async () => legend.querySelectorAll("button")[1].click());
    await settle();
    expect(selections().at(-1)!.sourceRecordIds.map((id: number) => records[id].Halogen)).toEqual(Array(7).fill("F"));
    await choose("Colour column", "prop:TPSA");
    expect(host.querySelector('[data-testid="collection-chart-legend"]')!.textContent).toBe("TPSA17.8299.77");
    await choose("Size column", "prop:Rings");
    expect(panel().dataset.chartType).toBe("scatter");

    // Histogram of MolWt: the bins and counts NumPy gives on the same edges.
    await choose("Chart type", "histogram");
    expect(host.querySelector('canvas[aria-label="Histogram of MolWt"]')).not.toBeNull();
    expect(table().map(row => row.slice(0, 2))).toEqual([
      ["240 – 260", "2"], ["260 – 280", "5"], ["280 – 300", "9"], ["300 – 320", "13"], ["320 – 340", "15"], ["340 – 360", "3"],
    ]);
    expect(table().map(row => Number(row[1]))).toEqual(reference.histogram.MolWt);
    // The seven fluorinated rows picked from the legend are counted in their bins.
    const fluorinatedPerBin = [0, 0, 0, 0, 0, 0];
    for (const record of records) if (record.Halogen === "F") fluorinatedPerBin[Math.floor((Number(record.MolWt) - 240) / 20)] += 1;
    expect(table().map(row => Number(row[2]))).toEqual(fluorinatedPerBin);
    // Clicking the fifth bin selects its 15 rows in the grid.
    await click(482, 150);
    const binned = selections().at(-1)!.sourceRecordIds as number[];
    expect(binned.length).toBe(15);
    expect(binned.every(id => Number(records[id].MolWt) >= 320 && Number(records[id].MolWt) < 340)).toBe(true);
    expect(table()[4]).toEqual(["320 – 340", "15", "15"]);
    // Shift-click adds the next bin; dragging across bins selects the range.
    await click(570, 150, { shiftKey: true });
    expect(selections().at(-1)!.sourceRecordIds.length).toBe(18);
    await act(async () => { pointer("pointerdown", 100, 150); pointer("pointermove", 200, 150); pointer("pointerup", 200, 150); });
    await settle();
    expect(selections().at(-1)!.sourceRecordIds.length).toBe(7);
    expect(table().map(row => row[2])).toEqual(["2", "5", "0", "0", "0", "0"]);

    // A selection made in the grid highlights its share of each bar.
    await choose("Chart type", "bar");
    expect(host.querySelector('canvas[aria-label="Bar chart of Count by Halogen"]')).not.toBeNull();
    const chlorinated = records.flatMap((record, id) => record.Halogen === "Cl" ? [id] : []);
    await act(async () => dispatch({ type: "gridMenuStateChanged", selectedSourceIndexes: [...chlorinated, 0] }));
    expect(table()).toEqual([["none", "33", "0"], ["F", "7", "0"], ["Cl", "5", "5"], ["Br+F", "1", "1"], ["Cl+F", "1", "0"]]);
    expect(panel().dataset.selected).toBe("6");
    // The mean of a value column per category.
    await choose("Value column", "prop:MolWt");
    expect(host.querySelector('canvas[aria-label="Bar chart of Mean MolWt by Halogen"]')).not.toBeNull();
    expect(table().map(row => row[1])).toEqual(["308.14", "308.47", "299.47", "283.14", "309.71"]);
    await choose("Value column", "");

    // A grid filter leaves only the rows that pass it.
    const unhalogenated = records.flatMap((record, id) => record.Halogen === "none" ? [id] : []);
    await act(async () => dispatch({ type: "chemicalSpaceVisibilityChanged", kind: "filtered", sourceRecordIds: unhalogenated }));
    expect(table().map(row => row[1])).toEqual(["33", "0", "0", "0", "0"]);
    expect(panel().dataset.rows).toBe("33");
    expect(host.textContent).toContain("33 of 47 shown");
    await act(async () => dispatch({ type: "chemicalSpaceVisibilityChanged", kind: "all" }));
    expect(panel().dataset.rows).toBe("47");
    expect(host.textContent).not.toContain("shown");

    // Box chart of MolWt by Halogen is the default; switch the value to SLogP.
    await choose("Chart type", "box");
    await choose("Value column", "prop:SLogP");
    expect(host.querySelector('canvas[aria-label="Box chart of SLogP by Halogen"]')).not.toBeNull();
    const boxes = reference.box["SLogP by Halogen"];
    const text = (value: number) => Number(value.toPrecision(5)).toLocaleString();
    expect(table()).toEqual(["none", "F", "Cl", "Br+F", "Cl+F"].map((label) => {
      const box = boxes[label];
      const picked = label === "Cl" ? "5" : label === "Br+F" ? "1" : "0";
      return [label, String(box.count), text(box.whiskerLow), text(box.q1), text(box.median), text(box.q3), text(box.whiskerHigh), String(box.outliers.length), picked];
    }));
    // One box over every row when no group is picked.
    await choose("Group column", "");
    expect(table().length).toBe(1);
    expect(table()[0].slice(0, 2)).toEqual(["SLogP", "47"]);

    // Every chart type drew through the canvas without the context refusing a call.
    expect(drawn.some(entry => entry.call === "fillRect")).toBe(true);
    expect(drawn.some(entry => entry.call === "fillText" && entry.args[0] === "Halogen")).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});

test("the tab says so when there is no collection, no column, or the grid does not answer", async () => {
  document.body.innerHTML = '<div class="app-shell"><iframe class="viewer-iframe" data-document-id="grid" data-renderer="grid2d"></iframe><div id="host"></div></div>';
  const gridWindow = document.querySelector("iframe")!.contentWindow as unknown as Window;
  let answer: Record<string, unknown> | null = { columns: [] };
  gridWindow.postMessage = ((message: { body: Posted }) => {
    const reply = message.body.type === "chemicalSpaceRequestColumns" ? answer
      : message.body.type === "collectionChartRequestData" ? { type: "collectionChartData", failed: true } : null;
    if (!reply) return;
    setTimeout(() => window.dispatchEvent(new MessageEvent("message", { source: gridWindow, data: {
      source: "burette-grid", body: { documentId: "grid", requestId: message.body.requestId, ...reply },
    } })), 0);
  }) as typeof gridWindow.postMessage;
  const host = document.getElementById("host")!;
  const root = createRoot(host);
  const settle = async () => {
    for (let turn = 0; turn < 4; turn += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  };
  try {
    await act(async () => root.render(<CollectionChartPanel document={null} visible />));
    expect(host.textContent).toBe("No collection selected");
    await act(async () => root.render(<CollectionChartPanel document={{ id: "grid", renderer: "grid2d" } as ViewerDocument} visible />));
    await settle();
    expect(host.textContent).toBe("No columns to chart");
    answer = { columns };
    await act(async () => window.dispatchEvent(new MessageEvent("message", { source: gridWindow, data: {
      source: "burette-grid", body: { documentId: "grid", type: "ready" },
    } })));
    await settle();
    expect(host.textContent).toContain("Could not read the collection");
    expect(host.querySelector("button")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
