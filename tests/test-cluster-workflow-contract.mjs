import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeChemicalSpacePositions } from "../apps/desktop/src/lib/chemical-space-normalization.ts";

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
const chemicalSpace = source("apps/desktop/src-tauri/src/compute/chemical_space.rs");
const chemicalSpacePanel = source("apps/desktop/src/components/chemical-space-panel.tsx");
const chemicalSpace3d = source("apps/desktop/src/components/chemical-space-3d.tsx");
const progressComponent = source("apps/desktop/src/components/ui/progress.tsx");
const desktopStyles = source("apps/desktop/src/styles.css");
const browserDevCompute = source("apps/desktop/src/lib/browser-dev-compute.ts");
const browserDevRoute = source("apps/desktop/vite/browser-dev/native-compute.ts");
const representationWorker = source("compute/models/chemical_space_representations.py");
const devComputeBackend = source("apps/desktop/src-tauri/src/compute/dev_backend.rs");
const agentShellServer = source("scripts/agent-shell-server.mjs");
const normalization = source("apps/desktop/src/lib/chemical-space-normalization.ts");

for (const command of [
  "compute_submit_job",
  "compute_begin_cluster_execution",
  "compute_submit_fingerprint_chunk",
  "compute_execute_cluster",
  "compute_publish_cluster",
  "compute_export_cluster_representatives",
  "compute_find_similar",
  "compute_execute_chemical_space",
]) {
  assert.match(workflow, new RegExp(`invoke<[^>]+>\\(\"${command}\"`));
  assert.match(computePermission, new RegExp(`\"${command}\"`));
}

