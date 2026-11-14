import { expect, test } from "bun:test";
import { categoryCounts } from "../apps/desktop/src/lib/table-shaping";
import { functionSource, sdfRows, type GridRow } from "./fixtures/table-shaping/grid-functions";

// The category filter and the row-list filter live in the grid: it counts the
// values, keeps the filter and decides which rows pass. These run the viewer's
// own functions over the compounds fixture, locally and as a paged collection.
const LIFTED = [
  "remoteCollectionTotal", "filterColumnVaries", "filterColumnIsRowIndex", "filterColumnStats", "categoryValueCounts",
  "filterColumnCategories", "gridFilterModel", "tableColumnDiscoveryRows", "currentLocalCollectionRows",
  "applyVirtualGridEdits", "stripDeletedPropColumns", "tableColumnDisplayValue", "tableColumnRawDisplayValue",
  "tableColumnNumericValue", "tableColumnRawNumericValue", "clampToValueRange", "clampTextToValueRange",
  "applyGridColumnFilter", "clearGridColumnFilters", "tableColumnFilterEmpty", "tableColumnFilterMatches",
  "tableColumnFilterBound", "filterByTableColumnControls", "clientRowFiltersActive", "rowPassesClientFilters",
  "gridAgentFilters", "gridAgentText", "remoteTableColumnFilters", "mergedDescriptorFilters", "mergedAnalysisFilters",
  "gridFetchPayload", "refreshRemoteChemicalSpaceSelection", "refresh", "filterByChemicalSpaceSelection", "applyRowListCommand",
];

const COLUMNS = [
  { id: "name", label: "Name", type: "text" },
  { id: "prop:ChEMBL ID", label: "ChEMBL ID", type: "text" },
  { id: "prop:Class", label: "Class", type: "text" },
  { id: "prop:MW", label: "MW", type: "number" },
];

type Model = { visible: number; total: number; rowListFilter: string | null; columns: Array<Record<string, unknown> & { id: string }> };

