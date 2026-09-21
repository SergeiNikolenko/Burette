#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const viewer = source("PreviewExtension/Web/viewer.js");
const grid = source("PreviewExtension/Web/grid-viewer.js");
const nativeCommand = source("apps/desktop/src-tauri/src/commands/pubchem.rs");
const hostHandler = source("apps/desktop/src/hooks/use-app-pubchem-messages.ts");
const quickLookConfig = source("PreviewExtension/Web/viewer-shell.js");

assert.match(viewer, /activeConfig\?\.appViewer === true[\s\S]*activeConfig\?\.pubChemSearch === true/);
assert.match(grid, /cfg\.appViewer === true && cfg\.pubChemSearch === true/);
assert.match(viewer, /function molstarExactPubChemSdfEntry[\s\S]*\[target\.ligand, target\.selectedEntry, target\.sourceEntry\]/);
assert.doesNotMatch(viewer.match(/function molstarExactPubChemSdfEntry[\s\S]*?\n  \}/u)?.[0] ?? "", /pdbLigandSdfEntryForResidue|molstarStandaloneMoleculePreviewTarget/);
assert.match(viewer, /function molstarPubChemSearchAvailable[\s\S]*!molstarStructureDirty[\s\S]*molstarExactPubChemSdfEntry/);
assert.match(viewer, /openPubChemSearch/);
assert.match(grid, /openPubChemSearch/);
assert.match(grid, /function canonicalPubChemSmiles[\s\S]*const molblock[\s\S]*rdkit\.get_mol\(molblock \|\| sourceSmiles\)/);
assert.match(nativeCommand, /https:\/\/pubchem\.ncbi\.nlm\.nih\.gov\/search\/search\.cgi/);
assert.match(nativeCommand, /PubChemSearchType::Identity => "fs"/);
assert.match(nativeCommand, /PubChemSearchType::Similarity => "90"/);
assert.match(hostHandler, /invoke\("open_pubchem_search", \{ searchType, smiles \}\)/);
assert.doesNotMatch(viewer, /window\.open\(/);
assert.doesNotMatch(grid, /window\.open\(/);
assert.doesNotMatch(quickLookConfig, /pubChemSearch\s*:\s*true/);

for (const runtime of [viewer, grid, nativeCommand, hostHandler]) {
  assert.match(runtime, /4096/);
  assert.match(runtime, /\*/);
}

console.log("PubChem search contract tests passed");
