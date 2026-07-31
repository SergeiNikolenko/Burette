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
// Sequence/pocket matching follows the best chain sequence even when otherwise
// identical files use different author-assigned chain IDs.
assert.match(fn("structureAlignmentChainCandidates"), /sameChainOnly[\s\S]*for \(const movingResidues of chains\.values\(\)\)/);
assert.match(align, /sameChainOnly: requested === 'atoms'/);

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
// Isolate's inverse and Mol*'s own cell actions came over from the scene tree menu
// when the 3D right click took its place; both address the component by ref.
assert.match(fn("molstarContextMenuActions"), /actions\.push\(\['view:show-all', 'Show all'\]\)/);
assert.match(fn("molstarContextMenuActions"), /sceneTreeCellActions\(activeMolstarViewer\(\), componentRef\)[\s\S]*`molstar-action:\$\{index\}`/);
assert.match(fn("moleculeContextMenuAction"), /action === 'view:show-all'[\s\S]*showAllSceneTreeNodes\(componentRef\)/);
assert.match(fn("moleculeContextMenuAction"), /action\.startsWith\('molstar-action:'\)[\s\S]*applySceneTreeAction\(componentRef, Number\(/);
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
assert.match(fn("restoreMolstarSceneUndoSnapshot"), /plugin\.runTask\(plugin\.state\.data\.setSnapshot\(snapshot\.state\)\)/);
assert.match(fn("captureMolstarAlignUndoSnapshot"), /kind: 'align'[\s\S]*wasAligned/);
assert.match(fn("captureMolstarAlignUndoSnapshot"), /mode: activeStructureAlignmentControl\.mode/);
assert.match(fn("restoreMolstarAlignUndoSnapshot"), /mode === snapshot\.mode[\s\S]*control\.toggle\(snapshot\.mode \|\| 'auto'\)/);
assert.match(fn("restoreMolstarEditUndoSnapshot"), /kind === 'scene'[\s\S]*kind === 'align'/);
assert.match(fn("pushMolstarEditUndoSnapshot"), /kind !== 'scene' && snapshot\.kind !== 'align' && !snapshot\.payload\?\.text/);
const undoLabels = fn("molstarSceneUndoActionLabel");
for (const undoable of ["colour:", "analyze:interactions", "analyze:label", "represent:surface", "view:hide", "view:isolate", "view:show-all"]) {
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
// Maestro/PyMOL toolsets use submenus, while the short visibility actions stay one
// click away and the representation editor gets the same cascading treatment.
assert.match(viewer, /\{ id: 'primary', title: 'Target', direct: true \}/);
assert.doesNotMatch(viewer, /\{ id: 'selection', title: 'Selection'/);
assert.match(viewer, /\{ id: 'view', title: 'Visibility', direct: true, breakBefore: true \}/);
assert.match(viewer, /\{ id: 'represent', title: 'Representation', direct: true, breakBefore: true \}/);
assert.match(viewer, /\{ id: 'analyze', title: 'Analyze', rootLabel: 'Tools', breakBefore: true \}/);
assert.match(viewer, /\{ id: 'export', title: 'Export' \}/);
assert.doesNotMatch(viewer, /\{ id: 'appearance', title: 'Appearance'/);
assert.match(viewer, /\{ id: 'align', title: 'Superposition' \}/);
assert.match(viewer, /\{ id: 'danger', title: 'Delete', direct: true, destructive: true, hideTitle: true, breakBefore: true \}/);
assert.match(fn("showMolstarContextMenu"), /const actionTarget = \{ \.\.\.menuTarget, pickingLevel: mode \}/);
assert.match(fn("showMolstarContextMenu"), /if \(!section\.hideTitle\)[\s\S]*moleculeMenuActionButton\(action, label, \{[\s\S]*target: actionTarget/);
assert.match(fn("moleculeMenuSubmenu"), /aria-haspopup[\s\S]*buret-tree-menu-sub-trigger[\s\S]*buret-molecule-context-submenu/);
assert.match(fn("moleculeMenuRepresentationSubmenu"), /aria-haspopup[\s\S]*menu[\s\S]*sceneTreeRepresentationMenu/);
assert.match(fn("moleculeMenuRepresentationSubmenu"), /trigger\.addEventListener\('click'[\s\S]*event\.stopPropagation\(\)[\s\S]*open\(true\)/);
assert.match(fn("duplicateSceneTreeRepresentation"), /typeOverride[\s\S]*addRepresentation[\s\S]*type: nextType[\s\S]*return String\(created\?\.ref/);
assert.match(fn("moleculeMenuRepresentationTypePicker"), /Update current[\s\S]*Add another[\s\S]*typePreview\.commit[\s\S]*typePreview\.restore[\s\S]*duplicateSceneTreeRepresentation/);
assert.match(fn("moleculeMenuRepresentationTypePreview"), /kind === 'preview'[\s\S]*kind === 'restore'[\s\S]*kind === 'commit'/);
assert.match(fn("moleculeMenuRepresentationTypePicker"), /typePreview\.preview/);
assert.match(fn("moleculeMenuRepresentationTypePicker"), /typePreview\.commit/);
assert.match(fn("moleculeMenuRepresentationTypePicker"), /typePreview\.restore/);
assert.doesNotMatch(viewer, /function moleculeMenuRepresentationMode/);
assert.match(fn("moleculeMenuActionButton"), /pickingLevel: options\.pickingLevel \|\| options\.target\.pickingLevel/);
assert.match(fn("moleculeMenuActionButton"), /moleculeContextMenuAction\(action, label, target\)/);
assert.match(fn("moleculeContextMenuAction"), /const target = targetOverride \|\| molstarContextTarget\(\)/);
assert.doesNotMatch(fn("moleculeContextMenuAction"), /action === 'select'[\s\S]*activeViewer\.plugin\.selectionMode = true/);
assert.doesNotMatch(fn("moleculeContextMenuAction"), /action === 'select'[\s\S]*activeViewer\.plugin\.selectionMode = false/);
assert.match(fn("installMoleculeMenuKeyboard"), /ArrowLeft[\s\S]*stopPropagation/);
assert.match(viewer, /menu\._buretPreviousFocus = document\.activeElement/);
assert.match(viewer, /renderActions\(\);\s*\n\s*const point = \{[\s\S]*Number\.parseFloat\(menu\.style\.left\)[\s\S]*positionMolstarContextMenu/);
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
