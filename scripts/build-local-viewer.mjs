import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildMcpMolstar } from './build-mcp-molstar.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const appRootIndex = process.argv.indexOf('--app-root');
if (appRootIndex >= 0 && !process.argv[appRootIndex + 1]) throw new Error('--app-root requires a checkout path.');
const appRoot = appRootIndex < 0 ? root : resolve(process.argv[appRootIndex + 1]);
const bootstrapOnly = process.argv.includes('--bootstrap-only');
const names = ['molstar.css', 'viewer-runtime.css', 'molstar.js', 'viewer-shell.js', 'burette-agent.js', 'trajectory-smoothing.js', 'molstar-preset-preview-controller.js', 'superposition-panel.js', 'viewer.js'];
const assets = bootstrapOnly ? null : Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(resolve(appRoot, 'PreviewExtension/Web', name), 'utf8')])));
if (assets) assets['molstar.js'] = await buildMcpMolstar(appRoot);
const require = createRequire(import.meta.url);
const tailwindRequire = createRequire(require.resolve('@tailwindcss/vite'));
const { compile } = await import(tailwindRequire.resolve('@tailwindcss/node'));
const { Scanner } = await import(tailwindRequire.resolve('@tailwindcss/oxide'));
const cssPath = resolve(root, 'plugins/burette-agent/ui/local-viewer.css');
const css = await compile(await readFile(cssPath, 'utf8'), { base: dirname(cssPath), onDependency() {} });
// Shell styling must exist before the MCP handshake or molecular asset download.
let shellCss = css.build(new Scanner({ sources: css.sources }).scan());
const result = await Bun.build({
  entrypoints: [resolve(root, 'plugins/burette-agent/ui/local-viewer-entry.mjs')], target: 'browser', format: 'esm', minify: true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [{ name: 'desktop-button-import', setup(build) {
    build.onResolve({ filter: /^@\/lib\/utils$/u }, () => ({ path: resolve(root, 'apps/desktop/src/lib/utils.ts') }));
  } }],
});
if (!result.success) throw new Error(result.logs.join('\n'));
const javascript = result.outputs.find(output => output.path.endsWith('.js'));
if (!javascript) throw new Error('Missing local viewer JavaScript entrypoint.');
// SDK components import CSS modules. Bun emits them alongside the JS; inline
// both into the self-contained resource so the controls work without a server.
for (const output of result.outputs) {
  if (output.path.endsWith('.css')) shellCss += `\n${await output.text()}`;
}
const bootstrap = (await javascript.text()).replaceAll('</script', '<\\/script').replace(/[ \t]+$/gmu, '');
// Legacy resource bindings also embed the shared workspace bootstrap. Preserve
// the unchanged engine archive when only host controls are being rebuilt.
const packed = assets ? gzipSync(JSON.stringify(assets)).toString('base64')
  : /<script id="burette-assets" type="application\/octet-stream">([A-Za-z0-9+/=]+)<\/script>/u.exec(await readFile(resolve(root, 'plugins/burette-agent/assets/local-viewer.html'), 'utf8'))?.[1];
if (!packed) throw new Error('Missing compact runtime archive; run a full local-viewer build.');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Burette</title><style id="burette-compact-style">${shellCss.replaceAll('</style', '<\\/style')}</style></head><body data-display-mode="inline"><div id="mcp-tabs"></div><div id="mcp-header"></div><main id="mcp-scene"><div id="app"></div><div id="status" role="status">Opening Burette…</div></main><script id="burette-assets" type="application/octet-stream">${packed}</script><script type="module">${bootstrap}</script></body></html>`;
if (Buffer.byteLength(html) > 4 * 1024 * 1024) throw new Error('Local viewer HTML exceeds the 4 MiB resource budget.');
await mkdir(resolve(root, 'plugins/burette-agent/assets'), { recursive: true });
await writeFile(resolve(root, 'plugins/burette-agent/assets/local-viewer.html'), html);
console.log(JSON.stringify({ resourceBytes: Buffer.byteLength(html), networkRequired: false }));
