import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';
import { gzipSync } from 'node:zlib';
import { rewriteEmbindForCsp } from '../apps/desktop/vite/native-workspace-csp.ts';

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite-plus/package.json'));
const testRequire = createRequire(viteRequire.resolve('vitest/package.json'));
const { init, parse } = await import(testRequire.resolve('es-module-lexer'));
await init;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

export function rewriteWorkspaceModule(code, path) {
  const dependencies = [];
  const resources = [];
  code = code.replace(/new URL\((["'`])([^"'`]+)\1,\s*(?:import\.meta\.url|self\.location\.href)\)/gu, (original, _quote, name) => {
    if (!/\.(?:js|wasm|png|svg|woff2?)$/u.test(name) || name.includes(':')) return original;
    const target = posix.normalize(posix.join(posix.dirname(path), name));
    if (!target.startsWith('shell/')) return original;
    resources.push(target);
    return `new URL(${JSON.stringify(`burette-packaged:${target}`)})`;
  });
  const edits = [];
  for (const item of parse(code)[0]) {
    if (item.d === -2) continue; // import.meta is not a module dependency.
    if (!item.n && item.d >= 0) {
      edits.push({ start: item.ss, end: item.se, text: `window.BuretteMcpWorkspace.importModuleAt(${JSON.stringify(path)},${code.slice(item.d + 1, item.se - 1)})` });
      continue;
    }
    if (!item.n) throw new Error(`Invalid module import in ${path}`);
    if (!item.n.startsWith('.')) throw new Error(`Unbundled module ${item.n} in ${path}`);
    const target = posix.normalize(posix.join(posix.dirname(path), item.n));
    if (!target.startsWith('shell/')) throw new Error('Workspace module escapes its bundle.');
    if (item.d >= 0) edits.push({ start: item.ss, end: item.se, text: `window.BuretteMcpWorkspace.importModule(${JSON.stringify(target)})` });
    else {
      dependencies.push(target);
      edits.push({ start: item.s, end: item.e, text: `burette:${target}` });
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  code = code.replaceAll('import.meta.url', `window.BuretteMcpWorkspace.moduleBase(${JSON.stringify(path)})`);
  return { code, dependencies: [...new Set(dependencies)], resources: [...new Set(resources)] };
}

export async function packNativeWorkspace({ shellRoot, runtimeRoot, outputRoot, molstar }) {
  const manifest = { version: 1, entry: 'shell/index.js', styles: [], assets: {} };
  await mkdir(outputRoot, { recursive: true });
  async function add(path, bytes, dependencies = [], resources = []) {
    const packed = gzipSync(bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (packed.length > 24 * 1024 * 1024 || bytes.length > 64 * 1024 * 1024) throw new Error(`Workspace asset is too large: ${path}`);
    manifest.assets[path] = { sha256, byteCount: bytes.length, packedBytes: packed.length, mimeType: types[extname(path)] || 'application/octet-stream', dependencies, resources };
    await writeFile(join(outputRoot, `${sha256}.gz`), packed);
  }
  async function walk(directory, prefix) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isDirectory()) await walk(join(directory, item.name), `${prefix}/${item.name}`);
      else if (item.isFile() && types[extname(item.name)]) {
        const path = `${prefix}/${item.name}`;
        let bytes = await readFile(join(directory, item.name));
        let dependencies = [];
        let resources = [];
        if (path.startsWith('shell/') && item.name.endsWith('.css')) {
          // SDK UI includes CDN-backed KaTeX faces. Reuse the same fonts Vite
          // already bundled for Burette; never loosen the offline loader/CSP.
          const siblings = await readdir(directory);
          const css = bytes.toString('utf8').replace(
            /https:\/\/cdn\.openai\.com\/common\/fonts\/katex\/(KaTeX_[A-Za-z0-9_-]+)\.woff2/gu,
            (_url, name) => {
              const matches = siblings.filter(file => file === `${name}.woff2` || (file.startsWith(`${name}-`) && file.endsWith('.woff2')));
              if (matches.length !== 1) throw new Error(`Expected one packaged SDK font: ${name}`);
              return `./${matches[0]}`;
            },
          );
          bytes = Buffer.from(css);
        }
        if (path.startsWith('shell/') && item.name.endsWith('.js')) {
          const result = rewriteWorkspaceModule(bytes.toString('utf8'), path);
          bytes = Buffer.from(result.code);
          dependencies = result.dependencies;
          resources = result.resources;
        }
        await add(path, bytes, dependencies, resources);
      }
    }
  }
  await walk(shellRoot, 'shell');
  // Only the visualization runtimes used by the shared shell, not its compute
  // engines, diagnostics, or standalone application files.
  for (const name of ['molstar.js', 'molstar.css', 'viewer-runtime.css', 'viewer-shell.js', 'viewer-bootstrap.js', 'sequence-panel.js', 'molecule-preview-interactions.js', 'renderer-view-state.js', 'color-picker.js', 'scene-file-actions.js', 'viewer.js', 'burette-agent.js', 'trajectory-smoothing.js', 'molstar-preset-preview-controller.js', 'superposition-panel.js', 'grid-viewer.js', 'grid-ui.js', 'grid.css', 'rdkit/RDKit_minimal.js', 'rdkit/RDKit_minimal.wasm', 'openchemlib/openchemlib.js']) {
    let bytes = name === 'molstar.js' ? Buffer.from(molstar) : await readFile(join(runtimeRoot, name));
    if (name === 'rdkit/RDKit_minimal.js') bytes = Buffer.from(rewriteEmbindForCsp(bytes.toString('utf8')));
    await add(`runtime/${name}`, bytes);
  }
  const index = await readFile(join(shellRoot, 'index.html'), 'utf8');
  const entry = index.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/u)?.[1];
  if (!entry) throw new Error('Shared shell has no module entry.');
  manifest.entry = posix.join('shell', entry);
  manifest.styles = [...index.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gu)].map(match => posix.join('shell', match[1]));
  for (const [path, entry] of Object.entries(manifest.assets)) {
    for (const dependency of entry.dependencies) if (!manifest.assets[dependency]) throw new Error(`Missing ${dependency} for ${path}`);
    for (const resource of entry.resources) if (!manifest.assets[resource]) throw new Error(`Missing resource ${resource} for ${path}`);
  }
  const json = JSON.stringify(manifest);
  if (Buffer.byteLength(json) > 192 * 1024) throw new Error('Workspace asset manifest exceeds 192 KiB.');
  await writeFile(join(outputRoot, 'manifest.json'), json);
  return manifest;
}
