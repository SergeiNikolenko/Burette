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
  previewIndex,
  previewRuntime,
  previewRuntimeGrid,
  previewRuntimeViewer,
  previewRuntimeUtils,
  quickLookPreviewController,
] = await Promise.all([
  source('apps/desktop/src-tauri/src/commands/mod.rs'),
  source('apps/desktop/src-tauri/src/lib.rs'),
  source('apps/desktop/src-tauri/src/commands/startup.rs'),
  source('apps/desktop/src-tauri/src/commands/documents.rs'),
  source('apps/desktop/src-tauri/src/commands/preview_cache.rs'),
  source('apps/desktop/src-tauri/src/commands/shell.rs'),
  source('apps/desktop/src-tauri/src/commands/quicklook.rs'),
  source('apps/desktop/src-tauri/src/preview/mod.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_grid.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_viewer.rs'),
  source('apps/desktop/src-tauri/src/preview/runtime_utils.rs'),
  source('PreviewExtension/Platform/PreviewViewController.swift'),
]);

assert.equal(await exists('apps/desktop/src-tauri/src/commands.rs'), false);

for (const moduleName of ['documents', 'preview_cache', 'quicklook', 'shell', 'startup']) {
  assert.match(commandsIndex, new RegExp(`pub\\(crate\\) mod ${moduleName};`));
}

for (const commandPath of [
  'commands::startup::startup_documents',
  'commands::documents::open_documents',
  'commands::preview_cache::clear_preview_cache',
  'commands::shell::open_logs_folder',
  'commands::shell::open_external_url',
  'commands::quicklook::reset_quick_look',
]) {
  assert.match(lib, new RegExp(commandPath.replaceAll('::', '::')));
}

assert.match(startupCommand, /#\[tauri::command\]\s+pub\(crate\) fn startup_documents/);
assert.match(documentsCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_documents/);
assert.match(previewCacheCommand, /#\[tauri::command\]\s+pub\(crate\) fn clear_preview_cache/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_logs_folder/);
assert.match(shellCommand, /#\[tauri::command\]\s+pub\(crate\) fn open_external_url/);
assert.match(quickLookCommand, /#\[tauri::command\]\s+pub\(crate\) fn reset_quick_look/);

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
assert.match(previewRuntimeViewer, /--buret-toolbar-safe-top:12px/);
assert.match(previewRuntimeViewer, /#buret-toolbar\.collapsed/);
assert.doesNotMatch(previewRuntimeViewer, /#buret-toolbar\.collapsed:hover/);
assert.match(previewRuntimeViewer, /\.buret-renderer-control\.visible/);
assert.match(previewRuntimeViewer, /buret-renderer-choice/);
assert.match(previewRuntimeViewer, /aria-label="Collapse controls"/);
assert.match(previewRuntimeViewer, /aria-expanded="true"/);
assert.match(previewRuntimeViewer, /--buret-panel-bg/);
assert.match(previewRuntimeUtils, /pub\(crate\) fn stable_id/);
assert.match(previewRuntimeUtils, /pub\(crate\) fn prune_runtime_dirs/);
assert.doesNotMatch(quickLookPreviewController, /#buret-toolbar\.collapsed:hover/);
assert.match(quickLookPreviewController, /buret-renderer-choice/);
assert.match(quickLookPreviewController, /aria-label="Collapse controls"/);
assert.match(quickLookPreviewController, /aria-expanded="true"/);
