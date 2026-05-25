#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const registry = JSON.parse(readFileSync('config/preview-formats.json', 'utf8'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

function sorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function assertSameSet(actual, expected, label) {
  assert.deepEqual(sorted(actual), sorted(expected), label);
}

function formatMap(formats) {
  return new Map(formats.map((format) => [format.contentType, format]));
}

function normalizedTagSpecification(spec = {}) {
  return Object.fromEntries(
    Object.entries(spec)
      .map(([key, values]) => [key, Array.isArray(values) ? [...values] : [values]])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function assertExportedTypeDeclarations(actualTypes, expectedFormats, label) {
  const actualById = new Map(actualTypes.map((type) => [type.UTTypeIdentifier, type]));
  const expectedById = formatMap(expectedFormats);
  assertSameSet(actualById.keys(), expectedById.keys(), `${label} identifiers must match preview format registry`);
  for (const [typeId, format] of expectedById) {
    const actual = actualById.get(typeId);
    assert.ok(actual, `${label} is missing ${typeId}`);
    assert.deepEqual(actual.UTTypeConformsTo ?? [], format.conformsTo ?? [], `${label} ${typeId} conformsTo`);
    assert.equal(actual.UTTypeDescription, format.description, `${label} ${typeId} description`);
    assert.deepEqual(
      normalizedTagSpecification(actual.UTTypeTagSpecification),
      normalizedTagSpecification({
        'public.filename-extension': format.extensions,
        ...(format.mimeTypes ? { 'public.mime-type': format.mimeTypes } : {}),
      }),
      `${label} ${typeId} tag specification`,
    );
  }
}

function plist(path) {
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', path], {
    encoding: 'utf8',
  });
  return JSON.parse(json);
}

assert.deepEqual(packageJson.workspaces, ['apps/*', 'packages/*']);

const appFormats = registry.formats.filter((format) => format.contentType?.startsWith('com.local.burrete10.'));

const appInfo = plist('apps/desktop/src-tauri/AppMetadata.plist');
const appDocumentTypes = appInfo.CFBundleDocumentTypes ?? [];
const appExtensions = appDocumentTypes.flatMap((type) => type.CFBundleTypeExtensions ?? []);
const appContentTypes = appDocumentTypes.flatMap((type) => type.LSItemContentTypes ?? []);
assertSameSet(
  appExtensions,
  registry.documentTypes.extensions,
  'AppMetadata CFBundleTypeExtensions must match preview format registry',
);
assertSameSet(
  appContentTypes,
  registry.quickLook.contentTypes,
  'AppMetadata LSItemContentTypes must match preview format registry',
);
const gridTableDocumentType = appDocumentTypes.find((type) => type.CFBundleTypeName === 'Molecular grid tables');
assert.ok(gridTableDocumentType, 'AppMetadata must declare a dedicated grid-table document type');
assert.equal(gridTableDocumentType.LSHandlerRank, 'Owner');
assertSameSet(
  gridTableDocumentType.CFBundleTypeExtensions ?? [],
  ['csv', 'tsv'],
  'Grid-table document type must only cover CSV/TSV extensions',
);
assertSameSet(
  gridTableDocumentType.LSItemContentTypes ?? [],
  [
    'com.local.burrete10.csv',
    'com.local.burrete10.tsv',
    'public.delimited-values-text',
    'public.comma-separated-values-text',
    'public.tab-separated-values-text',
  ],
  'Grid-table document type must prioritize CSV/TSV UTIs',
);
assertExportedTypeDeclarations(
  appInfo.UTExportedTypeDeclarations ?? [],
  appFormats,
  'AppMetadata exported UTIs',
);

const previewInfo = plist('PreviewExtension/Info.plist');
assertSameSet(
  previewInfo.NSExtension?.NSExtensionAttributes?.QLSupportedContentTypes ?? [],
  registry.quickLook.contentTypes,
  'Quick Look supported content types must match preview format registry',
);
assertExportedTypeDeclarations(
  previewInfo.UTExportedTypeDeclarations ?? [],
  appFormats.filter((format) => registry.quickLook.exportedTypeIds.includes(format.contentType)),
  'Quick Look exported UTIs',
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
