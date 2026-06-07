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
assert.equal(
  registry.quickLook.contentTypes.some(
    (type) =>
      type.startsWith('dyn.') ||
      type.startsWith('com.local.molstarquicklook10.') ||
      type === 'com.local.burettexyzrender.smiles',
  ),
  false,
  'Quick Look content types must not include dynamic or legacy identifiers',
);
const allowedSystemQuickLookContentTypes = new Set([
  'com.adobe.fdf',
  'com.apple.videoapps.cube',
  'com.gaussian.cube',
  'com.schrodinger.mae',
  'com.schrodinger.mol',
  'com.schrodinger.pdb',
  'com.schrodinger.sdf',
  'net.sourceforge.openbabel.xyz',
  'public.cif',
  'public.delimited-values-text',
  'public.comma-separated-values-text',
  'public.tab-separated-values-text',
]);
for (const contentType of registry.quickLook.contentTypes) {
  assert.ok(
    contentType.startsWith('com.local.burrete10.') || allowedSystemQuickLookContentTypes.has(contentType),
    `Quick Look content type must be exported by Burrete or explicitly allowed: ${contentType}`,
  );
}

const appInfo = plist('apps/desktop/src-tauri/AppMetadata.plist');
const appDocumentTypes = appInfo.CFBundleDocumentTypes ?? [];
const appExtensions = appDocumentTypes.flatMap((type) => type.CFBundleTypeExtensions ?? []);
const appContentTypes = appDocumentTypes.flatMap((type) => type.LSItemContentTypes ?? []);
const appOnlyContentTypes = registry.formats
  .filter((format) => format.contentType && !registry.quickLook.contentTypes.includes(format.contentType))
  .map((format) => format.contentType);
assertSameSet(
  appExtensions,
  registry.documentTypes.extensions,
  'AppMetadata CFBundleTypeExtensions must match preview format registry',
);
assertSameSet(
  appContentTypes,
  [...registry.quickLook.contentTypes, ...appOnlyContentTypes],
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
const graphmlFormat = registry.formats.find((format) => format.id === 'graphml');
assert.ok(graphmlFormat, 'Registry must declare GraphML for FEP network files');
assert.equal(
  registry.quickLook.contentTypes.includes(graphmlFormat.contentType),
  false,
  'GraphML must open in the app without opting into the molecular Quick Look preview runtime',
);
assert.equal(
  appDocumentTypes.find((type) => type.CFBundleTypeName === registry.documentTypes.name)?.LSHandlerRank,
  'Owner',
  'Molecular document type must make Burrete the default opener',
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
assert.match(rustFormats, /pub\(crate\) use burrete_core::/);
const coreFormats = readFileSync('crates/burrete-core/src/lib.rs', 'utf8');
assert.match(coreFormats, /include_str!\("\.\.\/\.\.\/\.\.\/config\/preview-formats\.json"\)/);

const browserDevDocuments = readFileSync('apps/desktop/src/lib/browser-dev-documents.ts', 'utf8');
assert.match(browserDevDocuments, /preview-formats\.json/);
assert.doesNotMatch(browserDevDocuments, /\["pdb", "ent", "pdbqt", "pqr"\]/);

const forcePreview = readFileSync('scripts/force-preview.sh', 'utf8');
assert.match(forcePreview, /preview-content-type\.mjs/);
assert.doesNotMatch(forcePreview, /pdb\|PDB\|ent\|ENT/);
assert.match(forcePreview, /com\.local\.burrete10\.xyz/);
assert.match(forcePreview, /Normal Quick Look resolves XYZ/);

const previewContentType = readFileSync('scripts/preview-content-type.mjs', 'utf8');
assert.match(previewContentType, /config['"], ['"]preview-formats\.json/);
assert.match(previewContentType, /mae\.gz/);
assert.match(previewContentType, /registry\.quickLook\.contentTypes\.includes\(format\.contentType\)/);
assert.doesNotMatch(previewContentType, /pdb\|PDB\|ent\|ENT/);

console.log('preview format registry check passed');
