import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, renameSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { patchMolstarSegmentorLifecycle, patchMolstarVolumeDimensions } from './molstar-segmentor-lifecycle.mjs';

export const molstarRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const molstarSource = JSON.parse(readFileSync(resolve(molstarRepoRoot, 'config/molstar-source.json'), 'utf8'));
export const molstarSourceRoot = resolve(molstarRepoRoot, '.tmp/molstar', molstarSource.revision);

export const molstarCompiledRoot = resolve(molstarSourceRoot, '.burette-lib');

let preparation;
export function prepareMolstarSource() {
  return preparation ??= prepare();
}

function sourceIdentity() {
  const hash = createHash('sha256');
  for (const name of ['prepare-molstar-source.mjs', 'molstar-source.mjs', 'molstar-segmentor-lifecycle.mjs']) hash.update(readFileSync(resolve(molstarRepoRoot, 'scripts', name)));
  return JSON.stringify({ recipe: hash.digest('hex'), compiler: process.versions.bun, ...molstarSource });
}

function sourceLinksCurrent() {
  try {
    return readlinkSync(resolve(molstarRepoRoot, 'node_modules/@molstar/core/src')) === resolve(molstarCompiledRoot, 'packages/core/src')
      && readlinkSync(resolve(molstarRepoRoot, 'node_modules/@molstar/core/types')) === resolve(molstarSourceRoot, 'packages/core/lib');
  } catch { return false; }
}

async function prepare() {
  const ready = resolve(molstarRepoRoot, 'node_modules/.burette-molstar-source');
  const sourceMarker = resolve(molstarSourceRoot, '.burette-source.json');
  const identity = sourceIdentity();
  if (existsSync(sourceMarker) && readFileSync(sourceMarker, 'utf8') === identity
    && existsSync(ready) && readFileSync(ready, 'utf8') === identity
    && sourceLinksCurrent()) return molstarSourceRoot;
  const lock = resolve(molstarSourceRoot, '../prepare.lock');
  mkdirSync(dirname(lock), { recursive: true });
  let acquired = false;
  for (let tries = 0; tries < 1200; tries++) {
    try {
      mkdirSync(lock);
      writeFileSync(resolve(lock, 'owner'), String(process.pid));
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const ownerFile = resolve(lock, 'owner');
        const owner = existsSync(ownerFile) ? Number(readFileSync(ownerFile, 'utf8')) : undefined;
        let alive = false;
        if (owner) {
          try { process.kill(owner, 0); alive = true; } catch (failure) { if (failure.code === 'EPERM') alive = true; }
        }
        if (!alive && (owner || Date.now() - statSync(lock).mtimeMs > 5000)) {
          const stale = `${lock}.stale-${process.pid}-${Date.now()}`;
          renameSync(lock, stale);
          if (existsSync(resolve(stale, 'owner'))) unlinkSync(resolve(stale, 'owner'));
          rmdirSync(stale);
          continue;
        }
      } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      await new Promise(resolveWait => setTimeout(resolveWait, 50));
    }
  }
  if (!acquired) throw new Error('Another Mol* source preparation did not finish within one minute.');
  try { return await prepareLocked(ready); } finally { unlinkSync(resolve(lock, 'owner')); rmdirSync(lock); }
}

async function prepareLocked(ready) {
  const marker = resolve(molstarSourceRoot, '.burette-source.json');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === sourceIdentity()) {
    linkSourcePackages();
    writeAtomic(ready, sourceIdentity());
    return molstarSourceRoot;
  }
  mkdirSync(molstarSourceRoot, { recursive: true });
  const archive = resolve(molstarSourceRoot, '../source.tar.gz');
  let bytes = existsSync(archive) ? readFileSync(archive) : undefined;
  const digest = data => createHash('sha256').update(data).digest('hex');
  if (!bytes || digest(bytes) !== molstarSource.sha256) {
    const response = await fetch(molstarSource.archive, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Mol* source download failed: HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    if (digest(bytes) !== molstarSource.sha256) throw new Error('Mol* source archive integrity mismatch.');
    writeFileSync(archive, bytes);
  }
  const result = spawnSync('tar', ['-xzf', archive, '--strip-components=1', '-C', molstarSourceRoot], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Could not unpack the pinned Mol* source.');
  const version = JSON.parse(readFileSync(resolve(molstarSourceRoot, 'version.json'), 'utf8')).version;
  if (version !== molstarSource.version) throw new Error('Mol* source version mismatch.');
  compileSource();
  const declarationResult = spawnSync(resolve(molstarRepoRoot, 'node_modules/.bin/tsc'), ['-b', resolve(molstarSourceRoot, 'apps/viewer'), resolve(molstarSourceRoot, 'apps/mesoscale-explorer'), '--noCheck', '--emitDeclarationOnly'], { stdio: 'inherit' });
  if (declarationResult.status !== 0) throw new Error('Could not emit the pinned Mol* declaration boundary.');
  normalizeDeclarations();
  linkSourcePackages();
  writeAtomic(marker, sourceIdentity());
  writeAtomic(ready, sourceIdentity());
  return molstarSourceRoot;
}

function compileSource() {
  if (typeof Bun === 'undefined') throw new Error('Mol* source preparation requires Bun.');
  mkdirSync(molstarCompiledRoot, { recursive: true });
  const identityModule = resolve(molstarCompiledRoot, '.identity-v6.mjs');
  writeAtomic(identityModule, '// Immutable Mol* source compilation identity.\n');
  const transpilers = Object.fromEntries(['ts', 'tsx'].map(loader => [loader, new Bun.Transpiler({ loader, target: 'browser', autoImportJSX: true, tsconfig: { compilerOptions: { useDefineForClassFields: false, jsx: 'react-jsx' } } })]));
  const visit = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '_test', '_spec', 'lib', 'build', 'dist', 'sequences', 'prism', 'ai'].includes(entry.name)) visit(file);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        const loader = entry.name.endsWith('.tsx') ? 'tsx' : 'ts';
        const output = resolve(molstarCompiledRoot, relative(molstarSourceRoot, file)).replace(/\.tsx?$/, '.js');
        mkdirSync(dirname(output), { recursive: true });
        let javascript = transpilers[loader].transformSync(readFileSync(file, 'utf8'));
        if (relative(molstarSourceRoot, file) === 'packages/extensions/volume-tools/src/segmentor/manager.ts') javascript = patchMolstarSegmentorLifecycle(javascript);
        if (relative(molstarSourceRoot, file) === 'packages/plugin/core/src/state/formats/volume/ccp4.ts') javascript = patchMolstarVolumeDimensions(javascript);
        const identityImport = `import ${JSON.stringify(relative(dirname(output), identityModule).split('\\').join('/'))};\n`;
        writeAtomic(output, `${JSON.stringify(`Burette Mol* ${molstarSource.revision}: ${relative(molstarSourceRoot, file)}`)};\n` + identityImport + javascript);
      } else if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) {
        const output = resolve(molstarCompiledRoot, relative(molstarSourceRoot, file));
        mkdirSync(dirname(output), { recursive: true });
        copyFileSync(file, output);
      }
    }
  };
  visit(resolve(molstarSourceRoot, 'packages'));
  visit(resolve(molstarSourceRoot, 'apps'));
  copyFileSync(resolve(molstarSourceRoot, 'version.json'), resolve(molstarCompiledRoot, 'version.json'));
}