assert.match(workflow, /workflowTemplate: "cluster\.v1"/);
assert.match(workflow, /backendPolicy: "gpuPreferred"/);
assert.match(workflow, /stage\.stageId === "tanimotoNeighbors"/);
assert.match(workflow, /numericStage\?\.effectiveBackend === "nativeMetal"/);
assert.match(workflow, /export async function runChemicalSpaceWorkflow/);
assert.match(workflow, /export async function runChemicalSpaceStudyWorkflow/);
assert.match(workflow, /preparedChemicalSpaceJobs\.get\(documentId\)/);
assert.match(workflow, /invalidateChemicalSpaceFingerprintCache/);
assert.match(workflow, /fingerprintBrowserChemicalSpaceRecords/);
assert.match(workflow, /invoke<ChemicalSpaceResult>\("compute_execute_chemical_space"/);
assert.match(chemicalSpace, /build_tanimoto_knn_profiled/);
assert.match(chemicalSpace, /optimize_embedding_profiled/);
assert.match(chemicalSpace, /cached_knn/);
assert.match(chemicalSpace, /let \(knn, tanimoto_gpu_time_ms\) = if let Some\(knn\) = reused_knn/);
for (const method of ["Umap", "Tmap", "Tsne", "Pacmap", "Localmap", "Trimap", "Dreams", "Cne", "Mmae"]) {
  assert.match(chemicalSpace, new RegExp(`ChemicalSpaceMethod::${method}`));
}
assert.match(chemicalSpace, /cluster_chemical_space_from_fingerprints/);
assert.match(chemicalSpace, /build_graph_profiled/);
assert.match(chemicalSpace, /butina_clusters/);
assert.match(
  chemicalSpacePanel,
  /\{ value: "umap", label: "UMAP" \},\s*\{ value: "tmap", label: "TMAP" \}/,
);
assert.match(chemicalSpacePanel, /result\.treeEdges/);
assert.match(chemicalSpacePanel, /Butina · Tanimoto/);
assert.match(chemicalSpacePanel, /Tanimoto cutoff/);
assert.match(chemicalSpacePanel, /clusterMembersForSource/);
assert.match(chemicalSpace3d, /vertexColors: true/);
assert.match(chemicalSpacePanel, /isKnownViewerMessageSource\(event\.source, documentId\)/);
assert.match(chemicalSpacePanel, /MAX_LASSO_POINTS = 4_096/);
assert.match(chemicalSpacePanel, /GRID_SELECTION_BRIDGE_LIMIT = 100_000/);
assert.match(chemicalSpacePanel, /normalizeChemicalSpacePositions/);
assert.match(normalization, /BULK_RADIUS_QUANTILE = 0\.9/);
assert.match(normalization, /MAX_NORMALIZED_RADIUS = 1\.45/);
assert.match(normalization, /Math\.log1p\(radius - 1\)/);

// Activity colouring (DataWarrior-style) rides the Grid bridge as a purely visual
// layer: numeric columns and their values flow from the grid viewer, and the panel
// derives per-point colours that override cluster colouring in 2D and 3D.
assert.match(gridViewer, /chemicalSpaceRequestColumns/);
assert.match(gridViewer, /chemicalSpaceRequestColumnValues/);
assert.match(gridViewer, /function postChemicalSpaceColumns/);
assert.match(gridViewer, /function postChemicalSpaceColumnValues/);
assert.match(gridViewer, /inferPropColumnType\(pool, key\)/);
assert.match(gridViewer, /tableColumnNumericValue\(row, id\)/);
assert.match(chemicalSpacePanel, /function requestChemicalSpaceColumns/);
assert.match(chemicalSpacePanel, /function requestChemicalSpaceColumnValues/);
assert.match(chemicalSpacePanel, /function buildActivityColoring/);
assert.match(chemicalSpacePanel, /activityColors\?\.get\(point\.sourceRecordId\)/);
assert.match(chemicalSpacePanel, /<ActivityLegend/);
assert.match(chemicalSpace3d, /pointColorsRef\.current\[index\]/);

// Activity cliffs ride the sparse Metal kNN graph: the backend surfaces the
// deduplicated neighbour edges + similarities, and the panel scores SALI over
// them (never a dense matrix), rendering cliff edges and a sortable table.
assert.match(chemicalSpace, /fn undirected_neighbor_edges/);
assert.match(chemicalSpace, /neighbor_edges: Vec<\[u32; 2\]>/);
assert.match(chemicalSpace, /MAX_UNDIRECTED_SIMILARITY_EDGES as usize/);
assert.match(workflow, /neighborEdges: Array<\[number, number\]>/);
assert.match(chemicalSpacePanel, /function computeActivityCliffs/);
assert.match(chemicalSpacePanel, /delta \/ Math\.max\(1e-6, 1 - similarity\)/);
assert.match(chemicalSpacePanel, /<CliffTable/);
assert.match(chemicalSpace3d, /updateCliffs/);
const corePositions = Array.from({ length: 92 }, (_, index) => {
  const angle = index / 92 * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle), Math.sin(angle * 3) * 0.4];
});
const outlierPositions = Array.from({ length: 8 }, (_, index) => {
  const angle = index / 8 * Math.PI * 2;
  return [Math.cos(angle) * 100, Math.sin(angle) * 100, index % 2 === 0 ? 60 : -60];
});
const normalizedPositions = normalizeChemicalSpacePositions([...corePositions, ...outlierPositions]);
const normalizedRadii = normalizedPositions
  .map((position) => Math.hypot(...position))
  .sort((left, right) => left - right);
