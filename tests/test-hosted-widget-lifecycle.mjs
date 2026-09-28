import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import * as hosted from '../apps/desktop/src/lib/hosted-mcp-widget.ts';

// Exercise the real hook with controllable host events and async document opens.
const source = readFileSync('apps/desktop/src/hooks/use-hosted-mcp-widget.ts', 'utf8')
  .replace(/^import[\s\S]*?;\n/gm, '')
  .replace('export function useHostedMcpWidget', 'function useHostedMcpWidget');
const result = { structuredContent: { fileName: '1STP.pdb' }, _meta: {
  structure: { data: 'ATOM\nEND\n', format: 'pdb', label: '1STP.pdb' },
  scene: { actions: [{ type: 'hide_components', kind: 'water' }] },
} };
function harness() {
  const window = new Window();
  const effects = [], added = [], deleted = [], pending = [], errors = [];
  let closes = 0;
  const deps = { ...hosted, window, document: window.document,
    isHostedMcpWidget: () => true, isHostedKetcherWidget: () => false,
    useRef: current => ({ current }), useEffect: fn => effects.push(fn),
    deleteBrowserDevVirtualTextDocument: path => deleted.push(path),
    openBrowserDevMolstarContextDocument: () => new Promise(resolve => pending.push(resolve)),
  };
  const hook = new Function(...Object.keys(deps), new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
    + '\nreturn useHostedMcpWidget;')(...Object.values(deps));
  hook({ preferences: {}, addDocuments: docs => added.push(...docs),
    closeAllDocuments: () => closes++, pushErrorStatus: error => errors.push(error) });
  return { window, effects, added, deleted, pending, errors, get closes() { return closes; },
    globals(globals) { window.dispatchEvent(new window.CustomEvent('openai:set_globals', { detail: { globals } })); },
    message(params) { window.dispatchEvent(new window.MessageEvent('message', {
      source: window.parent, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params },
    })); },
  };
}
const failures = [];
assert.equal(hosted.selectHostedMcpInitialStructure([result, { structuredContent: result.structuredContent }])?.label, '1STP.pdb');
assert.equal(hosted.selectHostedMcpInitialStructure([result, { isError: true }], result), null);
assert.equal(hosted.parseHostedMcpStructureResult({ _meta: { call_tool_result: { meta: result._meta } } })?.label, '1STP.pdb');
async function check(name, fn) {
  try { await fn(); console.log('PASS', name); }
  catch (error) { failures.push(name); console.error('FAIL', name, error.message); }
}
await check('metadata arriving after toolOutput starts the desktop viewer', async () => {
  const h = harness(); const cleanup = h.effects[0]();
  h.globals({ toolOutput: result.structuredContent });
  h.globals({ toolResponseMetadata: result._meta });
  assert.equal(h.pending.length, 1);
  h.pending[0]({ path: '/virtual/1' }); await Promise.resolve();
  assert.equal(h.added.length, 1); cleanup();
});
await check('partial output update does not clear a loaded structure', async () => {
  const h = harness(); h.window.openai = { toolOutput: result.structuredContent, toolResponseMetadata: result._meta };
  const cleanup = h.effects[0](); h.pending[0]({ path: '/virtual/2' }); await Promise.resolve();
  const closes = h.closes; h.globals({ toolOutput: result.structuredContent });
  assert.equal(h.closes, closes); assert.equal(h.pending.length, 1); cleanup();
});
await check('effect cleanup and remount reopen the same structure', async () => {
  const h = harness(); h.window.openai = { toolOutput: result.structuredContent, toolResponseMetadata: result._meta };
  const cleanup = h.effects[0](); h.pending[0]({ path: '/virtual/3' }); await Promise.resolve();
  cleanup(); const cleanup2 = h.effects[0]();
  assert.equal(h.pending.length, 2); cleanup2();
});
await check('MCP-only host restores its consumed initial payload on effect restart', async () => {
  const h = harness(); h.window.__BURETTE_HOSTED_MCP_RESULTS__ = [result];
  const cleanup = h.effects[0](); h.pending[0]({ path: '/virtual/mcp' }); await Promise.resolve();
  cleanup(); const cleanup2 = h.effects[0]();
  assert.equal(h.pending.length, 2); cleanup2();
});
await check('an async open resolving after unmount cannot add a stale document', async () => {
  const h = harness(); h.window.openai = { toolOutput: result.structuredContent, toolResponseMetadata: result._meta };
  const cleanup = h.effects[0](); cleanup();
  h.pending[0]({ path: '/virtual/stale' }); await Promise.resolve();
  assert.equal(h.added.length, 0); assert.ok(h.deleted.includes('/virtual/stale'));
});
await check('an explicit failure clears instead of retaining a stale success scene', async () => {
  const h = harness(); h.window.openai = { toolOutput: result.structuredContent, toolResponseMetadata: result._meta };
  const cleanup = h.effects[0](); h.pending[0]({ path: '/virtual/4' }); await Promise.resolve();
  const closes = h.closes; h.globals({ toolOutput: { viewerAvailable: false }, toolResponseMetadata: { structure: null } });
  assert.equal(h.closes, closes + 1); cleanup();
});
await check('MCP errors override stale structure metadata rather than reporting success', async () => {
  const h = harness(); const cleanup = h.effects[0]();
  h.message(result); assert.equal(h.pending.length, 1);
  h.pending[0]({ path: '/virtual/previous' }); await Promise.resolve();
  const closes = h.closes;
  h.message({ ...result, isError: true });
  assert.equal(h.closes, closes + 1);
  assert.equal(h.pending.length, 1); cleanup();
});
assert.deepEqual(failures, []);
