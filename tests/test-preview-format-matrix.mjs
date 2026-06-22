#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function exists(relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function listFiles(directory) {
  const result = [];
  async function walk(current) {
    for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const relative = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(relative);
      else result.push(relative);
    }
  }
  await walk(directory);
  return result.sort();
}

function fileExtension(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.endsWith(".mae.gz")) return "mae.gz";
  return path.extname(name).slice(1);
}

function sorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function formatForExtension(formats, extension) {
  return formats.find((format) => format.extensions?.includes(extension));
}

const registry = await json("config/preview-formats.json");
const matrix = await json("samples/preview-matrix.json");
const sampleFiles = await listFiles("samples");
const samples = sampleFiles.filter((file) => file !== "samples/preview-matrix.json");
const formatsById = new Map(registry.formats.map((format) => [format.id, format]));
const representativeByFormat = new Map(matrix.representatives.map((item) => [item.formatId, item]));
const sampleExtensions = new Set(samples.map(fileExtension));
const formatExtensions = new Set(registry.formats.flatMap((format) => format.extensions ?? []));
const formatContentTypes = new Set(
  registry.formats.flatMap((format) => [format.contentType, ...(format.contentTypeAliases ?? [])].filter(Boolean)),
);

assert.equal(matrix.schemaVersion, 1);
assert.ok(Array.isArray(matrix.surfaces));
assert.ok(matrix.surfaces.includes("browser-dev-shell"));
assert.ok(matrix.surfaces.includes("browser-quicklook"));
assert.ok(matrix.surfaces.includes("native-quicklook"));
assert.ok(matrix.surfaces.includes("ios-mobile"));
assert.ok(matrix.surfaces.every((surface) => /^[a-z0-9-]+$/u.test(surface)));

for (const sample of samples) {
  const extension = fileExtension(sample);
  assert.ok(formatForExtension(registry.formats, extension), `${sample} has unsupported extension .${extension}`);
}

for (const representative of matrix.representatives) {
  const format = formatsById.get(representative.formatId);
  assert.ok(format, `Unknown representative format: ${representative.formatId}`);
  assert.ok(await exists(representative.path), `Representative sample is missing: ${representative.path}`);
  assert.ok(samples.includes(representative.path), `Representative must live under samples/: ${representative.path}`);
  assert.ok(format.extensions.includes(fileExtension(representative.path)), `${representative.path} does not match ${representative.formatId}`);
  assert.ok(representative.surfaces.length > 0, `${representative.path} must declare at least one surface`);
  for (const surface of representative.surfaces) {
    assert.ok(matrix.surfaces.includes(surface), `${representative.path} uses unknown surface ${surface}`);
  }
}

for (const format of registry.formats) {
  const gap = matrix.extensionCoverageGaps[format.id];
  const coveredExtensions = format.extensions.filter((extension) => sampleExtensions.has(extension));
  if (coveredExtensions.length > 0) {
    assert.ok(representativeByFormat.has(format.id), `${format.id} has sample coverage but no representative`);
  }
  const missingExtensions = sorted(format.extensions.filter((extension) => !sampleExtensions.has(extension)));
  const documentedGaps = sorted(gap?.extensions ?? []);
  assert.deepEqual(documentedGaps, missingExtensions, `${format.id} extension gaps must match sample coverage`);
  if (missingExtensions.length > 0) {
    assert.match(gap.reason, /\S.{20,}/u, `${format.id} gap must explain why coverage is missing`);
  }
}

const documentedDocumentOnlyExtensions = matrix.documentTypeOnlyExtensions ?? {};
const documentOnlyExtensions = sorted((registry.documentTypes?.extensions ?? []).filter((extension) => !formatExtensions.has(extension)));
assert.deepEqual(Object.keys(documentedDocumentOnlyExtensions).sort(), documentOnlyExtensions);
for (const [extension, reason] of Object.entries(documentedDocumentOnlyExtensions)) {
  assert.match(reason, /\S.{20,}/u, `Document-only extension .${extension} must explain why it is outside preview formats`);
}

const documentedQuickLookContentTypeGaps = matrix.quickLookContentTypeGaps ?? {};
const localQuickLookContentTypeGaps = sorted(
  (registry.quickLook?.contentTypes ?? []).filter(
    (contentType) => contentType.startsWith("com.local.") && !formatContentTypes.has(contentType),
  ),
);
assert.deepEqual(Object.keys(documentedQuickLookContentTypeGaps).sort(), localQuickLookContentTypeGaps);
for (const [contentType, reason] of Object.entries(documentedQuickLookContentTypeGaps)) {
  assert.match(reason, /\S.{20,}/u, `${contentType} must explain why it is outside preview formats`);
}

const representedStrategies = new Set(
  matrix.representatives.map((representative) => {
    const format = formatsById.get(representative.formatId);
    return format.preview?.strategy ?? "none";
  }),
);
for (const strategy of ["direct", "grid", "external", "trajectory", "convert", "custom"]) {
  assert.ok(representedStrategies.has(strategy), `Matrix must include a representative for ${strategy}`);
}

for (const formatId of ["smiles", "csv", "tsv"]) {
  const representative = representativeByFormat.get(formatId);
  assert.ok(representative, `${formatId} needs an explicit grid representative`);
  assert.equal(formatsById.get(formatId)?.preview?.renderer, "grid2d");
}

for (const smokePath of matrix.smokeSets.nativeQuickLookFocused) {
  if (smokePath.startsWith("samples/")) {
    assert.ok(await exists(smokePath), `Native Quick Look smoke sample is missing: ${smokePath}`);
  }
}
for (const smokePath of matrix.smokeSets.browserQuickLookCore) {
  assert.ok(await exists(smokePath), `Browser Quick Look smoke sample is missing: ${smokePath}`);
}
for (const smokePath of matrix.smokeSets.iosManualCore) {
  assert.ok(await exists(smokePath), `iOS manual smoke sample is missing: ${smokePath}`);
  assert.ok(representativeByFormat.get(formatForExtension(registry.formats, fileExtension(smokePath)).id)?.surfaces.includes("ios-mobile"));
}

console.log("preview format matrix tests passed");
