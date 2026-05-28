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

assert.match(app, /body\?\.type === "openSdfPoseDocument"/);
assert.match(app, /documents\.find\(\(document\) => \(\s*document\.path !== targetDocument\.path && isProteinLikeDockingSource\(document\.path\)\s*\)\)/);
assert.match(app, /void openDockingDocument\(receptorDocument\.path, \[targetDocument\.path\]\)/);
assert.match(app, /void openDocuments\(\[targetDocument\.path\], \{\}, \{ rendererMode: "molstar" \}\)/);

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
assert.match(viewer, /previous\.textContent = 'Prev'/);
assert.match(viewer, /next\.textContent = 'Next'/);
assert.match(viewer, /label\.textContent = `Pose \$\{activePose \+ 1\} \/ \$\{prepared\.poseCount\}`/);
assert.match(viewer, /sessionStorage\.setItem\(dockingPoseStorageKey\(activeConfig\), String\(nextIndex\)\)/);
assert.match(viewer, /if \(event\.key === 'ArrowLeft'\)/);
assert.match(viewer, /if \(activePose > 0\) void setPose\(activePose - 1\)/);
assert.match(viewer, /if \(event\.key === 'ArrowRight'\)/);
assert.match(viewer, /if \(activePose < prepared\.poseCount - 1\) void setPose\(activePose \+ 1\)/);

assert.match(viewer, /function nativeTrajectoryControlsRoot\(\)/);
assert.match(viewer, /function setNativeTrajectoryPose\(index, poseCount\)/);
assert.match(viewer, /nativeTrajectoryStepButton\(direction\)/);
assert.match(viewer, /button\.click\(\)/);
assert.match(viewer, /installNativeTrajectoryPoseSync\(prepared\.poseCount/);

assert.match(openDropHook, /const request = dockingRequestForDrop\(activeDocumentPath, paths, activeDockingRequest\)/);
assert.match(openDropHook, /void openDockingDocument\(request\.receptorPath, request\.ligandPaths\)/);
assert.match(openDropHook, /if \(isOverActiveViewer\(event\.position\) && openAsDocking\(event\.paths\)\) return;/);
assert.match(openDropHook, /if \(openAsDocking\(paths\)\) return;/);

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
