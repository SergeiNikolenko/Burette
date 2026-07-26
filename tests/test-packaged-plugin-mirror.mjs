#!/usr/bin/env node
// `plugins/burette-agent/` ships copies of files that live elsewhere in the repo:
// scripts/build-agent-shell-plugin.mjs rsyncs PreviewExtension/Web into preview-web
// and copies a handful of scripts alongside. Nothing forced anyone to re-run it, so
// a change to the source could land while the packaged copy kept the old version -
// and it did: the large-collection indexing work sat in PreviewExtension/Web for
// several releases while the packaged plugin shipped a grid viewer 115 lines behind.
// Nothing failed, which is what made it last.
//
// This compares the copies with their sources by content. It deliberately does not
// run the build: the point is to catch the copy being stale, and a test that
// regenerated it first could never see that.
//
// The other two outputs under plugins/burette-agent - browser-shell-dist and
// mcp/lib - are bundler output with hashed filenames that change on every build
// even when no source did, so they are regenerated at release points instead and
// are not checked here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function filesUnder(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full, base));
    else if (entry.isFile()) out.push(relative(base, full));
  }
  return out.sort();
}

const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

async function assertSameFile(sourcePath, copyPath, what) {
  const info = await stat(join(root, copyPath)).catch(() => null);
  assert.ok(info?.isFile(), `${what}: ${copyPath} is missing - run \`bun run build:agent-shell\``);
  assert.equal(
    await digest(join(root, copyPath)),
    await digest(join(root, sourcePath)),
    `${what}: ${copyPath} no longer matches ${sourcePath}. `
      + "The packaged plugin would ship a different file than the app runs. "
      + "Run `bun run build:agent-shell` and commit the preview-web/scripts changes."
  );
}

// The whole PreviewExtension/Web tree, mirrored with `rsync -a --delete`: the copy
// must hold the same files and nothing else.
const webSource = join(root, "PreviewExtension/Web");
const webCopy = join(root, "plugins/burette-agent/preview-web");
const sourceFiles = await filesUnder(webSource);
const copyFiles = await filesUnder(webCopy);
assert.ok(sourceFiles.length > 0, "PreviewExtension/Web is empty - the check would pass vacuously");
assert.deepEqual(
  copyFiles,
  sourceFiles,
  "plugins/burette-agent/preview-web holds a different set of files than PreviewExtension/Web. "
    + "Run `bun run build:agent-shell`."
);
for (const file of sourceFiles) {
  await assertSameFile(join("PreviewExtension/Web", file), join("plugins/burette-agent/preview-web", file), "preview runtime");
}

// The copied scripts. The list is read out of the build script rather than
// restated, so adding one there cannot leave this test checking the old set.
const buildScript = await readFile(join(root, "scripts/build-agent-shell-plugin.mjs"), "utf8");
const listed = buildScript.match(/const runtimeScripts = \[([\s\S]*?)\]/);
assert.ok(listed, "build-agent-shell-plugin.mjs no longer declares runtimeScripts - this check cannot follow it");
const runtimeScripts = [...listed[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, name]) => name);
assert.ok(runtimeScripts.length > 0, "runtimeScripts parsed as empty");
for (const script of runtimeScripts) {
  await assertSameFile(join("scripts", script), join("plugins/burette-agent/scripts", script), "runtime script");
}

console.log(`packaged plugin mirror ok (${sourceFiles.length} runtime files, ${runtimeScripts.length} scripts)`);
