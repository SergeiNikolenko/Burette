import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { molstarSource, molstarSourceRoot, molstarCompiledRoot, prepareMolstarSource } from './prepare-molstar-source.mjs';

export { molstarSource, molstarSourceRoot, molstarCompiledRoot, prepareMolstarSource };
let packages;

function readInventory() {
  if (packages) return;
  packages = new Map();
  const visit = path => {
    if (existsSync(resolve(path, 'package.json'))) {
      const manifest = JSON.parse(readFileSync(resolve(path, 'package.json'), 'utf8'));
      if (manifest.name?.startsWith('@molstar/')) packages.set(manifest.name, { path, manifest });
    }
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'src', 'lib', 'build'].includes(entry.name)) visit(resolve(path, entry.name));
    }
  };
  visit(resolve(molstarSourceRoot, 'packages'));
  visit(resolve(molstarSourceRoot, 'apps'));
}

// Browser, native and Node authoring builds resolve the same compiled source.
export function resolveMolstarModule(specifier) {
  readInventory();
  const match = /^(@molstar\/[^/]+)(?:\/(.*))?$/.exec(specifier);
  const pkg = match && packages.get(match[1]);
  if (!pkg) throw new Error(`Unknown pinned Mol* package: ${specifier}`);
  const key = match[2] ? `./${match[2]}` : '.';
  let entry = pkg.manifest.exports?.[key];
  if (entry === null) throw new Error(`Mol* module is private: ${specifier}`);
  if (!entry) {
    for (const [pattern, value] of Object.entries(pkg.manifest.exports ?? {}).sort(([a], [b]) => b.length - a.length)) {
      if (!pattern.includes('*')) continue;
      const [prefix, suffix] = pattern.split('*');
      if (key.startsWith(prefix) && key.endsWith(suffix)) {
        const part = key.slice(prefix.length, suffix ? -suffix.length : undefined);
        entry = value && Object.fromEntries(Object.entries(value).map(([condition, target]) => [condition, target.replace('*', part)]));
        break;
      }
    }
  }
  const source = typeof entry === 'string' ? entry : entry?.['molstar-src'];
  if (!source) throw new Error(`Mol* source export missing: ${specifier}`);
  const path = resolve(pkg.path, source);
  if (!existsSync(path)) throw new Error(`Pinned Mol* module is missing: ${specifier} (${path})`);
  return resolve(molstarCompiledRoot, relative(molstarSourceRoot, path)).replace(/\.tsx?$/, '.js');
}

export async function readMolstarModule(specifier) {
  await prepareMolstarSource();
  const path = resolveMolstarModule(specifier);
  return readFileSync(path, 'utf8');
}

export const molstarSourcePlugin = {
  name: 'burette-pinned-molstar-source',
  setup(build) {
    build.onResolve({ filter: /^@molstar\// }, ({ path }) => ({ path: resolveMolstarModule(path) }));
  },
};

export function molstarPatchPlugin(name, specifier, patch) {
  return {
    name,
    setup(build) {
      const path = resolveMolstarModule(specifier);
      const filter = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      build.onLoad({ filter }, async () => ({ contents: patch(await readMolstarModule(specifier)), loader: 'js' }));
    },
  };
}
