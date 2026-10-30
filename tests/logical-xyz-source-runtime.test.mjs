import { afterAll, expect, mock, test } from 'bun:test';
import { plugin as register } from 'bun';
import { readFileSync } from 'node:fs';
import { transformSync } from '@babel/core';
import vm from 'node:vm';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { XYZ, waterScience } from './scientific-data-fixture.ts';
register({ name: 'logical-xyz-runtime-compiler', setup(build) {
  build.onLoad({ filter: /hooks\/use-source-editing\.ts$/u }, ({ path }) => ({ contents: transformSync(readFileSync(path, 'utf8'), {
    filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ['typescript'] }, plugins: [['babel-plugin-react-compiler', {}]],
  }).code, loader: 'ts' }));
} });
const browser = new Window({ url: 'http://localhost/' }), previous = new Map();
Object.assign(browser, { setImmediate, clearImmediate });
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, Element: browser.Element, Node: browser.Node,
  Event: browser.Event, MessageEvent: browser.MessageEvent, CustomEvent: browser.CustomEvent, MutationObserver: browser.MutationObserver,
  localStorage: browser.localStorage, CSS: browser.CSS, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} await browser.happyDOM.close(); });
mock.module('../apps/desktop/src/lib/tauri', () => ({ isTauriRuntime: () => false, trackTauriListener: () => () => {} }));
mock.module('../apps/desktop/src/lib/structure-text', () => ({ readStructureTextDocument: async () => { throw new Error('Archive read as text'); }, readStructureText: async () => { throw new Error('Archive read as text'); } }));
mock.module('../apps/desktop/src/hooks/use-deferred-viewer-runtime', () => ({ prepareDeferredViewerRuntime: async document => document }));
const { createRoot } = await import('react-dom/client');
const { useSourceEditingController } = await import('../apps/desktop/src/hooks/use-source-editing.ts');
const { defaultPreferences } = await import('../apps/desktop/src/stores/settings-store.ts');
const { requestViewerAction } = await import('../apps/desktop/src/lib/viewer-bridge.ts');
const { encodeScienceSession, decodeScienceSession } = await import('../apps/desktop/src/lib/science-session/codec.ts');
const { restoreScienceSession } = await import('../apps/desktop/src/lib/science-session/restore.ts');
const { prepareSceneScienceExport } = await import('../apps/desktop/src/lib/science-session/export.ts');
const { logicalSourceFor, releaseClosedScienceSessions } = await import('../apps/desktop/src/lib/science-session/state.ts');
const { releaseClosedImports } = await import('../apps/desktop/src/lib/workbench/scientific-source-state.ts');
const { PluginContext } = await import('molstar/lib/mol-plugin/context.js');
const { DefaultPluginSpec } = await import('molstar/lib/mol-plugin/spec.js');
const { PluginStateObject: SO, PluginStateTransform } = await import('molstar/lib/mol-plugin-state/objects.js');
const { Task } = await import('molstar/lib/mol-task/index.js');
const { BuretteGeometry } = await import('../scripts/molstar-geometry.js');
const scope = { molstar: { BuretteGeometry }, BuretteAgent: { run() { throw new Error('Unexpected generic agent route'); } } };
for (const name of ['scene-file-actions', 'geometry-preview']) vm.runInNewContext(readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), 'utf8'), { window: scope, crypto, TextEncoder, TextDecoder, Uint8Array, Float64Array, File });
const science = scope.BuretteSceneFiles.science;
const code = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => code.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, 'u'))[0];
const declaration = extract('executeBuretteAgentAction');
const globals = code.slice(code.indexOf('  let geometryPreviewRequest ='), code.indexOf(declaration));
const start = code.indexOf("  window.addEventListener('message', event => {", code.indexOf(declaration)), end = code.indexOf('  window.BuretteViewerActions =', start);
let hold;
const Probe = PluginStateTransform.BuiltIn({ name: 'logical-xyz-source-runtime-probe', from: SO.Molecule.Structure, to: SO.Data.String })({
  apply() { return Task.create('Held real Geometry dependent', async () => { const pending = hold; hold = null;
    if (pending) { pending.start(); await pending.waiting; } return new SO.Data.String('dependent'); }); },
});
const gate = () => { let release, start; return { waiting: new Promise(resolve => { release = resolve; }), entered: new Promise(resolve => { start = resolve; }), release: () => release(), start: () => start() }; };

