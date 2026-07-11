#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const pluginRoot = resolve(repoRoot, 'plugins/burette-agent');
const shellDist = resolve(pluginRoot, 'browser-shell-dist');
const previewWeb = resolve(pluginRoot, 'preview-web');
const mcpLibDir = resolve(pluginRoot, 'mcp/lib');
const runtimeScripts = [
  'amber_nc_preview_extract.py',
  'agent-preview.mjs',
  'agent-shell-server.mjs',
  'burrete-agent.mjs',
];
const requiredPreviewAssets = [
  'viewer.js',
  'viewer-shell.js',
  'viewer-runtime.css',
  'molstar.js',
  'molstar.css',
  'burette-agent.js',
  'grid-viewer.js',
  'grid-ui.js',
  'grid.css',
  'rdkit/RDKit_minimal.js',
  'rdkit/RDKit_minimal.wasm',
];

await rm(shellDist, { recursive: true, force: true });
await rm(previewWeb, { recursive: true, force: true });
await mkdir(resolve(pluginRoot, 'scripts'), { recursive: true });

for (const script of runtimeScripts) {
  await cp(resolve(repoRoot, 'scripts', script), resolve(pluginRoot, 'scripts', script));
}
await mkdir(previewWeb, { recursive: true });
await run('rsync', [
  '-a',
  '--delete',
  `${resolve(repoRoot, 'PreviewExtension/Web')}/`,
  `${previewWeb}/`,
]);
for (const asset of requiredPreviewAssets) {
  const source = resolve(previewWeb, asset);
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) throw new Error(`Missing required preview runtime asset: ${asset}`);
}

for (const file of await readdir(mcpLibDir)) {
  if (/^server-(?:bundle|chunk)-?.*\.mjs$/u.test(file)) {
    await rm(resolve(mcpLibDir, file), { force: true });
  }
}

await run('bun', [
  'build',
  resolve(pluginRoot, 'mcp/server.mjs'),
  '--outdir',
  mcpLibDir,
  '--entry-naming',
  'server-bundle.mjs',
  '--chunk-naming',
  'server-chunk-[hash].mjs',
  '--target',
  'node',
  '--format',
  'esm',
  '--minify',
  '--splitting',
]);
for (const file of await readdir(mcpLibDir)) {
  if (!/^server-(?:bundle|chunk)-?.*\.mjs$/u.test(file)) continue;
  const outputPath = resolve(mcpLibDir, file);
  const output = await readFile(outputPath, 'utf8');
  await writeFile(outputPath, output.replace(/[ \t]+$/gmu, ''));
}

await run('bun', ['run', 'build'], {
  cwd: resolve(repoRoot, 'apps/desktop'),
  env: {
    ...process.env,
    BURRETE_AGENT_SHELL_OUT_DIR: shellDist,
    VITE_BURRETE_AGENT_SHELL: '1',
    VITE_BURRETE_WEB_ASSETS_BASE: '/__burette/runtime/',
    VITE_BURRETE_BUILD_IDENTIFIER: 'browser-agent-shell',
    VITE_BURETTE_DEV_INSTANCE: 'agent',
  },
});

function run(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'inherit',
    });
    child.on('error', rejectRun);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${command} ${args.join(' ')} failed with ${signal || code}`));
    });
  });
}