function normalizeDeclarations() {
  // Inferred types emitted across workspace packages can name their source
  // path. Keep consumers behind declarations, rather than pulling upstream TS
  // into Burette's different compiler settings and React version.
  const visit = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'src'].includes(entry.name)) visit(file);
      else if (entry.name.endsWith('.d.ts')) {
        const source = readFileSync(file, 'utf8');
        writeAtomic(file, source.replace(/((?:import\(["']|from\s+["'])[^"']*)\/src\//g, '$1/lib/'));
      }
    }
  };
  visit(resolve(molstarSourceRoot, 'packages'));
  visit(resolve(molstarSourceRoot, 'apps'));
}

function writeAtomic(path, contents) {
  if (existsSync(path) && readFileSync(path, 'utf8') === contents) return;
  const temporary = `${path}.burette-${process.pid}`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

// Bun's runtime plugin API cannot resolve package aliases. Materialize only
// package metadata and source links; all implementation stays in the verified
// source cache, and every generated package uses the same immutable revision.
function linkSourcePackages() {
  const modules = resolve(molstarRepoRoot, 'node_modules');
  const link = (target, path) => {
    if (!existsSync(target)) return;
    let current;
    try { current = lstatSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current && !current.isSymbolicLink()) throw new Error(`Refusing to replace a non-managed Mol* directory: ${path}`);
    if (current && readlinkSync(path) === target) return;
    const temporary = `${path}.burette-${process.pid}`;
    symlinkSync(target, temporary, 'dir');
    renameSync(temporary, path);
  };
  const visit = path => {
    const file = resolve(path, 'package.json');
    if (existsSync(file)) {
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      if (manifest.name?.startsWith('@molstar/')) {
        const destination = resolve(modules, manifest.name);
        mkdirSync(destination, { recursive: true });
        const compiledPackage = resolve(molstarCompiledRoot, relative(molstarSourceRoot, path));
        link(resolve(compiledPackage, 'src'), resolve(destination, 'src'));
        link(resolve(path, 'lib'), resolve(destination, 'types'));
        link(resolve(path, 'lib'), resolve(compiledPackage, 'types'));
        const entries = Object.fromEntries(Object.entries(manifest.exports ?? {}).map(([key, value]) => {
          const source = typeof value === 'string' ? value : value?.['molstar-src'];
          const javascript = source?.replace(/\.tsx?$/, '.js');
          const types = source?.replace('./src/', './types/').replace(/\.tsx?$/, '.d.ts');
          return [key, source ? { types, bun: javascript, import: javascript } : null];
        }));
        writeAtomic(resolve(destination, 'package.json'), JSON.stringify({ name: manifest.name, version: molstarSource.version, type: 'module', exports: entries }));
        mkdirSync(compiledPackage, { recursive: true });
        writeAtomic(resolve(compiledPackage, 'package.json'), JSON.stringify({ name: manifest.name, version: molstarSource.version, type: 'module', exports: entries }));
      }
    }
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'src', 'lib', 'build'].includes(entry.name)) visit(resolve(path, entry.name));
    }
  };
  visit(resolve(molstarSourceRoot, 'packages'));
  visit(resolve(molstarSourceRoot, 'apps'));

}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareMolstarSource();
  console.log(`Prepared Mol* ${molstarSource.version} (${molstarSource.revision}).`);
}
