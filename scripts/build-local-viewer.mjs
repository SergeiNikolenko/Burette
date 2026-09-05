import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = ['molstar.css', 'viewer-runtime.css', 'molstar.js', 'viewer-shell.js', 'burette-agent.js', 'trajectory-smoothing.js', 'molstar-preset-preview-controller.js', 'superposition-panel.js', 'viewer.js'];
const assets = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(resolve(root, 'PreviewExtension/Web', name), 'utf8')])));
const result = await Bun.build({ entrypoints: [resolve(root, 'plugins/burette-agent/ui/local-viewer.mjs')], target: 'browser', format: 'esm', minify: true });
if (!result.success) throw new Error(result.logs.join('\n'));
const bootstrap = (await result.outputs[0].text()).replaceAll('</script', '<\\/script');
const packed = gzipSync(JSON.stringify(assets)).toString('base64');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Burette</title><style>html,body,#app{margin:0;width:100%;height:100%;min-height:420px}#status{position:absolute;top:8px;left:8px}.hidden{display:none}</style></head><body><div id="app"></div><div id="status">Loading local Burette viewer…</div><script id="burette-assets" type="application/octet-stream">${packed}</script><script type="module">${bootstrap}</script></body></html>`;
if (Buffer.byteLength(html) > 4 * 1024 * 1024) throw new Error('Local viewer HTML exceeds the 4 MiB resource budget.');
await mkdir(resolve(root, 'plugins/burette-agent/assets'), { recursive: true });
await writeFile(resolve(root, 'plugins/burette-agent/assets/local-viewer.html'), html);
console.log(JSON.stringify({ resourceBytes: Buffer.byteLength(html), networkRequired: false }));
