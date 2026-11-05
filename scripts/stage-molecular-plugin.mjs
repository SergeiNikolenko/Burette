#!/usr/bin/env node
import { cp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repoRoot, 'plugins/burette-agent');
const option = name => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} requires a path.`);
  return resolve(process.argv[index + 1]);
};
const base = await realpath(option('--base-plugin'));
const output = option('--output');
const within = (parent, path) => {
  const part = relative(parent, path);
  return !part || (!part.startsWith('..') && !isAbsolute(part));
};
if (within(base, output) || within(source, output)) throw new Error('Output must be outside both plugin inputs.');
if (await stat(output).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) {
  throw new Error('Output already exists; choose a new staging directory.');
}
const baseManifest = JSON.parse(await readFile(resolve(base, '.codex-plugin/plugin.json'), 'utf8'));
const sourceManifest = JSON.parse(await readFile(resolve(source, '.codex-plugin/plugin.json'), 'utf8'));
const assets = await readFile(resolve(base, 'assets/native-workspace/manifest.json'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

await mkdir(dirname(output), { recursive: true });
try {
  await cp(base, output, { recursive: true, filter: path => path.split(/[\\/]/u).at(-1) !== 'node_modules' });
  // UI assets are inherited unchanged. Replace complete backend directories so
  // a stale server chunk or worker cannot survive the composed package.
  for (const name of ['mcp', 'scripts', 'skills', 'vendor', '.codex-plugin']) {
    await rm(resolve(output, name), { recursive: true, force: true });
    await cp(resolve(source, name), resolve(output, name), { recursive: true });
  }
  for (const name of ['package.json', 'package-lock.json', 'README.md', '.mcp.json']) {
    await cp(resolve(source, name), resolve(output, name));
  }
  const provenance = { schemaVersion: 1, version: sourceManifest.version, sourceCommit,
    basePluginVersion: baseManifest.version, nativeAssetManifestSha256: sha256(assets),
    composition: 'Existing native/browser/preview UI with rebuilt autonomous molecular backend',
    createdAt: new Date().toISOString() };
  await writeFile(resolve(output, '.burette-autonomous-build.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  await writeFile(resolve(output, '.burette-agent-install.json'), `${JSON.stringify({ repoRoot }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, output, ...provenance }, null, 2));
} catch (error) {
  await rm(output, { recursive: true, force: true });
  throw error;
}
