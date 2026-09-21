import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { molstarStatePreconditionPlugin } from './molstar-state-precondition.mjs';

export async function buildMcpMolstar(root) {
  // The optional MP4 encoder initializes eval-based Emscripten glue on import.
  // Both native MCP surfaces omit it and share the same CSP-safe substitutions.
  const result = await Bun.build({
    entrypoints: [resolve(root, 'scripts/molstar-viewer-entry.js')], target: 'browser', format: 'iife', minify: true,
    loader: { '.jpg': 'dataurl' }, define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [molstarStatePreconditionPlugin, { name: 'molstar-mcp-app-csp', setup(build) {
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
  if (!result.success) throw new Error(result.logs.join('\n'));
  return result.outputs[0].text();
}
