#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { nextMesoscalePanelSize, shouldCollapseMesoscalePanel } from "../apps/desktop/src/preview-mesoscale/mesoscale-panel-resize.ts";

const stage = { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 };

assert.equal(nextMesoscalePanelSize("left", { x: 420, y: 0 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }), 420);
assert.equal(nextMesoscalePanelSize("right", { x: 860, y: 0 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }), 340);
assert.equal(nextMesoscalePanelSize("bottom", { x: 0, y: 510 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }), 290);
assert.equal(nextMesoscalePanelSize("left", { x: 40, y: 0 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }), 220, "side panels preserve the usable Burette minimum");
assert.equal(nextMesoscalePanelSize("bottom", { x: 0, y: 760 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }), 200, "portrait panels preserve the usable Burette minimum");
assert.equal(nextMesoscalePanelSize("left", { x: 1_000, y: 0 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }, 300), 660, "two landscape panels preserve the minimum canvas width together");

assert.equal(nextMesoscalePanelSize("split", { x: 700, y: 0 }, stage), 700, "the portrait split divider follows the pointer");
assert.equal(nextMesoscalePanelSize("split", { x: 40, y: 0 }, stage), 220, "neither stacked panel can be squeezed below the minimum");
assert.equal(nextMesoscalePanelSize("split", { x: 1_180, y: 0 }, stage), 980, "the trailing stacked panel keeps its minimum too");

assert.equal(shouldCollapseMesoscalePanel("left", { x: 200, y: 0 }, stage), false, "a drag inside the minimum only resizes");
assert.equal(shouldCollapseMesoscalePanel("left", { x: 100, y: 0 }, stage), true, "dragging well past the minimum closes the panel");
assert.equal(shouldCollapseMesoscalePanel("right", { x: 1_100, y: 0 }, stage), true, "the right divider closes the same way");
assert.equal(shouldCollapseMesoscalePanel("bottom", { x: 0, y: 700 }, stage), true, "the portrait divider closes the stacked panels");
assert.equal(shouldCollapseMesoscalePanel("split", { x: 10, y: 0 }, stage), false, "the split divider never closes a panel, it only rebalances");

const runtimeSource = await readFile("apps/desktop/src/preview-mesoscale/mesoscale-runtime.ts", "utf8");
assert.match(runtimeSource, /onCollapse: \(axis\)/, "squeezing a divider shut is wired to the layout regions");

const resizeSource = await readFile("apps/desktop/src/preview-mesoscale/mesoscale-panel-resize.ts", "utf8");
assert.match(resizeSource, /buret-meso-panel-resizer-grip/, "dividers carry the workspace grip affordance");
assert.match(resizeSource, /msp-layout-region\.msp-layout-main"\)\?\.parentElement/, "panel resize follows Mol*'s visibility wrapper");

console.log("mesoscale panel resize tests passed");
