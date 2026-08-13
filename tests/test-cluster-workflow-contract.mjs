import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeChemicalSpacePositions } from "../apps/desktop/src/lib/chemical-space-normalization.ts";
import {
  MAX_SCREEN_RENDER_POINTS,
  buildScreenPointIndex,
  nearestScreenPoint,
} from "../apps/desktop/src/lib/chemical-space-screen-index.ts";

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
assert.match(workflow, /preparedChemicalSpaceJobs\.get\(cacheKey\)/);
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
// Clustering is one button: no algorithm picker, no raw Tanimoto slider. The
// run tunes its own cutoff and reports the shape of the split instead.
assert.doesNotMatch(chemicalSpacePanel, /NativeSelectOption value="butina"|Tanimoto cutoff/);
assert.match(chemicalSpacePanel, /Group similar/);
assert.match(chemicalSpacePanel, /CLUSTER_START_CUTOFF = 0\.65/);
assert.match(chemicalSpacePanel, /function clusterVerdict/);
assert.match(chemicalSpacePanel, /biggest \/ total > CLUSTER_DOMINANT_SHARE/);
assert.match(chemicalSpacePanel, /singles \/ total > CLUSTER_SINGLETON_SHARE/);
assert.match(chemicalSpacePanel, /function rankClustersBySize/);
assert.match(chemicalSpacePanel, /data-testid="chemical-space-cluster-controls"/);
assert.match(chemicalSpacePanel, /clusterMembersForSource/);
assert.match(chemicalSpace3d, /vertexColors: true/);
assert.match(chemicalSpacePanel, /isKnownViewerMessageSource\(event\.source, documentId\)/);
assert.match(chemicalSpacePanel, /MAX_LASSO_POINTS = 1_024/);
assert.match(chemicalSpacePanel, /GRID_SELECTION_BRIDGE_LIMIT = 100_000/);
assert.match(chemicalSpacePanel, /normalizeChemicalSpacePositions/);
assert.match(chemicalSpacePanel, /buildSpatialPointIndex\(projected\)/);
assert.match(chemicalSpacePanel, /buildCameraScreenPointIndex\(spatialIndex, viewport, camera\)/);
assert.match(chemicalSpacePanel, /nearestScreenPoint\(\s*screenIndexRef\.current,\s*point,/);
assert.match(
  chemicalSpacePanel,
  /projectPositions\([\s\S]*?zoom: 1,[\s\S]*?panX: 0,[\s\S]*?panY: 0/,
  "camera pan and zoom must query the base spatial index instead of reprojecting every molecule",
);
const resizeObserverBlock = chemicalSpacePanel.slice(
  chemicalSpacePanel.indexOf("const observer = new ResizeObserver"),
  chemicalSpacePanel.indexOf("observer.observe(canvas);"),
);
assert.match(
  resizeObserverBlock,
  /window\.setTimeout\(commitViewport, 90\)/u,
  "2D Chemical Space must rebuild its O(N) projection only after resize settles",
);
assert.doesNotMatch(
  resizeObserverBlock,
  /setViewport\(\{ width, height,/u,
  "ResizeObserver must not rebuild the spatial index on every resize callback",
);
assert.match(chemicalSpacePanel, /screenPointForCamera/);
assert.match(chemicalSpacePanel, /screenPointFromCamera/);
assert.doesNotMatch(chemicalSpacePanel, /\[\.\.\.projected\]\.sort\(/);
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
assert.match(chemicalSpace, /const MAX_NEIGHBOR_EDGES: usize = 200_000/);
assert.match(chemicalSpace, /let edge_limit = MAX_NEIGHBOR_EDGES/);
assert.match(workflow, /neighborEdges: Array<\[number, number\]>/);
assert.match(chemicalSpacePanel, /function computeActivityCliffs/);
// A descriptor-identical pair leaves no similarity gap to divide by. Clamping
// the divisor scored those near 1e6, which buried every real cliff and flattened
// the edge shading; they are capped at twice the strongest finite SALI instead.
assert.doesNotMatch(chemicalSpacePanel, /Math\.max\(1e-6, 1 - similarity\)/);
assert.match(chemicalSpacePanel, /const sali = gap > 0 \? delta \/ gap : delta > 0 \? Number\.POSITIVE_INFINITY : 0;/);
assert.match(chemicalSpacePanel, /cliff\.sali = 2 \* maxFiniteSali \|\| cliff\.delta;/);
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

const screenIndex = buildScreenPointIndex(
  Array.from({ length: 250_000 }, (_, sourceRecordId) => ({
    sourceRecordId,
    x: sourceRecordId % 1_000,
    y: Math.floor(sourceRecordId / 1_000),
    depth: 0,
  })),
  { width: 1_000, height: 700 },
);
assert.ok(screenIndex.renderPoints.length <= MAX_SCREEN_RENDER_POINTS);
assert.ok(screenIndex.hoverBuckets.size <= 1_000 * 700);
assert.equal([...screenIndex.renderPointCounts.values()].reduce((sum, count) => sum + count, 0), 250_000);
assert.ok(
  [...screenIndex.hoverBuckets.values()].reduce((sum, candidates) => sum + candidates.length, 0)
    <= MAX_SCREEN_RENDER_POINTS,
  "hover lookup must stay bounded to visible LOD representatives",
);
assert.ok(screenIndex.bySourceRecordId.size <= MAX_SCREEN_RENDER_POINTS);
const sparseScreenIndex = buildScreenPointIndex([
  { sourceRecordId: 1, x: 12, y: 3, depth: 0 },
  { sourceRecordId: 2, x: 300, y: 300, depth: 0 },
], { width: 1_000, height: 700 });
assert.equal(nearestScreenPoint(sparseScreenIndex, { x: 12, y: 3 }, 8)?.sourceRecordId, 1);
const collidingHoverIndex = buildScreenPointIndex([
  { sourceRecordId: 3, x: 1, y: 1, depth: 0 },
  { sourceRecordId: 4, x: 14, y: 14, depth: 0 },
], { width: 100, height: 100 });
assert.equal(
  nearestScreenPoint(collidingHoverIndex, { x: 1, y: 1 }, 8)?.sourceRecordId,
  3,
  "hover indexing must retain all candidates that share a screen bucket",
);
assert.ok(normalizedRadii.at(-1) > 1, "outliers should remain distinguishable from the bulk");
assert.ok(normalizedRadii.at(-1) <= 1.45, "outliers should remain within the visible scene");
assert.doesNotMatch(chemicalSpacePanel, /MOLECULE_PREVIEW_HOVER_DELAY_MS/);
assert.doesNotMatch(chemicalSpacePanel, /previewHoverReadyFor/);
// The floating preview is suppressed while the inspector shows the same
// molecule, so the canvas receives the card only when it is the only surface -
// and putting the inspector card away with its close button hands the job back,
// which the open tab alone cannot tell you.
assert.match(chemicalSpacePanel, /preview=\{inspectorShowsMolecule \? null : preview\}/);
assert.match(chemicalSpacePanel, /const inspectorShowsMolecule = inspectorOpen && !previewCardHidden;/);
assert.match(chemicalSpacePanel, /window\.addEventListener\(HOVER_CARD_VISIBILITY_EVENT, handle\)/);
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
assert.match(
  gridViewer,
  /function refreshRemoteChemicalSpaceSelection/,
  "remote grids must page in every lasso-selected molecule, not filter the loaded window",
);
assert.match(workflow, /REPRESENTATION_UNAVAILABLE_ERROR_NAME = "RepresentationUnavailableError"/);
assert.match(browserDevCompute, /representationServerError/);
assert.match(
  chemicalSpacePanel,
  /ChemicalSpaceRepresentationUnavailable/,
  "a missing model runtime must render the dedicated state with a way back to Morgan",
);
assert.match(chemicalSpacePanel, /isRepresentationUnavailableError\(cause\)/);

// Learned representations in the packaged app: the workflow feeds prepared-job
// records into the Rust-managed model worker and embeds through the standalone
// kNN command, and the panel offers a real install path with progress.
assert.match(workflow, /chemical_space_represent_start/);
assert.match(workflow, /chemical_space_represent_status/);
assert.match(workflow, /chemical_space_represent_cancel/);
assert.match(workflow, /compute_execute_learned_chemical_space/);
assert.match(
  workflow,
  /sliceKnnCache\(\s*represented\.knnCache,\s*represented\.sourceRecordIds\.length,\s*options\.neighbors,\s*\)/,
  "the worker's 64-neighbour cache must be sliced to the requested neighbours before embedding",
);
assert.match(chemicalSpacePanel, /Install model runtime \(\{status\.installSizeHint\}\)/);
assert.match(chemicalSpacePanel, /Cancel installation/);
const modelCommands = source("apps/desktop/src-tauri/src/commands/chemical_space_models.rs");
assert.match(modelCommands, /include_str!\("\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/compute\/models\/chemical_space_representations\.py"\)/);
assert.match(modelCommands, /include_str!\("\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/compute\/models\/requirements\.txt"\)/);
assert.match(modelCommands, /BURETTE_PROGRESS\\t/);
assert.match(modelCommands, /fs::create_dir_all\(&weights\)/);
assert.match(modelCommands, /\.current_dir\(&weights\)/);
assert.match(browserDevRoute, /await mkdir\(modelRoot, \{ recursive: true \}\)/);
assert.match(browserDevRoute, /input,\s*modelRoot,\s*MODEL_REQUEST_TIMEOUT_MS/);
assert.match(computeCommands, /compute_execute_learned_chemical_space/);
assert.match(computePermission, /compute_execute_learned_chemical_space/);
const burettePermission = source("apps/desktop/src-tauri/permissions/burette.toml");
for (const command of [
  "chemical_space_model_runtime_status",
  "chemical_space_model_runtime_install",
  "chemical_space_model_runtime_cancel_install",
  "chemical_space_represent_start",
  "chemical_space_represent_status",
  "chemical_space_represent_cancel",
]) {
  assert.ok(burettePermission.includes(`"${command}"`), `${command} must stay permitted`);
}
assert.match(chemicalSpace, /execute_learned_chemical_space_from_knn/);

// Grid filters mirror onto the map: the grid pushes its post-filter (but
// pre-lasso) visibility set, remote grids page it in like the SMARTS scan,
// and both canvases dim everything outside it.
assert.match(gridViewer, /function postChemicalSpaceVisibility/);
assert.match(gridViewer, /function collectRemoteChemicalSpaceVisibility/);
assert.match(
  gridViewer,
  /let visibilityRows = filterByTableColumnControls\(filterByDescriptorControls\(filterBySMARTS\(textRows\)\)\)/,
  "map visibility must exclude the lasso's own selection filter",
);
assert.match(chemicalSpacePanel, /chemicalSpaceVisibilityChanged/);
assert.match(chemicalSpacePanel, /DIMMED_POINT_COLOR/);
assert.match(chemicalSpace3d, /pointColors/);

// The Filtered scope recomputes embeddings over just the filtered subset: the
// prepared job is keyed and scoped by the subset's signature on every runtime.
assert.match(workflow, /chemicalSpaceScopeSignature/);
assert.match(workflow, /scopeSourceIds: number\[\] \| null = null/);
assert.match(chemicalSpacePanel, /scopedBrowserRecords\(records, scopedSourceIds\)/);
assert.match(chemicalSpacePanel, /Recompute the map over just the filtered molecules/);
// An empty filtered scope normalizes to null ("all records") in the workflow
// layer, so every effect that prepares a job must reject scopes below two
// molecules — embedding, clustering, and studies alike.
for (const guarded of [
  /if \(scopedSourceIds && scopedSourceIds\.length < 2\) \{/,
  /const scopeTooSmall = scopedSourceIds !== null && scopedSourceIds\.length < 2;/,
]) {
  assert.match(chemicalSpacePanel, guarded);
}

// The grid ignores every message whose source is not "burette-grid-host". The
// pre-rename "burrete" spelling silently disconnected the filter panel from
// the grid, so no sender may ever use it again.
for (const file of [
  "apps/desktop/src/hooks/use-app-grid-filter-model.ts",
  "apps/desktop/src/components/app-layout.tsx",
  "apps/desktop/src/components/chemical-space-panel.tsx",
  "apps/desktop/src/hooks/use-app-grid-runtime-messages.ts",
]) {
  assert.doesNotMatch(
    source(file),
    /burrete-grid-host|burrete-host/,
    `${file} must address the grid with the renamed message source`,
  );
}
assert.match(
  chemicalSpace,
  /knn\.neighbors_per_vertex != clamped_neighbors/,
  "a mismatched learned kNN must fail instead of recomputing Tanimoto over placeholder fingerprints",
);
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
    > chemicalSpacePanel.indexOf("<PopoverTrigger asChild>"),
);
assert.match(chemicalSpacePanel, /label="Cluster spread" value=\{draft\.spread\.toFixed\(1\)\}/);
assert.match(chemicalSpacePanel, /min=\{1\} max=\{3\} step=\{0\.1\} value=\{\[draft\.spread\]\}/);
// A menu closes on selection and hid the map behind itself; settings live in a
// popover, and each concern owns its own toolbar button.
assert.doesNotMatch(chemicalSpacePanel, /DropdownMenu/);
assert.match(chemicalSpacePanel, /from "@\/components\/ui\/popover"/);
assert.match(chemicalSpacePanel, /from "@\/components\/ui\/collapsible"/);
assert.match(chemicalSpacePanel, />\s*Reset to defaults\s*<\/Button>/);
assert.match(chemicalSpacePanel, />\s*Rebuild on Metal\s*<\/Button>/);
assert.match(chemicalSpacePanel, />\s*Run animated study on Metal\s*<\/Button>/);
// Editing a slider only stages the change, so the commit button has to say so.
assert.match(chemicalSpacePanel, /disabled=\{!embeddingDirty \|\| Boolean\(progress\)\}/);
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
for (const engine of ["molformer", "unimol2-84m"]) {
  assert.match(chemicalSpacePanel, new RegExp(`value: "${engine}"`));
}
for (const engine of ["chemberta", "unimol-v1"]) {
  assert.doesNotMatch(chemicalSpacePanel, new RegExp(`value: "${engine}"`));
}
for (const engine of ["chemberta", "molformer", "unimol2-84m", "unimol-v1"]) {
  assert.match(representationWorker, new RegExp(`"${engine}"`));
}
assert.match(browserDevCompute, /const browserRepresentationRuns: SharedRunStore</);
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
assert.match(browserDevRoute, /BURETTE_CHEMICAL_SPACE_MODEL_PYTHON/);
assert.match(browserDevRoute, /chemical-space-representation/);
assert.match(browserDevRoute, /controller\.signal/);
assert.match(browserDevRoute, /child\.kill\("SIGTERM"\)/);
assert.match(browserDevRoute, /child\.kill\("SIGKILL"\)/);
assert.match(browserDevRoute, /application\/x-ndjson/);
assert.match(browserDevRoute, /BURETTE_PROGRESS/);
assert.match(agentShellServer, /child\.kill\('SIGTERM'\)/);
assert.match(agentShellServer, /child\.kill\('SIGKILL'\)/);
assert.match(agentShellServer, /application\/x-ndjson/);
assert.match(agentShellServer, /BURETTE_PROGRESS/);
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

// Chemical Space must not submit compute while the grid is still indexing: the
// backend refuses those submissions, and the panel used to render that refusal as
// a fatal error with a Retry button that could only fail again. Large collections
// additionally wait for an explicit confirmation instead of embedding hundreds of
// thousands of molecules just because a tab was opened.
assert.match(chemicalSpacePanel, /if \(computeBlockedByIndex \|\| needsConfirmation\) return;/);
assert.match(
  chemicalSpacePanel,
  /clusterMode === "off" \|\| computeBlockedByIndex \|\| needsConfirmation/,
  "large-collection confirmation must gate clustering as well as embedding",
);
// An unanswered probe must gate too: indexState is null on first render, so
// reading unknown as "small and ready" submitted the job the gate exists to hold.
assert.match(
  chemicalSpacePanel,
  /const awaitingIndexState = indexStateDocumentKey !== documentInstanceKey \|\| !indexProbed;/,
);
assert.match(
  chemicalSpacePanel,
  /indexState\?\.indexReady === true && indexState\?\.indexError === null/,
  "a terminal indexing error must not be treated as a ready collection",
);
assert.match(chemicalSpacePanel, /indexState\?\.indexError/);
assert.match(chemicalSpacePanel, /const computeBlockedByIndex = awaitingIndexState \|\| indexProbeError !== null \|\| !indexReady \|\| indexing;/);
assert.match(chemicalSpacePanel, /Retry index check/);
assert.match(
  chemicalSpacePanel,
  /awaitingIndexState \? \(\s*<ChemicalSpaceChecking/,
  "index probing must not look like a running calculation with a Stop button",
);
assert.match(
  chemicalSpacePanel,
  /indexState\?\.indexError \? \(\s*<ChemicalSpaceEmpty[\s\S]*?Collection indexing failed/,
  "a terminal backend indexing failure needs a distinct non-retry state",
);
assert.ok(
  chemicalSpacePanel.indexOf(") : indexing ? (") < chemicalSpacePanel.indexOf(") : !indexReady ? ("),
  "live indexing progress must render before the generic not-ready fallback",
);
// The dock stays mounted across documents, so the confirmation must not carry over.
assert.match(
  chemicalSpacePanel,
  /setConfirmedLargeRunDocumentKey\(null\);[\s\S]*?\}, \[documentInstanceKey\]\);/,
);
assert.match(
  chemicalSpacePanel,
  /effectiveRecordCount > AUTO_RUN_RECORD_LIMIT[\s\S]*?confirmedLargeRunDocumentKey !== largeRunConfirmationKey/,
);
assert.match(chemicalSpacePanel, /requestChemicalSpaceIndexState\(documentId, controller\.signal\)/);
assert.match(chemicalSpacePanel, /applySourceRevision\(next\.sourceRevision\)/);
assert.match(chemicalSpacePanel, /sourceRevision: Number\.isSafeInteger\(sourceRevision\)/);
assert.match(chemicalSpacePanel, /bytesIndexed: Number\.isFinite\(bytesIndexed\) \? bytesIndexed : 0/);
assert.match(chemicalSpacePanel, /indexingProgressLabel\(indexState\)/);
assert.match(
  chemicalSpacePanel,
  /indexStateDocumentKey !== documentInstanceKey/,
  "index readiness from the previous Grid document must not unlock a new document",
);
assert.match(
  chemicalSpacePanel,
  /confirmedLargeRunDocumentKey !== largeRunConfirmationKey/,
  "large-run confirmation must be scoped to the exact Grid source revision",
);
const dirtyHandler = chemicalSpacePanel.slice(
  chemicalSpacePanel.indexOf('data.body.type === "gridDirtyChanged"'),
  chemicalSpacePanel.indexOf('data.body.type === "gridHoverChanged"'),
);
const sourceRevisionHandler = chemicalSpacePanel.slice(
  chemicalSpacePanel.indexOf("const applySourceRevision = useCallback"),
  chemicalSpacePanel.indexOf("const commitOptions"),
);
assert.match(sourceRevisionHandler, /workflowControllerRef\.current\?\.abort\(\)/u);
assert.match(sourceRevisionHandler, /studyControllerRef\.current\?\.abort\(\)/u);
assert.match(dirtyHandler, /recordsTotal = Number\(data\.body\.recordsTotal\)/u);
assert.match(dirtyHandler, /setIndexState\(\(current\) => current/u);
assert.match(dirtyHandler, /applySourceRevision\(reportedRevision\)/u);
assert.match(sourceRevisionHandler, /setConfirmedLargeRunDocumentKey\(null\)/u);
assert.match(
  sourceRevisionHandler,
  /setStudyRunning\(false\)/u,
  "editing a Grid must cancel an in-flight parameter study before stale results can publish",
);
assert.match(chemicalSpacePanel, /`\$\{documentInstanceKey\}:\$\{sourceRevision\}:\$\{scopeKey\}`/);
assert.ok(
  chemicalSpacePanel.indexOf("if (computeBlockedByIndex || needsConfirmation) {")
    < chemicalSpacePanel.indexOf("completedEmbeddings.get(key)"),
  "cached embeddings must not bypass index readiness or explicit large-run confirmation",
);
assert.match(chemicalSpacePanel, /gridDocumentInstanceKey\(document\)/);
assert.match(chemicalSpacePanel, /actionLabel="Calculate chemical space"/);
assert.match(chemicalSpacePanel, /estimatedEmbeddingDuration\(effectiveRecordCount\)/);
assert.match(chemicalSpacePanel, /rememberThroughput\(next\.sourceRecordIds\.length/);
assert.match(chemicalSpacePanel, /MAX_COMPLETED_EMBEDDING_CACHE_ENTRIES = 6/);
assert.match(chemicalSpacePanel, /MAX_COMPLETED_EMBEDDING_CACHE_RECORDS = 500_000/);
assert.match(chemicalSpacePanel, /completedEmbeddings\.size > MAX_COMPLETED_EMBEDDING_CACHE_ENTRIES/);

const gridViewerSource = source("PreviewExtension/Web/grid-viewer.js");
assert.match(gridViewerSource, /chemicalSpaceRequestIndexState/);
assert.match(gridViewerSource, /recordsTotal,\s*sourceRevision: state\.sourceRevision/u);
const markGridDirtyBlock = gridViewerSource.slice(
  gridViewerSource.indexOf("function markGridDirty(reason)"),
  gridViewerSource.indexOf("function markGridClean()"),
);
assert.match(markGridDirtyBlock, /notifyGridDirty\(true\)/);
assert.doesNotMatch(
  markGridDirtyBlock,
  /if \(!wasDirty\)/,
  "every edit must advance the Grid revision and invalidate Chemical Space caches",
);
assert.match(gridViewerSource, /function postChemicalSpaceIndexState\(requestId\)/);
assert.match(gridViewerSource, /sourceRevision: state\.sourceRevision/u);
assert.match(gridViewerSource, /state\.sourceRevision \+= 1/u);

// Model inference is cached apart from the projection so that changing the
// embedder or a parameter reuses the vectors. The run outlives the caller that
// started it: only an explicit stop, or the source changing, ends one early -
// if the caller's signal ever reached representChemicalSpace again, switching
// representation mid-flight would silently throw the work away.
const sharedRun = source("apps/desktop/src/lib/shared-progress-run.ts");
// The run is started with its own signal and the caller only races it, so a
// caller that walks away detaches instead of cancelling.
assert.match(sharedRun, /start\(\(progress\) => \{/);
assert.match(sharedRun, /\}, controller\.signal\);/);
assert.match(sharedRun, /return rejectOnAbort\(attached\.promise, signal, abortError\)/);
assert.match(sharedRun, /if \(run\.lastProgress !== null\) onProgress\(run\.lastProgress\);/);
assert.match(sharedRun, /const oldestSettled = \[\.\.\.runs\.entries\(\)\]\.find\(\(\[, run\]\) => run\.settled\);/);
assert.match(workflow, /function sharedRepresentChemicalSpace\(/);
assert.match(workflow, /export function stopChemicalSpaceRepresentations\(documentId: string\)/);
assert.match(workflow, /start: \(report, runSignal\) => representChemicalSpace\(records, engine, report, runSignal\)/);
assert.doesNotMatch(
  workflow,
  /await representChemicalSpace\(/,
  "callers must go through the shared run, or a detached caller cancels the model",
);
// Browser dev speaks one long request instead of start/poll, and needs the same
// rule: the fetch must ride the run's signal, never the caller's.
assert.match(browserDevCompute, /runs: browserRepresentationRuns,/);
assert.match(browserDevCompute, /signal: runSignal,/);
assert.match(browserDevCompute, /export function stopBrowserChemicalSpaceRepresentations\(\)/);
assert.doesNotMatch(
  browserDevCompute,
  /body: JSON\.stringify\(\{ operation: "represent"[^}]*\}\),\s*\n\s*signal,/,
  "the representation request must not carry the caller's abort signal",
);
const invalidationStart = workflow.indexOf("export function invalidateChemicalSpaceFingerprintCache");
assert.match(
  workflow.slice(invalidationStart, invalidationStart + 400),
  /stopChemicalSpaceRepresentations\(documentId\);/,
);
assert.match(chemicalSpacePanel, /if \(documentId\) stopChemicalSpaceRepresentations\(documentId\);/);

// A lasso answers with the fragment its molecules share. The selection is
// announced from the one place that ever posts it, so the inspector cannot
// miss a selection the grid was told about.
const scaffoldCard = source("apps/desktop/src/components/grid-selection-scaffold.tsx");
assert.match(chemicalSpacePanel, /if \(body\.type === "chemicalSpaceSelectionChanged"\) \{/);
assert.match(chemicalSpacePanel, /new CustomEvent\("burette:chemical-space-selection"/);
assert.match(scaffoldCard, /export function useSelectionScaffold\(documentId: string\): ScaffoldState/);
assert.match(scaffoldCard, /window\.addEventListener\("burette:chemical-space-selection", handle\)/);
assert.match(scaffoldCard, /foldCommonScaffold\(/);
assert.match(scaffoldCard, /MAX_SCAFFOLD_MOLECULES = 5_000/);
assert.match(scaffoldCard, /MEANINGFUL_SCAFFOLD_ATOMS = 6/);
// Records are the whole collection and the scaffold search reuses them, so an
// edited source has to drop them along with every other cached view of it.
assert.match(chemicalSpacePanel, /invalidateScaffoldRecords\(documentId\);/);

console.log("cluster workflow contract tests passed");
