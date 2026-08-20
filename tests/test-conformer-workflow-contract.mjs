import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const viteConfig = source("apps/desktop/vite.config.ts");
const conformerCommand = source("apps/desktop/src-tauri/src/commands/conformer.rs");
const chemistrySettings = source("apps/desktop/src/lib/chemistry-settings.ts");
const chemistryTypes = source("apps/desktop/src/types.ts");
const chemistryJobsHook = source("apps/desktop/src/hooks/use-app-chemistry-jobs.ts");
const conformerWorkflow = source("apps/desktop/src/hooks/use-app-conformer-workflows.ts");
const structureInfoPanel = source("apps/desktop/src/components/structure-info-panel.tsx");
const nativeConformerWorkflow = source("apps/desktop/src/lib/compute-conformer.ts");
const gridConformerMessages = source("apps/desktop/src/hooks/use-app-grid-conformer-messages.ts");
const gridViewer = source("PreviewExtension/Web/grid-viewer.js");
const conformerWorker = source("apps/desktop/src/workers/conformer-extract.worker.ts");
const conformerExecutor = source("apps/desktop/src-tauri/src/compute/conformer_executor.rs");
const artifactPublisher = source("apps/desktop/src-tauri/src/compute/artifact_publisher.rs");

assert.match(structureInfoPanel, /document\.renderer !== "grid2d" && canUseConformerWorkflow/);
assert.match(conformerWorkflow, /Open a specific molecule from the collection in Mol\* before running CREST/);

for (const text of [chemistrySettings, chemistryTypes, structureInfoPanel, conformerWorkflow, conformerCommand, viteConfig]) {
  assert.doesNotMatch(text, /prismRotamerPruning|prism_rotamer_pruning/u);
}

assert.match(conformerCommand, /Unsupported conformer operation: \{operation\}/);
assert.match(viteConfig, /Unsupported conformer operation: \$\{String\(value \|\| "missing"\)\}/);
assert.match(viteConfig, /runBrowserDevConformerJobImpl\(request, jobKey\)[\s\S]*finally \{\s*finishBrowserDevJob\(jobKey\);/);
assert.match(conformerCommand, /Conformer job cancelled before the process started/);
assert.match(viteConfig, /browserDevJobWasCancelled\(jobKey\)[\s\S]*status: 130/);
assert.match(chemistryJobsHook, /cancelledConformerJobIdsRef\.current\.delete\(jobId\)[\s\S]*status: "running"/);
assert.match(conformerCommand, /Primary output: \{\}/);
assert.match(viteConfig, /Primary output: \$\{result\.primaryOpenPath \?\? "None"\}/);
assert.match(gridViewer, /sourceIndexes: rows\.map\(row => Number\(row\.index\)\)/);
assert.match(gridViewer, /CONFORMER_VARIANTS = \['DG', 'KDG', 'ETDG', 'ETDGv2', 'ETKDG', 'ETKDGv2', 'ETKDGv3', 'srETKDGv3'\]/);
assert.match(gridViewer, /MMFF_VARIANTS = \['MMFF94', 'MMFF94s'\]/);
assert.match(gridViewer, /optimizeGeometryGridSelection/);
assert.match(nativeConformerWorkflow, /workflowTemplate: "conformer\.v1"/);
assert.match(nativeConformerWorkflow, /initialization: options\.initialization/);
assert.match(nativeConformerWorkflow, /mmffVariant: options\.mmffVariant/);
assert.match(nativeConformerWorkflow, /backendPolicy: "gpuRequired"/);
assert.match(nativeConformerWorkflow, /compute_get_job/);
assert.match(nativeConformerWorkflow, /latest\.revision/);
assert.match(gridConformerMessages, /statusErrorMessage\(error\)/);
assert.match(gridConformerMessages, /conformersPerMolecule: 1/);
assert.doesNotMatch(gridConformerMessages, /conformersPerMolecule: optimizeInputGeometry \? 1 : 16/);
assert.match(gridConformerMessages, /Metal 3D generation failed; retrying the selected molecules with RDKit CPU/);
assert.match(gridViewer, /sourceIndex: Number\(row\.index\)/);
assert.match(gridConformerMessages, /const sourceIndex = Number\(item\.sourceIndex\)/);
assert.match(gridConformerMessages, /openDocuments\(\[result\.primaryOpenPath\][\s\S]*rendererMode: "molstar"/);
assert.match(gridConformerMessages, /openDocuments\(\[result\.primaryOpenPath\][\s\S]*molstarStyle: "ball-and-stick"/);
assert.match(gridConformerMessages, /preferences: \{ \.\.\.preferences, rendererMode: "molstar", molstarStyle: "ball-and-stick" \}/);
assert.match(gridConformerMessages, /openDocumentsInActiveTab\(\[generatedDocument\]\)/);
assert.match(gridConformerMessages, /opened the generated conformer artifact/);
assert.doesNotMatch(gridConformerMessages, /reply\("gridGenerate3DResult"/);
assert.doesNotMatch(gridViewer, /body\.type === 'gridGenerate3DResult'/);
assert.doesNotMatch(gridViewer, /pushUndoSnapshot\('Generate 3D'\)/);
for (const command of [
  "compute_execute_conformer_distance",
  "compute_execute_conformer_stereo",
  "compute_validate_conformer_reference",
  "compute_publish_conformer",
]) {
  assert.match(nativeConformerWorkflow, new RegExp(command));
}
assert.match(gridConformerMessages, /openTextDocuments\(\[result\.reportPath\], \{ background: true \}\)/);
assert.match(conformerWorker, /extract_mmff_parameters/);
assert.match(conformerWorker, /mmff_extractor_abi_version/);
assert.match(conformerWorker, /view\.setUint16\(4, 2, true\)/);
assert.match(conformerExecutor, /optimize_mmff_profiled/);
assert.match(conformerExecutor, /mmff_retry_options/);
assert.match(artifactPublisher, /ResultPackVersion::ConformerV2/);
assert.match(artifactPublisher, /"mmff_energy"/);
assert.match(artifactPublisher, /mmffVariant=\{\} mmffEnergy=\{\}/);
assert.match(artifactPublisher, /"result\/report\.md"/);
assert.match(artifactPublisher, /"computeReport"/);

console.log("conformer workflow contract tests passed");
