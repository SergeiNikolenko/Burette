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
  documentsCommand,
  gridCommand,
  previewCacheCommand,
  shellCommand,
  performanceSource,
  shellActionsSource,
  settingsPanelSource,
  commandPaletteSource,
  quickLookCommand,
  updaterCommand,
  tray,
  rendererPolicySource,
  previewIndex,
  previewGridStore,
  previewRuntime,
  previewRuntimeGrid,
  previewRuntimeViewer,
  previewRuntimeUtils,
  previewFormats,
  previewXyzrender,
  quickLookPreviewController,
  moleculeGridPreview,
  viewerRuntimeCSS,
  viewerJS,
  gridViewerJS,
  gridUiTSX,
  viewerShell,
  tauriConfigSource,
  tauriPermissionSource,
  defaultCapabilitySource,
  buildScript,
  buildDevScript,
  ciScript,
  releaseWorkflow,
  releaseVersionCheck,
  releaseScript,
  releaseSignatureScript,
  signUpdateManifestScript,
  vendorMolstarScript,
  vendorRdkitScript,
  packageSource,
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
] = await Promise.all([
  source('apps/desktop/src-tauri/src/commands/mod.rs'),
  source('apps/desktop/src-tauri/src/lib.rs'),
  source('apps/desktop/src-tauri/src/menu.rs'),
  source('apps/desktop/src-tauri/src/startup.rs'),
  source('apps/desktop/src-tauri/src/commands/startup.rs'),
  source('apps/desktop/src-tauri/src/commands/documents.rs'),
  source('apps/desktop/src-tauri/src/commands/grid.rs'),
  source('apps/desktop/src-tauri/src/commands/preview_cache.rs'),
  source('apps/desktop/src-tauri/src/commands/shell.rs'),
  source('apps/desktop/src/lib/performance.ts'),
  source('apps/desktop/src/components/types.ts'),
  source('apps/desktop/src/components/settings-panel/index.tsx'),
  source('apps/desktop/src/components/command-palette/index.tsx'),
  source('apps/desktop/src-tauri/src/commands/quicklook.rs'),
  source('apps/desktop/src-tauri/src/commands/updater.rs'),
  source('apps/desktop/src-tauri/src/tray.rs'),
  source('PreviewExtension/RendererPolicy.swift'),
  source('apps/desktop/src-tauri/src/preview/mod.rs'),
  source('apps/desktop/src-tauri/src/preview/grid_store.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_grid.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_viewer.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_utils.rs'),
  source('apps/desktop/src-tauri/src/preview/formats.rs'),
  source('apps/desktop/src-tauri/src/preview/xyzrender.rs'),
  source('PreviewExtension/Platform/PreviewViewController.swift'),
  source('PreviewExtension/MoleculeGridPreview.swift'),
  source('PreviewExtension/Web/viewer-runtime.css'),
  source('PreviewExtension/Web/viewer.js'),
  source('PreviewExtension/Web/grid-viewer.js'),
  source('apps/desktop/src/preview-grid/grid-ui.tsx'),
  source('PreviewExtension/Web/viewer-shell.js'),
  source('apps/desktop/src-tauri/tauri.conf.json'),
  source('apps/desktop/src-tauri/permissions/burrete.toml'),
  source('apps/desktop/src-tauri/capabilities/default.json'),
  source('scripts/build.sh'),
  source('scripts/build-dev.sh'),
  source('scripts/ci.sh'),
  source('.github/workflows/release.yml'),
  source('scripts/check-release-version.mjs'),
  source('scripts/release.sh'),
  source('scripts/check-release-signature.sh'),
  source('scripts/sign-update-manifest.mjs'),
  source('scripts/vendor-molstar.mjs'),
  source('scripts/vendor-rdkit.mjs'),
  source('package.json'),
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
]);
const previewFormatsSource = previewFormats;

