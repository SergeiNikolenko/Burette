import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const viewer = read('PreviewExtension/Web/viewer.js');
const hook = read('apps/desktop/src/hooks/use-agent-session.ts');
const extract = (source, name, indent) => {
  const match = source.match(new RegExp(`\\n${indent}(?:async )?function ${name}\\([\\s\\S]*?\\n${indent}\\}`, 'u'));
  assert.ok(match, name);
  return match[0];
};
let atomCount = 500;
const messages = [];
const notify = new Function('postHostMessage', 'molstarCurrentSelectionLociList', 'molstarStructureRuntime',
  'molstarContextOrderedSetForEach', 'molstarContextAtomFromModelIndex', 'molstarSelectionLevel', 'molstarSelectionAtomCount', 'molstarContextDocumentPayload', `
  let molstarSelectionHostSignature;
  ${extract(viewer, 'notifyMolstarSelectionChanged', '  ')}
  return notifyMolstarSelectionChanged;
`)(message => messages.push(message), () => atomCount ? [{ elements: [{ unit: { id: 1, model: { id: 'model-1' }, elements: Array.from({ length: atomCount }, (_, i) => i) }, indices: [] }] }] : [],
  () => ({ StructureElement: { Loci: { size: () => atomCount } } }),
  (_, visit) => { for (let i = 0; i < atomCount; i++) if (visit(i) === false) break; },
  (_, index) => ({ atomIndex: index, auth_asym_id: 'A', auth_seq_id: 12, auth_comp_id: 'CYS', auth_atom_id: 'CA' }),
  () => 'structure', () => 1, () => ({}));
notify(null);
assert.equal(messages[0].selection.atoms, 500);
assert.equal(messages[0].selection.atomIdentities.length, 96);
assert.equal(messages[0].selection.truncated, true);
assert.equal(messages[0].selection.atomIdentities[0].model, 'model-1');
notify({ scope: 'ion', label: 'ZN A375', focus: { selector: { kind: 'ion' } } });
assert.equal(messages.length, 1, 'a multi-atom selection must not inherit one ion preview selector');
notify(null);
assert.equal(messages.length, 1, 'identical UI selection is deduplicated');
atomCount = 1;
notify(null);
assert.equal(messages[1].selection.truncated, false);
atomCount = 0;
notify(null);
assert.equal(messages[2].selection, null, 'clearing selection clears the host context');

