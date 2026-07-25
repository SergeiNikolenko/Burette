#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function extensionForPath(filePath) {
  return path.extname(filePath).slice(1).toLowerCase();
}

const registry = await json("config/preview-formats.json");
const manifest = await json("tests/fixtures/quicklook-compatibility/manifest.json");
const previewController = await readFile(
  path.join(root, "PreviewExtension", "Platform", "PreviewViewController.swift"),
  "utf8",
);

assert.equal(manifest.schemaVersion, 1);

for (const fixture of manifest.cases) {
  await readFile(path.join(root, fixture.path));

  const extension = extensionForPath(fixture.path);
  const format = registry.formats.find((candidate) => candidate.extensions?.includes(extension));
  assert.ok(format, `${fixture.path} must have a registered preview format`);
  assert.equal(format.id, fixture.formatId, `${fixture.path} must resolve to ${fixture.formatId}`);

  const acceptedContentTypes = new Set([
    format.contentType,
    ...(format.contentTypeAliases ?? []),
    ...(format.quickLookContentTypeAliases ?? []),
  ]);
  assert.ok(
    acceptedContentTypes.has(fixture.observedContentType),
    `${fixture.path} must accept observed content type ${fixture.observedContentType}`,
  );
  assert.ok(
    registry.quickLook.contentTypes.includes(fixture.observedContentType),
    `${fixture.observedContentType} must be routed to the Quick Look extension`,
  );
}

assert.match(previewController, /case "mol", "mdl":/);
assert.match(previewController, /"autoFocusStructure": true/);

// A file that exceeds the Quick Look size limit must say so. It used to fall into
// the raw-text fallback, which rendered the first megabyte of atom lines as if
// that were the preview - the reported symptom for a 1 GB SDF against a 25 MiB
// limit.
assert.match(previewController, /if Self\.deservesExplicitPreviewError\(error\) \{ throw error \}/);
assert.match(
  previewController,
  /private static func deservesExplicitPreviewError\(_ error: Error\) -> Bool \{[\s\S]*?case \.fileTooLarge, \.couldNotExtractBoundedMaestroPreview:[\s\S]*?return true/u,
);

// A collection too large to read in full is previewed from a bounded prefix cut
// back to the last whole record, and the grid says so rather than presenting the
// sample as the entire file.
assert.match(previewController, /private static let collectionPreviewReadLimit = 8 \* 1024 \* 1024/u);
assert.match(previewController, /usesBoundedCollectionPreview = structureSize > sizeLimit/u);
assert.match(previewController, /truncatedToWholeRecords\(/u);
assert.match(previewController, /boundedSample: usesBoundedCollectionPreview/u);

console.log("Quick Look compatibility fixture tests passed");
