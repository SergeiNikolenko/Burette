#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { nextMesoscalePanelSize } from "../apps/desktop/src/preview-mesoscale/mesoscale-panel-resize.ts";

assert.equal(nextMesoscalePanelSize("left", { x: 420, y: 0 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }), 420);
assert.equal(nextMesoscalePanelSize("right", { x: 860, y: 0 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }), 340);
assert.equal(nextMesoscalePanelSize("bottom", { x: 0, y: 510 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }), 290);
assert.equal(nextMesoscalePanelSize("left", { x: 40, y: 0 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }), 220, "side panels preserve the usable Burette minimum");
assert.equal(nextMesoscalePanelSize("bottom", { x: 0, y: 760 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }), 200, "portrait panels preserve the usable Burette minimum");
assert.equal(nextMesoscalePanelSize("left", { x: 1_000, y: 0 }, { left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800 }, 300), 660, "two landscape panels preserve the minimum canvas width together");

const resizeSource = await readFile("apps/desktop/src/preview-mesoscale/mesoscale-panel-resize.ts", "utf8");
assert.match(resizeSource, /msp-layout-region\.msp-layout-main"\)\?\.parentElement/, "panel resize follows Mol*'s visibility wrapper");

console.log("mesoscale panel resize tests passed");
