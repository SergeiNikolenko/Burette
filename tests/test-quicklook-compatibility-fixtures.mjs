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

assert.equal(manifest.schemaVersion, 1);

for (const fixture of manifest.cases) {
  await readFile(path.join(root, fixture.path));

  const extension = extensionForPath(fixture.path);
  const format = registry.formats.find((candidate) => candidate.extensions?.includes(extension));
  assert.ok(format, `${fixture.path} must have a registered preview format`);
  assert.equal(format.id, fixture.formatId, `${fixture.path} must resolve to ${fixture.formatId}`);

  const acceptedContentTypes = new Set([format.contentType, ...(format.contentTypeAliases ?? [])]);
  assert.ok(
    acceptedContentTypes.has(fixture.observedContentType),
    `${fixture.path} must accept observed content type ${fixture.observedContentType}`,
  );
  assert.ok(
    registry.quickLook.contentTypes.includes(fixture.observedContentType),
    `${fixture.observedContentType} must be routed to the Quick Look extension`,
  );
}

console.log("Quick Look compatibility fixture tests passed");
