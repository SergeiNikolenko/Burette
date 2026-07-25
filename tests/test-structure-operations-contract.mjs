#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const viewer = source("PreviewExtension/Web/viewer.js");

const fn = (name) => {
  const match = viewer.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, "u"));
  assert.ok(match, `Missing function: ${name}`);
  return match[0];
};

// Superposition offers the three pairing rules Maestro and PyMOL separate, and the
// toolbar button stays on `auto` so numbering is tried before sequence alignment.
assert.match(viewer, /function alignStructureSceneEntries\(prepared, mode = 'auto'\)/);
assert.match(viewer, /\['align:atoms', `Align to \$\{reference\} by residue numbers`\]/);
assert.match(viewer, /\['align:sequence', `Align to \$\{reference\} by sequence`\]/);
assert.match(viewer, /\['align:binding-site', `Align to \$\{reference\} by binding site`\]/);
const align = fn("alignStructureSceneEntries");
assert.match(align, /const requested = mode === 'auto' \? 'atoms' : mode/);
assert.match(align, /if \(!candidates\.length && mode === 'auto'\)[\s\S]*resolvedMode = 'sequence'/);
assert.match(align, /requested === 'binding-site'[\s\S]*bindingSiteFilteredCandidate/);

// Needleman-Wunsch keeps its guard rail and only anchors on identical residues; a
// mismatched pair that the matrix walked through would drag the fit.
const nw = fn("alignResidueSequences");
assert.match(nw, /SEQUENCE_ALIGNMENT_MAX_CELLS/);
assert.match(nw, /referenceResidues\[row - 1\]\.name === movingResidues\[column - 1\]\.name/);
assert.match(viewer, /const SEQUENCE_ALIGNMENT_MAX_CELLS = 4e6/);

