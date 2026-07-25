#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(join(repoRoot, relative), "utf8");

const [dockPanel, structureInfoPanel] = await Promise.all([
  read("apps/desktop/src/components/dock-panel.tsx"),
  read("apps/desktop/src/components/structure-info-panel.tsx"),
]);

// Both panels stay mounted even while their dock is closed, so a static import
// here lands the dependency in the entry chunk that every window pays for at
// startup. Chemical Space brings three.js (618 KiB) and the filter charts bring
// recharts (310 KiB); moving both behind a lazy boundary took the initial
// JavaScript from 4981 KiB to 3938 KiB.
assert.match(
  dockPanel,
  /const ChemicalSpacePanel = lazy\(\(\) => import\("\.\/chemical-space-panel"\)/u,
  "Chemical Space must stay behind a lazy boundary",
);
assert.doesNotMatch(
  dockPanel,
  /^import \{ ChemicalSpacePanel \} from/mu,
  "Chemical Space must not be imported statically",
);

assert.match(
  structureInfoPanel,
  /const GridFilterSection = lazy\(\(\) => import\("\.\/grid-filter-section"\)/u,
  "the recharts-backed filter section must stay behind a lazy boundary",
);
assert.doesNotMatch(
  structureInfoPanel,
  /^import \{ GridFilterSection \} from/mu,
  "the filter section must not be imported statically",
);

// Both lazy components need a Suspense boundary around their use site.
for (const [name, source] of [["dock-panel", dockPanel], ["structure-info-panel", structureInfoPanel]]) {
  assert.match(source, /<Suspense fallback=\{null\}>/u, `${name} must wrap its lazy component in Suspense`);
}

console.log("lazy boundary contract OK");
