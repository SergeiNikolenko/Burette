#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function source(path) {
  return readFile(resolve(path), "utf8");
}

const [app, gridViewer, gridUi, viewer, dockingDocuments, dropActions, dropActionExecutor, fileKind, openDropHook, sidebarFileTreeNode, editorTabs, vpContract, packageJson, burretePermission] =
  await Promise.all([
    source("apps/desktop/src/App.tsx"),
    source("PreviewExtension/Web/grid-viewer.js"),
    source("apps/desktop/src/preview-grid/grid-ui.tsx"),
    source("PreviewExtension/Web/viewer.js"),
    source("apps/desktop/src/lib/docking-documents.ts"),
    source("apps/desktop/src/lib/drop-actions.ts"),
    source("apps/desktop/src/components/drop-action-executor.ts"),
    source("apps/desktop/src/components/editor-area/page-kinds/file.tsx"),
    source("apps/desktop/src/hooks/use-open-drop.ts"),
    source("apps/desktop/src/components/sidebar/file-tree-node.tsx"),
    source("apps/desktop/src/components/editor-area/editor-tabs.tsx"),
    source("tests/vp-contract.test.mjs"),
    source("package.json"),
    source("apps/desktop/src-tauri/permissions/burrete.toml"),
  ]);

assert.match(gridUi, /data-buret-grid-sdf-poses/);
assert.match(gridUi, /data-buret-grid-docking/);
assert.match(gridUi, />\s*Molstar\s*<\/button>/);
assert.match(gridUi, /data-buret-grid-ketcher/);
assert.match(gridUi, />\s*Ketcher\s*<\/button>/);
assert.match(gridViewer, /setStatus\('\[grid\] Select one or more molecules before opening Molstar\.', 'error'\)/);
assert.match(gridViewer, /post\('openSdfMolstarDocument', '\[grid\] Open selected molecules in Molstar.'/);
assert.match(gridViewer, /setStatus\('\[grid\] Select one or more molecules before opening Ketcher\.', 'error'\)/);
assert.match(gridViewer, /post\('openSdfKetcherDocument', '\[grid\] Open selected molecules in Ketcher.'/);
assert.match(gridViewer, /documentId: cfg\?\.documentId \|\| null/);
assert.match(gridViewer, /textBase64: textToBase64\(records\.join\('\\n'\)\)/);
assert.match(gridViewer, /receptorPath: receptorPath \|\| null/);
assert.match(gridViewer, /activePose/);
assert.match(gridViewer, /body\.type === 'poseReviewSelection'/);
assert.match(gridViewer, /function selectPoseReviewRow\(activePose, cfg\)/);
assert.match(gridViewer, /function selectedMolstarRows\(\)/);
assert.match(gridViewer, /function sdfRecordTextForMolstar\(row\)/);
assert.match(gridViewer, /const text = String\(record\.text \|\| ''\)\.trimEnd\(\);[\s\S]*?if \(!text\.trim\(\)\) return null;/);
assert.match(gridViewer, /const molblock = String\(row\?\.molblock \|\| ''\)\.trimEnd\(\);[\s\S]*?if \(molblock\.trim\(\)\) \{/);

assert.match(app, /body\?\.type === "openSdfMolstarDocument"/);
assert.match(app, /body\?\.type === "openSdfKetcherDocument"/);
assert.match(app, /openKetcherWithStructures\(\[\], fragments\)/);
assert.match(app, /invoke<ViewerDocument>\("open_text_structure"/);
assert.match(app, /rendererMode: "molstar" as const/);
assert.match(app, /void openDockingDocument\(receptorDocument\.path, \[document\.path\]\)/);
assert.match(app, /body\?\.type === "openSdfPoseDocument"/);
assert.match(app, /const \[poseReviewSelections, setPoseReviewSelections\] = useState<Record<string, number>>\(\{\}\)/);
assert.match(app, /body\?\.type === "dockingPoseChanged"/);
assert.match(app, /notifyGridPoseReviewSelection\(gridDocument\.id, activePose\)/);
assert.match(app, /const targetPath = typeof body\.path === "string" && body\.path\.trim\(\)\.length > 0/);
assert.match(app, /const requestedReceptorPath = typeof body\.receptorPath === "string"/);
assert.match(app, /document\.path === requestedReceptorPath/);
assert.match(app, /document\.path !== targetPath && isProteinLikeDockingSource\(document\.path\)/);
assert.match(app, /pushErrorStatus\("Selected receptor is not available for SDF poses\.", "SDF poses failed"\)/);
assert.match(app, /const openPoseReviewWorkspace = useCallback/);
assert.match(app, /openPoseReviewTab\(\{/);
assert.match(app, /void openPoseReviewWorkspace\(receptorDocument, poseTargetDocument, activePose\)/);
assert.match(app, /void openDockingDocument\(receptorDocument\.path, \[targetPath\]\)/);
assert.match(app, /void openDocuments\(\[targetPath\], \{\}, \{ rendererMode: "molstar" \}, \{ inActiveTab: true \}\)/);
assert.match(burretePermission, /"open_docking_document"/);

assert.match(dockingDocuments, /export function dockingRequestForDrop/);
assert.match(dockingDocuments, /export function isMolstarCombineSource/);
assert.match(dockingDocuments, /export function isMolstarCoordinateTrajectorySource/);
assert.match(dockingDocuments, /existingDockingRequest/);
assert.match(dockingDocuments, /combineDockingPaths\(\[\.\.\.existingDockingRequest\.ligandPaths, \.\.\.addedLigands\]\)/);
assert.match(dropActions, /export type DropAction/);
assert.match(dropActions, /export type DropActionChoice/);
assert.match(dropActions, /export type DropSourceContext/);
assert.match(dropActions, /export function resolveDropAction/);
assert.match(dropActions, /export function resolveDropActionChoices/);
assert.match(dropActions, /kind: "merge-collection"/);
assert.match(dropActions, /kind: "add-xyzrender-sheet-items"/);
assert.match(dropActions, /kind: "open-docking"/);

assert.match(viewer, /function prepareDockingStructure\(config\)/);
assert.match(viewer, /const DOCKING_COORDINATE_TRAJECTORY_FORMATS = new Set\(\['xtc', 'trr', 'dcd', 'nctraj', 'lammpstrj'\]\)/);
assert.match(viewer, /const DOCKING_MODEL_TRAJECTORY_FORMATS = new Set\(\['pdb', 'pdbqt', 'mmcif', 'gro'\]\)/);
assert.match(viewer, /const DOCKING_TOPOLOGY_TRAJECTORY_FORMATS = new Set\(\['top', 'psf', 'prmtop'\]\)/);
assert.match(viewer, /function dockingTrajectoryPair\(entries\)/);
assert.match(viewer, /trajectoryPair: dockingTrajectoryPair\(entries\)|const trajectoryPair = dockingTrajectoryPair\(entries\)/);
assert.match(viewer, /ligandSources\.forEach\(\(source, ligandIndex\) =>/);
assert.match(viewer, /records\.forEach\(\(record, poseIndex\) =>/);
assert.match(viewer, /label: `\$\{source\.label \|\| `Ligand \$\{ligandIndex \+ 1\}`\} pose \$\{poseIndex \+ 1\}`/);
assert.match(viewer, /sourcePath: source\.path \|\| ''/);
assert.match(viewer, /const activePose = readDockingPoseIndex\(config, poses\.length\)/);
assert.match(viewer, /nativeTrajectoryControls: true/);
assert.match(viewer, /activePose,\s*poseCount: nativeTrajectoryPoseCount/s);
assert.match(viewer, /entries:\s*\[\s*entries\[0\],\s*poses\[activePose\]\s*\]/);
assert.match(viewer, /async function loadDockingTrajectoryPair\(viewer, pair\)/);
assert.match(viewer, /viewer\.loadTrajectory\(\{/);
assert.match(viewer, /kind: pair\.modelKind/);
assert.match(viewer, /kind: 'coordinates-data'/);
assert.match(viewer, /async function applyDockingTrajectoryPairFrameCount\(prepared\)/);
assert.match(viewer, /if \(prepared\.trajectoryPair\) \{/);
assert.match(viewer, /if \(isDockingTrajectoryPairEntry\(entry, prepared\.trajectoryPair\)\) continue/);
assert.match(viewer, /function notifyDockingPoseChanged\(activePose, prepared\)/);
assert.match(viewer, /type: 'dockingPoseChanged'/);
assert.match(viewer, /const initialPose = activePose/);
assert.match(viewer, /prepared\.nativeTrajectoryControls && initialPose > 0/);
assert.match(viewer, /notifyDockingPoseChanged\(activePose, prepared\)/);

assert.match(viewer, /function installDockingPoseControls\(viewer, prepared\)/);
assert.match(viewer, /function nativeAnimationSelectButton\(\)/);
assert.match(viewer, /animation\.textContent = '⏯'/);
assert.match(viewer, /setAnimationOptionsOpen\(true\)/);
assert.match(viewer, /bindPoseStepButton\(previous, -1\)/);
assert.match(viewer, /bindPoseStepButton\(next, 1\)/);
assert.match(viewer, /poseRepeatTimer = window\.setInterval\(\(\) => repeatPoseStep\(direction\), 320\)/);
assert.match(viewer, /previous\.textContent = 'Prev'/);
assert.match(viewer, /next\.textContent = 'Next'/);
assert.match(viewer, /loop\.textContent = 'Loop'/);
assert.match(viewer, /speed\.className = 'buret-docking-pose-speed'/);
assert.match(viewer, /speed\.type = 'number'/);
assert.match(viewer, /slider\.type = 'range'/);
assert.match(viewer, /label\.textContent = `\$\{controlLabel\} \$\{activePose \+ 1\} \/ \$\{prepared\.poseCount\}`/);
assert.match(viewer, /sessionStorage\.setItem\(trajectoryControlStorageKey\(activeConfig, prepared\), String\(nextIndex\)\)/);
assert.match(viewer, /button\.click\(\)/);
assert.match(viewer, /function trajectoryFpsToDelay\(value, prepared\)/);
assert.match(viewer, /function nativeTrajectoryModelTransform\(expectedCount = 0\)/);
assert.match(viewer, /function nativeTrajectoryFrameCount\(plugin, cell\)/);
assert.match(viewer, /data\.cells\?\.forEach\?\.\(cell => \{/);
assert.match(viewer, /async function setNativeTrajectoryPoseDirect\(index, poseCount\)/);
assert.match(viewer, /plugin\.state\.updateTransform\(/);
assert.match(viewer, /const loopTargetIndex = \(\) => \{/);
assert.match(viewer, /const scheduleLoopStep = \(delayMs = loopNextDelay\(\)\) => \{/);
assert.match(viewer, /loopTimer = window\.setTimeout\(\(\) => \{/);
assert.match(viewer, /let loopActive = false/);
assert.match(viewer, /loopActive = Boolean\(active\)/);
assert.match(viewer, /const scheduleSliderInputPose = \(index\) => \{/);
assert.match(viewer, /if \(prepared\.nativeTrajectoryControls\) scheduleSliderInputPose\(previewIndex\)/);
assert.match(viewer, /if \(event\.key === 'ArrowLeft'\)/);
assert.match(viewer, /if \(activePose > 0\) void setPose\(activePose - 1\)/);
assert.match(viewer, /if \(event\.key === 'ArrowRight'\)/);
assert.match(viewer, /if \(activePose < prepared\.poseCount - 1\) void setPose\(activePose \+ 1\)/);
assert.match(viewer, /function molstarContextPickFromEvent\(event\)/);
assert.match(viewer, /canvas3d\.identify\(\[event\.clientX - rect\.left, event\.clientY - rect\.top\]\)/);
assert.match(viewer, /canvas3d\.getLoci\(picking\.id\)/);
assert.match(viewer, /const pickedStructure = molstarContextMenuPick\?\.loci\?\.structure \|\| null;/);
assert.match(viewer, /const data = molstarStructureFromRef\(structure\);/);
assert.match(viewer, /return data === pickedStructure \|\| data\?\.root === pickedStructure\?\.root;/);
assert.match(viewer, /function molstarContextTarget\(\)/);
assert.doesNotMatch(viewer, /scope: 'receptor'/);
assert.match(viewer, /scope: 'ligand'/);
assert.match(viewer, /scope: pickedScope/);
assert.match(viewer, /function pdbEnvironmentForLigand\(receptor, ligand, radiusAngstrom = 6\)/);
assert.match(viewer, /function molstarContextDocumentPayload\(target\)/);
assert.doesNotMatch(viewer, /\+ protein environment/);
assert.match(viewer, /contextDocument = molstarContextDocumentPayload\(target\)/);
assert.match(viewer, /if \(!contextDocument\) throw new Error\('No molecule-level Mol\* context is available for this target\.'\)/);
assert.match(viewer, /async function applyMolstarContextFocus\(config\)/);
assert.match(viewer, /command: 'focusLigand'/);
assert.match(viewer, /await applyMolstarContextFocus\(config\);/);
assert.match(viewer, /selects\.select\(\{ loci \}, applyGranularity\)/);
assert.match(viewer, /selection\.fromLoci\(additive \? 'add' : 'set', loci, applyGranularity\)/);
assert.match(viewer, /if \(loci\?\.kind === 'structure-loci'\) \{/);
assert.match(viewer, /function focusMolstarContextPick\(target\)/);
assert.match(app, /if \(!isTauriRuntime\(\)\) return openBrowserDevMolstarContextDocument\(contextDocument, molstarPreferences\);/);
assert.match(app, /invoke<ViewerDocument>\("open_text_structure", \{\s*request: \{\s*title: `\$\{label\}\.\$\{extension\}`,\s*extension,\s*text: entry\.data,/s);
assert.match(viewer, /function molstarContextMenuActions\(target, mode = 'molecule'\)/);
assert.match(viewer, /mode === 'atom' && target\?\.scope === 'ligand'/);
assert.match(viewer, /\['select-atom', 'Select atom'\]/);
assert.match(viewer, /\['select', `Select \$\{noun\}`\]/);
assert.match(viewer, /\['remove', molstarContextCanBulkDelete\(target\) \? `Delete selected \$\{noun\}` : `Delete \$\{noun\}`\]/);
assert.match(viewer, /if \(molstarContextCanBulkDelete\(target\)\) actions\.push\(\['remove-type', `Delete \$\{molstarContextBulkDeleteLabel\(target\)\}`\]\);/);
assert.match(viewer, /if \(target\?\.scope === 'residue'\) actions\.push\(\['remove-chain', 'Delete chain'\]\);/);
assert.match(viewer, /function deleteMolstarContextBulkType\(target\)/);
assert.match(viewer, /action === 'remove-type'/);
assert.match(viewer, /function deleteMolstarContextChain\(target\)/);
assert.match(viewer, /return deleteMolstarContextLoci\(target, chainLoci, false\);/);
assert.match(viewer, /await componentManager\.modifyByCurrentSelection\(components, 'subtract'\)/);
assert.doesNotMatch(viewer, /Select molecule/);
assert.doesNotMatch(viewer, /Delete molecule/);
assert.doesNotMatch(viewer, /Inspect properties/);
assert.match(viewer, /if \(!contextPick\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*hideMolstarContextMenu\(\);/);

assert.match(viewer, /function nativeTrajectoryControlsRoot\(\)/);
assert.match(viewer, /function setNativeTrajectoryPose\(index, poseCount\)/);
assert.match(viewer, /nativeTrajectoryStepButton\(direction\)/);
assert.match(viewer, /button\.click\(\)/);
assert.match(viewer, /installNativeTrajectoryPoseSync\(prepared\.poseCount/);
assert.match(viewer, /state\.events\.changed\.subscribe\(sync\)/);

assert.match(openDropHook, /from "\.\.\/lib\/drop-actions"/);
assert.match(openDropHook, /resolveDropActionChoices/);
assert.match(openDropHook, /const choices = resolveDropActionChoices/);
assert.match(openDropHook, /choices\.length > 1 && chooseDropAction/);
assert.match(openDropHook, /kind: "active-viewer"/);
assert.match(openDropHook, /documentPath: activeDocumentPath/);
assert.match(openDropHook, /void openDockingDocument\(action\.request\.receptorPath, action\.request\.ligandPaths\)/);
assert.match(app, /const chooseDropAction = useCallback/);
assert.match(app, /showNativeContextMenu\(/);
assert.match(app, /chooseDropAction,/);

assert.match(fileKind, /shellDropActionChoices\(payload, dropTarget\)\.filter/);
assert.match(fileKind, /runShellDropActionChoices\(actions, droppedPayload, choices, \{ x: event\.clientX, y: event\.clientY \}/);
assert.match(fileKind, /dockingRequest: document\.dockingRequest \?\? null/);
assert.doesNotMatch(fileKind, /dockingRequestForDrop/);
assert.match(fileKind, /Add to Mol\* docking view/);

assert.match(sidebarFileTreeNode, /writeStructureDragPayload\(event\.dataTransfer, \{/);
assert.match(sidebarFileTreeNode, /paths: \[item\.path\]/);
assert.match(sidebarFileTreeNode, /kind: "file"/);
assert.match(sidebarFileTreeNode, /shellDropActionChoices\(payload, sidebarDropTarget\(item, state\), \{ kind: "sidebar" \}\)/);
assert.match(sidebarFileTreeNode, /runShellDropActionChoices\(actions, payload, choices, \{ x: event\.clientX, y: event\.clientY \}\)/);
assert.match(sidebarFileTreeNode, /dockingRequest: document\?\.dockingRequest \?\? null/);
assert.doesNotMatch(sidebarFileTreeNode, /dockingRequestForDrop/);
assert.match(dropActionExecutor, /action\.kind === "open-docking"/);
assert.match(dropActionExecutor, /actions\.openDockingDocument\(action\.request\.receptorPath, action\.request\.ligandPaths\)/);
assert.match(dropActionExecutor, /action\.kind === "open-docking-with-records"/);
assert.match(dropActionExecutor, /actions\.openDockingStructureRecords\(action\.receptorPath, action\.ligandPaths, action\.records\)/);

assert.match(editorTabs, /writeStructureDragPayload\(event\.dataTransfer, \{/);
assert.match(editorTabs, /paths: tabPath \? \[tabPath\] : \[\]/);
assert.match(editorTabs, /items: \[tabDragItem\]/);

assert.match(vpContract, /"test-docking-viewer-contract\.mjs"/);
assert.match(packageJson, /bun tests\/test-docking-viewer-contract\.mjs/);

console.log("docking viewer contract tests passed");
