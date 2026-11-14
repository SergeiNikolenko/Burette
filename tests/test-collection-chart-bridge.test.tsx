import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useCollectionChartSource } from "../apps/desktop/src/hooks/use-collection-chart-source";
import { resolveChartConfig } from "../apps/desktop/src/lib/collection-chart-config";
import { chartSeriesKey, rowMask, type CategorySeries, type ChartColumn, type NumericSeries } from "../apps/desktop/src/lib/collection-chart-data";
import { createGrid, type GridRow, type Posted } from "./fixtures/collection-chart/grid-harness";

const browser = new Window();
Object.assign(globalThis, { window: browser, document: browser.document, CSS: browser.CSS,
  MessageEvent: browser.MessageEvent, CustomEvent: browser.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });

const series = ["A", "B", "A", "C", "A", ""];
const rows: GridRow[] = series.map((label, index) => ({
  index,
  name: `Molecule ${index + 1}`,
  props: { Weight: String(100 + index * 10), Series: label, Note: index === 1 ? "x".repeat(500) : "ok" },
  descriptors: { logp: { value: index / 2 } },
}));
const chartColumns = [
  { id: "prop:Weight", valueType: "number" },
  { id: "descriptor:logp", valueType: "number" },
  { id: "prop:Series", valueType: "text" },
  { id: "prop:Note", valueType: "text" },
];

test("the grid answers a chart request with whole columns, edits applied", async () => {
  const grid = createGrid(rows);
  grid.state.hiddenRows.add(4);
  grid.state.rowPatches.set(0, { name: "Edited", molblock: "", smiles: "", props: { Weight: "999", Series: "B", Note: "ok" } });
  await grid.request({ requestId: "r1", subscriberId: "chart", columns: chartColumns });
  expect(grid.posted).toEqual([{
    type: "collectionChartData",
    requestId: "r1",
    sourceRecordIds: [0, 1, 2, 3, 5],
    columns: [
      { id: "prop:Weight", valueType: "number", values: [999, 110, 120, 130, 150] },
      { id: "descriptor:logp", valueType: "number", values: [0, 0.5, 1, 1.5, 2.5] },
      { id: "prop:Series", valueType: "text", values: ["B", "B", "A", "C", ""] },
      { id: "prop:Note", valueType: "text", values: ["ok", "x".repeat(120), "ok", "ok", "ok"] },
    ],
    total: 5,
  }]);
  // A value that is not a number is sent as a blank, never as zero.
  grid.posted.length = 0;
  await grid.request({ requestId: "r2", subscriberId: "chart", columns: [{ id: "prop:Series", valueType: "number" }, { id: "prop:Missing", valueType: "text" }] });
  expect(grid.posted[0].columns).toEqual([
    { id: "prop:Series", valueType: "number", values: [null, null, null, null, null] },
    { id: "prop:Missing", valueType: "text", values: ["", "", "", "", ""] },
  ]);
  // Requests without an id or an owner are ignored, and columns are capped.
  grid.posted.length = 0;
  await grid.request({ requestId: "", subscriberId: "chart", columns: chartColumns });
  await grid.request({ requestId: "r3", subscriberId: "", columns: chartColumns });
  expect(grid.posted).toEqual([]);
  await grid.request({ requestId: "r4", subscriberId: "chart", columns: Array.from({ length: 9 }, (_, index) => ({ id: `prop:c${index}`, valueType: "text" })) });
  expect(grid.posted[0].columns.length).toBe(6);
});

test("a paged collection is read by one walk over its unfiltered pages", async () => {
  const many: GridRow[] = Array.from({ length: 1_000 }, (_, index) => ({ index, props: { Weight: String(index) } }));
  const grid = createGrid(many, { pageSize: 240 });
  grid.state.hiddenRows.add(3);
  grid.state.insertedRows.push({ index: 5_000, props: { Weight: "77" } });
  await grid.request({ requestId: "walk", subscriberId: "chart", columns: [{ id: "prop:Weight", valueType: "number" }] });
  // 240 rows a page: five requests cover 1,000 rows, and none carries a filter.
  expect(grid.pageRequests.map(request => request.offset)).toEqual([0, 240, 480, 720, 960]);
  expect(grid.pageRequests[0]).toEqual({ type: "gridFetchPage", query: "", sort: "index", offset: 0, limit: 240 });
  const answer = grid.posted[0];
  expect(answer.sourceRecordIds.length).toBe(1_000);
  expect(answer.sourceRecordIds.slice(0, 5)).toEqual([0, 1, 2, 4, 5]);
  expect(answer.sourceRecordIds.at(-1)).toBe(5_000);
  expect(answer.columns[0].values.at(-1)).toBe(77);
  expect(answer.total).toBe(1_000);
  expect(grid.state.collectionChartRequests.size).toBe(0);
});