const tauriConfig = JSON.parse(tauriConfigSource);
const packageConfig = JSON.parse(packageSource);
const vendorAssetsLock = JSON.parse(vendorAssetsLockSource);
const webRuntimeProfiles = JSON.parse(webRuntimeProfilesSource);
const defaultCapability = JSON.parse(defaultCapabilitySource);
const mainWindowConfig = tauriConfig.app.windows.find((window) => window.label === 'main');

assert.equal(await exists('apps/desktop/src-tauri/src/commands.rs'), false);
assert.ok(mainWindowConfig);
assert.equal(mainWindowConfig.visible, true);
assert.equal(mainWindowConfig.windowEffects?.state, 'active');
assert.match(tauriConfig.app.security.csp, /'unsafe-eval'/);
assert.match(tauriConfig.app.security.csp, /'wasm-unsafe-eval'/);
assert.match(tauriConfig.app.security.csp, /style-src[^;]*'unsafe-inline'/);
assert.ok(defaultCapability.permissions.includes('dialog:allow-open'));
assert.ok(defaultCapability.permissions.includes('dialog:allow-message'));
assert.ok(defaultCapability.permissions.includes('dialog:allow-save'));
assert.match(tauriConfig.app.security.csp, /script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' asset: http:\/\/asset\.localhost/);
assert.match(previewEntitlements, /com\.apple\.security\.network\.client/);
assert.match(docsReadmeSource, /Performance architecture/);
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

for (const moduleName of ['documents', 'grid', 'preview_cache', 'quicklook', 'shell', 'startup', 'updater']) {
  assert.match(commandsIndex, new RegExp(`pub\\(crate\\) mod ${moduleName};`));
}

for (const commandPath of [
  'commands::startup::startup_documents',
  'commands::documents::pick_open_targets',
  'commands::documents::classify_open_paths',
  'commands::documents::open_documents',
  'commands::documents::open_delimited_grid_document',
  'commands::documents::read_structure_text',
  'commands::documents::open_text_structure',
  'commands::documents::save_text_as',
  'commands::grid::grid_fetch_page',
  'commands::grid::grid_append_records',
  'commands::grid::grid_delimited_columns',
  'commands::grid::grid_append_delimited_records',
  'commands::documents::render_xyzrender_sheet_item',
  'commands::documents::render_xyzrender_sheet_items',
  'commands::documents::sync_viewer_preferences',
  'commands::preview_cache::clear_preview_cache',
  'commands::shell::export_diagnostics_bundle',
  'commands::shell::open_logs_folder',
  'commands::shell::open_external_url',
  'commands::shell::read_external_preview_svg',
  'commands::shell::reveal_path',
  'commands::shell::write_base64_file',
  'commands::shell::write_text_file',
  'commands::quicklook::reset_quick_look',
  'commands::updater::install_update',
]) {
  assert.match(lib, new RegExp(commandPath.replaceAll('::', '::')));
  assert.match(tauriPermissionSource, new RegExp(`"${commandPath.split('::').at(-1)}"`));
}

assert.match(lib, /disable_macos_state_restoration\(\);/);
assert.match(lib, /ApplePersistenceIgnoreState/);
assert.match(lib, /NSQuitAlwaysKeepsWindows/);
assert.match(startupCommand, /#\[tauri::command\]\s+pub\(crate\) fn startup_documents/);
assert.match(startupSource, /pub\(crate\) enum LaunchMode/);
assert.match(startupSource, /BURRETE_LAUNCH_MODE/);
assert.match(startupSource, /--burrete-launch-mode=register/);
assert.match(startupSource, /arg == "--burrete-launch-mode"/);
assert.match(startupSource, /file_args_from_argv/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn pick_open_targets/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn classify_open_paths/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_documents/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_delimited_grid_document/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn read_structure_text/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_text_structure/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn save_text_as/);
assert.match(previewRuntime, /impl ViewerDocument \{\s*pub\(crate\) fn into_virtual\(mut self\) -> Self \{\s*self\.is_virtual = true;\s*self\s*\}\s*\}/);
assert.match(documentsCommand, /open_document\(&app, output_path, &preferences, reload_options\.as_ref\(\)\)\s*\.map\(\|document\| document\.into_virtual\(\)\)/);
assert.match(documentsCommand, /open_document\(&app, output_path, &preferences, None\)\s*\.map\(\|document\| document\.into_virtual\(\)\)/);
assert.match(gridCommand, /#\[tauri::command\]\s+pub\(crate\) fn grid_fetch_page/);
assert.match(gridCommand, /#\[tauri::command\]\s+pub\(crate\) fn grid_append_records/);
assert.match(gridCommand, /#\[tauri::command\]\s+pub\(crate\) fn grid_delimited_columns/);
assert.match(gridCommand, /#\[tauri::command\]\s+pub\(crate\) fn grid_append_delimited_records/);
assert.match(gridCommand, /struct GridAppendRequest/);
assert.match(gridCommand, /registry\.append_text/);
assert.match(gridCommand, /registry\.append_text_with_options/);
assert.match(previewGridStore, /fn resolve_smiles_column/);
assert.match(previewGridStore, /struct GridParseOptions/);
assert.match(previewGridStore, /struct GridDelimitedColumnChoice/);
assert.match(previewGridStore, /fn infer_smiles_columns_from_values/);
assert.match(previewGridStore, /fn delimited_smiles_column_choices/);
assert.match(previewGridStore, /multiple possible structure columns/);
assert.match(previewGridStore, /fn rejects_ambiguous_delimited_structure_columns/);
assert.match(previewGridStore, /fn uses_explicit_column_for_ambiguous_delimited_table/);
assert.match(previewGridStore, /fn lists_delimited_structure_column_choices/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn sync_viewer_preferences/);
assert.match(documentsCommand, /"molstarStyle"/);
assert.match(documentsCommand, /fn expand_open_targets/);
assert.match(documentsCommand, /fn collect_supported_files/);
assert.match(documentsCommand, /fn looks_like_supported_structure_file/);
assert.match(previewCacheCommand, /#\[tauri::command\]\s+pub\(crate\) fn clear_preview_cache/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn export_diagnostics_bundle/);
assert.match(shellCommand, /timestamp level subsystem documentId event elapsedMs message/);
assert.match(shellCommand, /BurreteApp\.log/);
assert.match(shellCommand, /quicklook-logs/);
assert.match(shellCommand, /rawMoleculeContentIncluded/);
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
assert.match(quickLookCommand, /QuickLookResetReport/);
assert.match(quickLookCommand, /\.output\(\)/);
assert.doesNotMatch(quickLookCommand, /\.spawn\(\)/);
assert.match(buildScript, /does not accept positional arguments/);
assert.match(buildScript, /BURRETE_BUILD_MODE/);
assert.match(buildScript, /BURRETE_DEV_FLAVOR/);
assert.match(buildScript, /dev-namespace\.mjs" patch-tree "\$SAFE_ROOT"/);
assert.match(buildScript, /Developer ID Application:/);
assert.match(buildScript, /hardenedRuntime/);
assert.match(buildScript, /cargo build --release --bin burrete-core-bridge/);
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
assert.match(releaseWorkflow, /BURRETE_UPDATE_MANIFEST_PUBLIC_KEY_HEX/);
assert.match(releaseWorkflow, /BURRETE_UPDATE_MANIFEST_PRIVATE_KEY_PEM/);
assert.match(releaseWorkflow, /BURRETE_BUILD_MODE: release/);
assert.match(releaseWorkflow, /allow_adhoc=true/);
assert.match(releaseWorkflow, /BURRETE_RELEASE_ALLOW_ADHOC/);
assert.match(releaseWorkflow, /hdiutil create -volname Burrete/);
assert.match(releaseWorkflow, /zip\.manifest\.json/);
assert.match(releaseWorkflow, /zip\.manifest\.json\.sig/);
assert.match(releaseWorkflow, /prerelease=true/);
assert.match(releaseWorkflow, /release_flags\+\=\(--prerelease\)/);
assert.match(releaseScript, /sign-update-manifest\.mjs/);
assert.match(releaseScript, /--dry-run/);
assert.match(releaseScript, /BURRETE_BUILD_MODE=release/);
assert.match(releaseScript, /notarytool submit/);
assert.match(releaseScript, /stapler staple/);
assert.match(releaseScript, /hdiutil create -volname Burrete/);
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
assert.equal(packageConfig.scripts['test:update'], 'bun tests/test-update-versioning.mjs && bun tests/test-bun-installer-structure.mjs && bun tests/test-bun-installer-behavior.mjs && bun tests/test-runner-contract.mjs && bun tests/test-dev-namespace.mjs && bun tests/test-quicklook-preview-smoke-contract.mjs');
assert.match(packageConfig.scripts['check:js'], /scripts\/dev-namespace\.mjs/);
assert.match(buildScript, /BURRETE_DEV_FLAVOR/);
assert.match(buildScript, /bun "\$ROOT\/scripts\/dev-namespace\.mjs" shell-env/);
assert.match(buildScript, /LOCAL_APP="\$ROOT\/build\/\$BURRETE_APP_BUNDLE_NAME"/);
assert.match(buildScript, /bun "\$ROOT\/scripts\/dev-namespace\.mjs" patch-tree "\$SAFE_ROOT"/);
assert.match(buildDevScript, /BURRETE_DEV_FLAVOR is supported by scripts\/build\.sh, not scripts\/build-dev\.sh/);
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
assert.match(rendererPolicySource, /enum BurreteCoreBridge/);
assert.match(rendererPolicySource, /supported-extension/);
assert.match(rendererPolicySource, /resolve-renderer/);
assert.match(rendererPolicySource, /Bundle\(for: PreviewViewController\.self\)/);
assert.match(quickLookPreviewController, /BurreteCoreBridge\.supportedExtension\(pathExtension\)/);
assert.match(quickLookPreviewController, /BurreteCoreBridge\.quickLookSizeLimit\(fileExtension: fileExtension\)/);
assert.match(quickLookPreviewController, /BurreteCoreBridge\.format\(fileExtension: ext\)/);
assert.match(xcodeProjectSource, /BurreteThumbnail/);
assert.match(xcodeProjectSource, /ThumbnailProvider\.swift in Sources/);
assert.match(xcodeProjectSource, /INFOPLIST_FILE = PreviewExtension\/ThumbnailInfo\.plist/);
assert.match(xcodeThumbnailScheme, /BlueprintName = "BurreteThumbnail"/);
assert.match(xcodeThumbnailScheme, /BuildableName = "BurreteThumbnail\.appex"/);
assert.match(thumbnailInfoPlist, /com\.apple\.quicklook\.thumbnail/);
assert.match(thumbnailInfoPlist, /ThumbnailProvider/);
assert.match(thumbnailInfoPlist, /com\.local\.burrete10\.pdb/);
assert.match(thumbnailInfoPlist, /com\.local\.burrete10\.sdf/);
assert.match(thumbnailInfoPlist, /com\.local\.burrete10\.xyz/);
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
assert.equal(vendorAssetsLock.assets.length, 4);
for (const asset of vendorAssetsLock.assets) {
  assert.match(asset.sha256, /^sha256-/);
  assert.ok(asset.bytes > 0);
}
assert.equal(webRuntimeProfiles.schemaVersion, 1);
assert.equal(webRuntimeProfiles.sourceRoot, 'PreviewExtension/Web');
assert.deepEqual(vendorAssetsLock.profiles, webRuntimeProfiles.profiles);
assert.deepEqual(vendorAssetsLock.bundleTargets, webRuntimeProfiles.bundleTargets);
assert.ok(webRuntimeProfiles.profiles['desktop-molstar'].includes('molstar.js'));
assert.ok(webRuntimeProfiles.profiles['desktop-grid'].includes('rdkit/RDKit_minimal.wasm'));
assert.ok(webRuntimeProfiles.profiles['quicklook-molstar'].includes('viewer.js'));
assert.ok(webRuntimeProfiles.profiles['quicklook-grid'].includes('grid-viewer.js'));
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
assert.match(appInfoPlist, /<key>LSUIElement<\/key>\s*<false\/>/);
assert.match(releaseVersionCheck, /semver release or prerelease/);
assert.match(appMetadata, /<key>LSHandlerRank<\/key>\s*<string>Alternate<\/string>/);
assert.match(appMetadata, /<key>CFBundleTypeName<\/key>\s*<string>Molecular grid tables<\/string>/);
assert.match(appMetadata, /<key>LSHandlerRank<\/key>\s*<string>Owner<\/string>/);
assert.match(previewExtensionInfoPlist, /public\.comma-separated-values-text/);
assert.match(previewExtensionInfoPlist, /public\.tab-separated-values-text/);
assert.match(previewExtensionInfoPlist, /com\.local\.burrete10\.smiles/);
assert.doesNotMatch(installLocalScript, /broadPublicTypes/);
assert.match(installLocalScript, /let contentTypes = documentTypes\.flatMap/);
assert.match(installLocalScript, /for contentType in Set\(contentTypes\)/);
assert.match(installLocalScript, /Contents\/Resources\/ViewerWeb/);
assert.match(installLocalScript, /assert_bundled_xyzrender_runtime\(\)\s*\{/);
assert.match(installLocalScript, /assert_bundled_xyzrender_runner\(\)\s*\{/);
assert.match(installLocalScript, /sign_bundled_xyzrender_runtime\(\)\s*\{/);
assert.match(installLocalScript, /find "\$runtime" "\$python_root" -type f/);
assert.match(installLocalScript, /sign_bundled_xyzrender_runtime "\$STAGING_XYZRENDER_ENV" "\$STAGING_XYZRENDER_PYTHON"/);
assert.match(installLocalScript, /codesign --force --sign - --entitlements "\$ROOT\/PreviewExtension\/BurretePreview\.entitlements" "\$STAGING_APPEX"/);
assert.match(installLocalScript, /codesign --force --sign - "\$STAGING_DEST"/);
assert.doesNotMatch(installLocalScript, /codesign --force --deep --sign - "\$STAGING_DEST"/);
assert.match(installLocalScript, /codesign --verify --deep --strict "\$STAGING_DEST"/);
assert.match(installLocalScript, /for attempt in \$\(seq 1 60\)/);
assert.match(installLocalScript, /assert_bundled_xyzrender_runtime "\$STAGING_XYZRENDER_ENV" "\$STAGING_XYZRENDER_PYTHON" "before signing"/);
assert.match(installLocalScript, /assert_bundled_xyzrender_runner "\$STAGING_XYZRENDER_ENV" "\$STAGING_XYZRENDER_PYTHON" "after signing"/);
assert.doesNotMatch(installLocalScript, /\$STAGING_XYZRENDER_ENV\/bin\/xyzrender" --help/);
assert.match(previewXyzrender, /bundled_xyzrender_candidates_from_executable/);
assert.match(previewXyzrender, /Contents"\)\s*\.join\("Resources"\)\s*\.join\("xyzrender-runtime"\)/);
assert.match(previewXyzrender, /std::env::current_exe\(\)/);
assert.match(previewXyzrender, /fn xyzrender_batch_helper_launch/);
assert.match(previewXyzrender, /fn bundled_xyzrender_python_launch/);
assert.match(previewXyzrender, /join\("xyzrender-python"\)\s*\.join\("bin"\)\s*\.join\("python3"\)/);
assert.match(previewXyzrender, /\("PYTHONPATH", site_packages\.display\(\)\.to_string\(\)\)/);

assert.match(tray, /fn status_image\(\) -> tauri::image::Image<'static>/);
assert.match(tray, /\.icon\(status_image\(\)\)/);
assert.match(tray, /\.icon_as_template\(true\)/);
assert.match(tray, /pub\(crate\) fn show_main_window/);
assert.match(tray, /pub\(crate\) fn hide_main_window/);
assert.match(tray, /const DEFAULT_MAIN_WINDOW_WIDTH: f64 = 1180\.0;/);
assert.match(tray, /const DEFAULT_MAIN_WINDOW_HEIGHT: f64 = 760\.0;/);
assert.match(tray, /fn normalize_main_window/);
assert.match(tray, /\.inner_size\(\)/);
assert.match(tray, /window\.set_size\(Size::Logical\(LogicalSize::new\(/);
assert.match(tray, /window\.center\(\)/);
assert.doesNotMatch(tray, /default_window_icon/);
assert.doesNotMatch(tray, /\.title\("B"\)/);
assert.match(lib, /if !paths\.is_empty\(\) \{\s*tray::show_main_window\(app\);/);
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

for (const moduleName of ['runtime_grid', 'runtime_utils', 'runtime_viewer']) {
  assert.match(previewIndex, new RegExp(`pub\\(crate\\) mod ${moduleName};`));
}
assert.match(previewIndex, /pub\(crate\) mod grid_store;/);

assert.match(previewRuntime, /pub\(crate\) fn open_document/);
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
assert.match(previewRuntimeGrid, /include_single_sdf: normalize_renderer_mode\(&preferences\.renderer_mode\) == "grid2d"/);
assert.match(previewGridStore, /!options\.include_single_sdf\s*&& \(\(extension == "sdf" \|\| extension == "sd"\) && records_indexed <= 1\)/);
assert.match(previewRuntimeGrid, /"sourcePath": file_path\.to_string_lossy\(\)/);
assert.match(previewRuntimeGrid, /register\(\s*document_id,\s*grid_store\.database_path,\s*collection\.format,\s*grid_store\.cancel_token,\s*\)/);
assert.match(previewRuntimeGrid, /"gridDataMode": "bridge"/);
assert.match(previewRuntimeGrid, /"recordsIndexed": collection\.records_indexed/);
assert.match(previewRuntimeGrid, /"indexReady": collection\.index_ready/);
assert.match(previewRuntimeGrid, /"recordsIncluded": 0/);
assert.doesNotMatch(previewRuntimeGrid, /preview-grid-records\.js/);
assert.match(previewRuntimeGrid, /fn parse_sdf_grid/);
assert.match(previewRuntimeGrid, /fn parse_delimited_table/);
assert.match(previewRuntimeViewer, /pub\(crate\) fn create_runtime/);
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
assert.match(gridViewerJS, /inputDataBase64: textToBase64\(xyzrenderFragmentText\(record\)\)/);
assert.match(gridViewerJS, /function prepareXyzrenderCardSVG\(svg\)/);
assert.match(gridViewerJS, /markSVGForFitting\(html, 'data-buret-xyzrender-svg'\)/);
assert.match(gridViewerJS, /state\.cardRenderer = 'rdkit';\n\s+store\(CARD_RENDERER_STORAGE_KEY, 'rdkit'\);/);
assert.match(gridUiTSX, /data-buret-grid-card-renderer="xyzrender"/);
assert.match(quickLookPreviewController, /<script src="preview-config\.js"><\/script>/);
assert.match(quickLookPreviewController, /gridRuntimeCSP/);
assert.match(quickLookPreviewController, /molstarRuntimeCSP/);
assert.match(quickLookPreviewController, /externalArtifactRuntimeCSP/);
assert.match(quickLookPreviewController, /runtimeCSP\(for: renderer\)/);
assert.match(quickLookPreviewController, /Content-Security-Policy/);
assert.match(quickLookPreviewController, /elapsed\.fileReadMs/);
assert.match(quickLookPreviewController, /elapsed\.assetValidationMs/);
assert.match(quickLookPreviewController, /elapsed\.runtimeWriteMs/);
assert.match(quickLookPreviewController, /elapsed\.wkLoadStartMs/);
assert.match(quickLookPreviewController, /elapsed\.jsReadyMs/);
assert.match(quickLookPreviewController, /elapsed\.renderCompleteMs/);
assert.doesNotMatch(quickLookPreviewController, /<script src="preview-rdkit-wasm\.js"><\/script>/);
assert.match(quickLookPreviewController, /burette-quicklook-host/);
assert.doesNotMatch(quickLookPreviewController, /window\.BurreteRDKitWasmBase64 = \\"\\\(wasmData\.base64EncodedString\(\)\)\\";\\n/);
assert.match(quickLookPreviewController, /payload\["rdkitWasmPath"\] = "\.\.\/assets\/rdkit\/RDKit_minimal\.wasm"/);
assert.doesNotMatch(quickLookPreviewController, /<script src="preview-data\.js"><\/script>/);
assert.doesNotMatch(quickLookPreviewController, /window\.BurreteDataBase64 = null;\\nwindow\.BurreteDataURL = null;\\n/);
assert.doesNotMatch(quickLookPreviewController, /window\.BurreteDataBase64 = \\"\\\(structureData\.base64EncodedString\(\)\)\\";\\nwindow\.BurreteDataURL = '\.\/preview-data\.bin';\\n/);
assert.doesNotMatch(quickLookPreviewController, /preview-data\.js"\), options: \[\.atomic\]/);
assert.match(quickLookPreviewController, /renderTimeoutWorkItem\?\.cancel\(\)/);
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
assert.doesNotMatch(quickLookPreviewController, /BurreteRDKitWasmBase64/);
assert.match(previewRuntimeViewer, /"documentId": stable_id\(file_path\)/);
assert.match(previewRuntimeViewer, /runtime\.join\("preview-data\.bin"\)/);
assert.match(previewRuntimeViewer, /window\.BurreteDataBase64 = \\"\{\}\\";\\nwindow\.BurreteDataURL = null;\\n/);
assert.match(previewRuntimeViewer, /STANDARD\.encode\(&payload\.data\)/);
assert.match(previewRuntimeViewer, /window\.BurreteDockingPayloads = \{payload_text\};/);
assert.match(previewRuntimeViewer, /window\.BurretePreviewConfigURL = \{config_js:\?\};/);
assert.match(previewRuntimeViewer, /window\.BurretePreviewDataScriptURL = \{data_js:\?\};/);
assert.match(previewRuntimeViewer, /window\.BurreteDataURL = \{data_bin_js:\?\};/);
assert.match(previewRuntimeViewer, /include_data_script: bool/);
assert.match(previewRuntimeViewer, /viewer_html\(file_path, &runtime, &assets, &renderer, preferences, true\)/);
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
assert.match(previewRuntimeViewer, /body\.documentId = String\(window\.BurreteConfig\.documentId\)/);
assert.match(viewerRuntimeCSS, /--buret-toolbar-safe-top: 12px/);
assert.match(viewerRuntimeCSS, /--buret-viewport-controls-top: 64px/);
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
assert.doesNotMatch(viewerShell, /id="buret-open-in-app"/);
assert.doesNotMatch(viewerShell, /data-buret-action="open-burrete"/);
assert.doesNotMatch(viewerShell, /VESTA/);
assert.match(viewerRuntimeCSS, /--buret-panel-background/);
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
assert.doesNotMatch(viewerJS, /BurreteXyzFastURL|xyz-fast\.js/);
assert.match(previewRuntimeViewer, /window\.__mqlPost = \(type, message, payload\) => postToParent\(\{ type, message: message \|\| '', \.\.\.\(payload \|\| \{\}\) \}\);/);
assert.match(viewerJS, /function isQuickLookHost\(\)/);
assert.match(viewerJS, /powerPreference: isQuickLookHost\(\) \? 'default' : 'high-performance'/);
