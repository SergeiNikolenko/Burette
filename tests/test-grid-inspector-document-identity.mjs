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
