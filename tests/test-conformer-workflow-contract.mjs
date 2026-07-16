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
assert.match(nativeConformerWorkflow, /workflowTemplate: "conformer\.v1"/);
assert.match(nativeConformerWorkflow, /backendPolicy: "gpuPreferred"/);
for (const command of [
  "compute_execute_conformer_distance",
  "compute_execute_conformer_stereo",
  "compute_validate_conformer_reference",
  "compute_publish_conformer",
]) {
  assert.match(nativeConformerWorkflow, new RegExp(command));
}
assert.match(gridConformerMessages, /openDocuments\([\s\S]*result\.primaryOpenPath[\s\S]*rendererMode: "molstar"/);
assert.match(conformerWorker, /extract_mmff_parameters/);
assert.match(conformerWorker, /mmff_extractor_abi_version/);
assert.match(conformerWorker, /view\.setUint16\(4, 2, true\)/);
assert.match(conformerExecutor, /optimize_mmff_profiled/);
assert.match(conformerExecutor, /mmff_retry_options/);
assert.match(artifactPublisher, /ResultPackVersion::ConformerV2/);
assert.match(artifactPublisher, /bestMmff94sEnergy|mmff94sEnergy/);

console.log("conformer workflow contract tests passed");
