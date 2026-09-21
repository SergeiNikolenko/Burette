#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { namespaceForFlavor, patchTree, transformContentType } from "../scripts/dev-namespace.mjs";

const baseNamespace = namespaceForFlavor("");
assert.equal(baseNamespace.isDev, false);
assert.equal(baseNamespace.appId, "com.local.BuretteV10");
assert.equal(transformContentType("com.local.burette10.pdb", baseNamespace), "com.local.burette10.pdb");

const devNamespace = namespaceForFlavor("Chat 85B0");
assert.equal(devNamespace.isDev, true);
assert.equal(devNamespace.slug, "chat85b0");
assert.equal(devNamespace.appId, "com.local.BuretteV10.Dev.chat85b0");
assert.equal(devNamespace.previewId, "com.local.BuretteV10.Dev.chat85b0.Preview");
assert.equal(devNamespace.thumbnailId, "com.local.BuretteV10.Dev.chat85b0.Thumbnail");
assert.equal(devNamespace.pdbContentType, "com.local.burette10.dev.chat85b0.pdb");
assert.equal(
  transformContentType("com.local.burette10.xyz", devNamespace),
  "com.local.burette10.dev.chat85b0.xyz",
);

const root = await mkdtemp(join(tmpdir(), "burette-dev-namespace-"));
try {
  const plist = join(root, "Info.plist");
  await writeFile(
    plist,
    [
      "com.local.BuretteV10",
      "com.local.BuretteV10.Preview",
      "com.local.BuretteV10.Thumbnail",
      "com.local.burette10.pdb",
    ].join("\n"),
  );
  const changed = patchTree(root, devNamespace);
  assert.deepEqual(changed, [plist]);
  const patched = await readFile(plist, "utf8");
  assert.match(patched, /com\.local\.BuretteV10\.Dev\.chat85b0/);
  assert.match(patched, /com\.local\.BuretteV10\.Dev\.chat85b0\.Preview/);
  assert.match(patched, /com\.local\.BuretteV10\.Dev\.chat85b0\.Thumbnail/);
  assert.match(patched, /com\.local\.burette10\.dev\.chat85b0\.pdb/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("dev namespace tests passed");
