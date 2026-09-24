#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appRootIndex = process.argv.indexOf('--app-root');
if (appRootIndex >= 0 && !process.argv[appRootIndex + 1]) throw new Error('--app-root requires a checkout path.');
const appRoot = appRootIndex < 0 ? repoRoot : resolve(process.argv[appRootIndex + 1]);
const pluginRoot = resolve(repoRoot, 'plugins/burette-agent');
const shellDist = resolve(pluginRoot, 'browser-shell-dist');
const previewWeb = resolve(pluginRoot, 'preview-web');
const mcpLibDir = resolve(pluginRoot, 'mcp/lib');
const mcpOnly = process.argv.includes('--mcp-only');
const exampleAssets = resolve(pluginRoot, 'assets/examples');
await mkdir(exampleAssets, { recursive: true });
await cp(resolve(appRoot, 'samples/structures/proteins/1htb.pdb'), resolve(exampleAssets, '1htb.pdb'));
await cp(resolve(appRoot, 'apps/burette-public-plugin/public/demo-library/Quantum/caffeine.xyz'), resolve(exampleAssets, 'caffeine.xyz'));
const runtimeScripts = [
  'amber_nc_preview_extract.py',
  'agent-preview.mjs',
  'agent-shell-server.mjs',
  'burette-agent.mjs',
  'burette-deep-links.mjs',
  'dev-namespace.mjs',
  'mcp-app-session.mjs',
  'mcp-app-action-log.mjs',
  'mcp-app-open.mjs',
  'mcp-app-capture.mjs',
  'mcp-app-checkpoint.mjs',
  'mcp-app-documents.mjs',
  'mcp-app-assets.mjs',
  'local-file-actions.mjs',
  'native-workspace-xyzrender.mjs',
  'mvs-story.mjs',
  'mvs-story-templates.mjs',
];
const requiredPreviewAssets = [
  'viewer.js',
  'viewer-bootstrap.js',
  'viewer-shell.js',
  'viewer-runtime.css',
  'trajectory-smoothing.js',
  'molstar-preset-preview-controller.js',
  'superposition-panel.js',
  'molstar.js',
  'molstar.css',
  'mesoscale.js',
  'mesoscale.css',
  'burette-agent.js',
  'grid-viewer.js',
  'grid-ui.js',
  'grid.css',
  'openchemlib/openchemlib.js',
  'rdkit/RDKit_minimal.js',
  'rdkit/RDKit_minimal.wasm',
];

if (!mcpOnly) {
await rm(shellDist, { recursive: true, force: true });
await rm(previewWeb, { recursive: true, force: true });
await mkdir(resolve(pluginRoot, 'scripts'), { recursive: true });
await run('bun', ['run', 'build:grid-ui'], { cwd: appRoot });
await run('bun', [resolve(repoRoot, 'scripts/build-local-viewer.mjs'), '--app-root', appRoot]);
}

for (const script of runtimeScripts) {
  await cp(resolve(repoRoot, 'scripts', script), resolve(pluginRoot, 'scripts', script));
}
if (!mcpOnly) {
const storyTemplateAssets = resolve(pluginRoot, 'assets', 'mvs-story-templates');
await rm(storyTemplateAssets, { recursive: true, force: true });
await cp(resolve(repoRoot, 'templates', 'mvs-story'), storyTemplateAssets, { recursive: true });
await run('bun', [
  'build',
  resolve(repoRoot, 'scripts/mvs-schema-validator.mjs'),
  '--outfile',
  resolve(pluginRoot, 'scripts/mvs-schema-validator.mjs'),
  '--target',
  'node',
  '--format',
  'esm',
  '--minify',
]);
await mkdir(previewWeb, { recursive: true });
await run('rsync', [
  '-a',
  '--delete',
  `${resolve(appRoot, 'PreviewExtension/Web')}/`,
  `${previewWeb}/`,
]);
for (const asset of requiredPreviewAssets) {
  const source = resolve(previewWeb, asset);
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) throw new Error(`Missing required preview runtime asset: ${asset}`);
}

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

if (!mcpOnly) {
await run('bun', ['run', 'build'], {
  cwd: resolve(appRoot, 'apps/desktop'),
  env: {
    ...process.env,
    BURETTE_AGENT_SHELL_OUT_DIR: shellDist,
    VITE_BURETTE_AGENT_SHELL: '1',
    VITE_BURETTE_WEB_ASSETS_BASE: '/__burette/runtime/',
    VITE_BURETTE_BUILD_IDENTIFIER: 'browser-agent-shell',
    VITE_BURETTE_DEV_INSTANCE: 'agent',
  },
});

await run('bun', [resolve(repoRoot, 'scripts/build-native-workspace.mjs'), '--app-root', appRoot]);
}

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
