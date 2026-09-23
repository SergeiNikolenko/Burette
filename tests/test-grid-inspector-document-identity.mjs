import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
const panel = readFileSync("apps/desktop/src/components/structure-info-panel.tsx", "utf8");
const card = panel.match(/<GridHoverMoleculeCard\b[^]*?\/>/)?.[0];
assert.ok(card);
const jsx = new Bun.Transpiler({ loader: "tsx", tsconfig: { compilerOptions: { jsx: "react" } } }).transformSync(`function render(document, hoveredGridRow) { const gridFilterModel = null; return ${card}; }`);
const render = new Function("React", "GridHoverMoleculeCard", `${jsx}; return render;`)(React, () => null);
const old = render({ id: "compounds" }, { index: 2, name: "CMPD-003" });
const next = render({ id: "bace1" }, null);
assert.notEqual(old.key, next.key, "changing the inspected document must recreate the card instead of retaining another file's row");
assert.equal(next.props.documentId, "bace1");
assert.equal(next.props.row, null);
assert.equal(typeof next.props.onInspectProperty, "function", "document isolation preserves the property-filter action");
console.log("Inspector document identity checks passed.");

const hover = readFileSync("apps/desktop/src/components/grid-hover-molecule.tsx", "utf8");
const effectStart = hover.indexOf("  useEffect(() => {\n    const token = ++renderTokenRef.current;");
const effectEnd = hover.indexOf("\n  }, [scaffold", effectStart);
assert.ok(effectStart >= 0 && effectEnd > effectStart);
const effect = hover.slice(effectStart + "  useEffect(() => {".length, effectEnd);
for (const showingXyzrender of [false, true]) {
  let resolveEngines;
  let engineUsed = false;
  const engines = new Promise(resolve => { resolveEngines = resolve; });
  const env = {
    renderTokenRef: { current: 0 }, wellSize: { width: 120, height: 80 },
    scaffold: { kind: "idle" }, showingScaffold: false, showingXyzrender,
    shown: { smiles: "CC", previewSvg: "<svg/>" },
    specCache: new Map(), svgCache: new Map(), wellNodeRef: { current: null }, theme: "auto",
    setSvg() {}, setSpec() {}, paperColour: () => [1, 1, 1],
    loadDerivedEngines: () => engines,
    moleculeSpecLine: () => { engineUsed = true; return ""; },
  };
  const cleanup = new Function(...Object.keys(env), effect)(...Object.values(env));
  assert.equal(typeof cleanup, "function", "both renderer branches cancel a pending inspector render");
  cleanup();
  resolveEngines({ rdkit: { get_mol() { engineUsed = true; return null; } } });
  await Promise.resolve();
  assert.equal(engineUsed, false, "an unmounted inspector never computes for its previous document");
}
console.log("Inspector async-render disposal checks passed.");

// Draw explicit hydrogens with the inspector's real palettes. Their atom labels
// and half-bonds must both remain visible on the dark paper.
const paletteExpression = hover.match(/const DARK_STRUCTURE_PALETTE = (\{[^]*?\n\});/)[1];
const darkPalette = new Function(`return ${paletteExpression}`)();
const rdkit = await (await import('@rdkit/rdkit')).default();
const water = rdkit.get_mol('[H]O[H]', JSON.stringify({removeHs:false}));
try {
  const darkSvg = water.get_svg_with_highlights(JSON.stringify({width:240,height:160,atomColourPalette:darkPalette,backgroundColour:[0.067,0.067,0.067]}));
  const lightSvg = water.get_svg_with_highlights(JSON.stringify({width:240,height:160}));
  assert.ok(!darkSvg.includes('#000000'), 'dark inspector leaves no black hydrogen labels or bonds');
  assert.ok(darkSvg.includes('#DDDDDD'), 'neutral atoms use light ink');
  assert.ok(lightSvg.includes('#000000'), 'light inspector retains dark ink');
} finally { water.delete(); }
console.log('Explicit hydrogen labels and bonds have theme-appropriate contrast');
