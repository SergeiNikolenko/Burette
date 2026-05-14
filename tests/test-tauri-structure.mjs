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
  startupCommand,
  documentsCommand,
  previewCacheCommand,
  shellCommand,
  quickLookCommand,
  updaterCommand,
  tray,
  previewIndex,
  previewRuntime,
  previewRuntimeGrid,
  previewRuntimeViewer,
  previewRuntimeUtils,
  quickLookPreviewController,
  viewerRuntimeCSS,
  viewerShell,
  tauriConfigSource,
  tauriPermissionSource,
] = await Promise.all([
  source('apps/desktop/src-tauri/src/commands/mod.rs'),
  source('apps/desktop/src-tauri/src/lib.rs'),
  source('apps/desktop/src-tauri/src/commands/startup.rs'),
  source('apps/desktop/src-tauri/src/commands/documents.rs'),
  source('apps/desktop/src-tauri/src/commands/preview_cache.rs'),
  source('apps/desktop/src-tauri/src/commands/shell.rs'),
  source('apps/desktop/src-tauri/src/commands/quicklook.rs'),
  source('apps/desktop/src-tauri/src/commands/updater.rs'),
  source('apps/desktop/src-tauri/src/tray.rs'),
  source('apps/desktop/src-tauri/src/preview/mod.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_grid.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_viewer.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_utils.rs'),
  source('PreviewExtension/Platform/PreviewViewController.swift'),
  source('PreviewExtension/Web/viewer-runtime.css'),
  source('PreviewExtension/Web/viewer-shell.js'),
  source('apps/desktop/src-tauri/tauri.conf.json'),
  source('apps/desktop/src-tauri/permissions/burrete.toml'),
]);

const tauriConfig = JSON.parse(tauriConfigSource);
const mainWindowConfig = tauriConfig.app.windows.find((window) => window.label === 'main');

assert.equal(await exists('apps/desktop/src-tauri/src/commands.rs'), false);
assert.ok(mainWindowConfig);
assert.equal(mainWindowConfig.windowEffects?.state, 'active');

for (const moduleName of ['documents', 'preview_cache', 'quicklook', 'shell', 'startup', 'updater']) {
  assert.match(commandsIndex, new RegExp(`pub\\(crate\\) mod ${moduleName};`));
}

for (const commandPath of [
  'commands::startup::startup_documents',
  'commands::documents::open_documents',
  'commands::preview_cache::clear_preview_cache',
  'commands::shell::open_logs_folder',
  'commands::shell::open_external_url',
  'commands::quicklook::reset_quick_look',
  'commands::updater::install_update',
]) {
  assert.match(lib, new RegExp(commandPath.replaceAll('::', '::')));
  assert.match(tauriPermissionSource, new RegExp(`"${commandPath.split('::').at(-1)}"`));
}

assert.match(startupCommand, /#\[tauri::command\]\s+pub\(crate\) fn startup_documents/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_documents/);
assert.match(previewCacheCommand, /#\[tauri::command\]\s+pub\(crate\) fn clear_preview_cache/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_logs_folder/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_external_url/);
assert.match(quickLookCommand, /#\[tauri::command\]\s+pub\(crate\) fn reset_quick_look/);
assert.match(updaterCommand, /#\[tauri::command\]\s+pub\(crate\) async fn install_update/);

assert.match(tray, /fn status_image\(\) -> tauri::image::Image<'static>/);
assert.match(tray, /\.icon\(status_image\(\)\)/);
assert.match(tray, /\.icon_as_template\(true\)/);
assert.doesNotMatch(tray, /default_window_icon/);
assert.doesNotMatch(tray, /\.title\("B"\)/);

for (const moduleName of ['runtime_grid', 'runtime_utils', 'runtime_viewer']) {
  assert.match(previewIndex, new RegExp(`pub\\(crate\\) mod ${moduleName};`));
}

assert.match(previewRuntime, /pub\(crate\) fn open_document/);
assert.match(previewRuntime, /create_grid_runtime/);
assert.match(previewRuntime, /create_runtime/);
assert.doesNotMatch(previewRuntime, /fn parse_sdf_grid/);
assert.doesNotMatch(previewRuntime, /fn viewer_html/);
assert.match(previewRuntimeGrid, /pub\(crate\) fn create_grid_runtime/);
assert.match(previewRuntimeGrid, /fn parse_sdf_grid/);
assert.match(previewRuntimeGrid, /fn parse_delimited_table/);
assert.match(previewRuntimeViewer, /pub\(crate\) fn create_runtime/);
assert.match(previewRuntimeViewer, /pub\(crate\) fn copy_web_assets/);
assert.match(previewRuntimeViewer, /fn viewer_html/);
assert.doesNotMatch(previewRuntimeViewer, /fn viewer_runtime_css/);
assert.match(previewRuntimeViewer, /viewer-runtime\.css/);
assert.match(previewRuntimeViewer, /assets\.join\("viewer-runtime\.css"\)/);
assert.match(viewerRuntimeCSS, /--buret-toolbar-safe-top: 12px/);
assert.match(viewerRuntimeCSS, /--buret-viewport-controls-top: 64px/);
assert.match(viewerRuntimeCSS, /#buret-toolbar\.collapsed/);
assert.match(viewerRuntimeCSS, /#buret-toolbar\.buret-suppressed-by-molstar-panel/);
assert.doesNotMatch(viewerRuntimeCSS, /#buret-toolbar\.collapsed:hover/);
assert.match(viewerRuntimeCSS, /\.buret-renderer-control\.visible/);
assert.match(viewerRuntimeCSS, /top: var\(--buret-viewport-controls-top\) !important/);
assert.match(viewerRuntimeCSS, /msp-layout-collapse-left\.msp-layout-hide-top\.msp-layout-hide-bottom/);
assert.match(previewRuntimeViewer, /viewer-shell\.js/);
assert.match(viewerShell, /buret-renderer-choice/);
assert.match(viewerShell, /aria-label="Collapse controls"/);
assert.match(viewerShell, /aria-expanded="true"/);
assert.match(viewerShell, />Seq</);
assert.doesNotMatch(viewerShell, /VESTA/);
assert.match(viewerRuntimeCSS, /--buret-panel-background/);
assert.match(previewRuntimeUtils, /pub\(crate\) fn stable_id/);
assert.match(previewRuntimeUtils, /pub\(crate\) fn prune_runtime_dirs/);
assert.match(quickLookPreviewController, /viewer-runtime\.css/);
assert.match(quickLookPreviewController, /viewer-shell\.js/);
