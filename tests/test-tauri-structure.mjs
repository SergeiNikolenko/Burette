#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function source(path) {
  return readFile(resolve(path), 'utf8');
}

async function exists(path) {
  try {
    await access(resolve(path));
    return true;
  } catch {
    return false;
  }
}

const [
  commandsIndex,
  lib,
  menu,
  startupSource,
  startupCommand,
  agentIntegrationCommand,
  agentSessionHook,
  documentsCommand,
  gridCommand,
  previewCacheCommand,
  runtimeDoctorCommand,
  shellCommand,
  performanceSource,
  shellActionsSource,
  settingsPanelSource,
  commandPaletteSource,
  quickLookCommand,
  updaterCommand,
  tray,
  windowsSource,
  rendererPolicySource,
  previewIndex,
  previewGridStore,
  previewRuntime,
  previewRuntimeGrid,
  previewRuntimeViewer,
  previewRuntimeUtils,
  previewFormats,
  previewFormatRegistrySource,
  previewXyzrender,
  quickLookPreviewController,
  moleculeGridPreview,
  viewerRuntimeCSS,
  viewerJS,
  gridViewerJS,
  gridUiTSX,
  viewerShell,
  buretteAgentJS,
  tauriConfigSource,
  tauriPermissionSource,
  computePermissionSource,
  defaultCapabilitySource,
  computeCapabilitySource,
  buildScript,
  quickLookXyzrenderLauncherScript,
  buildDevScript,
  ciScript,
  ciWorkflow,
  toolchainAction,
  releaseWorkflow,
  releaseVersionCheck,
  releaseScript,
  createDmgScript,
  releaseSignatureScript,
  signUpdateManifestScript,
  vendorMolstarScript,
  vendorRdkitScript,
  packageSource,
  desktopPackageSource,
  vendorAssetsLockSource,
  webRuntimeProfilesSource,
  xcodeProjectSource,
  xcodeThumbnailScheme,
  previewEntitlements,
  appInfoPlist,
  appMetadata,
  installLocalScript,
  devNamespaceScript,
  previewExtensionInfoPlist,
  thumbnailInfoPlist,
  thumbnailProviderSource,
  cargoWorkspaceSource,
  tauriCargoSource,
  coreCargoSource,
  burreteCoreSource,
  docsReadmeSource,
  architectureDocsSource,
  rendererSupportDocsSource,
  performanceDocsSource,
  rdkitConformerScript,
] = await Promise.all([
  source('apps/desktop/src-tauri/src/commands/mod.rs'),
  source('apps/desktop/src-tauri/src/lib.rs'),
  source('apps/desktop/src-tauri/src/menu.rs'),
  source('apps/desktop/src-tauri/src/startup.rs'),
  source('apps/desktop/src-tauri/src/commands/startup.rs'),
  source('apps/desktop/src-tauri/src/commands/agent_integration.rs'),
  source('apps/desktop/src/hooks/use-agent-session.ts'),
  source('apps/desktop/src-tauri/src/commands/documents.rs'),
  source('apps/desktop/src-tauri/src/commands/grid.rs'),
  source('apps/desktop/src-tauri/src/commands/preview_cache.rs'),
  source('apps/desktop/src-tauri/src/commands/runtime_doctor.rs'),
  source('apps/desktop/src-tauri/src/commands/shell.rs'),
  source('apps/desktop/src/lib/performance.ts'),
  source('apps/desktop/src/components/types.ts'),
  source('apps/desktop/src/components/settings-panel/index.tsx'),
  source('apps/desktop/src/components/command-palette/index.tsx'),
  source('apps/desktop/src-tauri/src/commands/quicklook.rs'),
  source('apps/desktop/src-tauri/src/commands/updater.rs'),
  source('apps/desktop/src-tauri/src/tray.rs'),
  source('apps/desktop/src-tauri/src/windows.rs'),
  source('PreviewExtension/RendererPolicy.swift'),
  source('apps/desktop/src-tauri/src/preview/mod.rs'),
  source('apps/desktop/src-tauri/src/preview/grid_store.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_grid.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_viewer.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_utils.rs'),
  source('apps/desktop/src-tauri/src/preview/formats.rs'),
  source('config/preview-formats.json'),
  source('apps/desktop/src-tauri/src/preview/xyzrender.rs'),
  source('PreviewExtension/Platform/PreviewViewController.swift'),
  source('PreviewExtension/MoleculeGridPreview.swift'),
  source('PreviewExtension/Web/viewer-runtime.css'),
  source('PreviewExtension/Web/viewer.js'),
  source('PreviewExtension/Web/grid-viewer.js'),
  source('apps/desktop/src/preview-grid/grid-ui.tsx'),
  source('PreviewExtension/Web/viewer-shell.js'),
  source('PreviewExtension/Web/burette-agent.js'),
  source('apps/desktop/src-tauri/tauri.conf.json'),
  source('apps/desktop/src-tauri/permissions/burrete.toml'),
  source('apps/desktop/src-tauri/permissions/compute.toml'),
  source('apps/desktop/src-tauri/capabilities/default.json'),
  source('apps/desktop/src-tauri/capabilities/compute.json'),
  source('scripts/build.sh'),
  source('scripts/bundle-quicklook-xyzrender-launcher.sh'),
  source('scripts/build-dev.sh'),
  source('scripts/ci.sh'),
  source('.github/workflows/ci.yml'),
  source('.github/actions/setup-burrete-toolchain/action.yml'),
  source('.github/workflows/release.yml'),
  source('scripts/check-release-version.mjs'),
  source('scripts/release.sh'),
  source('scripts/create-dmg.sh'),
  source('scripts/check-release-signature.sh'),
  source('scripts/sign-update-manifest.mjs'),
  source('scripts/vendor-molstar.mjs'),
  source('scripts/vendor-rdkit.mjs'),
  source('package.json'),
  source('apps/desktop/package.json'),
  source('vendor-assets.lock.json'),
  source('config/web-runtime-profiles.json'),
  source('Burrete.xcodeproj/project.pbxproj'),
  source('Burrete.xcodeproj/xcshareddata/xcschemes/BurreteThumbnail.xcscheme'),
  source('PreviewExtension/BurretePreview.entitlements'),
  source('apps/desktop/src-tauri/Info.plist'),
  source('apps/desktop/src-tauri/AppMetadata.plist'),
  source('scripts/install-local.sh'),
  source('scripts/dev-namespace.mjs'),
  source('PreviewExtension/Info.plist'),
  source('PreviewExtension/ThumbnailInfo.plist'),
  source('PreviewExtension/ThumbnailProvider.swift'),
  source('Cargo.toml'),
  source('apps/desktop/src-tauri/Cargo.toml'),
  source('crates/burrete-core/Cargo.toml'),
  source('crates/burrete-core/src/lib.rs'),
  source('docs/README.md'),
  source('docs/architecture.md'),
  source('docs/renderer-support.md'),
  source('docs/performance.md'),
  source('scripts/rdkit_conformer.py'),
]);
const previewFormatsSource = previewFormats;
const previewTrace = await source('apps/desktop/src-tauri/src/preview/trace.rs');
const nightlySmokeWorkflow = await source('.github/workflows/nightly-smoke.yml');

const tauriConfig = JSON.parse(tauriConfigSource);
const packageConfig = JSON.parse(packageSource);
const desktopPackageConfig = JSON.parse(desktopPackageSource);
const vendorAssetsLock = JSON.parse(vendorAssetsLockSource);
const webRuntimeProfiles = JSON.parse(webRuntimeProfilesSource);
const defaultCapability = JSON.parse(defaultCapabilitySource);
const computeCapability = JSON.parse(computeCapabilitySource);
const mainWindowConfig = tauriConfig.app.windows.find((window) => window.label === 'main');
const tauriHandlerSource = lib.match(/tauri::generate_handler!\[([\s\S]*?)\]/)?.[1] ?? '';
const registeredTauriCommands = [
  ...tauriHandlerSource.matchAll(/(?:commands::(?:\w+::)+|compute::commands::)(\w+)/g),
].map((match) => match[1]);
const allowedViewerCommands = [...tauriPermissionSource.matchAll(/^\s*"([a-z0-9_]+)",?$/gm)].map((match) => match[1]);
const allowedComputeCommands = [...computePermissionSource.matchAll(/^\s*"([a-z0-9_]+)",?$/gm)].map((match) => match[1]);
const allowedTauriCommands = [...allowedViewerCommands, ...allowedComputeCommands];

