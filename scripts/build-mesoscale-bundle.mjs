import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserEncoderCryptoPlugin, assertNoLegacyBrowserCrypto } from './browser-encoder-crypto-plugin.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await Bun.build({
  entrypoints: [resolve(root, 'apps/desktop/src/preview-mesoscale/mesoscale-runtime.ts')],
  target: 'browser', format: 'iife', minify: true, loader: { '.jpg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [await browserEncoderCryptoPlugin(root)],
});
if (!result.success) throw new AggregateError(result.logs, 'Mesoscale browser build failed');
const code = (await result.outputs.find(output => output.kind === 'entry-point').text()).replace(/[ \t]+$/gmu, '');
assertNoLegacyBrowserCrypto(code);
await Bun.write(resolve(root, 'PreviewExtension/Web/mesoscale.js'), code);
