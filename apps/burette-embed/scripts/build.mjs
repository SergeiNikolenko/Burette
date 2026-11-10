#!/usr/bin/env bun
// Builds the embeddable 3D viewer: a static directory that any web app serves
// as is. Usage: bun apps/burette-embed/scripts/build.mjs [--out <dir>]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPreferences } from '../../desktop/src/lib/default-preferences.ts';
import { previewThemeTokens, previewViewerDefaults } from '../../desktop/src/lib/preview-defaults.ts';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const webRoot = join(repoRoot, 'PreviewExtension/Web');
const outFlag = process.argv.indexOf('--out');
if (outFlag !== -1 && (!process.argv[outFlag + 1] || process.argv[outFlag + 1].startsWith('-'))) {
  throw new Error('--out requires a directory path.');
}
const out = resolve(outFlag > 0 ? process.argv[outFlag + 1] : join(appRoot, 'dist/burette-embed'));

// The 3D runtime only: no workspace shell, grid, xyzrender, mesoscale or compute.
const RUNTIME_FILES = [
  'viewer-runtime.css', 'molstar.css', 'viewer-shell.js', 'viewer-bootstrap.js', 'molstar.js',
  'burette-agent.js', 'trajectory-smoothing.js', 'molstar-preset-preview-controller.js',
  'superposition-panel.js', 'molecule-preview-interactions.js', 'renderer-view-state.js',
  'color-picker.js', 'sequence-panel.js', 'native-viewer-menus.js', 'scene-file-actions.js',
  'sdf-collection-scene.js', 'svg-sanitizer.js', 'svg-sanitizer.LICENSE', 'viewer.js',
  'rdkit/RDKit_minimal.js', 'rdkit/RDKit_minimal.wasm', 'rdkit/LICENSE'
];

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function writeBuild(destination) {
  const runtime = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async name => [name, await readFile(join(webRoot, name))])));
  const src = Object.fromEntries(await Promise.all(
    ['frame.js', 'frame.css', 'burette-embed.js', 'burette-embed.d.ts', 'index.html', 'verify.mjs']
      .map(async name => [name, await readFile(join(appRoot, 'src', name), 'utf8')])
  ));
  const notices = {
    'README.md': await readFile(join(appRoot, 'README.md')),
    'LICENSE': await readFile(join(repoRoot, 'LICENSE')),
    'THIRD_PARTY_NOTICES.md': await readFile(join(repoRoot, 'THIRD_PARTY_NOTICES.md'))
  };
  for (const [, name] of src['frame.js'].matchAll(/'([\w/-]+\.js)'/gu)) {
    if (!Object.hasOwn(runtime, name)) throw new Error(`frame.js loads ${name}, which the build does not ship.`);
  }
  const themeTokens = previewThemeTokens(defaultPreferences);
  const defaults = {
    molstarStyle: defaultPreferences.molstarStyle,
    canvasBackground: defaultPreferences.canvasBackground,
    themeTokens,
    viewerDefaults: previewViewerDefaults(defaultPreferences)
  };
  const digestFiles = assets => Object.fromEntries(Object.entries(assets).map(([name, data]) => [name, sha(data)]));
  const runtimeFiles = digestFiles(runtime);
  const version = sha(JSON.stringify([runtimeFiles, defaults, digestFiles(src), digestFiles(notices)])).slice(0, 12);
  const assets = {
    ...runtime,
    ...notices,
    ...src,
    'frame.js': src['frame.js']
      .replace('__BURETTE_EMBED_MANIFEST__', JSON.stringify({ version, files: runtimeFiles }))
      .replace('__BURETTE_EMBED_DEFAULTS__', JSON.stringify(defaults)),
    'frame.css': `:root{--burette-embed-background-light:${themeTokens.light.background};--burette-embed-background-dark:${themeTokens.dark.background}}\n`
      + src['frame.css'],
    'burette-embed.js': src['burette-embed.js'].replace('__BURETTE_EMBED_VERSION__', JSON.stringify(version))
  };
  for (const [token, name] of Object.entries({
    STYLE_VIEWER_RUNTIME: 'viewer-runtime.css',
    STYLE_MOLSTAR: 'molstar.css',
    STYLE_EMBED: 'frame.css',
    SCRIPT_FRAME: 'frame.js'
  })) {
    assets['index.html'] = assets['index.html'].replace(`__${token}__`, `${name}?v=${sha(assets[name]).slice(0, 12)}`);
  }

  const git = args => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  const { version: burette } = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  const sourceCommit = process.env.BURETTE_SOURCE_COMMIT || git(['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid source commit for embedded viewer');
  const sourceDirty = process.env.BURETTE_SOURCE_COMMIT
    ? process.env.BURETTE_SOURCE_DIRTY !== 'false'
    : git(['status', '--porcelain', '--', 'PreviewExtension/Web', 'apps/burette-embed', 'apps/desktop/src']) !== '';
  const manifest = {
    name: 'burette-embed',
    version,
    burette,
    commit: sourceCommit,
    dirty: sourceDirty,
    bytes: Object.values(assets).reduce((sum, data) => sum + Buffer.byteLength(data), 0),
    files: digestFiles(assets)
  };
  await mkdir(join(destination, 'rdkit'));
  await Promise.all(Object.entries(assets).map(([name, data]) => writeFile(join(destination, name), data)));
  await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function main() {
  const existing = await lstat(out).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing && (!existing.isDirectory() || (await readdir(out)).length &&
    JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8').catch(() => '{}')).name !== 'burette-embed')) {
    throw new Error(`${out} is not an empty directory or a Burette embed build.`);
  }
  await mkdir(dirname(out), { recursive: true });
  const stage = await mkdtemp(join(dirname(out), '.burette-embed-'));
  try {
    const destination = join(stage, 'build');
    await mkdir(destination);
    const { version, files, bytes } = await writeBuild(destination);
    const previous = join(stage, 'previous');
    if (existing) await rename(out, previous);
    try {
      await rename(destination, out);
    } catch (error) {
      if (existing) await rename(previous, out);
      throw error;
    }
    console.log(JSON.stringify({ out, version, files: Object.keys(files).length, bytes }));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

await main();
