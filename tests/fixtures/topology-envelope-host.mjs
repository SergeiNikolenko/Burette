import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { plugin as bunPlugin } from 'bun';
import { transformSync } from '@babel/core';
import { StructureElement } from 'molstar/lib/mol-model/structure.js';

export async function checkTopologyEnvelope({ dom, source, targetPlugin, science, nextText, geometry, scene }) {
  const descriptors = new Map();
  for (const [key, value] of Object.entries({ CSS: dom.CSS, Node: dom.Node, HTMLElement: dom.HTMLElement, navigator: dom.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  let compiled = false;
  bunPlugin({ name: 'topology-budget-compiler', setup(build) {
    build.onLoad({ filter: /apps\/desktop\/src\/hooks\/use-topology-transfer\.ts$/u }, ({ path }) => {
      const output = transformSync(readFileSync(path, 'utf8'), { filename: path, babelrc: false, configFile: false,
        parserOpts: { plugins: ['typescript'] }, plugins: [['babel-plugin-react-compiler', {}]] });
      assert.ok(output?.code); compiled = true;
      return { contents: output.code, loader: 'ts' };
    });
  } });
  const { default: React, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useTopologyTransfer } = await import('../../apps/desktop/src/hooks/use-topology-transfer.ts');
  const { adoptLogicalSource, releaseClosedScienceSessions } = await import('../../apps/desktop/src/lib/science-session/state.ts');
  const { addDocumentInternalCoordinates, releaseClosedImports } = await import('../../apps/desktop/src/lib/workbench/scientific-source-state.ts');
  const { captureViewerActionTarget } = await import('../../apps/desktop/src/lib/viewer-bridge.ts');
  const { parseXyz } = await import('../../apps/desktop/src/lib/molecular-workbench/xyz.ts');
  const documentId = 'real-topology-budget', text = geometry.binding(source).text;
  adoptLogicalSource({ documentId, extension: 'xyz', text }, crypto.randomUUID(), null, science.atoms.map(atom => atom.element));
  addDocumentInternalCoordinates(documentId, text, science);
  const element = dom.document.createElement('div'), frame = dom.document.createElement('iframe');
  frame.className = 'viewer-iframe'; frame.dataset.documentId = documentId; frame.dataset.renderer = 'molstar';
  dom.document.body.append(element, frame);
  const root = createRoot(element), scope = { molstar: { BuretteGeometry: geometry, BuretteTopologyScene: scene, lib: { structure: { StructureElement } } } };
  for (const name of ['scene-file-actions', 'measurement-coordinate']) vm.runInNewContext(
    readFileSync(new URL(`../../PreviewExtension/Web/${name}.js`, import.meta.url), 'utf8'),
    { window: scope, crypto, TextEncoder, TextDecoder, Uint8Array, Float64Array, File });
  const viewerSource = readFileSync(new URL('../../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
  const extract = name => viewerSource.match(new RegExp('\\n  (?:async )?function ' + name + '\\([\\s\\S]*?\\n  \\}', 'u'))[0];
  let active = { plugin: source };
  const measurement = async () => scope.BuretteMeasurementCoordinate;
  const execute = new Function('window', 'activeMolstarViewer', 'measurementCoordinateRuntime', extract('executeBuretteAgentAction') + '; return executeBuretteAgentAction;')(scope, () => active, measurement);
  const restore = new Function('window', 'activeMolstarViewer', 'measurementCoordinateRuntime', extract('restoreMeasurementPreview') + '; return restoreMeasurementPreview;')(scope, () => active, measurement);
  Object.defineProperty(frame.contentWindow, 'postMessage', { configurable: true, value: async data => {
    if (data.source !== 'burette-agent-host') return;
    let result;
    try { result = await execute(data.body.action); } catch (error) { result = { ok: false, error: { message: error.message } }; }
    dom.dispatchEvent(new dom.MessageEvent('message', { source: frame.contentWindow, data: {
      source: 'burette-agent-viewer', body: { type: 'agent-action-result', id: data.body.id, result },
    } }));
  } });
  let hook;
  function Host() { hook = useTopologyTransfer(); return null; }
  try {
    await act(async () => { root.render(React.createElement(Host)); }); assert.equal(compiled, true);
    const target = { text: nextText, document: { format: 'xyz', ...parseXyz(nextText) }, topology: 1, sourceAtomIndices: [0, 1, 2, -1] };
    const binding = { ...geometry.binding(source), target: captureViewerActionTarget(documentId) };
    assert.ok(binding.target);
    const prepared = await hook.prepare({ id: documentId }, target, binding, () => true);
    assert.equal(hook.owns(prepared), true); await prepared.validate(() => true);
    const payloadBytes = new TextEncoder().encode(prepared.rendererViewState).byteLength;
    assert.ok(payloadBytes > 1024 * 1024 && payloadBytes < 2 * 1024 * 1024 + 8192);
    active = { plugin: targetPlugin };
    await restore(active, { rendererViewState: prepared.rendererViewState });
    const { receipt, ...restored } = scene.capture(targetPlugin, geometry.binding(targetPlugin).lease);
    const expected = JSON.parse(prepared.rendererViewState).topologyScene;
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    assert.equal(hash(restored), hash(expected), 'compiled host producer and actual receiver retain every field over the message bridge');
    const exactEnvelope = prepared.rendererViewState + ' '.repeat(2 * 1024 * 1024 + 8192 - payloadBytes);
    assert.ok(await restore(active, { rendererViewState: exactEnvelope }), 'the exact topology envelope boundary reaches native restore');
    const tree = targetPlugin.state.data.tree;
    assert.equal(await restore(active, { rendererViewState: exactEnvelope + ' ' }), null);
    assert.equal(targetPlugin.state.data.tree, tree);
    for (const value of [
      { version: 1, camera: { padding: 'x'.repeat(8192) } },
      { version: 2, topologyScene: expected, padding: '' },
      { version: 1, topologyScene: { ...expected, version: 2 } },
      { version: 1, topologyScene: expected, padding: 'x'.repeat(2 * 1024 * 1024 + 8192) },
    ]) {
      assert.equal(await restore(active, { rendererViewState: JSON.stringify(value) }), null);
      assert.equal(targetPlugin.state.data.tree, tree, 'invalid or oversized transient envelope does not mutate native state');
    }
    console.log(`Compiled host/native receiver retained ${payloadBytes} bytes; ordinary-view, version and oversized envelopes refused read-only.`);
  } finally {
    await act(async () => root.unmount()); element.remove(); frame.remove();
    releaseClosedImports(new Set()); releaseClosedScienceSessions(new Set());
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}