test('restored MOLX Geometry applies through actual dispatcher ACK and real Molstar capture, exports, Undo and reopens', async () => {
  const plugins = [], frames = [], host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const doc = { id: 'restored-geometry-runtime', path: '/Scenes/water.molx', title: 'water.molx', extension: 'molx', byteCount: 2048, renderer: 'molstar', runtimePath: 'same-MOLX-frame', virtual: true };
  let controller, active, opened = true; const errors = [];
  const newPlugin = async () => { const value = new PluginContext(DefaultPluginSpec()); await value.init(); value.state.setSnapshotParams({ camera: false }); plugins.push(value); return value; };
  const attach = viewer => {
    active = viewer; const frame = document.createElement('iframe'); frame.className = 'viewer-iframe'; frame.dataset.documentId = doc.id; frame.dataset.renderer = 'molstar'; document.body.append(frame); frames.push(frame);
    const source = frame.contentWindow; let listener;
    const runtimeWindow = Object.assign(Object.create(scope), { addEventListener(_name, callback) { listener = callback; } });
    new Function('window', 'activeMolstarViewer', 'loadScript', 'runtimeURL', 'activeConfig', 'document', 'bytesToBase64', `${globals}\n${declaration}\n${extract('agentActionFailure')}\n${code.slice(start, end)}`)(runtimeWindow, () => active, async () => {}, (_key, fallback) => fallback, {}, document, bytes => Buffer.from(bytes).toString('base64'));
    source.postMessage = data => listener({ data, source: { postMessage: reply => window.dispatchEvent(new MessageEvent('message', { source, data: reply })) } });
    return frame;
  };
  const exportScene = async () => {
    const prepared = await prepareSceneScienceExport(doc, { sourceEditing: controller, sceneFileCount: 1, isOpen: () => opened });
    expect(prepared?.kind).toBe('science'); if (prepared?.kind !== 'science') throw new Error('Missing scientific export.');
    const result = await requestViewerAction(doc.id, prepared.action); await prepared.confirm(); return new Uint8Array(Buffer.from(result.dataBase64, 'base64'));
  };
  const reopen = async bytes => {
    const plugin = await newPlugin(), token = science.beginImport(plugin); await plugin.managers.snapshot.open(new File([bytes], 'scene.molx'));
    expect(science.completeImport(plugin, token)).toBe(true); return { plugin };
  };
  function Fixture() { controller = useSourceEditingController({ activeDocument: doc, preferences: defaultPreferences, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} }); return null; }
  try {
    const original = await newPlugin(), raw = await original.builders.data.rawData({ data: XYZ });
    const trajectory = await original.builders.structure.parseTrajectory(raw, 'xyz');
    await original.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
    const binding = science.binding({ plugin: original }), uuid = crypto.randomUUID(), ids = Array.from({ length: 3 }, () => crypto.randomUUID());
    const encoded = await encodeScienceSession({ documentUuid: uuid, source: { extension: 'xyz', text: XYZ }, atomIds: ids, binding, science: waterScience(), original: { name: 'Original.xyz', file: new Blob([XYZ]) } });
    const archive = new Uint8Array(await (await science.serialize({ plugin: original }, { binding, positions: binding.positions, assets: encoded.assets }, { type: 'molx' })).arrayBuffer());
    const viewer = await reopen(archive), frame = attach(viewer);
    expect(await restoreScienceSession(doc, { readBytes: async () => archive, isOpen: () => opened, request: requestViewerAction, pollMs: 1 })).toBe('restored');
    await act(async () => root.render(React.createElement(Fixture)));
    await act(async () => controller.beginEditing(doc, 'geometry')); const owner = logicalSourceFor(doc.id);
    expect(controller.sessionForDocument(doc).content).toBe(XYZ);
    const structure = viewer.plugin.managers.structure.hierarchy.current.structures[0].cell;
    const rawSource = Array.from(viewer.plugin.state.data.cells.values()).find(cell => cell.transform.transformer.id.endsWith('raw-data'));
    const rawObject = rawSource.obj;
    await viewer.plugin.state.data.build().to(structure).apply(Probe).commit();
    const changed = XYZ.replace('0.757200', '1.757200'); hold = gate(); const pendingGate = hold;
    await act(async () => controller.updateDraft(doc, changed)); let apply;
    await act(async () => { apply = Promise.resolve(controller.applyPreview(doc)); await Promise.race([pendingGate.entered, apply.then(() => { throw new Error(controller.sessionForDocument(doc)?.diagnostic || 'Applied without dependent update'); })]); });
    expect(controller.sessionForDocument(doc).previewState).toBe('staging');
    await expect(prepareSceneScienceExport(doc, { sourceEditing: controller, sceneFileCount: 1, isOpen: () => opened })).rejects.toThrow('does not show');
    await act(async () => { pendingGate.release(); await apply; });
    expect([controller.sessionForDocument(doc).previewState, controller.ownsCurrentSourceFrame(doc, frame)]).toEqual(['current', true]);
    expect(science.binding(viewer).positions[4]).toBeCloseTo(1.7572, 5); expect(logicalSourceFor(doc.id)).toBe(owner);
    expect([rawSource.obj === rawObject, rawSource.obj.data]).toEqual([true, XYZ]);
    const editedArchive = await exportScene(), edited = await decodeScienceSession(editedArchive);
    expect([edited.documentUuid, edited.source.text, edited.atomIds, edited.science]).toEqual([uuid, changed, ids, null]);
    expect(new Uint8Array(await edited.original.file.arrayBuffer())).toEqual(new TextEncoder().encode(XYZ));
    const editedViewer = await reopen(editedArchive); expect(science.binding(editedViewer).positions[4]).toBeCloseTo(1.7572, 5);
    // Undo of the source draft follows the same applied runtime path, not a synthetic ACK.
    await act(async () => { controller.updateDraft(doc, XYZ); await controller.applyPreview(doc); });
    expect([controller.sessionForDocument(doc).dirty, logicalSourceFor(doc.id) === owner]).toEqual([false, true]);
    expect([rawSource.obj === rawObject, rawSource.obj.data]).toEqual([true, XYZ]);
    const undone = await decodeScienceSession(await exportScene());
    expect([undone.documentUuid, undone.source.text, undone.atomIds, undone.science]).toEqual([uuid, XYZ, ids, waterScience()]);
    expect(new Uint8Array(await undone.original.file.arrayBuffer())).toEqual(new TextEncoder().encode(XYZ));
    const capture = await prepareSceneScienceExport(doc, { sourceEditing: controller, sceneFileCount: 1, isOpen: () => opened });
    await act(async () => { expect(await restoreScienceSession(doc, { readBytes: async () => archive, isOpen: () => opened, request: requestViewerAction, pollMs: 1 })).toBe('restored'); });
    expect(logicalSourceFor(doc.id)).not.toBe(owner); expect(controller.sessionForDocument(doc)).toBeNull();
    await expect(Promise.resolve().then(() => capture.confirm())).rejects.toThrow('source changed');
    await act(async () => controller.beginEditing(doc, 'geometry'));
    const prepared = await prepareSceneScienceExport(doc, { sourceEditing: controller, sceneFileCount: 1, isOpen: () => opened });
    await act(async () => controller.closeDocuments([doc.id])); opened = false;
    await expect(Promise.resolve().then(() => prepared.confirm())).rejects.toThrow('closed'); expect(errors).toEqual([]);
  } finally {
    await act(async () => root.unmount()); host.remove(); for (const frame of frames) frame.remove(); for (const plugin of plugins) plugin.dispose();
    releaseClosedScienceSessions(new Set()); releaseClosedImports(new Set());
  }
}, 20_000);
