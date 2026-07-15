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
const xyzrenderInputFormat = registry.formats.find((format) => format.id === 'xyzrender-input');
assert.ok(xyzrenderInputFormat?.extensions?.includes('xyzr'), 'XYZR files must map to the xyzrender Quick Look input type');
assert.equal(
  xyzrenderInputFormat?.contentType,
  'com.local.burrete10.xyzrender-input',
  'XYZR files must use the xyzrender Quick Look content type',
);
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
  'com.mdli.sketchfile',
  'com.mdli.molfile',
  'com.revvity.external.cif',
  'com.revvity.external.mdl3000',
  'com.schrodinger.mae',
  'com.schrodinger.mol',
  'com.schrodinger.pdb',
  'com.schrodinger.sdf',
  'gg.flew.unfold.gromacs-structure',
  'gg.flew.unfold.subtitle-smi',
  'net.sourceforge.openbabel.mdl',
  'net.sourceforge.openbabel.xyz',
  'public.cif',
  'public.comma-separated-values-text',
  'public.pdb',
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
const quickLookOnlyContentTypes = new Set(
  registry.formats.flatMap((format) => format.quickLookContentTypeAliases ?? []),
);
const documentQuickLookContentTypes = registry.quickLook.contentTypes.filter(
  (contentType) => !quickLookOnlyContentTypes.has(contentType),
);
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
  [...documentQuickLookContentTypes, ...appOnlyContentTypes],
  'AppMetadata LSItemContentTypes must match preview format registry',
);
for (const contentType of quickLookOnlyContentTypes) {
  assert.ok(
    registry.quickLook.contentTypes.includes(contentType),
    `Quick Look-only content type must be routed to the extension: ${contentType}`,
  );
  assert.equal(
    appContentTypes.includes(contentType),
    false,
    `Quick Look-only content type must not be registered as an app document type: ${contentType}`,
  );
}
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
    'public.comma-separated-values-text',
    'public.tab-separated-values-text',
  ],
  'Grid-table document type must cover Burrete-owned and system CSV/TSV UTIs',
);
assertExportedTypeDeclarations(
  appInfo.UTExportedTypeDeclarations ?? [],
  appFormats,
  'AppMetadata exported UTIs',
);
const graphmlFormat = registry.formats.find((format) => format.id === 'graphml');
assert.ok(graphmlFormat, 'Registry must declare GraphML for FEP network files');
const quickLookPreviewController = readFileSync('PreviewExtension/Platform/PreviewViewController.swift', 'utf8');
assert.match(quickLookPreviewController, /shouldUseFepGraphMLPreview\(fileExtension: pathExtension, previewPlan: previewPlan\)/);
assert.match(quickLookPreviewController, /private static func shouldUseFepGraphMLPreview\(fileExtension: String, previewPlan: BurretePreviewPlan\?\) -> Bool/);
assert.match(quickLookPreviewController, /detected\.previewMode=fep-graphml/);
assert.equal(
  registry.quickLook.contentTypes.includes(graphmlFormat.contentType),
  true,
  'GraphML must opt into Quick Look only through the dedicated FEP network preview path',
);
assert.equal(
  appDocumentTypes.find((type) => type.CFBundleTypeName === registry.documentTypes.name)?.LSHandlerRank,
  'Owner',
  'Molecular document type must make Burrete the default opener',
);

const mobileInfo = plist('ios/BurreteMobile/Info.plist');
assert.deepEqual(
  mobileInfo.CFBundleDocumentTypes ?? [],
  appInfo.CFBundleDocumentTypes ?? [],
  'Mobile app document types must match AppMetadata so iOS Open In stays aligned',
);
assert.deepEqual(
  mobileInfo.UTExportedTypeDeclarations ?? [],
  appInfo.UTExportedTypeDeclarations ?? [],
  'Mobile app exported UTIs must match AppMetadata',
);
assert.equal(
  mobileInfo.LSSupportsOpeningDocumentsInPlace,
  true,
  'Mobile app should accept document URLs from Files and share sheets',
);

const previewInfo = plist('PreviewExtension/Info.plist');
assertSameSet(
  previewInfo.NSExtension?.NSExtensionAttributes?.QLSupportedContentTypes ?? [],
  registry.quickLook.contentTypes,
  'Quick Look supported content types must match preview format registry',
);
const thumbnailInfo = plist('PreviewExtension/ThumbnailInfo.plist');
assertSameSet(
  thumbnailInfo.NSExtension?.NSExtensionAttributes?.QLSupportedContentTypes ?? [],
  registry.quickLook.contentTypes,
  'Quick Look thumbnail supported content types must match preview format registry',
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
assert.match(forcePreview, /qlmanage -p -c "\$TYPE" "\$PREVIEW_FILE"/);
assert.doesNotMatch(forcePreview, /Normal Quick Look resolves XYZ/);

const previewContentType = readFileSync('scripts/preview-content-type.mjs', 'utf8');
assert.match(previewContentType, /config['"], ['"]preview-formats\.json/);
assert.match(previewContentType, /mae\.gz/);
assert.match(previewContentType, /registry\.quickLook\.contentTypes\.includes\(format\.contentType\)/);
assert.doesNotMatch(previewContentType, /pdb\|PDB\|ent\|ENT/);

console.log('preview format registry check passed');
