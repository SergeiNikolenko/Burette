#!/usr/bin/env bun
import assert from "node:assert/strict";

import { createMesoscaleCanvasInteractionController } from "../apps/desktop/src/preview-mesoscale/mesoscale-canvas-interaction.ts";
import { boundMesoscaleHierarchyPage, mergeMesoscaleHierarchySelection, mesoscaleSelectedCount } from "../apps/desktop/src/lib/mesoscale-contract.ts";
import { inclusiveMesoscaleTreeRange, mesoscaleTreeSelectionError } from "../apps/desktop/src/components/mesoscale/mesoscale-tree-selection.ts";

const selected = new Set();
const selections = [];
const menus = [];
const hits = new Map([[10, "structure-a"], [20, "structure-b"], [30, "structure-c"]]);
const controller = createMesoscaleCanvasInteractionController({
  pick: (point) => hits.get(point.x) ?? null,
  select: (ref, mode) => {
    selections.push({ ref, mode });
    if (mode === "replace") selected.clear();
    selected.add(ref);
  },
  isSelected: (ref) => selected.has(ref),
  openContextMenu: (ref, point) => menus.push({ ref, point, selectedRefs: [...selected] }),
});

assert.equal(controller.pointerDown(0, { x: 10, y: 5 }, false), true, "primary press on a structure starts sweep selection");
assert.deepEqual(selections, [{ ref: "structure-a", mode: "replace" }]);
assert.equal(controller.pointerMove({ x: 20, y: 5 }), true);
assert.equal(controller.pointerMove({ x: 20, y: 5 }), true, "revisiting the same structure remains handled");
assert.equal(controller.pointerMove({ x: 30, y: 5 }), true);
assert.deepEqual(selections, [
  { ref: "structure-a", mode: "replace" },
  { ref: "structure-b", mode: "extend" },
  { ref: "structure-c", mode: "extend" },
], "dragging across structures extends the selection exactly once per structure");
assert.equal(controller.pointerUp(), true);
assert.equal(controller.pointerMove({ x: 10, y: 5 }), false, "selection stops on release");

assert.equal(controller.contextMenu({ x: 20, y: 5 }), true, "right click resolves the structure under the pointer");
assert.equal(selections.length, 3, "right click on an existing selection preserves the multi-selection");
assert.deepEqual(menus, [{
  ref: "structure-b",
  point: { x: 20, y: 5 },
  selectedRefs: ["structure-a", "structure-b", "structure-c"],
}]);

selected.clear();
selected.add("structure-a");
assert.equal(controller.contextMenu({ x: 30, y: 5 }), true);
assert.deepEqual(selections.at(-1), { ref: "structure-c", mode: "replace" }, "right click on an unselected structure targets that structure");
assert.deepEqual(menus.at(-1)?.selectedRefs, ["structure-c"]);
assert.equal(controller.contextMenu({ x: 99, y: 5 }), false, "right click on empty canvas remains available to the viewer");
assert.equal(controller.contextMenuFor("structure-a", { x: 99, y: 5 }), true, "a context gesture keeps the structure picked at pointer-down even if release crosses a boundary");

const hierarchy = Array.from({ length: 130 }, (_, index) => ({
  ref: `structure-${index}`,
  parentRef: null,
  kind: "structure",
  label: `Structure ${index}`,
  description: "",
  hidden: false,
  selected: index === 129,
  elementCount: 1,
  instanceCount: 1,
  color: null,
  opacity: 1,
  emissive: 0,
}));
const boundedSelection = {
  selectedRefs: hierarchy.slice(0, 128).map((item) => item.ref),
  selectedCount: 130,
  selectionTruncated: true,
  hierarchyPreview: hierarchy.slice(0, 128),
};
assert.equal(mesoscaleSelectedCount({ selectedRefs: ["legacy"] }), 1, "legacy v2 summaries fall back to their bounded ref count");
assert.equal(mergeMesoscaleHierarchySelection(hierarchy, boundedSelection)[129].selected, true, "bounded summaries preserve selection state until paginated refresh arrives");
assert.equal(mergeMesoscaleHierarchySelection(hierarchy, { ...boundedSelection, selectedRefs: [], selectedCount: 0, selectionTruncated: false, hierarchyPreview: [] })[129].selected, false, "a complete clear summary clears every loaded row");

const treeRefs = ["structure-a", "structure-b", "structure-c", "structure-d"];
assert.deepEqual(inclusiveMesoscaleTreeRange(treeRefs, "structure-a", "structure-d"), treeRefs, "forward tree drag selects the inclusive range");
assert.deepEqual(inclusiveMesoscaleTreeRange(treeRefs, "structure-d", "structure-b"), ["structure-b", "structure-c", "structure-d"], "reverse tree drag selects the same ordered range");
assert.deepEqual(inclusiveMesoscaleTreeRange(treeRefs, "missing", "structure-b"), ["structure-b"], "stale drag anchors fall back to the current visible row");
assert.equal(mesoscaleTreeSelectionError(Array.from({ length: 4096 }, (_, index) => String(index))), null, "the documented atomic batch limit is selectable");
assert.match(mesoscaleTreeSelectionError(Array.from({ length: 4097 }, (_, index) => String(index))), /4,096/, "oversized tree ranges fail visibly before the bridge");

const recursiveDetail = { id: "detail", label: "x".repeat(400), detail: "y".repeat(400), children: [] };
recursiveDetail.children.push(recursiveDetail);
const boundedPage = boundMesoscaleHierarchyPage({
  kind: "hierarchy-page",
  revision: 1,
  filter: "",
  cursor: 0,
  nextCursor: null,
  total: 1,
  items: [{ ...hierarchy[0], label: "z".repeat(400), description: "d".repeat(400), children: [recursiveDetail] }],
});
assert.equal(boundedPage.items[0].label.length, 256, "hierarchy labels are bounded at the host bridge");
assert.equal(boundedPage.items[0].children?.[0].children?.length, 0, "cyclic hierarchy details are cut before rendering");
assert.equal(boundedPage.items[0].children?.[0].childrenTruncated, true, "truncated hierarchy details are explicit");

const malformedPage = boundMesoscaleHierarchyPage({
  ...boundedPage,
  items: [{ ...hierarchy[0], children: Array.from({ length: 2_000 }, () => null) }],
});
assert.equal(malformedPage.items[0].children?.length, 0, "malformed hierarchy entries remain bounded by the inspection budget");

console.log("mesoscale canvas interaction tests passed");
