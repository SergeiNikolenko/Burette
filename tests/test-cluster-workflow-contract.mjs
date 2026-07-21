import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const workflow = source("apps/desktop/src/lib/compute-cluster.ts");
const worker = source("apps/desktop/src/workers/cluster-fingerprint.worker.ts");
const bridge = source("apps/desktop/src/hooks/use-app-grid-compute-messages.ts");
const gridUi = source("apps/desktop/src/preview-grid/grid-ui.tsx");
const gridViewer = source("PreviewExtension/Web/grid-viewer.js");
const gridCss = source("PreviewExtension/Web/grid.css");
const computePermission = source("apps/desktop/src-tauri/permissions/compute.toml");
const computeCommands = source("apps/desktop/src-tauri/src/compute/commands.rs");
const coordinator = source("apps/desktop/src-tauri/src/compute/coordinator.rs");
const jobLifecycle = source("apps/desktop/src-tauri/src/compute/job_lifecycle.rs");
const representativeExport = source("apps/desktop/src-tauri/src/compute/representative_export.rs");
const artifactReader = source("apps/desktop/src-tauri/src/compute/artifact_reader.rs");

for (const command of [
  "compute_submit_job",
  "compute_begin_cluster_execution",
  "compute_submit_fingerprint_chunk",
  "compute_execute_cluster",
  "compute_publish_cluster",
  "compute_export_cluster_representatives",
  "compute_find_similar",
]) {
  assert.match(workflow, new RegExp(`invoke<[^>]+>\\(\"${command}\"`));
  assert.match(computePermission, new RegExp(`\"${command}\"`));
}

assert.match(workflow, /workflowTemplate: "cluster\.v1"/);
assert.match(workflow, /backendPolicy: "gpuPreferred"/);
assert.match(workflow, /stage\.stageId === "tanimotoNeighbors"/);
assert.match(workflow, /numericStage\?\.effectiveBackend === "nativeMetal"/);

for (const baseline of [
  /rdkitVersion: "2025\.03\.4"/,
  /radius: 2/,
  /bitCount: 2_048/,
  /useChirality: true/,
  /useFeatures: false/,
]) {
  assert.match(workflow, baseline);
}
assert.match(worker, /rdkit\.version\(\) !== "2025\.03\.4"/);
assert.match(worker, /fingerprint\.byteLength !== expectedBytes/);
assert.match(worker, /PreviewExtension\/Web\/rdkit\/RDKit_minimal\.wasm/);

assert.match(bridge, /body\?\.type !== "clusterMolecules"/);
assert.match(bridge, /result\.backend === "nativeMetal" \? "Metal GPU" : "reference CPU"/);
assert.match(bridge, /openTextDocuments\(\[result\.reportPath\], \{ background: true \}\)/);
assert.match(gridUi, /id="cluster-molecules"/);
assert.match(gridViewer, /post\('clusterMolecules'/);
assert.match(gridViewer, /kind: 'filtered'/);
assert.match(gridViewer, /columnFilters: remoteTableColumnFilters\(\)/);
assert.match(gridViewer, /descriptorFilters: mergedDescriptorFilters\(\)/);
assert.match(gridViewer, /analysisFilters: mergedAnalysisFilters\(\)/);
assert.match(bridge, /parseClusterFilteredScope\(body\.filteredScope\)/);
assert.match(workflow, /filteredScope \?\? \{ kind: "all" \}/);
assert.match(gridViewer, /body\.backend === 'nativeMetal' \? 'Metal GPU' : 'reference CPU'/);
assert.match(gridUi, /Cancel clustering/);
assert.match(gridViewer, /post\('cancelClusterMolecules'/);
assert.match(bridge, /body\?\.type === "cancelClusterMolecules"/);
assert.match(bridge, /active\.controller\.abort\(\)/);
assert.match(workflow, /compute_get_job/);
assert.match(workflow, /compute_cancel_job/);
assert.match(workflow, /throwIfAborted\(signal\)/);
assert.match(coordinator, /finish_cancellation\(&requested, now_ms\(\)\)/);
assert.match(jobLifecycle, /StageState::Cancelled/);

assert.match(computeCommands, /fn compute_export_cluster_representatives/);
assert.match(bridge, /body\?\.type === "exportClusterRepresentatives"/);
assert.match(bridge, /directory: true/);
assert.match(bridge, /gridClusterRepresentativesExportFinished/);
assert.match(gridUi, /id="export-cluster-representatives"/);
assert.match(gridUi, /Export diverse/);
assert.match(gridViewer, /latestRepresentativeAnalysisColumn\(\)/);
assert.match(gridViewer, /post\('exportClusterRepresentatives'/);
assert.match(gridCss, /\.buret-cluster-export-button\[aria-busy="true"\]/);

assert.match(computeCommands, /fn compute_find_similar/);
assert.match(bridge, /body\?\.type === "findSimilarMolecules"/);
assert.match(bridge, /gridSimilaritySearchFinished/);
assert.match(bridge, /result\.backend === "nativeMetal" \? "Metal GPU" : "reference CPU"/);
assert.match(gridUi, /id="find-similar-molecules"/);
assert.match(gridUi, /Find similar/);
assert.match(gridViewer, /state\.selected\.size !== 1/);
assert.match(gridViewer, /topK: 50/);
assert.match(gridViewer, /post\('findSimilarMolecules'/);
assert.match(gridViewer, /gridSimilaritySearchFinished/);
assert.match(gridCss, /\.buret-similarity-button\[aria-busy="true"\]/);

assert.match(representativeExport, /MOLECULAR_RECORDS_FILE_PATH/);
assert.match(representativeExport, /result\/representatives\.bin/);
assert.match(representativeExport, /result\/cluster-ids\.bin/);
assert.match(representativeExport, /OrderedRecordMoleculeIdentityHasher/);
assert.match(artifactReader, /OFlags::NOFOLLOW/);
assert.match(representativeExport, /open_verified_artifact_file/);
assert.match(representativeExport, /artifact_manifest_sha256/);
assert.match(representativeExport, /representatives\.csv/);
assert.match(representativeExport, /representatives\.sdf/);
assert.match(representativeExport, /representatives\.smi/);
assert.match(representativeExport, /provenance\.json/);
assert.match(representativeExport, /renameat_with\(/);
assert.match(representativeExport, /RenameFlags::NOREPLACE/);
assert.match(representativeExport, /table_only_record_count/);

console.log("cluster workflow contract tests passed");