// A failed alignment rolls coordinates back, so the button must follow the scene.
assert.match(viewer, /const syncAlignButton = \(\) => \{[\s\S]*prepared\.structureAlignmentEnabled === true/);
assert.match(viewer, /catch\(error => \{\s*\n\s*if \(enabling\) restoreStructureSceneEntries\(prepared\);\s*\n\s*syncAlignButton\(\);/);

// PDB subsets are addressed by atom serial. Pairing the n-th ATOM line with the
// n-th Mol* atom drifts on files where a record does not become an atom, which
// silently shifted extracted chains.
assert.match(viewer, /function molstarPdbExportPayloadForAtomSerials\(requestedSerials, fileName\)/);
assert.doesNotMatch(viewer, /molstarPdbExportPayloadForAtomIndices|molstarCurrentAtomIndicesForExport/);
const exportPayload = fn("molstarPdbExportPayloadForAtomSerials");
assert.match(exportPayload, /const serial = pdbSerialFromLine\(line\);\s*\n\s*if \(serial == null \|\| !requestedSerials\.has\(serial\)\) continue;/);
assert.doesNotMatch(exportPayload, /atomIndex\+\+/);
for (const helper of ["molstarStructureAtomSerials", "molstarChainAtomSerials", "molstarAtomSerialsFromLoci"]) {
  assert.match(fn(helper), /StructureProperties\.atom\.id\(location\)/, helper);
}

// Split and extract reach the scene's structure even when no pick supplied one.
assert.match(fn("splitMolstarStructureIntoChains"), /molstarTargetStructureData\(target\)/);
assert.match(fn("extractMolstarChainToFile"), /molstarTargetStructureData\(target\)/);
assert.match(fn("extractMolstarSelectionToFile"), /for \(const structure of molstarCurrentStructures\(activeMolstarViewer\(\)\)\)/);

// Selection tooling is Mol*'s own query registry, addressed by label because the
// registry entries carry no stable id.
assert.match(fn("molstarSelectionQuery"), /plugin\?\.query\?\.structure\?\.registry[\s\S]*label[\s\S]*includes\(needle\)/);
assert.match(viewer, /applyMolstarSelectionQuery\('whole residues'\)/);
assert.match(viewer, /applyMolstarSelectionQuery\('surrounding residues', 'add'\)/);
assert.match(viewer, /applyMolstarSelectionQuery\('inverse'\)/);
assert.match(viewer, /const MOLSTAR_SELECTION_LEVELS = \[\['element', 'Atom'\], \['residue', 'Residue'\], \['chain', 'Chain'\]\]/);
assert.match(fn("setMolstarSelectionLevel"), /interactivity\.setProps\(\{ granularity: level \}\)/);

// Typed contacts come from Mol*'s interactions representation, not from a distance
// cutoff, and the component includes the environment or it renders nothing.
const interactions = fn("addMolstarInteractionsForTarget");
assert.match(interactions, /applyMolstarSelectionQuery\('surrounding residues', 'add'\)/);
assert.match(interactions, /representation: 'interactions'/);

// Colour presets skip interactions components, whose colours are the contact types,
// and only offer pLDDT when the model actually carries a quality metric.
assert.match(fn("molstarComponentDrawsInteractions"), /type\?\.name === 'interactions'/);
assert.match(fn("molstarColourPresetComponents"), /filter\(component => !molstarComponentDrawsInteractions\(component\)\)/);
assert.match(fn("molstarStructureHasQualityAssessment"), /startsWith\('ma_qa_metric'\)/);
assert.match(fn("molstarColourPresetsForTarget"), /name === 'plddt-confidence' && !hasQuality/);

// Distance, angle, and dihedral share one arming session.
assert.match(viewer, /distance: \{ points: 2, method: 'addDistance'/);
assert.match(viewer, /angle: \{ points: 3, method: 'addAngle'/);
assert.match(viewer, /dihedral: \{ points: 4, method: 'addDihedral'/);
assert.match(fn("beginMolstarMeasurement"), /measurement\[spec\.method\]\(\.\.\.points\)/);

// Menu actions that change the scene are undoable through the same stack the
// structure edits use, so Cmd-Z walks them in the order they were made. Selections
// and exports stay out: one changes constantly, the other writes files.
assert.match(fn("captureMolstarSceneUndoSnapshot"), /kind: 'scene'[\s\S]*plugin\.state\.data\.getSnapshot\(\)/);
assert.match(fn("restoreMolstarSceneUndoSnapshot"), /plugin\.runTask\(plugin\.state\.data\.setSnapshot\(snapshot\.state\)\)/);
assert.match(fn("captureMolstarAlignUndoSnapshot"), /kind: 'align'[\s\S]*wasAligned/);
assert.match(fn("restoreMolstarAlignUndoSnapshot"), /control\.isAligned\(\) === snapshot\.wasAligned[\s\S]*control\.toggle\('auto'\)/);
assert.match(fn("restoreMolstarEditUndoSnapshot"), /kind === 'scene'[\s\S]*kind === 'align'/);
assert.match(fn("pushMolstarEditUndoSnapshot"), /kind !== 'scene' && snapshot\.kind !== 'align' && !snapshot\.payload\?\.text/);
const undoLabels = fn("molstarSceneUndoActionLabel");
for (const undoable of ["colour:", "analyze:interactions", "analyze:label", "represent:surface", "view:hide", "view:isolate"]) {
  assert.ok(undoLabels.includes(undoable), `scene undo should cover ${undoable}`);
}
for (const skipped of ["select:", "extract:", "split:", "save-"]) {
  assert.ok(!undoLabels.includes(skipped), `scene undo should skip ${skipped}`);
}
// A failed action leaves the scene alone, so it must not consume an undo step.
assert.match(viewer, /if \(sceneUndoSnapshot && !actionFailed\) pushMolstarEditUndoSnapshot\(sceneUndoSnapshot\)/);
// Measurements land after the last pick, not when the menu item is chosen.
assert.match(fn("beginMolstarMeasurement"), /captureMolstarSceneUndoSnapshot\(`\$\{spec\.noun\} measurement`\)[\s\S]*pushMolstarEditUndoSnapshot\(undoSnapshot\)/);

// The menu groups have to exist for the new namespaces to render anywhere.
for (const group of ["selection", "colour", "align"]) {
  assert.match(viewer, new RegExp(`\\{ id: '${group}', title: '[^']+' \\}`), group);
}
const group = fn("moleculeContextActionGroup");
assert.match(group, /name\.startsWith\('colour:'\)\) return 'colour'/);
assert.match(group, /name\.startsWith\('select:'\)\) return 'selection'/);
assert.match(group, /name\.startsWith\('align:'\) \|\| name === 'align-structures'\) return 'align'/);
assert.match(group, /name\.startsWith\('extract:'\) \|\| name\.startsWith\('split:'\)\) return 'export'/);

console.log("Structure operations contract tests passed");
