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

  // The build rewrites Rust identifiers too. The updater's dev exclusion must
  // survive that transformation or a dev launch can touch the real plugin.
  const updater = join(root, 'native_updates.rs');
  await writeFile(updater, await readFile(new URL('../apps/desktop/src-tauri/src/commands/native_updates.rs', import.meta.url), 'utf8'));
  patchTree(root, devNamespace);
  const transformed = await readFile(updater, 'utf8');
  const guard = transformed.slice(transformed.indexOf('fn initialize_sparkle'), transformed.indexOf('app.plugin('));
  assert.match(guard, /identifier\.contains\("\.Dev\."\)/);
  assert.ok(guard.includes(devNamespace.appId));
  assert.ok(guard.includes('return Err("Updates are disabled for dev builds.".into())'));
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("dev namespace tests passed");
