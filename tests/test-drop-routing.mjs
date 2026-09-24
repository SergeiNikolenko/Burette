import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { resolveDropActionChoices } from '../apps/desktop/src/lib/drop-actions.ts';
import { buildFileDropPreview } from '../apps/desktop/src/lib/drop-preview.ts';
import { describeDropTargetElement } from '../apps/desktop/src/lib/drop-target.ts';
import * as drag from '../apps/desktop/src/lib/structure-drag.ts';

const window = new Window();
const document = window.document;
const source = readFileSync('apps/desktop/src/hooks/use-open-drop.ts', 'utf8').replace(/^import[\s\S]*?;\n/gm, '').replace('export function useOpenDrop', 'function useOpenDrop');
const dependencies = {
  useCallback: fn => fn, useEffect: () => {}, useRef: value => ({ current: value }), useState: value => [value, () => {}],
  resolveDropActionChoices, describeDropTargetElement, ...drag,
  isTauriRuntime: () => false, document, window, Element: window.Element,
};
const useOpenDrop = new Function(...Object.keys(dependencies), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + '\nreturn useOpenDrop;')(...Object.values(dependencies));
const received = [];
const hook = useOpenDrop(paths => received.push(['open', paths]), () => {}, {
  activeDocumentId: 'source', activeDocumentPath: '/collection.sdf', activeDocumentRenderer: 'grid2d',
  documents: [{ id: 'target', path: '/sheet.xyz', renderer: 'xyzrender-external' }],
  addXyzrenderSheetItems: (id, payload) => { received.push(['sheet', id, payload.records]); return true; },
  openStructureRecords: (records, directory) => received.push(['records', directory, records]),
});
const records = [{ path: 'ethanol.smi', inputExtension: 'smi', text: 'CCO ethanol' }];
function drop(attributes) {
  const target = document.createElement('div');
  for (const [name, value] of Object.entries(attributes)) target.setAttribute(name, value);
  const dataTransfer = new window.DataTransfer();
  drag.writeStructureDragPayload(dataTransfer, { paths: [], records });
  hook.handleBrowserDrop({ target, dataTransfer, clientX: 20, clientY: 30, preventDefault() {} });
}
drop({ 'data-drop-document-id': 'target', 'data-drop-document-path': '/sheet.xyz', 'data-drop-document-renderer': 'xyzrender-external' });
drop({ 'data-drop-directory': '/project/molecules' });
assert.deepEqual(received, [['sheet', 'target', records], ['records', '/project/molecules', records]]);
const reaction = { path: 'reaction.rxn', inputExtension: 'rxn', text: '$RXN\nreaction\n' };
assert.equal(resolveDropActionChoices({ paths: [], records: [reaction] }, { kind: 'ketcher' })[0].action.kind, 'import-ketcher-structures');
const files = ['dwar', 'rxn', 'rdf'].map(ext => new File(['nonempty text'], `collection.${ext}`));
const browser = await drag.structureDragPayloadFromBrowserFiles(files);
assert.equal(browser.payload.records.length, 3);
assert.deepEqual(browser.errors, []);
console.log('Drop execution preserves inactive document and destination folder; reaction and browser formats accepted');

