import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = source("apps/desktop/src-tauri/src/compute/semiempirical_workflow.rs");
const commands = source("apps/desktop/src-tauri/src/compute/commands.rs");
const permissions = source("apps/desktop/src-tauri/permissions/compute.toml");
const protocol = source("crates/burrete-compute-protocol/src/workflow.rs");
const gridMessages = source("apps/desktop/src/hooks/use-app-grid-conformer-messages.ts");
const gridViewer = source("PreviewExtension/Web/grid-viewer.js");
const gridUi = source("apps/desktop/src/preview-grid/grid-ui.tsx");

assert.match(protocol, /serde\(rename = "semiempirical\.v1"\)[\s\S]*SemiempiricalV1/);
assert.match(commands, /compute_evaluate_grid_semiempirical/);
assert.match(permissions, /"compute_evaluate_grid_semiempirical"/);
assert.match(workflow, /"nativeMetalFockHybrid"[\s\S]*"nativeCpuReference"/);
assert.match(workflow, /"cpuParity"/);
assert.match(workflow, /WorkflowTemplateId::SemiempiricalV1/);
assert.match(workflow, /"rm1TotalEnergyEv"/);
assert.match(workflow, /"rm1AtomicCharges"/);
assert.match(gridMessages, /invoke<GridSemiempiricalResult>\("compute_evaluate_grid_semiempirical"/);
assert.match(gridMessages, /Metal Fock contractions/);
assert.match(gridViewer, /evaluateSemiempiricalGridSelection/);
assert.match(gridViewer, /semiempiricalEnabled: caps\.cluster/);
assert.match(gridUi, /id="calculate-rm1-selected"/);

console.log("semi-empirical Grid workflow contract tests passed");