assert.ok(normalizedPositions.flat().every(Number.isFinite));
assert.ok(normalizedRadii[80] > 0.7, "the central chemical-space structure should fill the viewport");
assert.ok(normalizedRadii.at(-1) > 1, "outliers should remain distinguishable from the bulk");
assert.ok(normalizedRadii.at(-1) <= 1.45, "outliers should remain within the visible scene");
assert.doesNotMatch(chemicalSpacePanel, /MOLECULE_PREVIEW_HOVER_DELAY_MS/);
assert.doesNotMatch(chemicalSpacePanel, /previewHoverReadyFor/);
assert.match(chemicalSpacePanel, /preview=\{preview\}/);
assert.match(chemicalSpace3d, /new THREE\.WebGLRenderer/);
assert.match(chemicalSpace3d, /new THREE\.PerspectiveCamera/);
assert.match(chemicalSpace3d, /new OrbitControls/);
assert.match(chemicalSpace3d, /nearestProjectedPoint/);
assert.match(chemicalSpace3d, /camera\.position\.sub\(anchor\)\.multiplyScalar\(ratio\)\.add\(anchor\)/);
assert.doesNotMatch(chemicalSpace3d, /raycaster\.intersectObject/);
assert.match(chemicalSpace3d, /updatePositions/);
assert.match(chemicalSpacePanel, /cursor\.x - centerX - \(cursor\.x - centerX - value\.panX\) \* ratio/);
assert.match(gridViewer, /body\.type === 'chemicalSpaceRequestState'/);
assert.match(gridViewer, /body\.type === 'chemicalSpaceRequestRecords'/);
assert.match(chemicalSpacePanel, /const retryDelays = \[0, 250, 1_000, 3_000, 7_000\]/);
assert.match(chemicalSpacePanel, /data\.body\.type === "ready"/);
assert.match(chemicalSpacePanel, /iframe\.addEventListener\("load", onLoad\)/);
assert.match(gridViewer, /CHEMICAL_SPACE_RECORD_LIMIT = 20000/);
assert.match(gridViewer, /body\.type === 'chemicalSpaceSelectionChanged'/);
assert.match(chemicalSpacePanel, /filterToSelection: tool === "lasso"/);
assert.match(gridViewer, /chemicalSpaceFilterActive = body\.filterToSelection === true/);
assert.match(gridViewer, /function filterByChemicalSpaceSelection/);
assert.match(gridViewer, /body\.type === 'chemicalSpaceHoverChanged'/);
assert.doesNotMatch(gridViewer, /chemicalSpacePreviewTimer/);
assert.doesNotMatch(gridViewer, /syncChemicalSpaceHover/);
assert.doesNotMatch(gridCss, /buret-chemical-space-hover/);
assert.match(gridViewer, /svg\.slice\(0, 262144\)/);
assert.match(chemicalSpacePanel, /Run animated study on Metal/);
assert.match(chemicalSpacePanel, /interpolateStudyResult/);
assert.match(chemicalSpacePanel, /data-testid="parameter-study-timeline"/);
assert.match(chemicalSpacePanel, /studyRunning \? \(/);
assert.match(chemicalSpacePanel, /value=\{progressPercent\(progress\) \?\? undefined\}/);
assert.match(chemicalSpacePanel, /indeterminate=\{progressPercent\(progress\) === null\}/);
assert.match(chemicalSpacePanel, /indeterminate=\{value === null\}/);
assert.match(progressComponent, /data-indeterminate=\{indeterminate \|\| undefined\}/);
assert.match(progressComponent, /burette-progress-indeterminate_1\.2s_ease-in-out_infinite/);
assert.match(desktopStyles, /@keyframes burette-progress-indeterminate/);
assert.doesNotMatch(chemicalSpacePanel, /studyParameterLabel/);
assert.ok(
  chemicalSpacePanel.indexOf('data-testid="parameter-study-timeline"')
    > chemicalSpacePanel.indexOf("{methodLabel(draft.method)} parameters"),
);
assert.match(chemicalSpacePanel, /label="Cluster spread" value=\{draft\.spread\.toFixed\(1\)\}/);
assert.match(chemicalSpacePanel, /min=\{1\} max=\{3\} step=\{0\.1\} value=\{\[draft\.spread\]\}/);
assert.match(chemicalSpacePanel, /from "@\/components\/ui\/dropdown-menu"/);
assert.match(chemicalSpacePanel, /<DropdownMenu modal=\{false\}>/);
assert.match(chemicalSpacePanel, /<DropdownMenuGroup/);
assert.match(chemicalSpacePanel, />\s*Reset to defaults\s*<\/DropdownMenuItem>/);
assert.match(chemicalSpacePanel, />\s*Rebuild on Metal\s*<\/DropdownMenuItem>/);
assert.match(chemicalSpacePanel, />\s*Run animated study on Metal\s*<\/DropdownMenuItem>/);
assert.match(chemicalSpacePanel, /data-testid="chemical-space-visual-controls"/);
assert.match(chemicalSpacePanel, /aria-label="TMAP tree line width"/);
assert.doesNotMatch(chemicalSpacePanel, /TMAP tree edge length|tmapEdgeScale/);
assert.match(chemicalSpace3d, /updateTreeLineScale/);
assert.match(chemicalSpacePanel, /method: current\.method,\s*dimensions: current\.dimensions/);
assert.match(chemicalSpacePanel, /from "@\/components\/ui\/empty"/);
assert.match(chemicalSpacePanel, /from "@\/components\/ui\/progress"/);
assert.match(chemicalSpacePanel, /from "@\/components\/ui\/spinner"/);
assert.match(chemicalSpacePanel, /from "@\/components\/ui\/badge"/);
assert.match(chemicalSpacePanel, /data\.body\.type === "gridDirtyChanged"/);
assert.doesNotMatch(chemicalSpacePanel, /radii\.length \* 0\.98/);
assert.match(chemicalSpacePanel, /adaptivePointRadius/);
assert.match(chemicalSpace3d, /adaptivePointScale/);
assert.match(browserDevCompute, /runBrowserDevChemicalSpaceStudy/);
assert.match(browserDevCompute, /browserFingerprintCache\.get\(key\)/);
for (const engine of ["chemberta", "molformer", "unimol2-84m", "unimol-v1"]) {
  assert.match(chemicalSpacePanel, new RegExp(`value: "${engine}"`));
  assert.match(representationWorker, new RegExp(`"${engine}"`));
}
assert.match(browserDevCompute, /browserRepresentationCache\.get\(key\)/);
assert.match(browserDevCompute, /neighbors: 64/);
assert.match(browserDevCompute, /REPRESENTATION_FETCH_RETRY_DELAY_MS = 400/);
assert.match(browserDevCompute, /fetchRepresentationWithRetry/);
assert.match(browserDevCompute, /error instanceof TypeError/);
assert.match(browserDevCompute, /signal\?\.aborted/);
assert.match(browserDevCompute, /sliceKnnCache/);
assert.match(representationWorker, /PYTORCH_ENABLE_MPS_FALLBACK.*=.*"0"/);
assert.match(representationWorker, /torch\.backends\.mps\.is_available\(\)/);
assert.match(representationWorker, /scores = vectors\[start:stop\] @ vectors\.T/);
assert.match(representationWorker, /torch\.topk/);
assert.match(browserDevRoute, /BURRETE_CHEMICAL_SPACE_MODEL_PYTHON/);
assert.match(browserDevRoute, /chemical-space-representation/);
assert.match(browserDevRoute, /controller\.signal/);
assert.match(browserDevRoute, /child\.kill\("SIGTERM"\)/);
assert.match(browserDevRoute, /child\.kill\("SIGKILL"\)/);
assert.match(browserDevRoute, /application\/x-ndjson/);
assert.match(browserDevRoute, /BURRETE_PROGRESS/);
assert.match(agentShellServer, /child\.kill\('SIGTERM'\)/);
assert.match(agentShellServer, /child\.kill\('SIGKILL'\)/);
assert.match(agentShellServer, /application\/x-ndjson/);
assert.match(agentShellServer, /BURRETE_PROGRESS/);
assert.match(chemicalSpacePanel, /Stop calculation/);
assert.match(chemicalSpacePanel, /workflowControllerRef\.current\?\.abort\(\)/);
assert.match(chemicalSpacePanel, /setCursor\(point\)/);
assert.match(chemicalSpace3d, /setPreviewAnchor\(localPoint\(event\)\)/);
assert.match(representationWorker, /OMP_NUM_THREADS", "2"/);
assert.match(representationWorker, /PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0\.8"/);
assert.match(representationWorker, /emit_progress\("model"/);
assert.match(representationWorker, /emit_progress\("similarity"/);
assert.match(browserDevCompute, /readRepresentationStream/);
assert.match(browserDevCompute, /moleculeContentSha256/);
assert.match(browserDevRoute, /"chemicalSpace"/);
assert.match(browserDevRoute, /chemicalSpaceKnnCache/);
assert.match(agentShellServer, /'chemicalSpace'/);
assert.match(agentShellServer, /chemicalSpaceKnnCache/);
assert.match(devComputeBackend, /DevComputeOperation::ChemicalSpace/);
assert.match(devComputeBackend, /execute_chemical_space_from_fingerprints/);

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
