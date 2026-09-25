#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { agentGridState, recordAgentGridState } from "../apps/desktop/src/lib/agent-grid-state.ts";

// A huge selection, long query and many filters stay bounded in observe.
assert.equal(recordAgentGridState({
  documentId: "grid-a",
  gridState: {
    sort: { key: "descriptor:MolWt", direction: "desc" },
    searchQuery: "c1ccccc1".repeat(100),
    smartsSearch: true,
    filters: Array.from({ length: 30 }, (_, index) => ({ id: `prop:${index}`, type: "number", min: index, max: "bad" })),
    filterCount: 30,
    selectedCount: 100000,
    selectedRowIds: [...Array.from({ length: 60 }, (_, index) => index), -1, 1.5, "7"],
    totalRows: 10000,
    visibleRows: 812,
    viewMode: "table",
    indexing: false,
  },
}), true);
const bounded = agentGridState("grid-a");
assert.ok(bounded);
const { updatedAt, ...stable } = bounded;
assert.equal(typeof updatedAt, "string");
assert.deepEqual({ ...stable, filters: stable.filters.length, selectedRowIds: stable.selectedRowIds.length }, {
  sort: { key: "descriptor:MolWt", direction: "desc" },
  searchQuery: "c1ccccc1".repeat(100).slice(0, 256),
  searchQueryTruncated: true,
  smartsSearch: true,
  filters: 20,
  filterCount: 30,
  chemicalSpaceFilterActive: false,
  selectedCount: 100000,
  selectedRowIds: 50,
  selectionTruncated: true,
  totalRows: 10000,
  visibleRows: 812,
  viewMode: "table",
  indexing: false,
});
assert.deepEqual(bounded.filters[1], { id: "prop:1", type: "number", min: 1 });
assert.equal(JSON.stringify(bounded).length < 4096, true);

// Messages without a document id or state are ignored.
assert.equal(recordAgentGridState({ gridState: {} }), false);
assert.equal(recordAgentGridState({ documentId: "grid-b" }), false);
assert.equal(agentGridState("grid-b"), null);

// Only the most recently reported documents are kept.
for (let index = 0; index < 70; index += 1) {
  recordAgentGridState({ documentId: `grid-${index}`, gridState: { totalRows: index } });
}
assert.equal(agentGridState("grid-a"), null);
assert.equal(agentGridState("grid-5"), null);
assert.equal(agentGridState("grid-69")?.totalRows, 69);

// The grid runtime reports the state on every chrome update, and the agent
// session consumes the same message type into observe.grid.
const gridViewer = await readFile("PreviewExtension/Web/grid-viewer.js", "utf8");
const agentSession = await readFile("apps/desktop/src/hooks/use-agent-session.ts", "utf8");
assert.match(gridViewer, /notifyGridMenuState\(cfg\);\n\s+notifyGridAgentState\(cfg, total, visible\);/u);
assert.match(gridViewer, /post\('gridAgentState', '', \{ gridState: payload \}\)/u);
assert.match(agentSession, /body\?\.type === "gridAgentState"/u);
assert.match(agentSession, /grid: activeDocument\?\.renderer === "grid2d" \? agentGridState\(activeDocument\.id\) : null/u);

console.log("agent grid state tests passed");