test("a newer request from the same chart replaces a walk that is still running, and an edit cancels it", async () => {
  const many: GridRow[] = Array.from({ length: 600 }, (_, index) => ({ index, props: { Weight: String(index) } }));
  const grid = createGrid(many, { pageSize: 240 });
  grid.gate.held = true;
  const first = grid.request({ requestId: "first", subscriberId: "chart", columns: [{ id: "prop:Weight", valueType: "number" }] });
  await Promise.resolve();
  grid.gate.held = false;
  const second = grid.request({ requestId: "second", subscriberId: "chart", columns: [{ id: "prop:Weight", valueType: "number" }] });
  grid.release();
  await Promise.all([first, second]);
  expect(grid.posted.map(message => message.requestId)).toEqual(["second"]);
  // A different chart is not cancelled by it.
  grid.posted.length = 0;
  await Promise.all([
    grid.request({ requestId: "right", subscriberId: "right-dock", columns: [] }),
    grid.request({ requestId: "bottom", subscriberId: "bottom-dock", columns: [] }),
  ]);
  expect(grid.posted.map(message => message.requestId).sort()).toEqual(["bottom", "right"]);
  // An edit bumps the source revision; the stale walk posts nothing.
  grid.posted.length = 0;
  grid.gate.held = true;
  const stale = grid.request({ requestId: "stale", subscriberId: "chart", columns: [] });
  await Promise.resolve();
  grid.state.sourceRevision += 1;
  grid.gate.held = false;
  grid.release();
  await stale;
  expect(grid.posted).toEqual([]);
});

test("the bridge limit caps a paged collection at 100,000 rows and reports the real total", async () => {
  const many: GridRow[] = Array.from({ length: 100_300 }, (_, index) => ({ index }));
  const grid = createGrid(many, { pageSize: 1_000 });
  await grid.request({ requestId: "big", subscriberId: "chart", columns: [{ id: "index", valueType: "number" }] });
  const answer = grid.posted[0];
  expect(answer.sourceRecordIds.length).toBe(100_000);
  expect(answer.columns[0].values.length).toBe(100_000);
  expect(answer.columns[0].values[99_999]).toBe(100_000);
  expect(answer.total).toBe(100_300);
  expect(grid.pageRequests.length).toBe(100);
});

