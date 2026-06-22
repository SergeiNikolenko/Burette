import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const source = (path) => readFileSync(join(repoRoot, path), "utf8");

const structureInfoPanel = source("apps/desktop/src/components/structure-info-panel.tsx");
assert.match(structureInfoPanel, /import \{ FoldingResultsPanel, useFoldingResult \} from "\.\/folding-results-panel";/);
assert.match(structureInfoPanel, /const foldingResult = useFoldingResult\(document\);/);
assert.match(structureInfoPanel, /<FoldingResultsPanel state=\{foldingResult\} actions=\{actions\} \/>/);

const foldingPanel = source("apps/desktop/src/components/folding-results-panel.tsx");
assert.match(foldingPanel, /readFoldingResultBundle/);
assert.match(foldingPanel, /FoldingPlddtPlot/);
assert.match(foldingPanel, /FoldingMatrixHeatmap/);
assert.match(foldingPanel, /openFoldingArtifact/);

const foldingClient = source("apps/desktop/src/lib/folding-results.ts");
assert.match(foldingClient, /invoke<FoldingResultBundle>\("read_folding_result_bundle"/);
assert.match(foldingClient, /\/__burette\/folding-result\?path=\$\{encodeURIComponent\(path\)\}/);

const tauriLib = source("apps/desktop/src-tauri/src/lib.rs");
assert.match(tauriLib, /commands::folding_results::read_folding_result_bundle/);

const tauriModules = source("apps/desktop/src-tauri/src/commands/mod.rs");
assert.match(tauriModules, /pub\(crate\) mod folding_results;/);
assert.match(tauriModules, /pub\(crate\) mod numpy_artifact;/);

const textFiles = source("apps/desktop/src-tauri/src/commands/text_files.rs");
assert.match(textFiles, /is_numpy_artifact_extension/);
assert.match(textFiles, /numpy_artifact_text_summary/);
assert.match(textFiles, /renders_numpy_arrays_as_text_summary/);

const viteConfig = source("apps/desktop/vite.config.ts");
const browserDevFoldingResults = source("apps/desktop/vite/browser-dev/folding-results.ts");
const browserDevFiles = source("apps/desktop/vite/browser-dev/files.ts");
assert.match(viteConfig, /registerBrowserDevFoldingResultRoute\(server, \{ isDevFileReadAllowed \}\)/);
assert.match(browserDevFoldingResults, /server\.middlewares\.use\("\/__burette\/folding-result"/);
assert.match(browserDevFoldingResults, /readBrowserDevFoldingResultBundle/);
assert.match(browserDevFoldingResults, /export function isNumpyArtifactExtension\(extension: string\)/);
assert.match(browserDevFiles, /isNumpyArtifactExtension\(extension\)/);
assert.match(browserDevFiles, /numpyArtifactTextSummary\(filePath, bytes, info\.size\)/);
assert.match(viteConfig, /"npy"/);
assert.match(viteConfig, /"npz"/);

console.log("folding results contract tests passed");
