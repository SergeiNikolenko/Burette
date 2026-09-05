import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = ['molstar.css', 'viewer-runtime.css', 'molstar.js', 'viewer-shell.js', 'burette-agent.js', 'trajectory-smoothing.js', 'molstar-preset-preview-controller.js', 'superposition-panel.js', 'viewer.js'];
const assets = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(resolve(root, 'PreviewExtension/Web', name), 'utf8')])));
// The desktop's optional MP4 encoder initializes eval-based Emscripten glue on
// import. Exclude that capability only from the sandboxed MCP App build.
const molstar = await Bun.build({
  entrypoints: [resolve(root, 'scripts/molstar-viewer-entry.js')], target: 'browser', format: 'iife', minify: true,
  loader: { '.jpg': 'dataurl' }, define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [{ name: 'molstar-mcp-app-csp', setup(build) {
    build.onLoad({ filter: /molstar\/lib\/apps\/viewer\/extensions\.js$/u }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const importLine = "import { Mp4Export } from '../../extensions/mp4-export/index.js';";
      const entry = "    'mp4-export': PluginSpec.Behavior(Mp4Export),";
      if (!source.includes(importLine) || !source.includes(entry)) throw new Error('Mol* MP4 extension layout changed; review the MCP App CSP build.');
      return { contents: source.replace(importLine, '').replace(entry, ''), loader: 'js' };
    });
    build.onLoad({ filter: /molstar\/lib\/mol-util\/string\.js$/u }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const start = source.indexOf('export function interpolate(');
      const end = source.indexOf('export function trimChar(', start);
      if (start < 0 || end < 0 || !source.slice(start, end).includes('new Function')) throw new Error('Mol* interpolation changed; review the MCP App CSP build.');
      const replacement = 'export function interpolate(str, params) { return str.replace(/\\$\\{([^}]+)\\}/g, (_, key) => { if (!Object.hasOwn(params, key)) throw new Error("Unsupported interpolation: " + key); return String(params[key]); }); }\n';
      return { contents: source.slice(0, start) + replacement + source.slice(end), loader: 'js' };
    });
  } }],
});
if (!molstar.success) throw new Error(molstar.logs.join('\n'));
assets['molstar.js'] = await molstar.outputs[0].text();
const result = await Bun.build({ entrypoints: [resolve(root, 'plugins/burette-agent/ui/local-viewer.mjs')], target: 'browser', format: 'esm', minify: true });
if (!result.success) throw new Error(result.logs.join('\n'));
const bootstrap = (await result.outputs[0].text()).replaceAll('</script', '<\\/script');
const packed = gzipSync(JSON.stringify(assets)).toString('base64');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Burette</title><style>html,body,#app{margin:0;width:100%;height:100%;min-height:420px}#status{position:absolute;top:8px;left:8px}.hidden{display:none}</style></head><body><div id="app"></div><div id="status">Loading local Burette viewer…</div><script id="burette-assets" type="application/octet-stream">${packed}</script><script type="module">${bootstrap}</script></body></html>`;
if (Buffer.byteLength(html) > 4 * 1024 * 1024) throw new Error('Local viewer HTML exceeds the 4 MiB resource budget.');
await mkdir(resolve(root, 'plugins/burette-agent/assets'), { recursive: true });
await writeFile(resolve(root, 'plugins/burette-agent/assets/local-viewer.html'), html);
console.log(JSON.stringify({ resourceBytes: Buffer.byteLength(html), networkRequired: false }));