test("the chart source keeps columns, rows, selection and filters in step with the grid", async () => {
  document.body.innerHTML = '<iframe class="viewer-iframe" data-document-id="grid" data-renderer="grid2d"></iframe><iframe class="viewer-iframe" data-document-id="other" data-renderer="grid2d"></iframe><div id="host"></div>';
  const [frame, otherFrame] = [...document.querySelectorAll("iframe")];
  const gridWindow = frame.contentWindow as unknown as Window;
  const grid = createGrid(rows);
  const hostMessages: Posted[] = [];
  const dispatch = (body: Record<string, unknown>, source: Window = gridWindow) => {
    window.dispatchEvent(new MessageEvent("message", { source, data: { source: "burette-grid", body: { documentId: "grid", ...body } } }));
  };
  const emit = (body: Record<string, unknown>, source?: Window) => act(async () => dispatch(body, source));
  let columns: Array<ChartColumn & { kind: string }> = [
    { id: "prop:Weight", label: "Weight", type: "number", kind: "property" },
    { id: "prop:Series", label: "Series", type: "text", kind: "property" },
  ];
  // The fake frame routes host messages into the production grid handler and
  // answers on a later task, as a real frame does.
  gridWindow.postMessage = ((message: { source: string; body: Posted }) => {
    expect(message.source).toBe("burette-grid-host");
    expect(message.body.documentId).toBe("grid");
    hostMessages.push(message.body);
    if (message.body.type === "chemicalSpaceRequestColumns") {
      setTimeout(() => dispatch({ type: "chemicalSpaceColumns", requestId: message.body.requestId, columns }), 0);
    }
    if (message.body.type === "collectionChartRequestData") {
      void grid.request(message.body).then(() => setTimeout(() => dispatch(grid.posted.pop()!), 0));
    }
  }) as typeof gridWindow.postMessage;

  let source!: ReturnType<typeof useCollectionChartSource>;
  const choices = { type: "bar" as const, y: { bar: "prop:Weight" } };
  const columnsToRead = (available: readonly ChartColumn[]) => resolveChartConfig(available, choices)?.requests ?? [];
  function Harness({ active }: { active: boolean }) {
    source = useCollectionChartSource("grid", active, columnsToRead);
    return null;
  }
  const root = createRoot(document.getElementById("host")!);
  // React applies what arrived during an act when it ends, so a request and
  // its answer take one turn each.
  const settle = async (turns = 3) => {
    for (let turn = 0; turn < turns; turn += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  };
  try {
    await act(async () => root.render(<Harness active />));
    await settle();
    // Opening the tab subscribes to the filter state and reads the columns it draws.
    const subscription = hostMessages.find(message => message.type === "chemicalSpaceVisibilitySubscription")!;
    expect(subscription.active).toBe(true);
    expect(hostMessages.some(message => message.type === "chemicalSpaceRequestState")).toBe(true);
    expect(hostMessages.find(message => message.type === "chemicalSpaceRequestColumns")!.includeAllColumns).toBe(true);
    const dataRequest = hostMessages.find(message => message.type === "collectionChartRequestData")!;
    expect(dataRequest.columns).toEqual([{ id: "prop:Series", valueType: "text" }, { id: "prop:Weight", valueType: "number" }]);
    expect(dataRequest.subscriberId).toBe(subscription.subscriberId);
    expect(source.columns).toEqual([
      { id: "prop:Weight", label: "Weight", type: "number" },
      { id: "prop:Series", label: "Series", type: "text" },
    ]);
    const table = source.table!;
    expect([...table.sourceRecordIds]).toEqual([0, 1, 2, 3, 4, 5]);
    const category = table.series.get(chartSeriesKey({ id: "prop:Series", valueType: "text" })) as CategorySeries;
    expect(category.labels).toEqual(["A", "B", "C"]);
    expect([...category.codes]).toEqual([0, 1, 0, 2, 0, -1]);
    expect((table.series.get(chartSeriesKey({ id: "prop:Weight", valueType: "number" })) as NumericSeries).max).toBe(150);

    // Grid → chart: a selection made in the grid arrives as row ids.
    await emit({ type: "gridMenuStateChanged", selectedSourceIndexes: [2, 4] });
    expect([...rowMask(table, source.selectedIds)]).toEqual([0, 0, 1, 0, 1, 0]);
    // The same message from another document's frame is not this grid speaking.
    await emit({ type: "gridMenuStateChanged", selectedSourceIndexes: [0] }, otherFrame.contentWindow as unknown as Window);
    expect(source.selectedIds).toEqual([2, 4]);

    // Chart → grid: picking rows selects them in the grid without filtering it.
    hostMessages.length = 0;
    await act(async () => source.select([1, 3], 3));
    expect(hostMessages).toEqual([{
      type: "chemicalSpaceSelectionChanged", documentId: "grid",
      sourceRecordIds: [1, 3], filterToSelection: false, focusSourceRecordId: 3,
    }]);
    expect(source.selectedIds).toEqual([1, 3]);

    // Grid filters: only the rows that pass are drawn, and clearing them restores all.
    await emit({ type: "chemicalSpaceVisibilityChanged", kind: "filtered", sourceRecordIds: [0, 2, 4] });
    expect([...rowMask(table, source.visibleIds)]).toEqual([1, 0, 1, 0, 1, 0]);
    await emit({ type: "chemicalSpaceVisibilityChanged", kind: "all" });
    expect(source.visibleIds).toBeNull();

    // An edit in the grid re-reads the rows.
    hostMessages.length = 0;
    grid.state.rowPatches.set(5, { name: "", molblock: "", smiles: "", props: { Weight: "500", Series: "C" } });
    grid.state.sourceRevision = 1;
    await emit({ type: "gridDirtyChanged", dirty: true, sourceRevision: 1 });
    await settle();
    expect(hostMessages.filter(message => message.type === "collectionChartRequestData").length).toBe(1);
    expect((source.table!.series.get(chartSeriesKey({ id: "prop:Weight", valueType: "number" })) as NumericSeries).max).toBe(500);

    // The grid's filter model is its only notice that columns or values changed
    // without an edit. The first one sets the ranges the chart was read at.
    const weight = { id: "prop:Weight", type: "number", min: 100, max: 500, bins: [5, 1] };
    await emit({ type: "gridFilterModel", model: { columns: [weight] } });
    await settle();
    // A new computed column shows up in the catalog; a filter change alone reads nothing again.
    hostMessages.length = 0;
    columns = [...columns, { id: "descriptor:logp", label: "LogP", type: "number", kind: "descriptor" }];
    await emit({ type: "gridFilterModel", model: { columns: [{ ...weight, filter: { min: "120", max: "", text: "" } }] } });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); });
    await settle();
    expect(source.columns!.map(column => column.id)).toEqual(["prop:Weight", "prop:Series", "descriptor:logp"]);
    expect(hostMessages.filter(message => message.type === "collectionChartRequestData").length).toBe(0);
    // Values that arrive without an edit move the charted column's range, which does.
    await emit({ type: "gridFilterModel", model: { columns: [{ ...weight, max: 640 }] } });
    await settle();
    expect(hostMessages.filter(message => message.type === "collectionChartRequestData").length).toBe(1);
    // A paged collection reports the range of its loaded pages; scrolling must not re-read it.
    hostMessages.length = 0;
    await emit({ type: "gridFilterModel", model: { columns: [{ ...weight, max: 900, statsRows: 240, statsTotal: 1000 }] } });
    await settle();
    expect(hostMessages.filter(message => message.type === "collectionChartRequestData").length).toBe(1);
    hostMessages.length = 0;
    await emit({ type: "gridFilterModel", model: { columns: [{ ...weight, max: 950, statsRows: 480, statsTotal: 1000 }] } });
    await settle();
    expect(hostMessages.filter(message => message.type === "collectionChartRequestData").length).toBe(0);

    // Hiding the dock gives the filter subscription back.
    hostMessages.length = 0;
    await act(async () => root.render(<Harness active={false} />));
    expect(hostMessages).toEqual([{
      type: "chemicalSpaceVisibilitySubscription", documentId: "grid",
      subscriberId: subscription.subscriberId, active: false,
    }]);
    expect(source.table).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
