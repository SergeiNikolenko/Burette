#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function text(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function json(relativePath) {
  return JSON.parse(text(relativePath));
}

function appFilterExtensions(appSource) {
  const match = appSource.match(/extensions:\s*\[([^\]]+)\]/);
  assert.ok(match, 'App file-open filter extensions were not found.');
  return new Set([...match[1].matchAll(/"([^"]+)"/g)].map(([, extension]) => extension));
}

const manifest = json('docs/specs/formats.manifest.json');
const formats = manifest.formats;
const registry = json('config/preview-formats.json');
assert.equal(manifest.schemaVersion, 1);
assert.ok(Array.isArray(formats) && formats.length > 0);

const appExtensions = appFilterExtensions(text('apps/desktop/src/App.tsx'));
const rustGrid = text('apps/desktop/src-tauri/src/preview/runtime_grid.rs');
const appMetadata = text('apps/desktop/src-tauri/AppMetadata.plist');
const tauriConfig = json('apps/desktop/src-tauri/tauri.conf.json');
const tauriExtensions = new Set(tauriConfig.bundle.fileAssociations.flatMap((association) => association.ext || []));
const registryFormats = new Map(registry.formats.flatMap((format) => format.extensions.map((extension) => [extension, format])));

for (const format of formats) {
  assert.ok(format.name, 'Format name is required.');
  assert.ok(format.contentType, `${format.name}: contentType is required.`);
  assert.ok(Array.isArray(format.extensions) && format.extensions.length > 0, `${format.name}: extensions are required.`);

  for (const extension of format.extensions) {
    const registryFormat = registryFormats.get(extension);
    assert.ok(registryFormat, `${extension}: missing from canonical preview format registry.`);
    assert.equal(registryFormat.contentType, format.contentType, `${extension}: content type differs from canonical registry.`);
    assert.ok(appExtensions.has(extension), `${extension}: missing from app file-open filter.`);
    assert.match(appMetadata, new RegExp(`<string>${extension.replace('.', '\\.')}<\\/string>`), `${extension}: missing from AppMetadata.plist.`);
    if (format.bundleAssociation) {
      assert.ok(tauriExtensions.has(extension), `${extension}: missing from tauri fileAssociations.`);
    }
    if (format.quickLook) {
      assert.match(appMetadata, new RegExp(`<string>${format.contentType.replaceAll('.', '\\.')}<\\/string>`), `${extension}: missing content type from AppMetadata.plist.`);
    }
    if (format.renderer === 'grid2d') {
      assert.match(rustGrid, new RegExp(`"${extension}"`), `${extension}: missing from Rust grid runtime.`);
    }
  }
}

console.log('Format manifest is consistent.');
