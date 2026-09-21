#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(join(repoRoot, relative), "utf8");

const [dockPanel, structureInfoPanel, chemicalSpacePanel, documentKind] = await Promise.all([
  read("apps/desktop/src/components/dock-panel.tsx"),
  read("apps/desktop/src/components/structure-info-panel.tsx"),
  read("apps/desktop/src/components/chemical-space-panel.tsx"),
  read("apps/desktop/src/components/editor-area/page-kinds/document.tsx"),
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

assert.match(
  chemicalSpacePanel,
  /const ChemicalSpace3D = lazy\(\(\) => import\("\.\/chemical-space-3d"\)/u,
  "the 2D Chemical Space panel must not load three.js until 3D is requested",
);
assert.doesNotMatch(
  chemicalSpacePanel,
  /^import \{ ChemicalSpace3D \} from "\.\/chemical-space-3d";/mu,
  "the Three-backed Chemical Space renderer must not be imported statically",
);
assert.match(
  chemicalSpacePanel,
  /<Suspense fallback=\{<ChemicalSpaceChecking message="Loading the 3D renderer…"\s*\/>\}>/u,
  "the lazy 3D renderer needs an explicit loading state",
);

// The page-kinds barrel is statically imported by the entry chunk, so a static
// document surface import lands the whole Retab stack there: KaTeX CSS grew the
// initial stylesheet from 345 to 459 KiB and pdf-viewer.tsx got pinned out of
// its dynamic-import chunk (Vite's INEFFECTIVE_DYNAMIC_IMPORT). The surface
// must load like the Ketcher page kind: lazily, from document-page.tsx.
assert.match(
  documentKind,
  /const DocumentSurface = lazy\(\(\) => import\("\.\.\/\.\.\/document-page"\)/u,
  "the Retab document surface must stay behind a lazy boundary",
);
for (const [label, pattern] of [
  ["the file-viewer surface", /ui\/file-viewer/u],
  ["the PDF viewer", /ui\/pdf-viewer/u],
  ["the KaTeX stylesheet", /katex/u],
]) {
  assert.doesNotMatch(documentKind, pattern, `${label} must not be imported statically by the document page kind`);
}

// Both lazy components need a Suspense boundary around their use site.
for (const [name, source] of [["dock-panel", dockPanel], ["structure-info-panel", structureInfoPanel], ["page-kinds/document", documentKind]]) {
  assert.match(source, /<Suspense fallback=\{null\}>/u, `${name} must wrap its lazy component in Suspense`);
}

console.log("lazy boundary contract OK");