function grid(source: GridRow[], options: { remote?: boolean; pageSize?: number } = {}) {
  const remote = options.remote === true;
  const pageSize = options.pageSize ?? 4;
  const state = {
    remoteMode: remote, all: remote ? [] : source.slice(), rows: remote ? source.slice(0, pageSize) : source.slice(),
    totalRows: source.length, recordsTotalHint: source.length, recordsIndexed: source.length, indexReady: true,
    rowPatches: new Map(), insertedRows: [], hiddenRows: new Set<number>(), deletedPropColumns: new Set<string>(),
    selected: new Set<number>(), chemicalSpaceFilterActive: false, columnValueRanges: new Map(),
    filterColumnStatsCache: new Map(), filterColumnVariationCache: new Map(), filterColumnStatsRows: null as GridRow[] | null,
    filterCategoryPins: new Map(), rowListFilter: null as { id: string } | null, selectionAnchorIndex: null as number | null,
    exports: [] as Array<[string, number[]]>, tableColumnFilters: {} as Record<string, unknown>, descriptorFilters: [], descriptorSort: null,
    remoteAnalysisColumns: [], query: "", sort: "index", smarts: "", smartsError: "", smartsMatches: new Map(),
    dataToken: 0, remoteLoadToken: 0, token: 0, remoteLoading: false, renderedCount: 0, visibleCount: 0,
    plainRemoteRefreshes: 0, searchTimer: 0, fetches: [] as Array<Record<string, unknown>>, statuses: [] as string[], visibility: null as number[] | null,
  };
  const api = new Function("state", "columns", "source", "pageSize", `
    const FILTER_BINS = 32;
    const FILTER_CATEGORY_LIMIT = 60;
    const FILTER_CATEGORY_VALUE_CHARS = 80;
    const GRID_AGENT_MAX_TEXT = 256;
    const GRID_SELECTION_BRIDGE_LIMIT = 100000;
    function capabilities() { return { selection: true, export: true }; }
    function syncRenderedSelection() {}
    async function exportCSV() { state.exports.push(['csv', [...state.selected]]); }
    async function exportSmiles() { state.exports.push(['smiles', [...state.selected]]); }
    const document = { getElementById() { return null; } };
    function filterModelColumns() { return columns; }
    function safeConfig() { return {}; }
    function rowSmiles() { return ''; }
    function descriptorNumericValue() { return Number.NaN; }
    function applyColumnValueRanges(row) { return row; }
    function invalidateTableColumnCatalog() {
      state.filterColumnStatsCache.clear();
      state.filterColumnVariationCache.clear();
      state.filterColumnStatsRows = null;
    }
    function updateChrome() {}
    function syncGridEditControls() {}
    function setStatus(message) { state.statuses.push(message); }
    function loadBatchSize() { return pageSize; }
    function applyGridPageState() {}
    async function hydrateDataWarriorRows(rows) { return rows; }
    async function renderVirtualWindow() {}
    function postChemicalSpaceVisibility(rows) { state.visibility = rows.map(row => row.index); }
    // The collection database: it applies the filters it knows - text
    // "contains" and number ranges - and pages the result.
    async function hostRequest(type, payload) {
      state.fetches.push(payload);
      const kept = source.filter(row => (payload.columnFilters || []).every(filter => {
        const text = String(tableColumnRawDisplayValue(row, filter.id));
        if (filter.filterType === 'text') return text.toLowerCase().includes(filter.text.toLowerCase());
        const value = Number(text);
        return text.trim() !== '' && (filter.min === undefined || value >= filter.min) && (filter.max === undefined || value <= filter.max);
      }));
      // 120 is the smallest page the walk asks for; the test pages smaller to cross page borders.
      const limit = Math.min(payload.limit, pageSize);
      return { rows: kept.slice(payload.offset, payload.offset + limit), totalRows: kept.length };
    }
    function resetGridWindowForNewResultSet() {}
    function normalize(value) { return String(value || '').toLowerCase(); }
    function normalizedSearchText(row) { return normalize(row.name); }
    function filterBySMARTS(rows) { return rows; }
    function filterByDescriptorControls(rows) { return rows; }
    function shouldFallbackSMARTSToTextSearch() { return false; }
    function compareWithDescriptorSort(a, b) { return a.index - b.index; }
    function repostInspectorRow() {}
    function render() {}
    async function refreshRemote() { state.plainRemoteRefreshes += 1; }
    ${LIFTED.map(functionSource).join("\n")}
    return { gridFilterModel, applyGridColumnFilter, clearGridColumnFilters, gridAgentFilters, categoryValueCounts, refresh, applyRowListCommand };
  `)(state, COLUMNS, source, pageSize) as {
    gridFilterModel: (cfg: unknown) => Model;
    applyGridColumnFilter: (cfg: unknown, columnId: string, part: string, value: unknown) => void;
    clearGridColumnFilters: (cfg: unknown, columnId: string | null) => void;
    gridAgentFilters: () => unknown[];
    categoryValueCounts: (rows: unknown[], read: (row: never) => unknown, limit: number, maxLength: number) => Array<[string, number]> | null;
    refresh: (cfg: unknown) => Promise<void> | void;
    applyRowListCommand: (body: unknown, cfg: unknown) => void;
  };
  const column = (id: string) => api.gridFilterModel({}).columns.find((entry) => entry.id === id)!;
  const names = () => state.rows.map((row) => row.name);
  return { state, api, column, names };
}

const compounds = () => sdfRows("chembl-compounds.sdf");

