#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("apps/desktop/src/components/spectrum-viewer.tsx", "utf8");
const peakHoverData = source.match(/function peakHoverData\(peak: SpectrumPeak\) \{[\s\S]*?\n\}/)?.[0] ?? "";

assert.match(source, /hoverlabel: \{\s*bgcolor: "var\(--surface-elevated\)"/);
assert.match(peakHoverData, /annotationText\(peak, "frag_base_form"\)/);
assert.match(peakHoverData, /annotationText\(peak, "formula"\)/);
assert.match(peakHoverData, /annotationNumberText\(peak, "ppm_diff"\)/);
assert.match(peakHoverData, /annotationNumberText\(peak, "frag_mass"\)/);
assert.doesNotMatch(peakHoverData, /Object\.entries\(peak\.annotations/);
assert.doesNotMatch(peakHoverData, /frag_hashes/);

console.log("spectrum viewer contract tests passed");
