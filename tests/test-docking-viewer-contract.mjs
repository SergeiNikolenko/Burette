#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function source(path) {
  return readFile(resolve(path), "utf8");
}

const [app, gridViewer, viewer, dockingDocuments, fileKind, openDropHook, sidebarFileTreeNode, editorTabs, vpContract, packageJson] =
  await Promise.all([
    source("apps/desktop/src/App.tsx"),
    source("PreviewExtension/Web/grid-viewer.js"),
    source("PreviewExtension/Web/viewer.js"),
    source("apps/desktop/src/lib/docking-documents.ts"),
    source("apps/desktop/src/components/editor-area/page-kinds/file.tsx"),
    source("apps/desktop/src/hooks/use-open-drop.ts"),
    source("apps/desktop/src/components/sidebar/file-tree-node.tsx"),
    source("apps/desktop/src/components/editor-area/editor-tabs.tsx"),
    source("tests/vp-contract.test.mjs"),
    source("package.json"),
  ]);

assert.match(gridViewer, /data-buret-grid-sdf-poses data-buret-grid-docking>Poses<\/button>/);
assert.match(gridViewer, /post\('openSdfPoseDocument', '\[grid\] Open SDF poses in Mol\*.'/);
assert.match(gridViewer, /documentId: cfg\?\.documentId \|\| null/);
assert.match(gridViewer, /path: sourcePath \|\| null/);
assert.match(gridViewer, /receptorPath: receptorPath \|\| null/);

assert.match(app, /body\?\.type === "openSdfPoseDocument"/);
assert.match(app, /const targetPath = typeof body\.path === "string" && body\.path\.trim\(\)\.length > 0/);
assert.match(app, /const requestedReceptorPath = typeof body\.receptorPath === "string"/);
assert.match(app, /document\.path === requestedReceptorPath/);
assert.match(app, /document\.path !== targetPath && isProteinLikeDockingSource\(document\.path\)/);
assert.match(app, /pushErrorStatus\("Selected receptor is not available for SDF poses\.", "SDF poses failed"\)/);
assert.match(app, /void openDockingDocument\(receptorDocument\.path, \[targetPath\]\)/);
assert.match(app, /void openDocuments\(\[targetPath\], \{\}, \{ rendererMode: "molstar" \}\)/);

assert.match(dockingDocuments, /export function dockingRequestForDrop/);
assert.match(dockingDocuments, /existingDockingRequest/);
assert.match(dockingDocuments, /ligandLikeDockingPaths\(\[\.\.\.existingDockingRequest\.ligandPaths, \.\.\.addedLigands\]\)/);

assert.match(viewer, /function prepareDockingStructure\(config\)/);
assert.match(viewer, /ligandSources\.forEach\(\(source, ligandIndex\) =>/);
assert.match(viewer, /records\.forEach\(\(record, poseIndex\) =>/);
assert.match(viewer, /label: `\$\{source\.label \|\| `Ligand \$\{ligandIndex \+ 1\}`\} pose \$\{poseIndex \+ 1\}`/);
assert.match(viewer, /const activePose = readDockingPoseIndex\(config, poses\.length\)/);
assert.match(viewer, /nativeTrajectoryControls: true/);
assert.match(viewer, /entries:\s*\[\s*entries\[0\],\s*poses\[activePose\]\s*\]/);

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
assert.match(viewer, /slider\.type = 'range'/);
assert.match(viewer, /label\.textContent = `Pose \$\{activePose \+ 1\} \/ \$\{prepared\.poseCount\}`/);
assert.match(viewer, /sessionStorage\.setItem\(dockingPoseStorageKey\(activeConfig\), String\(nextIndex\)\)/);
assert.match(viewer, /button\.click\(\)/);
assert.match(viewer, /window\.setInterval\(\(\) => \{/);
assert.match(viewer, /void setPose\(Number\(slider\.value\) - 1\)/);
assert.match(viewer, /if \(event\.key === 'ArrowLeft'\)/);
assert.match(viewer, /if \(activePose > 0\) void setPose\(activePose - 1\)/);
assert.match(viewer, /if \(event\.key === 'ArrowRight'\)/);
assert.match(viewer, /if \(activePose < prepared\.poseCount - 1\) void setPose\(activePose \+ 1\)/);
assert.match(viewer, /function molstarContextPickFromEvent\(event\)/);
assert.match(viewer, /canvas3d\.identify\(\[event\.clientX - rect\.left, event\.clientY - rect\.top\]\)/);
assert.match(viewer, /canvas3d\.getLoci\(picking\.id\)/);
assert.match(viewer, /const pickedStructure = molstarContextMenuPick\?\.loci\?\.structure \|\| null;/);
assert.match(viewer, /return data === pickedStructure \|\| data\?\.root === pickedStructure\?\.root;/);
assert.match(viewer, /function molstarContextTarget\(\)/);
assert.match(viewer, /scope: 'receptor'/);
assert.match(viewer, /scope: 'ligand'/);
assert.match(viewer, /function pdbEnvironmentForLigand\(receptor, ligand, radiusAngstrom = 6\)/);
assert.match(viewer, /function molstarContextDocumentPayload\(target\)/);
assert.match(viewer, /contextDocument = molstarContextDocumentPayload\(target\)/);
assert.match(viewer, /if \(!contextDocument\) throw new Error\('No molecule-level Mol\* context is available for this target\.'\)/);
assert.match(viewer, /selects\.select\(pick, true\)/);
assert.match(viewer, /function focusMolstarContextPick\(\)/);
assert.match(app, /openBrowserDevMolstarContextDocument\(body\.contextDocument, preferences\)/);
assert.match(viewer, /\['select', 'Select molecule'\]/);
assert.match(viewer, /if \(!contextPick\) \{\s*hideMolstarContextMenu\(\);/);

assert.match(viewer, /function nativeTrajectoryControlsRoot\(\)/);
assert.match(viewer, /function setNativeTrajectoryPose\(index, poseCount\)/);
assert.match(viewer, /nativeTrajectoryStepButton\(direction\)/);
assert.match(viewer, /button\.click\(\)/);
assert.match(viewer, /installNativeTrajectoryPoseSync\(prepared\.poseCount/);

assert.match(openDropHook, /const request = dockingRequestForDrop\(activeDocumentPath, paths, activeDockingRequest\)/);
assert.match(openDropHook, /void openDockingDocument\(request\.receptorPath, request\.ligandPaths\)/);
assert.match(openDropHook, /if \(isOverActiveViewer\(event\.position\) && openAsDocking\(event\.paths\)\) return;/);
assert.match(openDropHook, /if \(openAsDocking\(payload\.paths\)\) return;/);

assert.match(fileKind, /const request = dockingRequestForDrop\(document\.path, droppedPaths, document\.dockingRequest\)/);
assert.match(fileKind, /void actions\.openDockingDocument\(request\.receptorPath, request\.ligandPaths\)/);
assert.match(fileKind, /Add to Mol\* docking view/);

assert.match(sidebarFileTreeNode, /writeStructureDrag\(event\.dataTransfer, \[item\.path\]\)/);
assert.match(sidebarFileTreeNode, /const dockingRequest = dockingRequestForDrop\(item\.path, paths\)/);
assert.match(sidebarFileTreeNode, /item\.path\.startsWith\("burrete-docking:\/\/"\)/);
assert.match(sidebarFileTreeNode, /void actions\.openDockingDocument\(item\.documentId \?\? item\.path, paths\)/);

assert.match(editorTabs, /writeStructureDrag\(event\.dataTransfer, \[tabPath\]\)/);

assert.match(vpContract, /"test-docking-viewer-contract\.mjs"/);
assert.match(packageJson, /bun tests\/test-docking-viewer-contract\.mjs/);

console.log("docking viewer contract tests passed");