test("a text column whose values repeat is offered with the count of every value", () => {
  const { api, column } = grid(compounds());
  expect(column("prop:Class").categories).toEqual([["NSAID", 5], ["Stimulant", 3], ["", 1], ["Analgesic", 1], ["Solvent", 1]]);
  // The same list the host's table module counts.
  expect(column("prop:Class").categories).toEqual(
    categoryCounts(compounds().map((row) => row.props.Class ?? ""), 60)!.map(({ value, count }) => [value, count]),
  );
  // An identifier that repeats once is not a set of categories, nor is a
  // column where every row differs, nor a number column.
  expect(column("prop:ChEMBL ID").categories).toBeUndefined();
  expect(column("name").categories).toBeUndefined();
  expect(column("prop:MW").categories).toBeUndefined();
  expect(column("prop:MW").bins).toHaveLength(32);

  const wide = Array.from({ length: 200 }, (_, index) => ({ value: `v${index % 61}` }));
  expect(api.categoryValueCounts(wide, (row: { value: string }) => row.value, 60, 80)).toBeNull();
  expect(api.categoryValueCounts([{ value: "x".repeat(81) }], (row: { value: string }) => row.value, 60, 80)).toBeNull();
  expect(api.categoryValueCounts([{ value: " b10 " }, { value: "b2" }, { value: "b10" }, { value: "b2" }], (row: { value: string }) => row.value, 60, 80))
    .toEqual([["b2", 2], ["b10", 2]]);
});

test("picked values filter the rows, combine with a numeric range and leave the counts alone", () => {
  const { state, api, column, names } = grid(compounds());
  api.applyGridColumnFilter({}, "prop:Class", "values", ["Stimulant", "Analgesic"]);
  expect(names()).toEqual(["Paracetamol", "Caffeine", "Theophylline", "Nicotine"]);
  expect(column("prop:Class").filter).toEqual({ min: "", max: "", text: "", values: ["Stimulant", "Analgesic"] });
  expect(column("prop:Class").categories).toEqual([["NSAID", 5], ["Stimulant", 3], ["", 1], ["Analgesic", 1], ["Solvent", 1]]);
  expect(api.gridFilterModel({}).visible).toBe(4);

  api.applyGridColumnFilter({}, "prop:MW", "min", "160");
  api.applyGridColumnFilter({}, "prop:MW", "max", "190");
  expect(names()).toEqual(["Theophylline", "Nicotine"]);
  expect(api.gridAgentFilters()).toEqual([
    { id: "prop:Class", type: "text", text: "Stimulant | Analgesic" },
    { id: "prop:MW", type: "number", min: 160, max: 190 },
  ]);

  // The empty value stands for the rows without a class.
  api.clearGridColumnFilters({}, "prop:MW");
  api.applyGridColumnFilter({}, "prop:Class", "values", [""]);
  expect(names()).toEqual(["Diazepam"]);
  // A text filter on the same column narrows the picked values further.
  api.applyGridColumnFilter({}, "prop:Class", "values", ["NSAID", "Solvent"]);
  api.applyGridColumnFilter({}, "prop:Class", "text", "solv");
  expect(names()).toEqual(["Benzene"]);
  api.applyGridColumnFilter({}, "prop:Class", "text", "");
  // Unticking the last value removes the filter.
  api.applyGridColumnFilter({}, "prop:Class", "values", []);
  expect(state.tableColumnFilters).toEqual({});
  expect(names()).toHaveLength(11);
});

test("a paged collection applies picked values while it walks the pages the database filtered", async () => {
  const { state, api, column, names } = grid(compounds(), { remote: true, pageSize: 6 });
  // Only the first page is loaded, and the counts say so.
  const offered = { categories: [["NSAID", 4], ["Analgesic", 1], ["Stimulant", 1]], statsRows: 6, statsTotal: 11, statsComplete: false };
  expect(column("prop:Class")).toMatchObject(offered);

  api.applyGridColumnFilter({}, "prop:Class", "values", ["Stimulant"]);
  await Promise.resolve(state.remoteLoading).then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(names()).toEqual(["Caffeine", "Theophylline", "Nicotine"]);
  expect(state.totalRows).toBe(3);
  expect(state.plainRemoteRefreshes).toBe(0);
  // The database is never asked for something it cannot evaluate, and both pages are walked.
  expect(state.fetches.map((payload) => [payload.offset, payload.columnFilters])).toEqual([[0, []], [6, []]]);
  expect(state.visibility).toEqual([5, 6, 7]);
  expect(state.statuses.at(-1)).toBe("[grid] Showing 3 of 11 rows.");
  // The loaded rows are now the three stimulants, but the values that were on offer stay.
  expect(column("prop:Class")).toMatchObject(offered);

  // A numeric range goes to the database; the picked values are applied to what it returns.
  state.fetches.length = 0;
  api.applyGridColumnFilter({}, "prop:MW", "min", "170");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(names()).toEqual(["Caffeine", "Theophylline"]);
  expect(state.fetches[0].columnFilters).toEqual([{ id: "prop:MW", filterType: "number", min: 170 }]);
  expect(state.visibility).toEqual([5, 6]);

  // A chemical-space selection narrows the same walk and does not feed back into the map.
  state.selected = new Set([6, 0]);
  state.chemicalSpaceFilterActive = true;
  await api.refresh({});
  expect(names()).toEqual(["Theophylline"]);
  expect(state.visibility).toEqual([5, 6]);

  // Without picked values the page fetch is the plain one again.
  state.chemicalSpaceFilterActive = false;
  api.clearGridColumnFilters({}, "prop:Class");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.plainRemoteRefreshes).toBe(1);
});

