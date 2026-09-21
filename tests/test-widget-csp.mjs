import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

// Bundle the real bridge entry: importing config in the test itself would hide
// initialization-order regressions and miss duplicate bundled Zod instances.
const result = await Bun.build({
  entrypoints: ['widget-csp-test'],
  target: 'browser', format: 'esm', minify: true,
  plugins: [{ name: 'bridge-probe', setup(build) {
    build.onResolve({ filter: /^widget-csp-test$/ }, () => ({ path: 'entry', namespace: 'probe' }));
    build.onLoad({ filter: /.*/, namespace: 'probe' }, () => ({
      contents: `import { connectViewer } from ${JSON.stringify(new URL('../plugins/burette-agent/ui/mcp-viewer-entry.mjs', import.meta.url).pathname)}; globalThis.bridgeType = typeof connectViewer;`,
      loader: 'js',
    }));
  } }],
});
assert.equal(result.success, true, String(result.logs));
let attempts = 0;
const blockEval = () => { attempts++; throw new Error('CSP forbids dynamic code'); };
runInNewContext(await result.outputs[0].text(), {
  console, URL, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
  Function: new Proxy(Function, { construct: blockEval, apply: blockEval }),
}, { timeout: 5000, contextCodeGeneration: { strings: false, wasm: false } });
assert.equal(attempts, 0, 'MCP schema initialization must not probe eval');
console.log('Bundled local MCP bridge initializes without dynamic code generation.');
