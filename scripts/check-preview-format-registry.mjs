#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const registry = JSON.parse(readFileSync('config/preview-formats.json', 'utf8'));

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function assertSameSet(actual, expected, label) {
  assert.deepEqual(sorted(actual), sorted(expected), label);
}

function plist(path) {
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', path], {
    encoding: 'utf8',
  });
  return JSON.parse(json);
}

const workspaceManifest = readFileSync('pnpm-workspace.yaml', 'utf8');
assert.match(workspaceManifest, /packages:\n  - apps\/\*/);
assert.doesNotMatch(workspaceManifest, /packages\/\*/);
assert.doesNotMatch(workspaceManifest, /tools\/\*/);

const appInfo = plist('apps/desktop/src-tauri/AppMetadata.plist');
const appDocumentType = appInfo.CFBundleDocumentTypes?.[0] ?? {};
assertSameSet(
  appDocumentType.CFBundleTypeExtensions ?? [],
  registry.documentTypes.extensions,
  'AppMetadata CFBundleTypeExtensions must match preview format registry',
);
assertSameSet(
  appDocumentType.LSItemContentTypes ?? [],
  registry.quickLook.contentTypes,
  'AppMetadata LSItemContentTypes must match preview format registry',
);
assertSameSet(
  (appInfo.UTExportedTypeDeclarations ?? []).map((type) => type.UTTypeIdentifier),
  registry.formats
    .map((format) => format.contentType)
    .filter((type) => type?.startsWith('com.local.burrete10.')),
  'AppMetadata exported UTIs must match preview format registry',
);

const previewInfo = plist('PreviewExtension/Info.plist');
assertSameSet(
  previewInfo.NSExtension?.NSExtensionAttributes?.QLSupportedContentTypes ?? [],
  registry.quickLook.contentTypes,
  'Quick Look supported content types must match preview format registry',
);
assertSameSet(
  (previewInfo.UTExportedTypeDeclarations ?? []).map((type) => type.UTTypeIdentifier),
  registry.quickLook.exportedTypeIds,
  'Quick Look exported UTIs must match preview format registry',
);

const tauriConfig = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
assertSameSet(
  tauriConfig.bundle.fileAssociations?.[0]?.ext ?? [],
  registry.documentTypes.extensions,
  'Tauri file associations must match preview format registry',
);

const rustFormats = readFileSync('apps/desktop/src-tauri/src/preview/formats.rs', 'utf8');
assert.match(rustFormats, /include_str!\("\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/config\/preview-formats\.json"\)/);

const browserDevDocuments = readFileSync('apps/desktop/src/lib/browser-dev-documents.ts', 'utf8');
assert.match(browserDevDocuments, /preview-formats\.json/);
assert.doesNotMatch(browserDevDocuments, /\["pdb", "ent", "pdbqt", "pqr"\]/);

const forcePreview = readFileSync('scripts/force-preview.sh', 'utf8');
assert.match(forcePreview, /config\/preview-formats\.json/);
assert.doesNotMatch(forcePreview, /pdb\|PDB\|ent\|ENT/);

console.log('preview format registry check passed');