const nsaids = { id: "list-1", name: "NSAIDs", indexes: [0, 1, 2, 3, 10] };

test("a row list is shown on its own, survives a change of selection and combines with the other filters", () => {
  const { state, api, names } = grid(compounds());
  api.applyRowListCommand({ action: "filter", ...nsaids }, {});
  expect(names()).toEqual(["Aspirin", "Ibuprofen", "Naproxen", "Diclofenac", "Acetylsalicylic acid"]);
  expect(api.gridFilterModel({}).rowListFilter).toBe("list-1");
  expect(api.gridFilterModel({}).visible).toBe(5);
  // It is a filter, so the map dims the rest and an export says "filtered".
  expect(state.visibility).toEqual([0, 1, 2, 3, 10]);

  state.selected = new Set([5]);
  api.refresh({});
  expect(names()).toHaveLength(5);
  api.applyGridColumnFilter({}, "prop:MW", "min", "200");
  expect(names()).toEqual(["Ibuprofen", "Naproxen", "Diclofenac"]);
  api.clearGridColumnFilters({}, null);

  api.applyRowListCommand({ action: "filter", id: null, indexes: [] }, {});
  expect(api.gridFilterModel({}).rowListFilter).toBeNull();
  expect(names()).toHaveLength(11);
});

test("selecting a row list replaces the selection, and exporting one exports exactly its rows", () => {
  const { state, api, names } = grid(compounds());
  state.selected = new Set([7, 8]);
  api.applyRowListCommand({ action: "select", ...nsaids, indexes: [0, 1, "2", -4, 3.5, 10] }, {});
  expect([...state.selected]).toEqual([0, 1, 2, 10]);
  expect(state.selectionAnchorIndex).toBe(10);
  expect(names()).toHaveLength(11);
  expect(state.exports).toEqual([]);

  api.applyRowListCommand({ action: "export-csv", ...nsaids }, {});
  api.applyRowListCommand({ action: "export-smiles", id: "list-2", name: "Two", indexes: [5, 6] }, {});
  expect(state.exports).toEqual([["csv", [0, 1, 2, 3, 10]], ["smiles", [5, 6]]]);

  // A selection the map was filtering by is replaced, so the map filter goes with it.
  state.chemicalSpaceFilterActive = true;
  api.applyRowListCommand({ action: "select", ...nsaids }, {});
  expect(state.chemicalSpaceFilterActive).toBe(false);
  // An empty list changes nothing.
  api.applyRowListCommand({ action: "select", id: "x", name: "Empty", indexes: [] }, {});
  expect([...state.selected]).toEqual([0, 1, 2, 3, 10]);
});

test("a paged collection shows a row list by walking its pages", async () => {
  const { state, api, names } = grid(compounds(), { remote: true, pageSize: 4 });
  api.applyRowListCommand({ action: "filter", ...nsaids }, {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(names()).toEqual(["Aspirin", "Ibuprofen", "Naproxen", "Diclofenac", "Acetylsalicylic acid"]);
  expect(state.fetches.map((payload) => payload.offset)).toEqual([0, 4, 8]);
  expect(state.totalRows).toBe(5);
  expect(state.plainRemoteRefreshes).toBe(0);
});
