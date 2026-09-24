import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspaceAgent, svgSize } from '../plugins/burette-agent/ui/native-workspace-agent.mjs';
import { captureToolResult } from '../scripts/mcp-app-capture.mjs';

const path = '/authorized/caffeine.xyz';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><circle r="4"/></svg>';
const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// A fake page: viewer iframes plus dock elements measured as { open, width, height }.
function page({ frames = [], docks = {} } = {}) {
  return {
    querySelector(selector) {
      const dock = docks[/data-area="(\w+)"/u.exec(selector)?.[1]];
      return dock ? { dataset: { open: String(dock.open) }, getBoundingClientRect: () => dock } : null;
    },
    querySelectorAll: () => frames,
  };
}
function clock() {
  let time = 0;
  return { now: () => time, sleep: ms => { time += ms; return new Promise(resolve => setImmediate(resolve)); } };
}
const xyzDocument = { id: 'doc-1', title: 'caffeine.xyz', path, renderer: 'xyzrender-external', ready: true };

test('xyzrender outcomes are observable per document, including silent Mol* fallback', async () => {
  const agent = createWorkspaceAgent({ root: page(), ...clock() });
  agent.request([path, '/authorized/protein.pdb'], 'xyzrender');
  const observed = () => agent.decorate({ documents: [{ ...xyzDocument, renderer: 'molstar' }, { id: 'doc-2', path: '/authorized/protein.pdb', renderer: 'molstar' }, { id: 'doc-3', path: '/authorized/other.pdb', renderer: 'molstar' }] }).documents;
  const [, protein, other] = observed();
  assert.equal(protein.externalRenderer.status, 'fallback');
  assert.match(protein.externalRenderer.reason, /1500 atoms/u);
  assert.equal(other.externalRenderer, undefined, 'documents opened without xyzrender stay unannotated');
  await assert.rejects(agent.xyzrender(path, { preset: 'flat' }, async () => { throw new Error('External xyzrender executable was not found on this host.'); }));
  assert.deepEqual([observed()[0].externalRenderer.status, observed()[0].externalRenderer.error], ['fallback', 'External xyzrender executable was not found on this host.']);
  await agent.xyzrender(path, { preset: 'flat', controls: { atomScale: 1.2, fog: null } }, async () => ({ svg, preset: 'flat', elapsedMs: 12 }));
  const { activeDocument } = agent.decorate({ activeDocument: xyzDocument });
  assert.deepEqual(activeDocument.externalRenderer, { status: 'ready', requested: 'xyzrender', preset: 'flat', controls: { atomScale: 1.2 }, output: { svgBytes: svg.length, width: 300, height: 150 }, elapsedMs: 12 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 80 40" width="100%">'), { svgBytes: 38, width: 80, height: 40 });
});

test('capture and observation work on the xyzrender SVG; Mol* commands explain the active renderer', async () => {
  const rasterized = [];
  const agent = createWorkspaceAgent({ root: page(), rasterize: async input => { rasterized.push(input); return { dataUri: onePixelPng }; }, ...clock() });
  const current = () => ({ activeDocument: xyzDocument });
  assert.equal((await agent.intercept({ type: 'capture_scene' }, current)()).result.error.code, 'XYZRENDER_NOT_RENDERED');
  await agent.xyzrender(path, { preset: 'tube' }, async () => ({ svg, preset: 'tube' }));
  const captured = await agent.intercept({ type: 'capture_scene', scope: 'auto' }, current)();
  assert.deepEqual(rasterized, [svg]);
  const tool = captureToolResult({ sessionId: 's', actionId: 'a', status: 'completed', action: { type: 'capture_scene' }, result: captured.result });
  assert.deepEqual([tool.content[1].type, tool.structuredContent.images, tool.structuredContent.renderer], ['image', [{ role: 'scene', width: 1, height: 1 }], 'xyzrender']);
  const observed = await agent.intercept({ type: 'observe_scene' }, current)();
  assert.deepEqual([observed.result.ok, observed.result.result.externalRenderer.preset], [true, 'tube']);
  assert.equal((await agent.intercept({ type: 'focus_ligand' }, current)()).result.error.code, 'XYZRENDER_ACTIVE');
  assert.equal(agent.intercept({ type: 'capture_scene' }, () => ({ activeDocument: { ...xyzDocument, renderer: 'molstar' } })), null, 'Mol* documents keep the shell path');
});

test('set_xyzrender_view merges controls, completes after the new render and reports unavailable switches', async () => {
  const posted = [];
  const button = { disabled: true };
  const frame = { dataset: { documentId: 'doc-1' }, contentDocument: { querySelector: () => button }, contentWindow: { postMessage(message) {
    posted.push(message);
    void agent.xyzrender(path, message.body, async () => ({ svg, preset: message.body.preset, xyzrenderControls: message.body.controls })).catch(() => {});
  } } };
  const agent = createWorkspaceAgent({ root: page({ frames: [frame] }), ...clock() });
  await agent.xyzrender(path, { preset: 'default', controls: { atomScale: 1.2 } }, async () => ({ svg, preset: 'default', xyzrenderControls: { atomScale: 1.2 } }));
  let active = xyzDocument;
  const current = () => ({ activeDocument: active });
  const changed = await agent.intercept({ type: 'set_xyzrender_view', preset: 'tube', controls: { bondWidth: 3 } }, current)();
  assert.deepEqual(posted[0], { source: 'burette-host', body: { type: 'setXyzrenderControls', documentId: 'doc-1', preset: 'tube', controls: { atomScale: 1.2, bondWidth: 3 } } });
  assert.deepEqual([changed.status, changed.result.result.externalRenderer.status, changed.result.result.externalRenderer.preset], ['completed', 'ready', 'tube']);
  active = { ...xyzDocument, renderer: 'molstar' };
  assert.equal((await agent.intercept({ type: 'set_xyzrender_view', preset: 'flat' }, current)()).result.error.code, 'XYZRENDER_INACTIVE');
  const unavailable = await agent.intercept({ type: 'set_xyzrender_view', renderer: 'xyzrender' }, current)();
  assert.deepEqual([unavailable.result.error.code, /512 KiB/u.test(unavailable.result.error.message)], ['RENDERER_UNAVAILABLE', true]);
});

test('docks are reported by measured visibility and a panel action fails when nothing renders', async () => {
  const docks = { right: { open: true, width: 320, height: 600 }, bottom: { open: true, width: 800, height: 0 } };
  const agent = createWorkspaceAgent({ root: page({ docks }), displayMode: () => 'inline', ...clock() });
  const observed = agent.decorate({ panels: ['viewer', 'dock:bottom'] });
  assert.deepEqual([observed.panels, observed.docks.bottom], [['viewer', 'dock:right'], { open: true, visible: false, width: 800, height: 0 }]);
  const acknowledged = { status: 'completed', result: { ok: true, command: 'set_workspace_panel', result: { area: 'bottom', open: true } } };
  const hidden = await agent.settlePanel({ area: 'bottom', open: true }, acknowledged);
  assert.equal(hidden.result.error.code, 'PANEL_NOT_RENDERED');
  assert.match(hidden.result.error.message, /800x0 px, inline placement.*180 px.*fullscreen/su);
  docks.bottom.height = 240;
  assert.deepEqual((await agent.settlePanel({ area: 'bottom', open: true }, acknowledged)).result.result, { area: 'bottom', open: true, visible: true, width: 800, height: 240 });
});
