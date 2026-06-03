#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { namespaceForFlavor, patchTree, transformContentType } from "../scripts/dev-namespace.mjs";

const baseNamespace = namespaceForFlavor("");
assert.equal(baseNamespace.isDev, false);
assert.equal(baseNamespace.appId, "com.local.BurreteV10");
assert.equal(transformContentType("com.local.burrete10.pdb", baseNamespace), "com.local.burrete10.pdb");

const devNamespace = namespaceForFlavor("Chat 85B0");
assert.equal(devNamespace.isDev, true);
assert.equal(devNamespace.slug, "chat85b0");
assert.equal(devNamespace.appId, "com.local.BurreteV10.Dev.chat85b0");
assert.equal(devNamespace.previewId, "com.local.BurreteV10.Dev.chat85b0.Preview");
assert.equal(devNamespace.thumbnailId, "com.local.BurreteV10.Dev.chat85b0.Thumbnail");
assert.equal(devNamespace.pdbContentType, "com.local.burrete10.dev.chat85b0.pdb");
assert.equal(
  transformContentType("com.local.burrete10.xyz", devNamespace),
  "com.local.burrete10.dev.chat85b0.xyz",
);

const root = await mkdtemp(join(tmpdir(), "burrete-dev-namespace-"));
try {
  const plist = join(root, "Info.plist");
  await writeFile(
    plist,
    [
      "com.local.BurreteV10",
      "com.local.BurreteV10.Preview",
      "com.local.BurreteV10.Thumbnail",
      "com.local.burrete10.pdb",
    ].join("\n"),
  );
  const changed = patchTree(root, devNamespace);
  assert.deepEqual(changed, [plist]);
  const patched = await readFile(plist, "utf8");
  assert.match(patched, /com\.local\.BurreteV10\.Dev\.chat85b0/);
  assert.match(patched, /com\.local\.BurreteV10\.Dev\.chat85b0\.Preview/);
  assert.match(patched, /com\.local\.BurreteV10\.Dev\.chat85b0\.Thumbnail/);
  assert.match(patched, /com\.local\.burrete10\.dev\.chat85b0\.pdb/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("dev namespace tests passed");