// A cold target queues multiple drops until its actual iframe reports readiness.
const effects = [];
const workflowSource = readFileSync('apps/desktop/src/hooks/use-app-grid-workflows.ts', 'utf8').replace(/^import[\s\S]*?;\n/gm, '').replace('export function useAppGridWorkflows', 'function useAppGridWorkflows');
const workflowDeps = { ...dependencies, useEffect: fn => effects.push(fn) };
const workflows = new Function(...Object.keys(workflowDeps), ts.transpileModule(workflowSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + '\nreturn useAppGridWorkflows;')(...Object.values(workflowDeps));
const selectedTabs = [];
const frame = document.createElement('iframe');
frame.className = 'viewer-iframe';
frame.dataset.documentId = 'cold-target';
document.body.appendChild(frame);
const sent = [];
frame.contentWindow.postMessage = message => sent.push(message.body);
const workflowDocuments = [{ id: 'cold-target', path: '/target.sdf', renderer: 'xyzrender-external' }];
const workflowStatuses = [];
const workflow = workflows({
  activeDocument: null, documents: workflowDocuments,
  tabs: [{ id: 'target-tab', location: { kind: 'file', documentId: 'cold-target' } }],
  setActiveTab: id => selectedTabs.push(id), pushStatus: message => workflowStatuses.push(message), pushErrorStatus() {}, poseReviewSelections: {},
});
const cleanups = effects.map(fn => fn());
const payload = { paths: [], records, point: { x: 20, y: 30 } };
assert.equal(workflow.addXyzrenderSheetItemsToDocument('cold-target', payload), true);
assert.equal(workflow.addXyzrenderSheetItemsToDocument('cold-target', payload), true);
assert.deepEqual(selectedTabs, ['target-tab', 'target-tab']);
assert.equal(sent.filter(body => body.type === 'addXyzrenderSheetItems').length, 0);
const readyBody = { source: 'burette-viewer', body: { type: 'xyzrenderSheetReady' } };
window.dispatchEvent(new window.MessageEvent('message', { data: readyBody, source: window }));
assert.equal(sent.filter(body => body.type === 'addXyzrenderSheetItems').length, 0);
window.dispatchEvent(new window.MessageEvent('message', { data: readyBody, source: frame.contentWindow }));
assert.deepEqual(sent.filter(body => body.type === 'addXyzrenderSheetItems'), [0, 1].map(() => ({ type: 'addXyzrenderSheetItems', documentId: 'cold-target', paths: [], records, point: null })));
window.dispatchEvent(new window.MessageEvent('message', { data: readyBody, source: frame.contentWindow }));
assert.equal(sent.filter(body => body.type === 'addXyzrenderSheetItems').length, 2);
const previousAdds = () => sent.filter(body => body.type === 'addXyzrenderSheetItems');
workflow.addXyzrenderSheetItemsToDocument('cold-target', { paths: [], records: Array(200).fill(records[0]) });
workflow.addXyzrenderSheetItemsToDocument('cold-target', payload);
assert.match(workflowStatuses.at(-1), /200 molecules/);
window.dispatchEvent(new window.MessageEvent('message', { data: readyBody, source: frame.contentWindow }));
assert.equal(previousAdds().length, 3);
assert.equal(previousAdds().at(-1).records.length, 200);
workflow.addXyzrenderSheetItemsToDocument('cold-target', payload);
workflowDocuments.length = 0;
effects[0](); // Closing the queued destination clears its pending additions.
window.dispatchEvent(new window.MessageEvent('message', { data: readyBody, source: frame.contentWindow }));
assert.equal(previousAdds().length, 3);
assert.equal(workflow.addXyzrenderSheetItemsToDocument('cold-target', payload), false);
for (const cleanup of cleanups) cleanup?.();
console.log('Cold sheet drops wait for the matching frame and flush exactly once');

// Retina native events must never hit-test a second, unscaled point in a dock.
const queried = [];
const actualTarget = { id: 'under-cursor' };
const retinaHitTest = new Function('document', 'window', 'navigator', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + '\nreturn elementFromTauriDropPosition;')({
  elementFromPoint(x, y) { queried.push([x, y]); return x === 300 ? actualTarget : { closest: () => ({ id: 'wrong-dock' }) }; },
}, { devicePixelRatio: 2 }, { platform: 'Win32' });
assert.equal(retinaHitTest({ x: 600, y: 400 }), actualTarget);
assert.deepEqual(queried, [[300, 200]]);
console.log('Retina drag hit-testing uses one coordinate system and the target under the cursor');

const dragEffects = [];
const cancelDeps = { ...dependencies, Event: window.Event, useEffect: fn => dragEffects.push(fn) };
const cancelHook = new Function(...Object.keys(cancelDeps), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + '\nreturn useOpenDrop;')(...Object.values(cancelDeps));
cancelHook(() => {}, () => {});
const cancelCleanups = dragEffects.map(fn => fn());
const message = type => window.dispatchEvent(new window.MessageEvent('message', { source: frame.contentWindow, data: { source: 'burette-grid', body: { type, payload } } }));
message('structureDragStart');
message('structureDragCancel');
let performed = 0;
const dropTarget = document.createElement('div');
document.body.appendChild(dropTarget);
dropTarget.addEventListener('drop', () => performed++);
const dataTransfer = new window.DataTransfer();
drag.writeStructureDragPayload(dataTransfer, payload);
dropTarget.dispatchEvent(new window.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
assert.equal(performed, 0);
message('structureDragStart');
dropTarget.dispatchEvent(new window.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
assert.equal(performed, 1);
for (const cleanup of cancelCleanups) cleanup?.();
console.log('Iframe cancellation blocks the pending drop, and a new drag works normally');

// WKWebView consumes an internal HTML drop and emits native events with no paths.
const nativeEffects = [];
let nativeDrop;
const nativeSaved = [];
const folder = document.createElement('div');
folder.dataset.dropDirectory = '/project/native';
folder.getBoundingClientRect = () => ({ left: 10, top: 180, width: 200, height: 30 });
document.elementFromPoint = (x, y) => { assert.deepEqual([x, y], [90, 198]); return folder; };
const nativeDeps = { ...dependencies, CustomEvent: window.CustomEvent, requestAnimationFrame: fn => fn(), buildFileDropPreview, navigator: { platform: 'MacIntel' }, Event: window.Event,
  isTauriRuntime: () => true, useEffect: fn => nativeEffects.push(fn),
  getCurrentWindow: () => ({ onDragDropEvent: fn => { nativeDrop = fn; return Promise.resolve(() => {}); } }),
  trackTauriListener: () => () => {},
};
Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
const nativeHook = new Function(...Object.keys(nativeDeps), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + '\nreturn useOpenDrop;')(...Object.values(nativeDeps));
nativeHook(() => {}, () => {}, { openStructureRecords: (records, directory) => nativeSaved.push({ records, directory }) });
const nativeCleanups = nativeEffects.map(fn => fn());
message('structureDragStart');
nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
message('structureDragEnd'); // Can arrive before the native bridge dispatches drop.
nativeDrop({ payload: { type: 'drop', paths: [], position: { x: 90, y: 198 } } });
assert.deepEqual(nativeSaved, [{ records, directory: '/project/native' }]);
nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
message('structureDragStart'); // Native enter may beat the iframe postMessage.
message('structureDragEnd');
nativeDrop({ payload: { type: 'drop', paths: [], position: { x: 90, y: 198 } } });
assert.deepEqual(nativeSaved, [0, 1].map(() => ({ records, directory: '/project/native' })));
const strip = document.createElement('div');
strip.className = 'tab-strip';
const tab = document.createElement('div');
tab.className = 'tab-shell';
tab.dataset.tabId = 'target-tab';
strip.appendChild(tab);
document.elementFromPoint = () => tab;
const tabTransfer = new window.DataTransfer();
drag.writeStructureDragPayload(tabTransfer, payload);
tabTransfer.setData(drag.TAB_DRAG_MIME, 'source-tab');
tabTransfer.setDragImage = () => {};
const reordered = [];
const hovered = [];
let ended = 0;
window.addEventListener('burette-native-drag-hover', event => hovered.push(event.detail));
window.addEventListener('burette-native-drag-end', () => ended++);
window.addEventListener('burette-native-tab-drop', event => reordered.push(event.detail));
const tabStart = new window.DragEvent('dragstart');
Object.defineProperty(tabStart, 'dataTransfer', { value: tabTransfer });
window.dispatchEvent(tabStart);
nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
window.dispatchEvent(new window.DragEvent('dragend'));
nativeDrop({ payload: { type: 'drop', paths: [], position: { x: 90, y: 198 } } });
assert.deepEqual(reordered, [{ tabId: 'source-tab', x: 90 }]);
assert.deepEqual(hovered, [{ tabId: 'target-tab', sourceTabId: 'source-tab', x: 90 }]);
assert.equal(ended, 1);
message('structureDragStart');
nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
assert.deepEqual(hovered.at(-1), { tabId: 'target-tab', sourceTabId: null, x: 90 });
nativeDrop({ payload: { type: 'leave' } });
assert.equal(ended, 2);
assert.equal(nativeSaved.length, 2, 'Tab reorder must not import its structure');
// Leaving the window does not turn a returning tab drag into molecular import.
window.dispatchEvent(tabStart);
nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
nativeDrop({ payload: { type: 'leave' } });
window.dispatchEvent(new window.Event('blur'));
nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
window.dispatchEvent(new window.DragEvent('dragend'));
nativeDrop({ payload: { type: 'drop', paths: [], position: { x: 90, y: 198 } } });
assert.equal(reordered.length, 2, 'Returning tab drag must retain reorder identity');

// Late native over/drop after Escape cannot reactivate a target or save files.
document.elementFromPoint = () => folder;
message('structureDragStart');
nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
const hoverCountBeforeCancel = hovered.length;
nativeDrop({ payload: { type: 'over', position: { x: 90, y: 198 } } });
nativeDrop({ payload: { type: 'drop', paths: [], position: { x: 90, y: 198 } } });
assert.equal(hovered.length, hoverCountBeforeCancel, 'Cancelled drag must not restart tab hover');
assert.equal(nativeSaved.length, 2);

// A new gesture works after cancellation and repeated bridge drops are inert.
message('structureDragStart');
nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
nativeDrop({ payload: { type: 'drop', paths: [], position: { x: 90, y: 198 } } });
nativeDrop({ payload: { type: 'drop', paths: [], position: { x: 90, y: 198 } } });
assert.equal(nativeSaved.length, 3, 'Source payload must be consumed once');
message('structureDragEnd');
// Unknown frames and malformed/oversized source records cannot become a drop.
for (const entry of [
  { source: window, records },
  { source: frame.contentWindow, records: [null] },
  { source: frame.contentWindow, records: Array(201).fill(records[0]) },
  { source: frame.contentWindow, records: [{ ...records[0], text: 'x'.repeat(24 * 1024 * 1024 + 1) }] },
]) {
  nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
  window.dispatchEvent(new window.MessageEvent('message', { source: entry.source,
    data: { source: 'burette-grid', body: { type: 'structureDragStart', payload: { records: entry.records } } } }));
  nativeDrop({ payload: { type: 'drop', paths: [], position: { x: 90, y: 198 } } });
  assert.equal(nativeSaved.length, 3);
}
const selection = [...records, { path: 'acetic-acid.smi', inputExtension: 'smi', text: 'CC(=O)O acetic acid' }];
window.dispatchEvent(new window.MessageEvent('message', { source: frame.contentWindow,
  data: { source: 'burette-grid', body: { type: 'structureDragStart', payload: { records: selection } } } }));
nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
nativeDrop({ payload: { type: 'leave' } });
window.dispatchEvent(new window.Event('blur'));
nativeDrop({ payload: { type: 'enter', paths: [], position: { x: 90, y: 198 } } });
message('structureDragEnd');
nativeDrop({ payload: { type: 'drop', paths: [], position: { x: 90, y: 198 } } });
assert.deepEqual(nativeSaved.at(-1), { records: selection, directory: '/project/native' });
assert.equal(nativeSaved.length, 4);
for (const cleanup of nativeCleanups) cleanup?.();
console.log('WKWebView internal drops retain molecular records and use logical Retina coordinates');
