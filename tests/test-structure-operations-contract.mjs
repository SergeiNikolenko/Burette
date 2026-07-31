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

// Superposition exposes explicit reference/moving structures, contextual target
// actions, PDB pairing modes, and Mol*'s native TM-align behind one controller.
assert.match(viewer, /function alignStructureSceneEntries\(prepared, request = 'auto'\)/);
assert.match(viewer, /\['align:advanced', 'Advanced alignment…'\]/);
assert.match(viewer, /moleculeMenuNestedAction\('align:menu:to', 'Align to', references\.map\(reference =>/);
assert.match(viewer, /moleculeMenuNestedAction\(`align:menu:target:\$\{reference\.id\}`, reference\.label, \[/);
assert.match(viewer, /superpositionContextAction\(\{ method: 'auto', referenceId: reference\.id, movingIds: \[moving\.id\] \}\), 'Automatic'/);
assert.match(viewer, /superpositionContextAction\(\{ method: 'tm-align', referenceId: reference\.id, movingIds: \[moving\.id\] \}\), 'TM-align'/);
assert.match(viewer, /moleculeMenuNestedAction\('align:menu:all-to-this', 'Align all to this', \[/);
assert.match(viewer, /superpositionContextAction\(\{ method: 'auto', referenceId: moving\.id, movingIds: references\.map\(reference => reference\.id\) \}\), 'Automatic'/);
assert.match(viewer, /superpositionContextAction\(\{ method: 'tm-align', referenceId: moving\.id, movingIds: references\.map\(reference => reference\.id\) \}\), 'TM-align'/);
assert.match(viewer, /method: 'chains',[\s\S]*?\[moving\.id\]: movingChain\.id/);
assert.match(viewer, /method: 'selected-atoms',[\s\S]*?useCurrentSelection: true/);
assert.match(fn("moleculeMenuCloseSubmenus"), /_buretParentSubmenu/);
assert.match(fn("moleculeMenuNestedSubmenu"), /aria-haspopup[\s\S]*?moleculeMenuActionItem/);
assert.match(fn("molstarContextActionsPayload"), /moleculeMenuLeafActions/);
const align = fn("alignStructureSceneEntries");
assert.match(align, /referenceIndex[\s\S]*movingIndices[\s\S]*chainIds/);
assert.match(align, /if \(method !== 'auto'\) return build\(method\)/);
assert.match(align, /return build\('atoms'\)[\s\S]*const result = build\('sequence'\)/);
assert.match(align, /resolvedMode === 'binding-site'[\s\S]*pdbLigandHeavyAtoms/);
assert.match(fn("nativeSuperpositionPlan"), /facade\.alignWithTM\(nativeEntries\)/);
assert.match(fn("nativeSuperpositionPlan"), /facade\.alignChains\(nativeEntries/);
assert.match(fn("nativeSuperpositionPlan"), /facade\.alignWithSifts/);
assert.match(fn("nativeSuperpositionPlan"), /facade\.alignAtoms/);

// Needleman-Wunsch keeps its guard rail and only anchors on identical residues; a
// mismatched pair that the matrix walked through would drag the fit.
const nw = fn("alignResidueSequences");
assert.match(nw, /SEQUENCE_ALIGNMENT_MAX_CELLS/);
assert.match(nw, /referenceResidues\[row - 1\]\.name === movingResidues\[column - 1\]\.name/);
assert.match(viewer, /const SEQUENCE_ALIGNMENT_MAX_CELLS = 4e6/);

// The scene mutation is one Mol* transaction and metadata only changes after it
// commits, so a failed pair cannot leave a half-superposed scene.
assert.match(fn("commitSuperpositionPlan"), /state\.updateTree\(update, \{ revertOnError: true, revertIfAborted: true \}\)/);
assert.doesNotMatch(fn("commitSuperpositionPlan"), /update\.delete\(/);
const resetSuperposition = fn("resetSuperpositionTransforms");
assert.match(resetSuperposition, /identitySuperpositionTransformParams\(\)/);
assert.match(resetSuperposition, /update\.to\(cell\)\.update\(identityParams\)/);
assert.doesNotMatch(resetSuperposition, /update\.delete\(/);
assert.match(fn("createStructureSuperpositionController"), /await commitSuperpositionPlan\(viewer, entries, plan\);\s*\n\s*result = plan/);
assert.match(fn("createStructureSuperpositionController"), /entriesStillLoaded[\s\S]*ensureEntries/);
// Align resolves only structures already present in the live Mol* tree.
// Re-preparing the docking scene here would restore older visibility,
// representation, and selection state before applying the transform.
assert.match(
  fn("createStructureSuperpositionController"),
  /const refreshEntries = async \(\) => \{\s*\n\s*entries = superpositionStructureEntries\(viewer, prepared\);/,
);
assert.doesNotMatch(fn("createStructureSuperpositionController"), /prepareSuperpositionScene|applyDockingSceneVisibility/);
assert.match(
  fn("createStructureSuperpositionController"),
  /const restoreAfterSceneReload = async \(\) => \{[\s\S]*?if \(!result\) return false;[\s\S]*?await refreshEntries\(\);[\s\S]*?await commitSuperpositionPlan\(viewer, entries, result\);/,
);
assert.match(fn("reloadSdfPoseMode"), /await activeStructureAlignmentControl\?\.restoreAfterSceneReload\?\.\(\)/);
// Superposition is a transform inside the scene, not a different scene. Keying
// the docking scene on the alignment flag made the first structure step after
// Align rebuild the scene from scratch, which dropped every transform cell and
// re-focused the camera.
assert.doesNotMatch(fn("dockingSceneStateKey"), /structureAlignmentEnabled/);

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

// Selection tooling remains available to other surfaces, while the context menu
// uses its top segmented control for the target scope.
assert.match(fn("molstarSelectionQuery"), /plugin\?\.query\?\.structure\?\.registry[\s\S]*label[\s\S]*includes\(needle\)/);
assert.match(viewer, /applyMolstarSelectionQuery\('whole residues'\)/);
assert.match(viewer, /applyMolstarSelectionQuery\('surrounding residues', 'add'\)/);
assert.match(viewer, /applyMolstarSelectionQuery\('inverse'\)/);
assert.match(viewer, /const MOLSTAR_SELECTION_LEVELS = \[\['element', 'Atom'\], \['residue', 'Residue'\], \['chain', 'Chain'\]\]/);
assert.match(fn("setMolstarSelectionLevel"), /interactivity\.setProps\(\{ granularity: level \}\)/);
assert.match(fn("molstarContextSelectionLoci"), /const pickingLevel = target\?\.pickingLevel \|\| molstarContextMenuMode/);
assert.match(fn("molstarContextSelectionLoci"), /molstarContextPickingLevelLoci\(target, pickingLevel\)/);
assert.match(fn("molstarContextPickingLevelLoci"), /level === 'residue'[\s\S]*molstarContextResidueAtomLociForStructure/);
assert.match(fn("molstarContextPickingLevelLoci"), /level === 'chain'[\s\S]*molstarContextChainLociFromPick/);
assert.match(fn("moleculePickingLevelSubmenu"), /for \(const \[level, levelLabel\] of VIEWPORT_GRANULARITIES\)/);
assert.match(fn("moleculePickingLevelSubmenu"), /setAttribute\('role', 'menuitemradio'\)/);
assert.match(fn("moleculePickingLevelSubmenu"), /setAttribute\('aria-checked', checked \? 'true' : 'false'\)/);
assert.match(fn("molstarContextResolvedLoci"), /molstarContextMenuMode === 'molecule' \|\| !pickedAtom/);
assert.match(fn("modifyMolstarContextVisibility"), /modifyByCurrentSelection\(components, operation\)/);
assert.match(fn("modifyMolstarContextVisibility"), /selection\.fromLoci\('set', loci, false\)/);
assert.match(fn("modifyMolstarContextVisibility"), /operation === 'intersect'[\s\S]*molstarComponentIntersectsLoci/);
assert.match(fn("modifyMolstarContextVisibility"), /state\?\.updateCellState\?\.\(ref, \{ isHidden: true \}\)/);
assert.match(fn("moleculeContextMenuAction"), /modifyMolstarContextVisibility\(target, 'subtract'\)/);
assert.match(fn("moleculeContextMenuAction"), /modifyMolstarContextVisibility\(target, 'intersect'\)/);
assert.match(fn("moleculeContextMenuAction"), /action === 'view:isolate'[\s\S]*focusMolstarContextPick\(\{ \.\.\.target, loci: isolateLoci \}\)/);
assert.match(fn("addMolstarContextScopeComponent"), /const loci = molstarContextSelectionLoci\(target\)/);
assert.match(fn("addMolstarContextScopeComponent"), /manager\.add\(\{[\s\S]*selection: selectionQuery[\s\S]*representation/);
assert.match(fn("molstarContextTargetComponents"), /molstarCurrentStructures\(activeMolstarViewer\(\)\)[\s\S]*find\(structure => structure\?\.cell\?\.transform\?\.ref === targetRef\)/);
assert.match(fn("applyMolstarColourPreset"), /addMolstarContextScopeComponent\([\s\S]*updateRepresentationsTheme\(\[component\]/);
assert.match(fn("moleculeContextMenuAction"), /focusMolstarContextPick\(\{ \.\.\.target, loci \}\)/);
assert.match(fn("moleculeContextMenuAction"), /molstarSurroundingsLoci\(\{ \.\.\.target, loci \}, 5\)/);

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
const measurement = fn("beginMolstarMeasurement");
assert.match(measurement, /const session = \{\s*\n\s*points: \[\]/);
assert.match(measurement, /clicks\.subscribe\(event =>/);
assert.match(measurement, /acceptPicksAt: performance\.now\(\) \+ 180/);
assert.match(measurement, /pickAt < session\.acceptPicksAt/);
assert.match(measurement, /pickAt - session\.lastPickAt < 120/);
assert.match(measurement, /session\.points\.push\(loci\)/);
assert.match(measurement, /session\.points\.length < spec\.points/);
assert.match(measurement, /showMolstarMeasureToast\(molstarMeasurePrompt\(kind, session\.points\.length\)\)/);
assert.match(measurement, /measurement\[spec\.method\]\(\.\.\.points\)/);
assert.match(fn("molstarMeasurePrompt"), /\$\{picked\}\/\$\{spec\.points\} points selected/);
assert.match(fn("showMolstarMeasureToast"), /visible: true/);

// Menu actions that change the scene are undoable through the same stack the
// structure edits use, so Cmd-Z walks them in the order they were made. Selections
// and exports stay out: one changes constantly, the other writes files.
assert.match(fn("captureMolstarSceneUndoSnapshot"), /kind: 'scene'[\s\S]*plugin\.state\.data\.getSnapshot\(\)/);
assert.match(fn("captureMolstarSceneUndoSnapshot"), /superposition: activeStructureAlignmentControl\?\.snapshot\?\.\(\) \|\| null/);
assert.match(fn("restoreMolstarSceneUndoSnapshot"), /plugin\.runTask\(plugin\.state\.data\.setSnapshot\(snapshot\.state\)\)/);
assert.match(fn("restoreMolstarSceneUndoSnapshot"), /restoreMetadata\?\.\(snapshot\.superposition \|\| null\)/);
assert.doesNotMatch(viewer, /kind: 'align'/);
assert.match(fn("restoreMolstarEditUndoSnapshot"), /kind === 'scene'/);
assert.match(fn("pushMolstarEditUndoSnapshot"), /kind !== 'scene' && !snapshot\.payload\?\.text/);
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
assert.match(viewer, /const SCENE_TREE_MEASUREMENT_PARAM_KEYS = new Set/);
assert.match(fn("sceneTreeMeasurementTargets"), /sceneTreeSubtreeRefs\(state, ref\)/);
assert.match(fn("sceneTreeMeasurementTargets"), /\['Distance', 'Angle', 'Dihedral', 'Label'\]/);
assert.match(fn("applySceneTreeMeasurementParam"), /update\.to\(targetRef\)\.update\(old => \(\{ \.\.\.old, \[entry\.key\]: value \}\)\)/);
assert.match(fn("sceneTreeMeasurementMenu"), /'geometry-color'[\s\S]*'line-size'[\s\S]*sceneTreeMeasurementText\(menu, targets\)[\s\S]*'text-color'[\s\S]*'text-size'/);
assert.match(fn("sceneTreeMeasurementText"), /const field = 'custom-text'/);

// The first level stays compact: common target actions are direct, the long
// Maestro/PyMOL toolsets open as submenus, while the short visibility and
// representation blocks stay one click away on the first level.
assert.match(viewer, /\{ id: 'primary', title: 'Target', direct: true \}/);
assert.doesNotMatch(viewer, /\{ id: 'selection', title: 'Selection'/);
assert.match(viewer, /\{ id: 'view', title: 'Visibility', direct: true, breakBefore: true \}/);
assert.match(viewer, /\{ id: 'represent', title: 'Representation', direct: true, breakBefore: true \}/);
assert.match(viewer, /\{ id: 'analyze', title: 'Analyze', rootLabel: 'Tools', breakBefore: true \}/);
assert.doesNotMatch(viewer, /\{ id: 'appearance', title: 'Appearance'/);
assert.match(viewer, /\{ id: 'align', title: 'Superposition' \}/);
assert.match(viewer, /\{ id: 'danger', title: 'Delete', direct: true, destructive: true, hideTitle: true, breakBefore: true \}/);
assert.match(fn("showMolstarContextMenu"), /const actionTarget = \{ \.\.\.menuTarget, pickingLevel: mode \}/);
assert.match(fn("showMolstarContextMenu"), /if \(!section\.hideTitle\)[\s\S]*moleculeMenuActionButton\(action, label, \{[\s\S]*target: actionTarget/);
assert.match(fn("moleculeMenuSubmenu"), /aria-haspopup[\s\S]*buret-tree-menu-sub-trigger[\s\S]*buret-molecule-context-submenu/);
assert.match(fn("moleculeMenuActionButton"), /pickingLevel: options\.pickingLevel \|\| options\.target\.pickingLevel/);
assert.match(fn("moleculeMenuActionButton"), /moleculeContextMenuAction\(action, label, target\)/);
assert.match(fn("moleculeContextMenuAction"), /const target = targetOverride \|\| molstarContextTarget\(\)/);
assert.doesNotMatch(fn("moleculeContextMenuAction"), /action === 'select'[\s\S]*activeViewer\.plugin\.selectionMode = true/);
assert.doesNotMatch(fn("moleculeContextMenuAction"), /action === 'select'[\s\S]*activeViewer\.plugin\.selectionMode = false/);
assert.match(fn("installMoleculeMenuKeyboard"), /ArrowLeft[\s\S]*stopPropagation/);
assert.match(viewer, /menu\._buretPreviousFocus = document\.activeElement/);
assert.match(viewer, /renderActions\(\);\s*\n\s*const point = molstarContextMenuLastPoint[\s\S]*positionMolstarContextMenu/);
assert.match(fn("molstarContextMenuActions"), /VIEWPORT_GRANULARITIES\.find\(\(\[value\]\) => value === mode\)/);
assert.match(fn("molstarContextMenuActions"), /\['remove', molstarContextCanBulkDelete\(target\)/);
assert.doesNotMatch(fn("molstarContextMenuActions"), /select:level:/);
assert.match(fn("showMolstarContextMenu"), /let mode = molstarSelectionLevel\(\)/);
assert.match(fn("showMolstarContextMenu"), /moleculePickingLevelSubmenu\(menu, mode/);
assert.match(fn("showMolstarContextMenu"), /proteinScope \? 'Protein actions' : 'Molecule actions'/);
assert.match(fn("showMolstarContextMenu"), /const applyPickingLevel = levelLabel => \{\s*setMolstarSelectionLevel\(mode\)/);
assert.match(fn("showMolstarContextMenu"), /Picking level set to \$\{String\(levelLabel \|\| mode\)\.toLowerCase\(\)\}/);
assert.doesNotMatch(fn("showMolstarContextMenu"), /activeViewer\.plugin\.selectionMode = true/);
assert.doesNotMatch(fn("showMolstarContextMenu"), /selectMolstarContextPick/);
// Opening the menu and changing its radio group are observational. Only the
// explicit Select command may change the live selection.
assert.match(fn("showMolstarContextMenu"), /menu\.appendChild\(pickingLevel\);\s*\n\s*renderActions\(\)/);
assert.doesNotMatch(fn("molstarContextMenuActions"), /actions\.push\(\[`colour:/);
assert.match(fn("installMolstarContextMenu"), /document\.addEventListener\('mousedown', suppressSecondaryMouseEvent, true\)/);
assert.match(fn("installMolstarContextMenu"), /document\.addEventListener\('auxclick', suppressSecondaryMouseEvent, true\)/);
// Plain left-click behavior remains untouched by the context-menu selection
// contract; the existing sequence-selection preservation path is unchanged.
assert.doesNotMatch(fn("beginMolstarSelectionPreserve"), /molstarContextPickFromEvent/);
assert.match(fn("finishMolstarSelectionPreserve"), /restoreMolstarSelectionLociList\(preserve\.lociList\)/);
assert.match(fn("installMolstarContextMenu"), /const onPointerUp = \(event\) => \{\s*finishMolstarSelectionPreserve\(event\)/);
const group = fn("moleculeContextActionGroup");
assert.match(group, /name\.startsWith\('colour:'\)\) return 'colour'/);
assert.match(group, /name\.startsWith\('select:'\)\) return 'selection'/);
assert.match(group, /name\.startsWith\('align:'\) \|\| name === 'align-structures'\) return 'align'/);
assert.match(group, /name\.startsWith\('extract:'\) \|\| name\.startsWith\('split:'\)\) return 'export'/);

console.log("Structure operations contract tests passed");