const hookJs = ts.transpileModule([
  extract(hook, 'viewerAgentStateFromMessage', ''),
  extract(hook, 'boundedSessionString', ''),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const contextJs = ts.transpileModule(read('apps/burette-public-plugin/lib/hosted-context.ts'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', contextJs)(exports);
const fromMessage = new Function('createSelectionContext', `${hookJs}; return viewerAgentStateFromMessage;`)(exports.createSelectionContext);
const selected = fromMessage({ type: 'selectionChanged', documentId: 'doc-a', selection: messages[0].selection });
assert.equal(selected.documentId, 'doc-a');
assert.equal(selected.selection.counts.atoms, 500);
assert.equal(selected.selection.counts.atomIdentities.length, 96);
assert.equal(fromMessage({ type: 'selectionChanged', documentId: 'doc-a', selection: null }, selected).selection, null);
assert.equal(fromMessage({ type: 'selectionChanged', documentId: 'doc-a', selection: { cleared: true } }, selected).selection, null);
assert.equal(fromMessage({ type: 'selectionChanged', selection: messages[0].selection }), null);
const large = exports.createSelectionContext({ atoms: 500, atomIdentities: Array.from({ length: 96 }, () => ({
  chain: '界'.repeat(255), compId: '界'.repeat(255), atomName: '界'.repeat(255), model: '界'.repeat(255), operator: '界'.repeat(255),
})) }, 'doc-a');
assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 24 * 1024);
assert.equal(large.structuredContent.burette.activeSelection.atoms, 500);
assert.equal(large.structuredContent.burette.activeSelection.truncated, true);

const writeObserveJs = ts.transpileModule(extract(hook, 'writeObserve', ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let releaseWrite;
let signalStarted;
const started = new Promise(resolve => { signalStarted = resolve; });
const heldWrite = new Promise(resolve => { releaseWrite = resolve; });
const writtenTabs = [];
const writeObserve = new Function('writeJson', `
  let observeWriteRevision = 0;
  let observeWriteQueue = Promise.resolve();
  const AGENT_API_VERSION = 'test', MAX_OBSERVED_DOCUMENTS = 128, MAX_OBSERVED_TABS = 128, MAX_OBSERVED_PANELS = 64;
  const isTauriRuntime = () => false, isBrowserAgentSessionDir = () => true;
  const joinSessionPath = (dir, name) => dir + '/' + name;
  ${writeObserveJs}
  return writeObserve;
`)(async (_, state) => {
  writtenTabs.push(state.activeTabId);
  if (writtenTabs.length === 1) { signalStarted(); await heldWrite; }
});
const initialWrite = writeObserve('session', null, [], [], [], {}, 'first', 'file');
await started;
const middleWrite = writeObserve('session', null, [], [], [], {}, 'middle', 'file');
const latestWrite = writeObserve('session', null, [], [], [], {}, 'latest', 'file');
releaseWrite();
await Promise.all([initialWrite, middleWrite, latestWrite]);
assert.deepEqual(writtenTabs, ['first', 'latest'], 'selection/tab snapshots are serialized with latest pending state winning');

const timeout = new Function(`${extract(viewer, 'withTimeout', '  ')}; return withTimeout;`)();
const previewWindow = {};
const render = new Function('window', 'normalizeFormat', 'molstarPreviewKey', 'molstarPreviewSvgCache', 'withTimeout',
  'molstarPreviewInitRDKit', 'debug', 'molstarMoleculePreviewFallbackSVG', 'molstarPreviewCacheSVG', `
  return (${extract(viewer, 'molstarMoleculePreviewRDKitSVG', '  ')});
`)(previewWindow, x => x, () => 'ion', new Map(), (promise, _, message) => timeout(promise, 5, message),
  () => new Promise(() => {}), () => {}, () => '<svg>Zn</svg>', () => {});
assert.equal(await render({ format: 'sdf' }), '<svg>Zn</svg>', 'a hung RDKit initializer reaches the fallback');
previewWindow.BuretteResolveRuntimeAsset = async () => 'blob:rdkit';
await assert.rejects(render({ format: 'sdf' }), /timed out/, 'native RDKit failures must not become cached ball projections');
const paths = [];
const rdkitWindow = {};
const load = new Function('window', 'runtimeURL', 'molstarPreviewLoadScript', 'withTimeout', `
  return (${extract(viewer, 'molstarPreviewLoadRDKitScript', '  ')});
`)(rdkitWindow, (_, fallback) => fallback, async src => { paths.push(src); rdkitWindow.initRDKitModule = () => {}; }, timeout);
await load();
assert.deepEqual(paths, ['rdkit/RDKit_minimal.js']);
const resolvedScripts = [];
const nativeScript = new Function('window', 'document', `return (${extract(viewer, 'molstarPreviewLoadScript', '  ')});`)(
  { BuretteResolveRuntimeAsset: async path => { resolvedScripts.push(path); return 'blob:verified-rdkit'; } },
  { querySelector: () => null, createElement: () => ({}), head: { appendChild: script => { assert.equal(script.src, 'blob:verified-rdkit'); script.onload(); } } },
);
await nativeScript('rdkit/RDKit_minimal.js');
assert.deepEqual(resolvedScripts, ['rdkit/RDKit_minimal.js']);
const cleared = [];
const clearRail = new Function('viewportPlugin', 'setMolstarLassoEnabled', 'clearMolstarPersistentMoleculePreview', 'clearMolstarSelection', 'hideMolstarContextMenu', 'closeViewportMenu', 'updateSelectionBar', 'setStatus', `return (${extract(viewer, 'runViewportRailAction', '  ')});`)(
  () => ({}), value => cleared.push(['lasso', value]), () => cleared.push(['preview']), async () => cleared.push(['selection']), () => {}, () => {}, () => {}, () => {},
);
clearRail('clear-selection', { classList: { add() {} } });
await Promise.resolve();
assert.deepEqual(cleared, [['lasso', false], ['preview'], ['selection']]);
const handlers = new Map();
const installCard = new Function('Element', `return (${extract(viewer, 'installMolstarMoleculePreviewResize', '  ')});`)(class {});
installCard({ dataset: {}, addEventListener: (name, handler) => handlers.set(name, handler) });
assert.doesNotThrow(() => handlers.get('pointerdown')({
  button: 0, target: { closest: selector => selector === '[data-buret-molecule-preview-action]' ? {} : null },
}), 'header buttons must not begin a drag or capture their click');
console.log('Viewer selection context and bounded 2D preview checks passed.');