assert.ok(tauriHandlerSource, 'the registered Tauri command handler must be discoverable');
assert.equal(await exists('apps/desktop/src-tauri/src/commands.rs'), false);
assert.ok(mainWindowConfig);
assert.equal(tauriConfig.build.beforeBuildCommand, 'true');
assert.equal(desktopPackageConfig.scripts.build, '../../node_modules/.bin/vite build --config vite.config.ts');
assert.equal(desktopPackageConfig.scripts['build:tauri'], 'bun run build && node ../../node_modules/@tauri-apps/cli/tauri.js build');
assert.equal(mainWindowConfig.visible, true);
assert.equal(mainWindowConfig.windowEffects?.state, 'active');
assert.equal(tauriConfig.bundle.resources['../../../plugins/burette-agent'], 'plugins/burette-agent');
assert.match(tauriConfig.app.security.csp, /'unsafe-eval'/);
assert.match(tauriConfig.app.security.csp, /'wasm-unsafe-eval'/);
assert.match(tauriConfig.app.security.csp, /style-src[^;]*'unsafe-inline'/);
assert.doesNotMatch(tauriConfig.build.beforeBuildCommand, /bun run build/);
assert.ok(defaultCapability.permissions.includes('dialog:allow-open'));
assert.ok(defaultCapability.permissions.includes('dialog:allow-message'));
assert.ok(defaultCapability.permissions.includes('dialog:allow-save'));
assert.ok(defaultCapability.permissions.includes('core:menu:allow-new'));
assert.ok(defaultCapability.permissions.includes('core:menu:allow-popup'));
assert.ok(defaultCapability.permissions.includes('core:window:allow-internal-toggle-maximize'));
assert.deepEqual(defaultCapability.windows, ['main', 'workspace-*']);
assert.equal(defaultCapability.webviews, undefined);
assert.equal(defaultCapability.remote, undefined);
assert.ok(defaultCapability.permissions.includes('allow-viewer-commands'));
assert.equal(defaultCapability.permissions.includes('allow-compute-commands'), false);
assert.equal(computeCapability.local, true);
assert.deepEqual(computeCapability.windows, ['main', 'workspace-*']);
assert.equal(computeCapability.webviews, undefined);
assert.equal(computeCapability.remote, undefined);
assert.deepEqual(computeCapability.permissions, ['allow-compute-commands']);
assert.deepEqual(
  allowedComputeCommands.toSorted(),
  registeredTauriCommands.filter((command) => command.startsWith('compute_')).toSorted(),
  'the dedicated compute ACL must contain every compute command and nothing else',
);
assert.deepEqual(
  allowedViewerCommands.filter((command) => command.startsWith('compute_')),
  [],
  'viewer commands must not inherit compute control',
);
assert.deepEqual(
  registeredTauriCommands.filter((command) => !allowedTauriCommands.includes(command)),
  [],
  'every registered Tauri command must be included in the desktop command ACL',
);
for (const windowLabel of defaultCapability.windows) {
  assert.doesNotMatch(windowLabel, /quicklook|quick-look|preview|viewer/i);
}
for (const permission of defaultCapability.permissions) {
  if (typeof permission === 'string') {
    assert.doesNotMatch(permission, /^(fs|shell|process|updater):/);
  }
}
const tauriIpcSurface = /@tauri-apps\/api|__TAURI__|window\.__TAURI__|\bcore\.invoke\b|\binvoke\s*\(|ipc:/;
for (const [artifactName, artifactSource] of [
  ['viewer.js', viewerJS],
  ['grid-viewer.js', gridViewerJS],
  ['viewer-shell.js', viewerShell],
  ['burette-agent.js', buretteAgentJS],
]) {
  assert.doesNotMatch(artifactSource, tauriIpcSurface, `${artifactName} must use the host bridge instead of direct Tauri IPC`);
}
assert.match(tauriConfig.app.security.csp, /script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' asset: http:\/\/asset\.localhost/);
assert.match(tauriConfig.app.security.csp, /connect-src[^;]*asset: http:\/\/asset\.localhost/);
assert.match(tauriConfig.app.security.csp, /worker-src 'self' asset: http:\/\/asset\.localhost/);
assert.match(previewEntitlements, /com\.apple\.security\.network\.client/);
assert.match(docsReadmeSource, /Performance architecture/);
assert.match(docsReadmeSource, /Stability program/);
assert.match(architectureDocsSource, /\[Performance architecture\]\(performance\.md\)/);
assert.match(rendererSupportDocsSource, /\[Performance architecture\]\(performance\.md\)/);
assert.doesNotMatch(rendererSupportDocsSource, /xyz-fast|fast-xyz/);
assert.match(performanceDocsSource, /config\/web-runtime-profiles\.json/);
assert.match(performanceDocsSource, /preview-data\.bin/);
assert.match(performanceDocsSource, /window\.BurreteDataURL/);
assert.match(performanceDocsSource, /RDKit_minimal\.wasm/);
assert.match(performanceDocsSource, /molecules_fts/);
assert.match(performanceDocsSource, /BURRETE_PERF_RUN_GRID_FTS=1 \.\/scripts\/perf-smoke\.sh/);
assert.match(performanceDocsSource, /Do Not Regress/);
assert.match(burreteCoreSource, /pub const PREVIEW_CONTRACT_SCHEMA_VERSION: u32 = 1/);
assert.match(burreteCoreSource, /pub const PREVIEW_TRACE_FILE: &str = "preview-trace\.jsonl"/);
assert.match(burreteCoreSource, /pub enum PreviewLifecycleState/);
assert.match(burreteCoreSource, /pub struct PreviewLifecycle/);
assert.match(burreteCoreSource, /pub fn transition\(&mut self, next: PreviewLifecycleState\)/);
assert.match(burreteCoreSource, /can_transition_from/);
assert.match(burreteCoreSource, /preview_trace_payload/);
assert.match(burreteCoreSource, /preview_runtime_manifest/);
assert.match(burreteCoreSource, /preview_error_code_for_message/);
assert.match(nightlySmokeWorkflow, /on:\s*\n\s*schedule:/);
assert.match(nightlySmokeWorkflow, /BURRETE_DEV_FLAVOR:\s*ci/);
assert.match(nightlySmokeWorkflow, /scripts\/quicklook-preview-smoke\.sh/);
for (const fixture of [
  'samples/mini.pdb',
  'samples/mini.cif',
  'samples/mini.sdf',
  'samples/mini.xyz',
  'samples/structures/small-molecules/benzene.xyz',
  'samples/quantum/inputs/caffeine.com',
]) {
  assert.match(nightlySmokeWorkflow, new RegExp(fixture.replaceAll('/', '\\/')));
}
assert.doesNotMatch(nightlySmokeWorkflow, /cp samples\/mini\.xyz build\/smoke\/single\.xyzr/);
assert.match(nightlySmokeWorkflow, /scripts\/perf-smoke\.sh/);

for (const moduleName of ['agent_integration', 'documents', 'grid', 'preview_cache', 'quicklook', 'runtime_doctor', 'shell', 'startup', 'updater']) {
  assert.match(commandsIndex, new RegExp(`pub\\(crate\\) mod ${moduleName};`));
}

for (const commandPath of [
  'commands::agent_integration::agent_integration_status',
  'commands::startup::startup_documents',
  'commands::startup::startup_agent_session',
  'commands::documents::pick_open_targets',
  'commands::documents::classify_open_paths',
  'commands::documents::open_documents',
  'commands::documents::open_delimited_grid_document',
  'commands::documents::read_structure_text',
  'commands::documents::fetch_pdb_structure',
  'commands::documents::generate_3d_conformer',
  'commands::documents::open_text_structure',
  'commands::documents::fetch_remote_structure',
  'commands::documents::save_text_as',
  'commands::descriptors::descriptor_calculate_grid',
  'commands::descriptors::descriptor_start_grid',
  'commands::descriptors::descriptor_grid_job_status',
  'commands::descriptors::descriptor_cancel_grid',
  'commands::grid::grid_fetch_page',
  'commands::grid::grid_append_records',
  'commands::grid::grid_delimited_columns',
  'commands::grid::grid_append_delimited_records',
  'commands::documents::render_xyzrender_sheet_item',
  'commands::documents::render_xyzrender_sheet_items',
  'commands::documents::sync_viewer_preferences',
  'commands::preview_cache::clear_preview_cache',
  'commands::runtime_doctor::external_runtime_doctor',
  'commands::shell::export_diagnostics_bundle',
  'commands::shell::open_logs_folder',
  'commands::shell::open_external_url',
  'commands::shell::existing_paths',
  'commands::shell::open_new_workspace_window',
  'commands::shell::read_external_preview_svg',
  'commands::shell::read_viewer_runtime_file_base64',
  'commands::shell::reveal_path',
  'commands::shell::write_base64_file',
  'commands::shell::write_text_file',
  'commands::quicklook::reset_quick_look',
  'commands::pubchem::open_pubchem_search',
  'commands::updater::install_update',
]) {
  assert.match(lib, new RegExp(commandPath.replaceAll('::', '::')));
  assert.match(tauriPermissionSource, new RegExp(`"${commandPath.split('::').at(-1)}"`));
}

assert.match(lib, /disable_macos_state_restoration\(\);/);
assert.match(lib, /ApplePersistenceIgnoreState/);
assert.match(lib, /NSQuitAlwaysKeepsWindows/);
assert.match(startupCommand, /#\[tauri::command\]\s+pub\(crate\) fn startup_documents/);
assert.match(startupCommand, /#\[tauri::command\]\s+pub\(crate\) fn startup_agent_session/);
assert.match(agentIntegrationCommand, /#\[tauri::command\]\s+pub\(crate\) fn agent_integration_status/);
assert.match(agentIntegrationCommand, /PLUGIN_RELATIVE_PATH: &str = "plugins\/burette-agent"/);
assert.match(agentIntegrationCommand, /BURRETE_AGENT_PLUGIN_DIR/);
assert.match(agentIntegrationCommand, /schema: "burette_agent_integration\.v1"/);
assert.doesNotMatch(agentIntegrationCommand, /mcp\/widget-assets\/molecule-table\/widget\.html/);
assert.doesNotMatch(agentIntegrationCommand, /mcp\/widget-assets\/trajectory-review\/widget\.html/);
assert.doesNotMatch(agentIntegrationCommand, /mcp\/widget-assets\/molecular-report\/widget\.html/);
assert.doesNotMatch(agentIntegrationCommand, /mcp\/widget-assets\/molecular-workspace\/widget\.html/);
assert.match(agentIntegrationCommand, /find_codex_plugin_manifest/);
assert.match(agentIntegrationCommand, /mcp\/lib\/server-bundle\.mjs/);
assert.match(agentIntegrationCommand, /"scripts\/burrete-agent\.mjs"/);
assert.match(agentIntegrationCommand, /"browser-shell-dist\/index\.html"/);
assert.doesNotMatch(agentIntegrationCommand, /Command::new|spawn|remove_file|write\(/);
assert.match(startupSource, /pub\(crate\) enum LaunchMode/);
assert.match(startupSource, /BURRETE_LAUNCH_MODE/);
assert.match(startupSource, /--burrete-launch-mode=register/);
assert.match(startupSource, /--burrete-agent-session/);
assert.match(startupSource, /pub\(crate\) fn agent_session_from_argv/);
assert.match(startupSource, /pub\(crate\) fn emit_agent_session/);
assert.match(startupSource, /paths_by_window: Mutex<HashMap<String, Vec<String>>>/);
assert.match(startupSource, /push_for_window/);
assert.match(startupSource, /drain_for_window/);
assert.match(startupCommand, /window: tauri::WebviewWindow<R>/);
assert.match(lib, /startup::emit_agent_session\(app, session_dir\)/);
assert.match(agentSessionHook, /invoke<string \| null>\("startup_agent_session"\)/);
assert.match(agentSessionHook, /listen<string>\("agent-session"/);
assert.match(agentSessionHook, /trackTauriListener\(listen<string>\("agent-session"/);
assert.match(agentSessionHook, /VITE_BURRETE_AGENT_SHELL/);
assert.match(agentSessionHook, /BROWSER_AGENT_SESSION_DIR/);
assert.match(agentSessionHook, /activateSession\(BROWSER_AGENT_SESSION_DIR\)/);
assert.doesNotMatch(agentSessionHook, /let unlisten/);
assert.doesNotMatch(agentSessionHook, /unlisten\?\.\(\)/);
assert.match(agentSessionHook, /joinSessionPath\(sessionDir, "observe\.json"\)/);
assert.match(agentSessionHook, /joinSessionPath\(sessionDir, "actions\.json"\)/);
assert.match(agentSessionHook, /__burette\/agent-session\/\$\{browserFile\}/);
assert.match(agentSessionHook, /browser-agent-http-session/);
assert.match(agentSessionHook, /new EventSource\("\/__burette\/agent-session\/events"\)/);
assert.match(agentSessionHook, /browserActionEvents\?\.addEventListener\("actions", pollNow\)/);
assert.match(agentSessionHook, /workspacePanelsRef/);
assert.match(agentSessionHook, /workspacePanels/);
assert.match(agentSessionHook, /viewerAgentStatesRef/);
assert.match(agentSessionHook, /viewerAgentStateFromMessage/);
assert.match(agentSessionHook, /type === "agentReady"/);
assert.match(agentSessionHook, /agent-panel:\$\{area\}:\$\{kind\}:\$\{document\.title\}/);
assert.match(agentSessionHook, /type === "open_files"/);
assert.match(agentSessionHook, /type === "render_panel"/);
assert.match(agentSessionHook, /render_panel kind must be markdown, table, or chart/);
assert.match(agentSessionHook, /openTextDocuments\(\[file\], \{ background: true \}\)/);
assert.match(agentSessionHook, /setDockDocument\(area, document\.id\)/);
assert.match(agentSessionHook, /source: "burrete-agent-host"/);
assert.match(agentSessionHook, /querySelectorAll<HTMLIFrameElement>\("iframe\.viewer-iframe\[data-document-id\]"\)/);
assert.match(agentSessionHook, /item\.dataset\.documentId === activeDocument\.id/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn read_viewer_runtime_file_base64/);
assert.match(shellCommand, /Runtime file path is outside the preview runtime directory/);
assert.match(previewRuntimeViewer, /burrete-native-host/);
assert.match(previewRuntimeViewer, /window\.BurreteReceiveNativeData\(body\.payload \|\| \{\}\)/);
assert.match(previewRuntimeViewer, /window\.BurreteReceiveNativeRuntimeFile\(body\.payload \|\| \{\}\)/);
assert.match(startupSource, /arg == "--burrete-launch-mode"/);
assert.match(startupSource, /file_args_from_argv/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn pick_open_targets/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn classify_open_paths/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_documents/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_delimited_grid_document/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn read_structure_text/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) async fn fetch_pdb_structure/);
assert.match(documentsCommand, /https:\/\/files\.rcsb\.org\/download\/\{pdb_id\}\.pdb/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn generate_3d_conformer/);
assert.match(documentsCommand, /engine: Option<String>/);
assert.match(documentsCommand, /mode: Option<String>/);
assert.match(documentsCommand, /candidate_count: Option<usize>/);
assert.match(documentsCommand, /rmsd_cutoff: Option<f64>/);
assert.match(documentsCommand, /conformer_count: Option<usize>/);
assert.match(documentsCommand, /3D conformer generation supports Datamol and RDKit engines/);
assert.match(documentsCommand, /source_3d: Option<ConformerGenerationSource>/);
assert.match(documentsCommand, /fn generated_conformer_set_title/);
assert.match(documentsCommand, /"mode": mode/);
assert.match(documentsCommand, /"candidateCount": candidate_count/);
assert.match(documentsCommand, /"rmsdCutoff": rmsd_cutoff/);
assert.match(documentsCommand, /include_str!\(concat!\([\s\S]*env!\("CARGO_MANIFEST_DIR"\),[\s\S]*"\/\.\.\/\.\.\/\.\.\/scripts\/rdkit_conformer\.py"/);
assert.match(rdkitConformerScript, /Cannot preserve the original 3D pose because the original core no longer matches the current Ketcher sketch/);
assert.match(rdkitConformerScript, /3D conformer generation supports Datamol and RDKit engines/);
assert.match(rdkitConformerScript, /ff\.AddFixedPoint\(int\(atom_idx\)\)/);
assert.match(rdkitConformerScript, /method = "ETKDG\+" \+ family \+ \("\+fixed-core" if core is not None else "\+ensemble"\)/);
assert.match(rdkitConformerScript, /mode = str\(payload\.get\("mode"\) or "single"\)/);
assert.match(rdkitConformerScript, /DEFAULT_ENSEMBLE_CANDIDATE_COUNT = 128/);
assert.match(rdkitConformerScript, /DEFAULT_ENSEMBLE_RMSD_CUTOFF = 0\.75/);
assert.doesNotMatch(rdkitConformerScript, /ENSEMBLE_OUTPUT_COUNT/);
assert.match(rdkitConformerScript, /def select_ensemble_conformer_ids\(scored\):/);
assert.match(rdkitConformerScript, /selected_conf_ids = select_ensemble_conformer_ids\(scored\)/);
assert.match(rdkitConformerScript, /"conformerCount": len\(records\)/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_text_structure/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn fetch_remote_structure/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn save_text_as/);
assert.match(previewRuntime, /pub\(crate\) fn into_virtual\(mut self\) -> Self/);
assert.match(previewRuntime, /pub\(crate\) fn virtual_structure/);
assert.match(documentsCommand, /enum OpenDocumentsMode/);
assert.match(documentsCommand, /CombinePoses/);
assert.match(documentsCommand, /CombineGrid/);
assert.match(documentsCommand, /fn open_combined_pose_document/);
assert.match(documentsCommand, /fn open_combined_grid_document/);
assert.match(documentsCommand, /create_combined_sdf_pose_runtime/);
assert.match(documentsCommand, /create_grid_runtime_with_options/);
assert.match(documentsCommand, /runtime_document_id\(\s*window_label,/);
assert.match(previewRuntimeGrid, /pub\(crate\) fn create_grid_runtime_with_options<R: Runtime>\(\s*app: &tauri::AppHandle<R>,\s*document_id: &str,\s*registry_document_id: &str,/s);
assert.match(previewRuntimeGrid, /register\(\s*registry_document_id,/s);
assert.match(previewRuntimeGrid, /"documentId": document_id,/);
assert.doesNotMatch(previewRuntimeGrid, /"documentId": registry_document_id/);
assert.match(previewRuntime, /let runtime_document_id = crate::windows::runtime_document_id\(window_label, &document_id\);\s*if let Some\(runtime_path\) = create_grid_runtime_with_options\(\s*app,\s*&document_id,\s*&runtime_document_id,/s);
assert.match(documentsCommand, /let document_id = crate::preview::runtime_utils::stable_id\(Path::new\(&path\)\);/);
assert.match(documentsCommand, /let runtime_document_id = crate::windows::runtime_document_id\(window_label, &document_id\);/);
assert.match(documentsCommand, /create_grid_runtime_with_options\(\s*app,\s*&document_id,\s*&runtime_document_id,/s);
assert.match(documentsCommand, /fn combined_sdf_data/);
assert.match(documentsCommand, /data\.ends_with\(b"\$\$\$\$"\)/);
assert.match(documentsCommand, /ViewerDocument::virtual_structure/);
assert.match(documentsCommand, /open_document_for_window\(\s*app,\s*window_label,\s*output_path,\s*&preferences,\s*reload_options\.as_ref\(\),\s*\)\s*\.map\(\|document\| document\.into_virtual\(\)\)/);
assert.match(documentsCommand, /open_document_for_window\(&app, window\.label\(\), output_path, &preferences, None\)\s*\.map\(\|document\| document\.into_virtual\(\)\)/);
assert.match(gridCommand, /#\[tauri::command\]\s+pub\(crate\) fn grid_fetch_page/);
assert.match(gridCommand, /#\[tauri::command\]\s+pub\(crate\) fn grid_append_records/);
assert.match(gridCommand, /#\[tauri::command\]\s+pub\(crate\) fn grid_delimited_columns/);
assert.match(gridCommand, /#\[tauri::command\]\s+pub\(crate\) fn grid_append_delimited_records/);
assert.match(gridCommand, /struct GridAppendRequest/);
assert.match(gridCommand, /registry\.append_text/);
assert.match(gridCommand, /registry\.append_text_with_options/);
assert.match(previewGridStore, /fn resolve_smiles_columns/);
assert.match(previewGridStore, /struct GridParseOptions/);
assert.match(previewGridStore, /struct GridDelimitedColumnChoice/);
assert.match(previewGridStore, /fn infer_smiles_columns_from_values/);
assert.match(previewGridStore, /fn is_likely_smiles_column/);
assert.match(previewGridStore, /fn delimited_smiles_column_choices/);
assert.match(previewGridStore, /value == "smile" \|\| value\.contains\("smiles"\)/);
assert.match(moleculeGridPreview, /value == "smile" \|\| value\.contains\("smiles"\)/);
assert.match(previewGridStore, /fn infers_smiles_columns_without_smiles_headers/);
assert.match(previewGridStore, /fn uses_explicit_column_for_ambiguous_delimited_table/);
assert.match(previewGridStore, /fn lists_delimited_structure_column_choices/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn sync_viewer_preferences/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn list_project_structure_files/);
assert.match(lib, /commands::documents::list_project_structure_files/);
assert.match(tauriPermissionSource, /"list_project_structure_files"/);
assert.match(documentsCommand, /"molstarStyle"/);
assert.match(documentsCommand, /fn expand_open_targets/);
assert.match(documentsCommand, /fn collect_supported_files/);
assert.match(documentsCommand, /fn looks_like_supported_structure_file/);
assert.match(previewCacheCommand, /#\[tauri::command\]\s+pub\(crate\) fn clear_preview_cache/);
assert.match(runtimeDoctorCommand, /#\[tauri::command\]\s+pub\(crate\) fn external_runtime_doctor/);
assert.match(runtimeDoctorCommand, /burrete\.external-runtime-doctor\.v1/);
for (const checkId of ['xyzrender', 'descriptors-python', 'datamol-conformer-python', 'rdkit-conformer-python', 'crest', 'prism', 'xtb', 'schrodinger']) {
  assert.match(runtimeDoctorCommand, new RegExp(`"${checkId}"`));
}
assert.match(runtimeDoctorCommand, /descriptors::descriptor_runtime_status\(\)/);
assert.match(runtimeDoctorCommand, /documents::conformer_python_runtime_status\("datamol"\)/);
assert.match(runtimeDoctorCommand, /documents::conformer_python_runtime_status\("rdkit"\)/);
assert.match(runtimeDoctorCommand, /conformer::conformer_status\(\)/);
assert.match(runtimeDoctorCommand, /xtb::xtb_status\(app\)/);
assert.match(runtimeDoctorCommand, /xyzrender::xyzrender_runtime_status\(\)/);
assert.doesNotMatch(runtimeDoctorCommand, /descriptor_runtime_install|install_xtb|run_xtb_job|run_conformer_job|create_xyzrender_artifact/);
assert.match(previewXyzrender, /pub\(crate\) fn xyzrender_runtime_status/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn export_diagnostics_bundle/);
assert.match(shellCommand, /timestamp level subsystem documentId event elapsedMs message/);
assert.match(shellCommand, /BurreteApp\.log/);
assert.match(shellCommand, /PREVIEW_TRACE_FILE/);
assert.match(shellCommand, /previewTraceCopied/);
assert.match(shellCommand, /quicklook-logs/);
assert.match(shellCommand, /rawMoleculeContentIncluded/);
assert.match(previewIndex, /pub\(crate\) mod trace;/);
assert.match(previewTrace, /pub\(crate\) use burrete_core::PREVIEW_TRACE_FILE/);
assert.match(previewTrace, /PreviewTraceEvent/);
assert.match(previewTrace, /preview_error_code_for_message/);
assert.match(previewTrace, /preview_trace_payload/);
assert.match(previewTrace, /preview_runtime_manifest/);
assert.match(previewRuntime, /append_preview_trace/);
assert.match(previewRuntime, /PreviewLifecycle::default\(\)/);
assert.match(previewRuntime, /PreviewLifecycleState::Completed/);
assert.match(previewRuntime, /PreviewLifecycleState::Failed/);
assert.match(quickLookPreviewController, /runtimeManifestJSON/);
assert.match(quickLookPreviewController, /manifest\.json/);
assert.match(quickLookPreviewController, /previewRequestID/);
assert.match(quickLookPreviewController, /preview-trace\.jsonl/);
assert.match(quickLookPreviewController, /trace\.requestID=/);
assert.match(quickLookPreviewController, /\[build\] runtimeDirectory=/);
assert.match(quickLookPreviewController, /BRT-QL-WEB-TIMEOUT/);
assert.match(quickLookPreviewController, /private func appendFailedPreviewTrace\(requestID: UUID, error: Error, message: String\)/);
assert.match(quickLookPreviewController, /appendFailedPreviewTrace\(requestID: requestID, error: error, message: "render timeout waiting for JS ready"\)/);
assert.match(quickLookPreviewController, /appendFailedPreviewTrace\(requestID: activePreviewRequestID, error: error, message: "WK didFail"\)/);
assert.match(quickLookPreviewController, /appendFailedPreviewTrace\(requestID: activePreviewRequestID, error: error, message: "WK didFailProvisionalNavigation"\)/);
assert.match(quickLookPreviewController, /appendFailedPreviewTrace\(requestID: activePreviewRequestID, error: error, message: "WK webContentProcessDidTerminate"\)/);
assert.match(quickLookPreviewController, /appendFailedPreviewTrace\(requestID: requestID, error: error, message: "native renderer switch error"\)/);
assert.match(performanceSource, /export function collectPerformanceMarks/);
assert.match(performanceSource, /export async function measureAsync/);
assert.match(shellActionsSource, /exportDiagnostics: \(\) => void \| Promise<void>;/);
assert.match(settingsPanelSource, /actionRow\("Diagnostics"/);
assert.match(commandPaletteSource, /id: "export-diagnostics"/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_logs_folder/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_external_url/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn read_external_preview_svg/);
assert.match(shellCommand, /externalArtifact/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn reveal_path/);
assert.match(shellCommand, /tauri_plugin_opener::reveal_item_in_dir/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn write_base64_file/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn write_text_file/);
assert.match(quickLookCommand, /#\[tauri::command\]\s+pub\(crate\) fn reset_quick_look/);
assert.match(updaterCommand, /#\[tauri::command\]\s+pub\(crate\) async fn install_update/);
assert.match(updaterCommand, /format_download_message\(0, request\.size, 0\.0\)/);
assert.match(updaterCommand, /download_asset_with_progress\(/);
assert.match(updaterCommand, /"--connect-timeout"/);
assert.match(updaterCommand, /"--speed-limit"/);
assert.match(updaterCommand, /"--speed-time"/);
assert.match(quickLookCommand, /QuickLookResetReport/);
assert.match(quickLookCommand, /launch_services_registered: CommandReport/);
assert.match(quickLookCommand, /default_handlers_registered: CommandReport/);
assert.match(quickLookCommand, /extension_registered: CommandReport/);
assert.match(quickLookCommand, /extension_enabled: CommandReport/);
assert.match(quickLookCommand, /LaunchServices\.framework\/Support\/lsregister/);
assert.match(quickLookCommand, /LSSetDefaultRoleHandlerForContentType/);
assert.match(quickLookCommand, /"\/usr\/bin\/pluginkit"/);
assert.match(quickLookCommand, /bundle_id\(&preview_extension\)/);
assert.match(quickLookCommand, /\.output\(\)/);
assert.match(updaterCommand, /LSSetDefaultRoleHandlerForContentType/);
assert.doesNotMatch(quickLookCommand, /\.spawn\(\)/);
assert.match(buildScript, /does not accept positional arguments/);
assert.match(buildScript, /BURRETE_BUILD_MODE/);
assert.match(buildScript, /BURRETE_DEV_FLAVOR/);
assert.match(buildScript, /dev-namespace\.mjs" patch-tree "\$SAFE_ROOT"/);
assert.match(buildScript, /Developer ID Application:/);
assert.match(buildScript, /hardenedRuntime/);
assert.match(buildScript, /cargo build --release --bin burrete-core-bridge/);
assert.match(buildScript, /TAURI_TARGET_DIR="\$\{CARGO_TARGET_DIR:-target\}"/);
assert.match(buildScript, /"\$TAURI_TARGET_DIR\/release\/bundle\/macos\/Burrete\.app"/);
assert.match(buildScript, /CORE_BRIDGE="\$TAURI_TARGET_DIR\/release\/burrete-core-bridge"/);
assert.match(buildScript, /case "\$TAURI_BUILT_APP" in/);
assert.match(buildScript, /ditto --norsrc --noextattr "\$BUILT_APP_SOURCE" "\$VERIFY_APP"/);
assert.match(buildScript, /-scheme BurreteThumbnail/);
assert.match(buildScript, /BurreteThumbnail\.appex/);
assert.match(buildScript, /Contents\/Resources\/burrete-core-bridge/);
assert.match(buildScript, /codesign "\$\{CODESIGN_ARGS\[@\]\}" "\$TAURI_BUILT_APP\/Contents\/PlugIns\/BurretePreview\.appex\/Contents\/Resources\/burrete-core-bridge"/);
assert.match(buildScript, /codesign "\$\{CODESIGN_ARGS\[@\]\}" --entitlements "\$ROOT\/PreviewExtension\/BurretePreview\.entitlements" "\$TAURI_BUILT_APP\/Contents\/PlugIns\/BurreteThumbnail\.appex"/);
assert.match(buildScript, /Add :LSUIElement bool false/);
assert.doesNotMatch(buildScript, /Add :LSUIElement bool true/);
assert.match(ciScript, /\.\/scripts\/build\.sh\n/);
assert.doesNotMatch(ciScript, /\.\/scripts\/build\.sh\s+samples\/mini\.sdf/);
assert.match(ciScript, /bun run check:vendor-assets/);
assert.match(ciScript, /bun run test:update/);
assert.match(ciWorkflow, /uses: \.\/\.github\/actions\/setup-burrete-toolchain/);
assert.match(ciWorkflow, /install-xyzrender: "true"/);
assert.match(toolchainAction, /Install xyzrender runtime/);
assert.match(toolchainAction, /python3 -m pip install --user --break-system-packages uv/);
assert.match(toolchainAction, /"\$\(python3 -m site --user-base\)\/bin\/uv" tool install xyzrender/);
assert.match(releaseWorkflow, /BURRETE_UPDATE_MANIFEST_PUBLIC_KEY_HEX/);
assert.match(releaseWorkflow, /BURRETE_UPDATE_MANIFEST_PRIVATE_KEY_PEM/);
assert.match(releaseWorkflow, /BURRETE_BUILD_MODE: release/);
assert.match(releaseWorkflow, /uses: \.\/\.github\/actions\/setup-burrete-toolchain/);
assert.match(releaseWorkflow, /install-xyzrender: "true"/);
assert.match(releaseWorkflow, /allow_adhoc=true/);
assert.match(releaseWorkflow, /BURRETE_RELEASE_ALLOW_ADHOC/);
assert.match(releaseWorkflow, /scripts\/create-dmg\.sh release\/Burrete\.app/);
assert.match(releaseWorkflow, /zip\.manifest\.json/);
assert.match(releaseWorkflow, /zip\.manifest\.json\.sig/);
assert.match(releaseWorkflow, /prerelease=true/);
assert.match(releaseWorkflow, /release_flags\+\=\(--prerelease\)/);
assert.match(releaseScript, /sign-update-manifest\.mjs/);
assert.match(releaseScript, /--dry-run/);
assert.match(releaseScript, /BURRETE_BUILD_MODE=release/);
assert.match(releaseScript, /notarytool submit/);
assert.match(releaseScript, /stapler staple/);
assert.match(releaseScript, /scripts\/create-dmg\.sh" "\$APP" "\$DMG"/);
assert.match(createDmgScript, /packaging\/dmg\/background\.png/);
assert.match(createDmgScript, /ln -s \/Applications/);
assert.match(createDmgScript, /set background picture of viewOptions/);
assert.match(createDmgScript, /set position of item "Burrete\.app"/);
assert.match(createDmgScript, /set position of item "Applications"/);
assert.match(releaseSignatureScript, /BurreteThumbnail\.appex/);
assert.match(releaseSignatureScript, /com\.local\.BurreteV10\.Thumbnail/);
assert.match(releaseSignatureScript, /hardened runtime/);
assert.match(releaseSignatureScript, /spctl --assess --type execute/);
assert.match(releaseSignatureScript, /xcrun stapler validate/);
assert.match(signUpdateManifestScript, /crypto\.sign\(null, manifestBytes/);
assert.match(updaterCommand, /verify_update_manifest/);
assert.match(updaterCommand, /BURRETE_UPDATE_MANIFEST_PUBLIC_KEY_HEX/);
assert.match(updaterCommand, /ed25519/);
assert.match(updaterCommand, /manifest_asset_name/);
assert.match(updaterCommand, /asset_sha256/);
assert.equal(packageConfig.packageManager, 'bun@1.3.8');
assert.deepEqual(packageConfig.workspaces, ['apps/*', 'packages/*']);
assert.equal(packageConfig.scripts['check:formats'], 'bun scripts/check-preview-format-registry.mjs');
assert.equal(packageConfig.scripts['check:vendor-assets'], 'bun scripts/check-vendor-assets.mjs');
for (const updateTest of [
  'bun tests/test-update-versioning.mjs',
  'bun tests/test-update-auto-prompt-contract.mjs',
  'bun tests/test-bun-installer-behavior.mjs',
  'bun tests/test-dev-namespace.mjs',
  'bun tests/test-quicklook-preview-smoke-contract.mjs',
  'bun tests/test-install-health-contract.mjs',
  'bun tests/test-preview-format-matrix.mjs',
  'bun tests/test-cross-platform-preview-contract.mjs',
]) {
  assert.ok(packageConfig.scripts['test:update'].split(/\s*&&\s*/u).includes(updateTest), `test:update must include ${updateTest}`);
}
assert.equal(desktopPackageConfig.scripts.build, '../../node_modules/.bin/vite build --config vite.config.ts');
assert.doesNotMatch(desktopPackageConfig.scripts.build, /bun --bun vite build/);
assert.match(packageConfig.scripts['check:js'], /scripts\/dev-namespace\.mjs/);
assert.match(buildScript, /BURRETE_DEV_FLAVOR/);
assert.match(buildScript, /bun "\$ROOT\/scripts\/dev-namespace\.mjs" shell-env/);
assert.match(buildScript, /LOCAL_APP="\$ROOT\/build\/\$BURRETE_APP_BUNDLE_NAME"/);
assert.match(buildScript, /\.\.\/\.\.\/node_modules\/\.bin\/vite build --config vite\.config\.ts/);
assert.match(buildScript, /bun "\$ROOT\/scripts\/dev-namespace\.mjs" patch-tree "\$SAFE_ROOT"/);
assert.match(buildDevScript, /BURRETE_DEV_FLAVOR is supported by scripts\/build\.sh, not scripts\/build-dev\.sh/);
assert.match(buildDevScript, /\.\.\/\.\.\/node_modules\/\.bin\/vite build --config vite\.config\.ts/);
assert.match(buildDevScript, /bun run build:tauri/);
assert.match(installLocalScript, /BURRETE_DEV_FLAVOR/);
assert.match(installLocalScript, /DEST="\$DEST_DIR\/\$APP_BUNDLE_NAME"/);
assert.match(installLocalScript, /pluginkit -r "\$EXT_ID"/);
assert.match(devNamespaceScript, /export function namespaceForFlavor/);
assert.match(devNamespaceScript, /appId: `\$\{BASE\.appId\}\.Dev\.\$\{slug\}`/);
assert.equal(packageConfig.scripts['vendor:lock'], 'bun scripts/check-vendor-assets.mjs --write');
assert.match(cargoWorkspaceSource, /"apps\/desktop\/src-tauri"/);
assert.match(cargoWorkspaceSource, /"crates\/burrete-core"/);
assert.match(tauriCargoSource, /burrete-core = \{ path = "\.\.\/\.\.\/\.\.\/crates\/burrete-core" \}/);
assert.match(coreCargoSource, /name = "burrete-core"/);
assert.match(previewFormatsSource, /pub\(crate\) use burrete_core::\{/);
assert.match(previewFormatsSource, /format_for_extension/);
assert.match(previewFormatsSource, /resolve_renderer/);
assert.match(previewFormatRegistrySource, /"id": "mol-view-spec-json"/);
assert.match(previewFormatRegistrySource, /"extensions": \["mvsj"\]/);
assert.match(previewFormatRegistrySource, /"id": "mol-view-spec-archive"/);
assert.match(previewFormatRegistrySource, /"extensions": \["mvsx"\]/);
assert.ok(tauriConfig.bundle.fileAssociations?.[0]?.ext?.includes('mvsj'));
assert.ok(tauriConfig.bundle.fileAssociations?.[0]?.ext?.includes('mvsx'));
assert.match(rendererPolicySource, /enum BurreteCoreBridge/);
assert.match(rendererPolicySource, /supported-extension/);
assert.match(rendererPolicySource, /resolve-renderer/);
assert.match(rendererPolicySource, /struct BurretePreviewPlan: Decodable, Equatable/);
assert.match(rendererPolicySource, /let primary: BurretePreviewPrimary\?/);
assert.match(rendererPolicySource, /let converter: BurretePreviewConverter\?/);
assert.match(rendererPolicySource, /let staged: \[BurretePreviewStagedEntry\]/);
assert.match(rendererPolicySource, /let fallbacks: \[BurretePreviewFallback\]/);
assert.match(rendererPolicySource, /let capabilities: BurretePreviewCapabilities/);
assert.match(rendererPolicySource, /Bundle\(for: PreviewViewController\.self\)/);
assert.match(rendererPolicySource, /enum BundledFormatRegistry/);
assert.match(rendererPolicySource, /url\(forResource: registryName, withExtension: "json"\)/);
assert.match(quickLookPreviewController, /BurreteCoreBridge\.supportedExtension\(pathExtension\)/);
assert.match(quickLookPreviewController, /BundledFormatRegistry\.supportedExtension\(pathExtension\)/);
assert.doesNotMatch(quickLookPreviewController, /supportedStructureExtensions/);
assert.match(quickLookPreviewController, /let previewPlan = BurreteCoreBridge\.previewPlan/);
assert.match(quickLookPreviewController, /shouldUseFepGraphMLPreview\(fileExtension: pathExtension, previewPlan: previewPlan\)/);
assert.match(quickLookPreviewController, /requiresGridPreview\(fileExtension: pathExtension, previewPlan: previewPlan\)/);
assert.match(quickLookPreviewController, /canOpenInVesta\(fileExtension: originalFileExtension, previewPlan: previewPlan\)/);
assert.match(quickLookPreviewController, /private enum StructurePreviewStrategy: String/);
assert.match(quickLookPreviewController, /let structureStrategy = StructurePreviewStrategy\(previewPlan: previewPlan\)/);
assert.match(quickLookPreviewController, /private static func prepareConvertStructurePreviewIfNeeded\(/);
assert.match(quickLookPreviewController, /prepareConvertStructurePreviewIfNeeded\([\s\S]*strategy: structureStrategy,[\s\S]*preparedConversion: preparedConversion,/);
assert.match(quickLookPreviewController, /strategy\.requiresPreparedConversion\(previewPlan: previewPlan\)/);
assert.match(quickLookPreviewController, /private static func preferBuiltInParserForDefaultExternalPreviewIfAvailable\(/);
assert.match(quickLookPreviewController, /preferBuiltInParserForDefaultExternalPreviewIfAvailable\([\s\S]*rendererOverride: rendererOverride,[\s\S]*preparedConversion: preparedConversion,/);
assert.match(quickLookPreviewController, /structureStrategy\.requiresExtractedStandaloneCoordinates\(fileExtension: pathExtension\)/);
assert.match(quickLookPreviewController, /private struct StructurePreviewBuildState/);
assert.match(quickLookPreviewController, /state\.applyConvertedStructure\(convertedStructure\)/);
assert.match(quickLookPreviewController, /try renderExternalXyzrenderIfNeeded\(/);
assert.match(quickLookPreviewController, /private static func renderExternalXyzrenderIfNeeded\(/);
assert.match(quickLookPreviewController, /xyzrender\.fallback=\\\(state\.renderer\)/);
assert.match(quickLookPreviewController, /private static func buildFepGraphMLPreviewResult\(/);
assert.match(quickLookPreviewController, /return try buildFepGraphMLPreviewResult\(/);
assert.match(quickLookPreviewController, /private static func buildMoleculeGridPreviewResult\(/);
assert.match(quickLookPreviewController, /let gridPreviewResult = try buildMoleculeGridPreviewResult\(/);
assert.match(quickLookPreviewController, /"openchemlib\/openchemlib\.js"/);
assert.match(quickLookPreviewController, /private struct StructurePreviewPayload/);
assert.match(quickLookPreviewController, /private static func buildStructurePreviewPayload\(/);
assert.match(quickLookPreviewController, /let structurePreview = try buildStructurePreviewPayload\(/);
assert.match(quickLookPreviewController, /previewPlan: previewPlan/);
assert.match(quickLookPreviewController, /BurreteCoreBridge\.quickLookSizeLimit\(fileExtension: fileExtension\)/);
assert.match(quickLookPreviewController, /BurreteCoreBridge\.format\(fileExtension: ext\)/);
assert.match(xcodeProjectSource, /preview-formats\.json in Resources/);
assert.match(xcodeProjectSource, /path = "config\/preview-formats\.json"/);
assert.match(xcodeProjectSource, /BurreteThumbnail/);
assert.match(xcodeProjectSource, /ThumbnailProvider\.swift in Sources/);
assert.match(xcodeProjectSource, /INFOPLIST_FILE = PreviewExtension\/ThumbnailInfo\.plist/);
assert.match(xcodeProjectSource, /Bundle xyzrender launcher/);
assert.match(xcodeProjectSource, /Contents\/Resources\/xyzrender-python3/);
assert.match(xcodeProjectSource, /Contents\/lib\/\.xyzrender-python-library\.stamp/);
assert.match(xcodeProjectSource, /bundle-quicklook-xyzrender-launcher\.sh/);
assert.doesNotMatch(xcodeProjectSource, /Contents\/lib\/libpython3\.13\.dylib/);
assert.match(quickLookXyzrenderLauncherScript, /otool -L "\$PYTHON_EXE"/);
assert.match(quickLookXyzrenderLauncherScript, /Python\\\.framework\\\/Versions\\\/\.\*\\\/Python/);
assert.match(quickLookXyzrenderLauncherScript, /install_name_tool -change/);
assert.match(quickLookXyzrenderLauncherScript, /@executable_path\/\.\.\/lib\/\$PYTHON_LIBRARY_NAME/);
assert.match(quickLookXyzrenderLauncherScript, /libpython3\*\.dylib/);
assert.doesNotMatch(quickLookXyzrenderLauncherScript, /Contents\/lib\/libpython3\.13\.dylib/);
assert.match(xcodeThumbnailScheme, /BlueprintName = "BurreteThumbnail"/);
assert.match(xcodeThumbnailScheme, /BuildableName = "BurreteThumbnail\.appex"/);
assert.match(thumbnailInfoPlist, /com\.apple\.quicklook\.thumbnail/);
assert.match(thumbnailInfoPlist, /ThumbnailProvider/);
assert.match(thumbnailInfoPlist, /com\.local\.burrete10\.pdb/);
assert.match(thumbnailInfoPlist, /com\.local\.burrete10\.sdf/);
assert.match(thumbnailInfoPlist, /com\.local\.burrete10\.xyz/);
assert.match(thumbnailInfoPlist, /gg\.flew\.unfold\.gromacs-structure/);
assert.match(thumbnailProviderSource, /final class ThumbnailProvider: QLThumbnailProvider/);
assert.match(thumbnailProviderSource, /QLThumbnailReply\(contextSize: size\)/);
assert.match(thumbnailProviderSource, /parsePDB/);
assert.match(thumbnailProviderSource, /parseMolfile/);
assert.match(thumbnailProviderSource, /parseXYZ/);
assert.doesNotMatch(thumbnailProviderSource, /WebKit/);
assert.doesNotMatch(thumbnailProviderSource, /Molstar|RDKit|viewer\.js|grid-viewer/);
assert.match(vendorMolstarScript, /check-vendor-assets\.mjs/);
assert.match(vendorRdkitScript, /check-vendor-assets\.mjs/);
assert.equal(vendorAssetsLock.schemaVersion, 2);
assert.equal(vendorAssetsLock.source.bunLock, 'bun.lock');
assert.equal(vendorAssetsLock.source.profiles, 'config/web-runtime-profiles.json');
assert.equal(vendorAssetsLock.packages.molstar.version, packageConfig.dependencies.molstar);
assert.equal(vendorAssetsLock.packages['@rdkit/rdkit'].version, packageConfig.dependencies['@rdkit/rdkit']);
assert.equal(vendorAssetsLock.packages.openchemlib.version, packageConfig.dependencies.openchemlib);
assert.equal(vendorAssetsLock.assets.length, 5);
for (const asset of vendorAssetsLock.assets) {
  assert.match(asset.sha256, /^sha256-/);
  assert.ok(asset.bytes > 0);
}
assert.equal(webRuntimeProfiles.schemaVersion, 1);
assert.equal(webRuntimeProfiles.sourceRoot, 'PreviewExtension/Web');
assert.deepEqual(vendorAssetsLock.profiles, webRuntimeProfiles.profiles);
assert.deepEqual(vendorAssetsLock.bundleTargets, webRuntimeProfiles.bundleTargets);
assert.ok(webRuntimeProfiles.profiles['desktop-molstar'].includes('molstar.js'));
assert.ok(webRuntimeProfiles.profiles['desktop-grid'].includes('openchemlib/openchemlib.js'));
assert.ok(webRuntimeProfiles.profiles['desktop-grid'].includes('rdkit/RDKit_minimal.wasm'));
assert.ok(webRuntimeProfiles.profiles['quicklook-molstar'].includes('viewer.js'));
assert.ok(webRuntimeProfiles.profiles['quicklook-grid'].includes('grid-viewer.js'));
assert.ok(webRuntimeProfiles.profiles['quicklook-grid'].includes('openchemlib/openchemlib.js'));
assert.ok(webRuntimeProfiles.profiles['external-artifact'].includes('viewer-shell.js'));
assert.deepEqual(webRuntimeProfiles.bundleTargets.tauri.profiles, [
  'desktop-molstar',
  'desktop-grid',
  'external-artifact',
]);
assert.deepEqual(webRuntimeProfiles.bundleTargets.quicklook.profiles, [
  'quicklook-molstar',
  'quicklook-grid',
  'external-artifact',
]);
assert.match(xcodeProjectSource, /check-vendor-assets\.mjs --profile quicklook-molstar --profile quicklook-grid --profile external-artifact/);
assert.match(previewEntitlements, /com\.apple\.security\.app-sandbox/);
assert.match(previewEntitlements, /com\.apple\.security\.files\.user-selected\.read-only/);
assert.match(previewEntitlements, /com\.apple\.security\.files\.user-selected\.executable/);
assert.match(appInfoPlist, /<key>LSUIElement<\/key>\s*<false\/>/);
assert.match(releaseVersionCheck, /semver release or prerelease/);
assert.doesNotMatch(appMetadata, /<key>LSHandlerRank<\/key>\s*<string>Alternate<\/string>/);
assert.match(appMetadata, /<key>CFBundleTypeName<\/key>\s*<string>Molecular grid tables<\/string>/);
assert.match(appMetadata, /<key>LSHandlerRank<\/key>\s*<string>Owner<\/string>/);
assert.match(appMetadata, /com\.local\.burrete10\.graphml/);
assert.match(thumbnailInfoPlist, /com\.local\.burrete10\.graphml/);
assert.match(thumbnailProviderSource, /parseCIF/);
assert.match(thumbnailProviderSource, /parseMol2/);
assert.match(thumbnailProviderSource, /parseCube/);
const quickLookSupportedContentTypesBlock = previewExtensionInfoPlist.match(
  /<key>QLSupportedContentTypes<\/key>\s*<array>([\s\S]*?)<\/array>/,
)?.[1] ?? '';
assert.match(quickLookSupportedContentTypesBlock, /public\.comma-separated-values-text/);
assert.match(quickLookSupportedContentTypesBlock, /public\.tab-separated-values-text/);
assert.match(previewExtensionInfoPlist, /com\.local\.burrete10\.csv/);
assert.match(previewExtensionInfoPlist, /com\.local\.burrete10\.tsv/);
assert.match(previewExtensionInfoPlist, /com\.local\.burrete10\.smiles/);
assert.match(previewExtensionInfoPlist, /com\.local\.burrete10\.graphml/);
assert.match(previewExtensionInfoPlist, /com\.local\.burrete10\.fep-edge-list/);
assert.match(quickLookSupportedContentTypesBlock, /com\.local\.burrete10\.openmm-coordinate-artifact/);
assert.match(quickLookSupportedContentTypesBlock, /com\.local\.burrete10\.openmm-workflow-text-artifact/);
assert.match(appMetadata, /<string>graphml<\/string>/);
assert.match(appMetadata, /<string>edge<\/string>/);
assert.match(appMetadata, /com\.local\.burrete10\.graphml/);
assert.match(appMetadata, /com\.local\.burrete10\.fep-edge-list/);
assert.match(appMetadata, /com\.local\.burrete10\.openmm-coordinate-artifact/);
assert.match(appMetadata, /com\.local\.burrete10\.openmm-workflow-text-artifact/);
assert.match(tauriConfigSource, /"graphml"/);
assert.match(tauriConfigSource, /"edge"/);
assert.match(quickLookPreviewController, /shouldUseFepGraphMLPreview\(fileExtension: String, previewPlan: BurretePreviewPlan\?\)/);
assert.match(quickLookPreviewController, /\["graphml", "edge"\]\.contains\(fileExtension\.lowercased\(\)\)/);
assert.match(quickLookPreviewController, /detected\.previewMode=fep-graphml/);
assert.match(quickLookPreviewController, /layoutFepGraphMLPreview/);
assert.match(quickLookPreviewController, /webDirectory: webDirectory/);
assert.match(quickLookPreviewController, /requiresRDKit: true/);
assert.match(quickLookPreviewController, /molblock: graphMLMolblock\(label: label, atoms: atoms, bonds: bonds\)/);
assert.match(quickLookPreviewController, /private static func graphMLMolblock/);
assert.match(quickLookPreviewController, /private static func graphMLKekuleAromaticBondTypes/);
assert.match(quickLookPreviewController, /let denseMode = graph\.nodes\.count > 12/);
assert.match(quickLookPreviewController, /class="node-dot"/);
assert.match(quickLookPreviewController, /class="node-card"/);
assert.match(quickLookPreviewController, /class="node-molecule"/);
assert.match(quickLookPreviewController, /const fepNodeMolblocks =/);
assert.match(quickLookPreviewController, /<script src="preview-rdkit-wasm\.js"><\/script>/);
assert.match(quickLookPreviewController, /<script src="\.\.\/assets\/rdkit\/RDKit_minimal\.js"><\/script>/);
assert.match(quickLookPreviewController, /rdkit\.get_mol\(String\(entry\.molblock \|\| ''\)\)/);
assert.match(quickLookPreviewController, /mol\.set_new_coords\?\.\(\)/);
assert.match(quickLookPreviewController, /rdkitImages: rdkitImages/);
assert.match(quickLookPreviewController, /score: " \+ String\(format: "%\.3f", \$0\)/);
assert.match(quickLookPreviewController, /shouldUseTextArtifactPreview\(url: URL, fileExtension: String, previewPlan: BurretePreviewPlan\?\)/);
assert.match(quickLookPreviewController, /private static func isPreferredTextArtifact\(url: URL\) -> Bool \{[\s\S]*url\.lastPathComponent\.lowercased\(\) == "log\.lammps"/);
assert.match(quickLookPreviewController, /detected\.previewMode=text-artifact/);
assert.match(quickLookPreviewController, /textFallback\.originalError=/);
assert.doesNotMatch(installLocalScript, /broadPublicTypes/);
assert.match(installLocalScript, /let contentTypes = documentTypes\.flatMap/);
assert.match(installLocalScript, /for contentType in Set\(contentTypes\)/);
assert.match(installLocalScript, /Contents\/Resources\/ViewerWeb/);
assert.match(buildScript, /LOCAL_XYZRENDER_ENV="\$HOME\/\.local\/share\/uv\/tools\/xyzrender"/);
assert.match(buildScript, /bun run build:agent-shell/);
assert.match(updaterCommand, /sync_burrete_codex_plugin\(\)/);
assert.match(updaterCommand, /Contents\/Resources\/plugins\/burette-agent/);
assert.match(updaterCommand, /mcp" \/ "lib" \/ "server-bundle\.mjs/);
assert.doesNotMatch(updaterCommand, /"0\.1\.0"/);
assert.match(updaterCommand, /Education & Research/);
assert.match(updaterCommand, /codex plugin synced/);
assert.match(buildScript, /XYZRENDER_RUNTIME_PYTHON_PACKAGES=\("datamol==0\.12\.5"\)/);
assert.match(buildScript, /require_xyzrender_runtime_for_release\(\)\s*\{/);
assert.match(buildScript, /release builds require bundled xyzrender runtime source/);
assert.match(buildScript, /ensure_xyzrender_runtime_python_packages\(\)\s*\{/);
assert.match(buildScript, /uv pip install --python "\$LOCAL_XYZRENDER_ENV\/bin\/python3" "\$\{XYZRENDER_RUNTIME_PYTHON_PACKAGES\[@\]\}"/);
assert.match(buildScript, /import datamol/);
assert.match(buildScript, /bundle_xyzrender_runtime "\$TAURI_BUILT_APP"/);
assert.match(buildScript, /rsync -aL --delete "\$LOCAL_XYZRENDER_ENV\/" "\$runtime\/"/);
assert.match(buildScript, /Contents\/Resources\/xyzrender-runtime/);
assert.match(buildScript, /Contents\/Resources\/xyzrender-python/);
assert.doesNotMatch(buildScript, /bundle_quicklook_xyzrender_python/);
assert.doesNotMatch(buildScript, /rsync -aL --delete "\$source_runtime\/" "\$appex_runtime\/"/);
assert.doesNotMatch(buildScript, /rsync -aL --delete "\$source_python\/" "\$appex_python\/"/);
assert.doesNotMatch(buildScript, /Contents\/PlugIns\/BurretePreview\.appex\/Contents\/Resources\/xyzrender-runtime/);
assert.doesNotMatch(buildScript, /Contents\/PlugIns\/BurretePreview\.appex\/Contents\/Resources\/xyzrender-python/);
assert.match(buildScript, /bundle_quicklook_xyzrender_launcher\(\)/);
assert.match(buildScript, /Contents\/Resources\/xyzrender-python3/);
assert.doesNotMatch(buildScript, /Contents\/MacOS\/xyzrender-python3/);
assert.match(buildScript, /-name 'libpython3\*\.dylib'/);
assert.match(buildScript, /-name 'Python'/);
assert.match(buildScript, /Contents\/lib\/\{libpython3\*\.dylib,Python\}/);
assert.doesNotMatch(buildScript, /Contents\/lib\/libpython3\.13\.dylib/);
assert.doesNotMatch(buildScript, /ditto --norsrc --noextattr "\$python_root\/bin\/python3" "\$appex\/Contents\/Resources\/xyzrender-python3"/);
assert.doesNotMatch(buildScript, /ditto --norsrc --noextattr "\$source_python\/bin\/python3" "\$appex_launch_python"/);
assert.doesNotMatch(buildScript, /install_name_tool -change "@executable_path\/\.\.\/lib\/libpython3\.13\.dylib" "@executable_path\/libpython3\.13\.dylib"/);
assert.doesNotMatch(buildScript, /Contents\/MacOS\/xyzrender-python\/bin\/python3/);
assert.doesNotMatch(buildScript, /bundle_quicklook_xyzrender_runtime/);
assert.doesNotMatch(buildScript, /rsync -aL --delete "\$app_runtime\/" "\$appex_runtime\/"/);
assert.doesNotMatch(buildScript, /Quick Look bundled xyzrender runtime missing/);
assert.doesNotMatch(buildScript, /Quick Look bundled xyzrender python home missing/);
assert.doesNotMatch(buildScript, /Quick Look bundled xyzrender launch python missing/);
assert.match(buildScript, /\[ ! -f "\$PYTHON_ROOT\/bin\/python3" \]/);
assert.match(buildScript, /exec "\$PYTHON_ROOT\/bin\/python3" -m xyzrender\.cli "\$@"/);
assert.match(buildScript, /sign_bundled_xyzrender_runtime "\$TAURI_BUILT_APP"/);
assert.doesNotMatch(buildScript, /sign_quicklook_xyzrender_python/);
assert.match(buildScript, /sign_quicklook_xyzrender_launcher\(\)/);
assert.doesNotMatch(buildScript, /XYZRENDER_CODESIGN_ENTITLEMENTS/);
assert.doesNotMatch(buildScript, /codesign "\$\{CODESIGN_ARGS\[@\]\}" --entitlements "\$entitlements" "\$binary"/);
assert.match(buildScript, /assert_bundled_xyzrender_runtime "\$LOCAL_APP" "in build output"/);
assert.match(buildScript, /assert_bundled_xyzrender_runtime "\$VERIFY_APP" "before codesign verification"/);
assert.match(installLocalScript, /assert_bundled_xyzrender_runtime\(\)\s*\{/);
assert.match(installLocalScript, /assert_bundled_xyzrender_runner\(\)\s*\{/);
assert.doesNotMatch(installLocalScript, /assert_quicklook_xyzrender_python\(\)\s*\{/);
assert.doesNotMatch(installLocalScript, /sign_bundled_xyzrender_runtime\(\)\s*\{/);
assert.doesNotMatch(installLocalScript, /sign_quicklook_xyzrender_python\(\)\s*\{/);
assert.doesNotMatch(installLocalScript, /sign_xyzrender_binaries\(\)\s*\{/);
assert.doesNotMatch(installLocalScript, /find "\$@" -type f/);
assert.doesNotMatch(installLocalScript, /sign_bundled_xyzrender_runtime "\$STAGING_XYZRENDER_ENV" "\$STAGING_XYZRENDER_PYTHON"/);
assert.doesNotMatch(installLocalScript, /rsync -aL --delete "\$LOCAL_XYZRENDER_ENV\/" "\$STAGING_XYZRENDER_ENV\/"/);
assert.doesNotMatch(installLocalScript, /rsync -aL --delete "\$LOCAL_XYZRENDER_PYTHON_ROOT\/" "\$STAGING_XYZRENDER_PYTHON\/"/);
assert.doesNotMatch(installLocalScript, /APPEX_XYZRENDER/);
assert.doesNotMatch(installLocalScript, /rsync -aL --delete "\$STAGING_XYZRENDER_ENV\/" "\$STAGING_APPEX_XYZRENDER_ENV\/"/);
assert.doesNotMatch(installLocalScript, /rsync -aL --delete "\$STAGING_XYZRENDER_PYTHON\/" "\$STAGING_APPEX_XYZRENDER_PYTHON\/"/);
assert.doesNotMatch(installLocalScript, /Contents\/PlugIns\/BurretePreview\.appex\/Contents\/Resources\/xyzrender-runtime/);
assert.doesNotMatch(installLocalScript, /Contents\/PlugIns\/BurretePreview\.appex\/Contents\/Resources\/xyzrender-python/);
assert.doesNotMatch(installLocalScript, /bundle_quicklook_xyzrender_launcher\(\)/);
assert.match(installLocalScript, /Contents\/Resources\/xyzrender-python3/);
assert.doesNotMatch(installLocalScript, /Contents\/MacOS\/xyzrender-python3/);
assert.match(installLocalScript, /-name 'libpython3\*\.dylib'/);
assert.match(installLocalScript, /-name 'Python'/);
assert.match(installLocalScript, /Contents\/lib\/\{libpython3\*\.dylib,Python\}/);
assert.doesNotMatch(installLocalScript, /Contents\/lib\/libpython3\.13\.dylib/);
assert.match(installLocalScript, /SIGN_IDENTITY="\$\{BURRETE_CODESIGN_IDENTITY:--\}"/);
assert.match(installLocalScript, /CODESIGN_ARGS=\(--force --sign "\$SIGN_IDENTITY"\)/);
assert.doesNotMatch(installLocalScript, /XYZRENDER_CODESIGN_ENTITLEMENTS/);
assert.doesNotMatch(installLocalScript, /codesign "\$\{CODESIGN_ARGS\[@\]\}" --entitlements "\$entitlements" "\$binary"/);
assert.doesNotMatch(installLocalScript, /sign_quicklook_xyzrender_launcher\(\)/);
assert.match(installLocalScript, /codesign "\$\{CODESIGN_ARGS\[@\]\}" "\$STAGING_APPEX\/Contents\/Resources\/burrete-core-bridge"/);
assert.match(installLocalScript, /codesign "\$\{CODESIGN_ARGS\[@\]\}" --entitlements "\$ROOT\/PreviewExtension\/BurretePreview\.entitlements" "\$STAGING_APPEX"/);
assert.match(installLocalScript, /codesign "\$\{CODESIGN_ARGS\[@\]\}" "\$STAGING_DEST"/);
assert.doesNotMatch(installLocalScript, /codesign --force --deep --sign - "\$STAGING_DEST"/);
assert.match(installLocalScript, /codesign --verify --deep --strict "\$STAGING_DEST"/);
assert.match(installLocalScript, /run_bundled_xyzrender_help\(\)\s*\{/);
assert.match(installLocalScript, /local timeout_seconds=10/);
assert.match(installLocalScript, /return 124/);
assert.match(installLocalScript, /\[\[ "\$IS_DEV_FLAVOR" == "1" && "\$\{BURRETE_SKIP_XYZRENDER_RUNNER_CHECK:-0\}" == "1" \]\]/);
assert.match(installLocalScript, /for attempt in \$\(seq 1 6\)/);
assert.match(installLocalScript, /assert_bundled_xyzrender_runtime "\$STAGING_XYZRENDER_ENV" "\$STAGING_XYZRENDER_PYTHON" "from build output"/);
assert.match(installLocalScript, /local python="\$python_root\/bin\/python3"/);
assert.match(installLocalScript, /assert_bundled_xyzrender_runner "\$STAGING_XYZRENDER_ENV" "\$STAGING_XYZRENDER_PYTHON" "after app signing"/);
assert.doesNotMatch(installLocalScript, /\$STAGING_XYZRENDER_ENV\/bin\/xyzrender" --help/);
assert.match(previewXyzrender, /bundled_xyzrender_candidates_from_executable/);
assert.match(previewXyzrender, /Contents"\)\s*\.join\("Resources"\)\s*\.join\("xyzrender-runtime"\)/);
assert.match(previewXyzrender, /std::env::current_exe\(\)/);
assert.match(previewXyzrender, /fn xyzrender_batch_helper_launch/);
assert.match(previewXyzrender, /fn bundled_xyzrender_python_launch/);
assert.match(previewXyzrender, /join\("xyzrender-python"\)\s*\.join\("bin"\)\s*\.join\("python3"\)/);
assert.match(previewXyzrender, /\("PYTHONPATH", site_packages\.display\(\)\.to_string\(\)\)/);
assert.match(previewXyzrender, /surface_mode/);
assert.match(previewXyzrender, /paired_nci_surface_cube_path/);
assert.match(previewXyzrender, /"--esp"/);
assert.match(previewXyzrender, /"--nci-surf"/);
assert.match(previewRuntimeViewer, /"surfaceMode"/);

assert.match(tray, /fn status_image\(\) -> tauri::image::Image<'static>/);
assert.match(tray, /\.icon\(status_image\(\)\)/);
assert.match(tray, /\.icon_as_template\(true\)/);
assert.match(tray, /pub\(crate\) fn show_main_window/);
assert.match(tray, /pub\(crate\) fn hide_main_window/);
assert.match(tray, /tray\.new-window/);
assert.match(tray, /windows::open_new_workspace_window\(app\)/);
assert.match(tray, /const DEFAULT_MAIN_WINDOW_WIDTH: f64 = 1180\.0;/);
assert.match(tray, /const DEFAULT_MAIN_WINDOW_HEIGHT: f64 = 760\.0;/);
assert.match(tray, /fn normalize_main_window/);
assert.match(tray, /\.inner_size\(\)/);
assert.match(tray, /window\.set_size\(Size::Logical\(LogicalSize::new\(/);
assert.match(tray, /window\.center\(\)/);
assert.doesNotMatch(tray, /default_window_icon/);
assert.doesNotMatch(tray, /\.title\("B"\)/);
assert.match(lib, /mod windows;/);
assert.match(lib, /windows::focused_window_label\(app\)/);
assert.match(lib, /windows::show_window\(app, &window_label\)/);
assert.match(lib, /startup::signal_open_documents_for_window\(app, &window_label, paths\)/);
assert.match(windowsSource, /pub\(crate\) const MAIN_WINDOW_LABEL: &str = "main"/);
assert.match(windowsSource, /pub\(crate\) const WORKSPACE_WINDOW_PREFIX: &str = "workspace-"/);
assert.match(windowsSource, /WebviewWindowBuilder::new\(app, &label, url\)/);
assert.match(windowsSource, /index\.html\?burreteWindow=\{label\}/);
assert.match(windowsSource, /\.transparent\(true\)\s*\.background_color\(Color\(0, 0, 0, 0\)\)/);
assert.match(windowsSource, /Effect::HudWindow/);
assert.match(windowsSource, /EffectState::Active/);
assert.match(windowsSource, /pub\(crate\) fn runtime_document_id/);
assert.match(windowsSource, /unregister_prefix/);
assert.match(lib, /let launch_mode = startup::LaunchMode::current\(&argv\);/);
assert.match(lib, /launch_mode\.is_register\(\) && startup_paths\.is_empty\(\)/);
assert.match(lib, /tray::hide_main_window\(app\.handle\(\)\);/);
assert.match(lib, /tauri::ActivationPolicy::Regular/);
assert.match(lib, /tauri::ActivationPolicy::Accessory/);
assert.match(lib, /commands::documents::pick_open_targets/);
assert.match(lib, /commands::documents::open_documents/);
assert.match(lib, /commands::documents::sync_viewer_preferences/);
assert.match(lib, /commands::quicklook::reset_quick_look/);
assert.match(lib, /commands::updater::install_update/);
assert.match(menu, /PredefinedMenuItem::about/);
assert.match(menu, /PredefinedMenuItem::services/);
assert.match(menu, /PredefinedMenuItem::show_all/);
assert.match(menu, /SubmenuBuilder::new\(app, "Help"\)/);
for (const menuId of [
  'file.new-window',
  'file.open-recent',
  'file.reveal-active',
  'file.copy-active-path',
  'file.show-active-metadata',
  'file.export-preview-png',
  'file.export-preview-svg',
  'maintenance.clear-preview-cache',
  'maintenance.reset-quick-look',
  'maintenance.open-logs',
]) {
  assert.match(menu, new RegExp(menuId.replaceAll('.', '\\.')));
}
assert.match(menu, /New Window/);
assert.match(menu, /accelerator\("CmdOrCtrl\+Shift\+N"\)/);
for (const eventName of [
  'MENU_OPEN_RECENT_EVENT',
  'MENU_REVEAL_ACTIVE_EVENT',
  'MENU_COPY_ACTIVE_PATH_EVENT',
  'MENU_SHOW_ACTIVE_METADATA_EVENT',
  'MENU_EXPORT_PREVIEW_PNG_EVENT',
  'MENU_EXPORT_PREVIEW_SVG_EVENT',
  'MENU_CLEAR_PREVIEW_CACHE_EVENT',
  'MENU_RESET_QUICK_LOOK_EVENT',
  'MENU_OPEN_LOGS_EVENT',
]) {
  assert.match(menu, new RegExp(`pub\\(crate\\) const ${eventName}`));
  assert.match(lib, new RegExp(`menu::${eventName}`));
}
assert.match(menu, /Check for Updates/);
assert.match(menu, /short_version: Some\(pkg\.version\.to_string\(\)\)/);

for (const moduleName of ['runtime_grid', 'runtime_utils', 'runtime_viewer', 'trace']) {
  assert.match(previewIndex, new RegExp(`pub\\(crate\\) mod ${moduleName};`));
}
assert.match(previewIndex, /pub\(crate\) mod grid_store;/);

assert.match(previewRuntime, /pub\(crate\) fn open_document_for_window/);
assert.match(previewRuntime, /runtime_document_id\(window_label, &document_id\)/);
assert.match(documentsCommand, /window: tauri::WebviewWindow<R>/);
assert.match(gridCommand, /runtime_document_id\(window\.label\(\), &request\.document_id\)/);
assert.match(previewRuntime, /active_pose: Option<usize>/);
assert.match(previewRuntime, /request\.active_pose/);
assert.match(previewRuntime, /create_grid_runtime/);
assert.match(previewRuntime, /create_runtime/);
assert.match(previewFormats, /pub\(crate\) use burrete_core::\{/);
assert.match(burreteCoreSource, /"grid2d" \| "grid" \| "grid-2d" => "grid2d"/);
assert.doesNotMatch(previewRuntime, /fn parse_sdf_grid/);
assert.doesNotMatch(previewRuntime, /fn viewer_html/);
assert.match(previewRuntimeGrid, /pub\(crate\) fn create_grid_runtime/);
assert.match(previewRuntimeGrid, /build_grid_store/);
assert.match(previewRuntimeGrid, /include_single_sdf: options\.include_single_sdf\s*\|\|\s*normalize_renderer_mode\(&preferences\.renderer_mode\) == "grid2d"/);
assert.match(previewGridStore, /!options\.include_single_sdf\s*&& \(\(extension == "sdf" \|\| extension == "sd"\) && records_indexed <= 1\)/);
assert.match(previewRuntimeGrid, /"sourcePath": file_path\.to_string_lossy\(\)/);
assert.match(previewRuntimeGrid, /register\(\s*registry_document_id,\s*grid_store\.database_path,\s*collection\.format,\s*grid_store\.cancel_token,\s*\)/);
assert.match(previewRuntimeGrid, /"gridDataMode": "bridge"/);
assert.match(previewRuntimeGrid, /"recordsIndexed": collection\.records_indexed/);
assert.match(previewRuntimeGrid, /"indexReady": collection\.index_ready/);
assert.match(previewRuntimeGrid, /"recordsIncluded": 0/);
assert.match(previewRuntimeGrid, /runtime_manifest\(\s*"grid2d"/);
assert.match(previewRuntimeGrid, /write_json_atomic\(\s*&runtime\.join\("manifest\.json"\)/);
assert.doesNotMatch(previewRuntimeGrid, /preview-grid-records\.js/);
assert.match(previewRuntimeGrid, /fn parse_sdf_grid/);
assert.match(previewRuntimeGrid, /fn parse_delimited_table/);
assert.match(previewRuntimeViewer, /pub\(crate\) fn create_runtime/);
assert.match(previewRuntimeViewer, /runtime_manifest\(/);
assert.match(previewRuntimeViewer, /write_json_atomic\(\s*&runtime\.join\("manifest\.json"\)/);
assert.match(previewRuntimeViewer, /pub\(crate\) fn create_combined_sdf_pose_runtime/);
assert.match(previewRuntimeViewer, /"sourcePath": source_path/);
assert.match(previewRuntimeViewer, /"xyzrenderSourcePath": xyzrender_source_path/);
assert.match(previewRuntimeViewer, /"xyzrenderInputDataBase64"\]\s*=\s*json!\(\s*base64::engine::general_purpose::STANDARD\.encode\(input_data\)\s*\)/);
assert.match(previewRuntimeViewer, /"xyzrenderInputExtension"\]\s*=\s*json!\("xyz"\)/);
assert.match(previewRuntimeViewer, /"defaultSdfPoseMode": "all"/);
assert.match(previewRuntimeViewer, /"sdfPoseModeStorageKey": format!\("buret\.sdf\.poseMode\.\{document_id\}"\)/);
assert.match(previewRuntimeViewer, /active_pose: Option<usize>/);
assert.match(previewRuntimeViewer, /"activePose": active_pose/);
assert.match(previewRuntimeViewer, /pub\(crate\) fn copy_web_assets/);
assert.match(previewRuntimeViewer, /fn viewer_html/);
assert.doesNotMatch(previewRuntimeViewer, /fn viewer_runtime_css/);
assert.match(previewRuntimeViewer, /viewer-runtime\.css/);
assert.match(previewRuntimeViewer, /assets\.join\("viewer-runtime\.css"\)/);
assert.match(previewRuntimeViewer, /Content-Security-Policy/);
assert.match(previewRuntimeViewer, /const webkit = window\.webkit \|\| \{\};/);
assert.match(previewRuntimeViewer, /const messageHandlers = webkit\.messageHandlers \|\| \{\};/);
assert.match(previewRuntimeViewer, /if \(!messageHandlers\.burrete\) \{/);
assert.match(previewRuntimeViewer, /messageHandlers\.burrete = \{ postMessage: postToParent \};/);
assert.match(previewRuntimeViewer, /window\.__mqlAction = \(name\) => messageHandlers\.burrete\.postMessage/);
assert.match(previewRuntimeViewer, /window\.parent\.postMessage\(\{ source: 'burrete-viewer', body \}, '\*'\)/);
assert.doesNotMatch(previewRuntimeViewer, /window\.parent\.postMessage\(\{ source: 'burrete-viewer', body \}, window\.location\.origin\)/);
assert.match(previewRuntimeGrid, /Content-Security-Policy/);
assert.match(previewRuntimeGrid, /'unsafe-eval'/);
assert.match(previewRuntimeGrid, /'wasm-unsafe-eval'/);
assert.match(previewRuntimeGrid, /grid-ui-v10/);
assert.match(previewXyzrender, /std::env::current_exe\(\)/);
assert.match(previewXyzrender, /xyzrender-runtime/);
assert.match(gridViewerJS, /resetDocumentRuntimeState\(\);\n\s+state\.remoteMode = isRemoteMode\(cfg\);/);
assert.match(gridViewerJS, /buildUI\(cfg\);\n\s+refresh\(cfg\);\n\s+try \{\n\s+await initRDKit\(\);/);
assert.match(gridViewerJS, /if \(state\.cardRenderer === 'rdkit'\) \{\n\s+if \(state\.remoteMode\) \{\n\s+if \(state\.rows\.length\) void renderVirtualWindow\(cfg, state\.token, \{ force: true \}\);\n\s+\} else \{\n\s+render\(cfg\);\n\s+\}\n\s+\}/);
assert.match(gridViewerJS, /function supportsXyzrenderCards\(cfg\)/);
assert.match(gridViewerJS, /cfg\?\.appViewer === true && \(\s*cfg\?\.gridDataMode === 'bridge'/);
assert.doesNotMatch(gridViewerJS, /return \(cfg\?\.appViewer === true && cfg\?\.gridDataMode === 'bridge'\)\s*\|\|\s*\(typeof cfg\?\.xyzrenderEndpoint === 'string'/);
assert.match(previewRuntimeGrid, /"pageSize": 72/);
assert.match(moleculeGridPreview, /"pageSize": 48/);
assert.match(gridViewerJS, /hostRequest\('renderXyzrenderCard'/);
assert.match(gridViewerJS, /body\.type === 'gridPage' \|\| body\.type === 'xyzrenderCard'/);
assert.match(gridViewerJS, /body\.type === 'gridRecordsAppended'/);
assert.match(gridViewerJS, /void refreshRemote\(config\(\)\)/);
assert.match(gridViewerJS, /function xyzrenderFragmentText\(record\)/);
assert.match(gridViewerJS, /const smiles = firstLine\.trim\(\)\.split\(\/\\s\+\/u\)\[0\]/);
assert.match(gridViewerJS, /function xyzrenderCardInputText\(row, record\)/);
assert.match(gridViewerJS, /inputDataBase64: textToBase64\(xyzrenderCardInputText\(row, record\)\)/);
assert.match(gridViewerJS, /inputDataBase64: textToBase64\(xyzrenderCardInputText\(job\.row, job\.record\)\)/);
assert.match(gridViewerJS, /preset: currentXyzrenderPreset\(cfg\)/);
assert.match(gridViewerJS, /preset: currentXyzrenderPreset\(job\.cfg\)/);
assert.match(gridViewerJS, /function prepareXyzrenderCardSVG\(svg\)/);
assert.match(gridViewerJS, /markSVGForFitting\(html, 'data-buret-xyzrender-svg'\)/);
assert.match(gridViewerJS, /state\.cardRenderer = 'rdkit';\n\s+store\(CARD_RENDERER_STORAGE_KEY, 'rdkit'\);/);
assert.match(gridUiTSX, /dataAttribute="buret-grid-card-renderer"/);
assert.match(gridUiTSX, /value: "xyzrender"/);
assert.match(gridUiTSX, /id="xyzrender-preset"/);
assert.match(quickLookPreviewController, /<script src="preview-config\.js"><\/script>/);
assert.match(quickLookPreviewController, /gridRuntimeCSP/);
assert.match(quickLookPreviewController, /molstarRuntimeCSP/);
assert.match(quickLookPreviewController, /externalArtifactRuntimeCSP/);
assert.match(quickLookPreviewController, /surfaceMode/);
assert.match(quickLookPreviewController, /pairedNCISurfaceCubeURL/);
assert.match(quickLookPreviewController, /"--esp"/);
assert.match(quickLookPreviewController, /"--nci-surf"/);
assert.match(quickLookPreviewController, /runtimeCSP\(for: renderer\)/);
assert.match(quickLookPreviewController, /Content-Security-Policy/);
assert.match(quickLookPreviewController, /elapsed\.fileReadMs/);
assert.match(quickLookPreviewController, /elapsed\.assetValidationMs/);
assert.match(quickLookPreviewController, /elapsed\.runtimeWriteMs/);
assert.match(quickLookPreviewController, /elapsed\.wkLoadStartMs/);
assert.match(quickLookPreviewController, /elapsed\.jsReadyMs/);
assert.match(quickLookPreviewController, /elapsed\.renderCompleteMs/);
assert.match(quickLookPreviewController, /requiresRDKit: structurePreview\.renderer == BurreteRendererMode\.molstar/);
assert.match(quickLookPreviewController, /let rdkitWasmAsset: String/);
assert.match(quickLookPreviewController, /rdkitWasmAsset = """\s*<script src="preview-rdkit-wasm\.js"><\/script>/);
assert.match(quickLookPreviewController, /<script src="preview-rdkit-wasm\.js"><\/script>/);
assert.match(quickLookPreviewController, /burette-quicklook-host/);
assert.match(quickLookPreviewController, /window\.BurreteRDKitWasmBase64 = \\"\\\(wasmData\.base64EncodedString\(\)\)\\";\\n/);
assert.match(quickLookPreviewController, /molstarRuntimeCSP[^\n]*script-src[^\n]*'wasm-unsafe-eval'/);
assert.match(quickLookPreviewController, /payload\["rdkitWasmPath"\] = "\.\.\/assets\/rdkit\/RDKit_minimal\.wasm"/);
assert.doesNotMatch(quickLookPreviewController, /<script src="preview-data\.js"><\/script>/);
assert.doesNotMatch(quickLookPreviewController, /window\.BurreteDataBase64 = null;\\nwindow\.BurreteDataURL = null;\\n/);
assert.doesNotMatch(quickLookPreviewController, /window\.BurreteDataBase64 = \\"\\\(structureData\.base64EncodedString\(\)\)\\";\\nwindow\.BurreteDataURL = '\.\/preview-data\.bin';\\n/);
assert.doesNotMatch(quickLookPreviewController, /preview-data\.js"\), options: \[\.atomic\]/);
assert.match(quickLookPreviewController, /renderTimeoutWorkItem\?\.cancel\(\)/);
assert.match(quickLookPreviewController, /finishPreviewIfNeeded\(nil, requestID: requestID, cancelRenderTimeout: false\)/);
assert.match(quickLookPreviewController, /private func finishPreviewIfNeeded\(_ error: Error\?, requestID: UUID\? = nil, cancelRenderTimeout: Bool = true\)/);
assert.match(quickLookPreviewController, /private var previewSourceMonitor: DispatchSourceTimer\?/);
assert.match(quickLookPreviewController, /private var pendingPreviewSourceReloadWorkItem: DispatchWorkItem\?/);
assert.match(quickLookPreviewController, /startPreviewSourceMonitoring\(for: url\)/);
assert.match(quickLookPreviewController, /DispatchSource\.makeTimerSource/);
assert.match(quickLookPreviewController, /schedulePreviewSourceReload\(for: url, fingerprint: fingerprint\)/);
assert.match(quickLookPreviewController, /if type == "requestData" \{/);
assert.match(quickLookPreviewController, /handleJavaScriptStructureDataRequest\(body\)/);
assert.match(quickLookPreviewController, /window\.BurreteReceiveNativeData && window\.BurreteReceiveNativeData\(/);
assert.match(quickLookPreviewController, /PreviewError\.webRenderFailed\("The embedded WebKit process terminated while loading the Quick Look preview\."\)/);
assert.match(quickLookPreviewController, /finishPreviewIfNeeded\(nil, requestID: activePreviewRequestID\)/);
assert.match(quickLookPreviewController, /guard let url = currentPreviewURL else \{/);
assert.match(viewerJS, /function requestStructureDataFromNative\(\)/);
assert.match(viewerJS, /const fallbackKey = format === 'xyz' \? XYZ_FRAME_MODE_STORAGE_KEY : SDF_POSE_MODE_STORAGE_KEY/);
assert.match(viewerJS, /const storageKey = String\(config\?\.sdfPoseModeStorageKey \|\| fallbackKey\)/);
assert.match(viewerJS, /const defaultMode = sceneMode === 'structureAll' \? 'all' : 'single'/);
assert.match(viewerJS, /const stored = window\.localStorage\?\.getItem\(storageKey\);[\s\S]*if \(stored === 'all' \|\| stored === 'single'\) return stored;[\s\S]*return 'single';/);
assert.match(viewerJS, /window\.__mqlPost\('requestData', 'requestData', \{ requestToken \}\);/);
assert.match(viewerJS, /function loadArrayBufferViaXHR\(url\)/);
assert.match(viewerJS, /fetch preview-data\.bin failed, falling back to XMLHttpRequest/);
assert.match(viewerJS, /XMLHttpRequest preview-data\.bin failed, requesting native structure payload/);
assert.match(viewerJS, /window\.BurreteDataBytes = await loadArrayBufferViaXHR\(requestURL\);/);
assert.match(viewerJS, /setTimeout\(hideStatus, isQuickLookHost\(\) \? 0 : 700\);/);
assert.match(viewerJS, /if \(isQuickLookHost\(\)\) \{\s+setTimeout\(finish, 35\);\s+requestAnimationFrame\(finish\);\s+return;/);
assert.doesNotMatch(quickLookPreviewController, /BurreteLauncher\.open\(fileURL: url\)/);
assert.doesNotMatch(quickLookPreviewController, /launchViaExecutable\(fileURL: fileURL, appURL: appURL, fallbackError: error, completion: completion\)/);
assert.doesNotMatch(quickLookPreviewController, /appendingPathComponent\("burrete", isDirectory: false\)/);
assert.match(quickLookPreviewController, /BurreteRDKitWasmBase64/);
assert.match(previewRuntimeViewer, /"documentId": stable_id\(file_path\)/);
assert.match(previewRuntimeViewer, /runtime\.join\("preview-data\.bin"\)/);
assert.match(previewRuntimeViewer, /window\.BurreteDataBase64 = \\"\{\}\\";\\nwindow\.BurreteDataURL = null;\\n/);
assert.match(previewRuntimeViewer, /STANDARD\.encode\(&payload\.data\)/);
assert.match(previewRuntimeViewer, /window\.BurreteDockingPayloads = \{payload_text\};/);
assert.match(previewRuntimeViewer, /window\.BurretePreviewConfigURL = \{config_js:\?\};/);
assert.match(previewRuntimeViewer, /window\.BurretePreviewDataScriptURL = \{data_js:\?\};/);
assert.match(previewRuntimeViewer, /window\.BurreteDataURL = \{data_bin_js:\?\};/);
assert.match(previewRuntimeViewer, /let rdkit_js = asset_url\(&assets\.join\("rdkit\/RDKit_minimal\.js"\)\)/);
assert.match(previewRuntimeViewer, /let rdkit_wasm = asset_url\(&assets\.join\("rdkit\/RDKit_minimal\.wasm"\)\)/);
assert.match(previewRuntimeViewer, /window\.BurreteRDKitJSURL = \{rdkit_js:\?\};/);
assert.match(previewRuntimeViewer, /window\.BurreteRDKitWasmURL = \{rdkit_wasm:\?\};/);
assert.match(previewRuntimeViewer, /EMBEDDED_PREVIEW_DATA_SCRIPT_MAX_BYTES: usize = 32 \* 1024 \* 1024/);
assert.match(previewRuntimeViewer, /let include_data_script = should_embed_preview_data_script\(payload\.data\.len\(\)\);/);
assert.match(previewRuntimeViewer, /include_data_script: bool/);
assert.match(previewRuntimeViewer, /viewer_html\(\s*file_path,\s*&runtime,\s*&assets,\s*&renderer,\s*preferences,\s*include_data_script,\s*\)/);
assert.match(previewRuntimeViewer, /viewer_html\(&title_path, &runtime, &assets, "molstar", preferences, true\)/);
assert.match(previewRuntimeViewer, /VIEWER_MOLSTAR_CSP/);
assert.match(previewRuntimeViewer, /VIEWER_EXTERNAL_ARTIFACT_CSP/);
assert.match(previewRuntimeViewer, /worker-src 'none'/);
assert.match(previewRuntimeViewer, /fn viewer_csp\(renderer: &str\)/);
assert.match(previewRuntimeViewer, /<meta http-equiv="Content-Security-Policy" content="\{csp\}"/);
assert.match(previewRuntimeViewer, /window\.BurreteMolstarURL = \{molstar_js:\?\};/);
assert.doesNotMatch(previewRuntimeViewer, /BurreteXyzFastURL|xyz_fast_js/);
assert.match(previewGridStore, /pub\(crate\) struct GridRuntimeRegistry/);
assert.match(previewGridStore, /pub\(crate\) fn build_grid_store/);
assert.match(previewGridStore, /pub\(crate\) fn append_text/);
assert.match(previewGridStore, /fn append_grid_text/);
assert.match(previewGridStore, /fn fetch_page/);
assert.match(previewGridStore, /query\.limit\.clamp\(1, 240\)/);
assert.match(previewRuntimeGrid, /use base64::Engine;/);
assert.match(previewRuntimeGrid, /let rdkit_wasm = runtime\.join\("RDKit_minimal\.wasm"\)/);
assert.match(previewRuntimeGrid, /fs::copy\(assets\.join\("rdkit"\)\.join\("RDKit_minimal\.wasm"\), &rdkit_wasm\)/);
assert.match(previewRuntimeGrid, /window\.BurreteRDKitWasmBase64 =/);
assert.match(previewRuntimeGrid, /let rdkit_wasm_path = asset_url\(&rdkit_wasm\)/);
assert.match(previewRuntimeGrid, /"rdkitWasmPath": rdkit_wasm_path/);
assert.match(previewRuntimeGrid, /const GRID_RUNTIME_CSP/);
assert.match(previewRuntimeGrid, /'wasm-unsafe-eval'/);
assert.match(previewRuntimeGrid, /<meta http-equiv="Content-Security-Policy" content="\{GRID_RUNTIME_CSP\}"/);
assert.match(previewRuntimeGrid, /runtime\.join\("preview-rdkit-wasm\.js"\)/);
assert.match(previewRuntimeGrid, /<script src="\{rdkit_wasm_js\}"><\/script>/);
assert.match(previewRuntimeGrid, /assets\.join\("openchemlib"\)\.join\("openchemlib\.js"\)/);
assert.match(previewRuntimeGrid, /<script src="\{openchemlib_js\}"><\/script>/);
assert.match(previewRuntimeViewer, /body\.documentId = String\(window\.BurreteConfig\.documentId\)/);
assert.match(viewerRuntimeCSS, /--buret-toolbar-safe-top: 12px/);
assert.match(viewerRuntimeCSS, /--buret-viewport-controls-top: calc\(var\(--buret-toolbar-safe-top\) \+ 42px\)/);
assert.match(viewerRuntimeCSS, /#buret-toolbar\.collapsed/);
assert.match(viewerRuntimeCSS, /#buret-toolbar\.buret-suppressed-by-molstar-panel/);
assert.doesNotMatch(viewerRuntimeCSS, /#buret-toolbar\.collapsed:hover/);
assert.match(viewerRuntimeCSS, /\.buret-renderer-control\.visible/);
assert.match(viewerRuntimeCSS, /top: var\(--buret-viewport-controls-top\) !important/);
assert.match(viewerRuntimeCSS, /msp-layout-collapse-left\.msp-layout-hide-top\.msp-layout-hide-bottom/);
assert.match(viewerRuntimeCSS, /body\.burette-quicklook-host .msp-plugin .msp-layout-left/);
assert.match(previewRuntimeViewer, /viewer-shell\.js/);
assert.match(viewerShell, /buret-renderer-choice/);
assert.match(viewerShell, /aria-label="Collapse controls"/);
assert.match(viewerShell, /aria-expanded="true"/);
assert.match(viewerShell, />Seq</);
assert.match(viewerShell, /data-buret-action="sdf-poses"/);
assert.doesNotMatch(viewerShell, /id="buret-open-in-app"/);
assert.doesNotMatch(viewerShell, /data-buret-action="open-burrete"/);
assert.doesNotMatch(viewerShell, /VESTA/);
assert.match(viewerRuntimeCSS, /--buret-panel-background/);
assert.match(viewerRuntimeCSS, /\.buret-pose-toggle/);
assert.match(previewRuntimeUtils, /pub\(crate\) fn stable_id/);
assert.match(previewRuntimeUtils, /pub\(crate\) fn prune_runtime_dirs/);
assert.match(quickLookPreviewController, /viewer-runtime\.css/);
assert.match(quickLookPreviewController, /viewer-shell\.js/);
assert.match(viewerJS, /function appendCacheBuster\(url, cb\)/);
assert.match(viewerJS, /startsWith\('asset:\/\/'\)/);
assert.match(viewerJS, /function runtimeURL\(globalName, fallback\)/);
assert.match(viewerJS, /runtimeURL\('BurretePreviewConfigURL', '\.\/preview-config\.js'\)/);
assert.match(viewerJS, /runtimeURL\('BurretePreviewDataScriptURL', '\.\/preview-data\.js'\)/);
assert.match(viewerJS, /runtimeURL\('BurreteMolstarURL', '\.\/molstar\.js'\)/);
assert.match(viewerJS, /SDF_POSE_MODE_STORAGE_KEY/);
assert.match(viewerJS, /function buildSdfPoseOverlay/);
assert.match(viewerJS, /M  V30 BEGIN CTAB/);
assert.doesNotMatch(viewerJS, /BurreteXyzFastURL|xyz-fast\.js/);
assert.match(previewRuntimeViewer, /window\.__mqlPost = \(type, message, payload\) => postToParent\(\{ type, message: message \|\| '', \.\.\.\(payload \|\| \{\}\) \}\);/);
assert.match(viewerJS, /function isQuickLookHost\(\)/);
assert.match(viewerJS, /powerPreference: String\(activeConfig\?\.molstarPowerPreference \|\| ''\) === 'default' \|\| isQuickLookHost\(\)/);
