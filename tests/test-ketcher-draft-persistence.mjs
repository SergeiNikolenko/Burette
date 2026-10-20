import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-compiler-api';

function callback(path, name) {
  const source = ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(found, `Missing ${name}`);
  return '(() => {\n' + ts.transpileModule(`const result = ${found};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + '\nreturn result; })()';
}

const originalLocation = { kind: 'ketcher', draftMolfile: 'old MOL', draftKet: 'old KET' };
let state = { activeTabId: 'other', tabs: [{ id: 'owner', location: originalLocation }, { id: 'other', location: { kind: 'ketcher', draftMolfile: 'other MOL' } }] };
let legacyDraft;
const save = vm.runInNewContext(callback('apps/desktop/src/hooks/use-app-ketcher-actions.ts', 'saveKetcherDraft'), {
  window: {}, setKetcherDraftMolfile: value => { legacyDraft = value; },
  useMoleculeStore: { getState: () => state, setState: update => { state = { ...state, ...update(state) }; } },
});
save({ tabId: 'owner', molfile: 'new MOL', ket: 'new KET' });
assert.equal(state.tabs[0].location.draftMolfile, 'new MOL', 'Normal desktop drafts must persist to the owning tab, not the active tab');
assert.equal(state.tabs[0].location.draftKet, 'new KET', 'Preserve KET for macromolecules, reactions and annotations');
assert.equal(state.tabs[1].location.draftMolfile, 'other MOL');
assert.equal(legacyDraft, 'new MOL');
save({ tabId: 'owner', molfile: 'MOL-only replacement' });
assert.equal(state.tabs[0].location.draftKet, undefined, 'A newer MOL-only save must clear a stale preferred KET');
save({ tabId: 'owner', molfile: '', ket: '' });
assert.equal(state.tabs[0].location.draftMolfile, '');
assert.equal(state.tabs[0].location.draftKet, '');
state.tabs = state.tabs.filter(tab => tab.id !== 'owner');
save({ tabId: 'owner', molfile: 'late closed-tab export', ket: 'late KET' });
assert.equal(state.tabs.length, 1, 'Late exports cannot recreate a closed tab');
assert.equal(legacyDraft, '', 'Late exports cannot seed another editor through the legacy fallback');
console.log('PASS: native and hosted Ketcher drafts belong to a tab, retain KET and clear stale/closed-tab state');

const pagePath = 'apps/desktop/src/components/ketcher-page.tsx';
const page = ts.createSourceFile(pagePath, readFileSync(new URL(`../${pagePath}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers = page.statements.filter(node => ts.isFunctionDeclaration(node) && ['isBlankKetcherMolfile', 'isMolfileCountsLine', 'isBlankKetcherKet'].includes(node.name.text)).map(node => node.getText(page)).join('\n');
const runtime = vm.createContext({
  draftExportSerialRef: { current: 0 }, restoredDraftRef: { current: '' }, tabId: 'owner',
  withKetcherTimeout: promise => promise,
  saveKetcherDraft: request => saved.push(request), setHasSketch: value => { hasSketch = value; }, setPreserved3dSource() {},
});
vm.runInContext(ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, runtime);
const saved = [];
let hasSketch;
const pending = [];
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
runtime.ketcher = {
  getMolfile: () => { const value = deferred(); pending.push(value); return value.promise; },
  getKet: () => { const value = deferred(); pending.push(value); return value.promise; },
};
const persist = vm.runInContext(callback(pagePath, 'persistDraft'), runtime);
const oldSave = persist();
const newSave = persist();
pending[2].resolve('latest MOL'); pending[3].resolve('{"root":{"nodes":[{"$ref":"latest"}]}}');
await newSave;
pending[0].resolve('old MOL'); pending[1].resolve('{"root":{"nodes":[{"$ref":"old"}]}}');
await oldSave;
assert.equal(saved.length, 1, 'Out-of-order exports cannot overwrite a newer editor snapshot');
assert.equal(saved[0].tabId, 'owner');
assert.equal(saved[0].molfile, 'latest MOL');
assert.equal(runtime.restoredDraftRef.current, JSON.stringify({ draftKet: saved[0].ket, draftMolfile: saved[0].molfile }), 'Autosave marks its complete format pair to prevent a destructive self-restore');
const macroSave = persist();
pending[4].reject(new Error('MOL cannot represent this macromolecule'));
pending[5].resolve('{"root":{"nodes":[{"type":"monomer","alias":"A"}]}}');
await macroSave;
assert.equal(saved.at(-1).molfile, '');
assert.match(saved.at(-1).ket, /monomer/);
assert.equal(hasSketch, true, 'A valid KET-only macromolecule is not an empty sketch');
const clearSave = persist('', '{"root":{"nodes":[]}}');
await clearSave;
assert.equal(saved.at(-1).molfile, '');
assert.equal(saved.at(-1).ket, '');
assert.equal(hasSketch, false);
const lateSave = persist();
++runtime.draftExportSerialRef.current; // The subscription cleanup invalidates pending exports.
pending[6].resolve('closed editor MOL'); pending[7].resolve('closed editor KET');
await lateSave;
assert.equal(saved.length, 3, 'A disposed editor cannot publish its late export');
console.log('PASS: actual autosave callback rejects stale/disposed completions and preserves KET-only macro/empty state');

let restores = 0;
runtime.location = { kind: 'ketcher', draftKet: saved[1].ket, draftMolfile: saved[1].molfile };
runtime.panelMode = null;
runtime.liveImportDirty = false;
runtime.restoreKetcherDraft = async () => { restores++; };
runtime.setOutput = runtime.setPanelMode = runtime.setStatus = () => {};
runtime.restoredDraftRef.current = JSON.stringify({ draftKet: saved[1].ket, draftMolfile: saved[1].molfile });
const restore = vm.runInContext(callback(pagePath, 'restoreDraft'), runtime);
assert.equal(await restore(runtime.ketcher), false, 'Publishing an autosave must not re-import its own KET');
assert.equal(restores, 0);
runtime.restoredDraftRef.current = '';
assert.equal(await restore(runtime.ketcher), true, 'A remounted editor must restore its persisted KET-only snapshot');
assert.equal(restores, 1);
console.log('PASS: actual restore callback restores KET-only drafts without re-importing self-autosaves');

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { localStorage: globalThis.localStorage, location: { search: '', hostname: '127.0.0.1' }, addEventListener() {} };
const { useMoleculeStore } = await import('../apps/desktop/src/stores/molecule-store.ts');
useMoleculeStore.setState({ tabs: [{ id: 'owner', location: originalLocation, back: [], forward: [] }], activeTabId: 'owner' });
useMoleculeStore.getState().openKetcherTab({ kind: 'ketcher', draftMolfile: 'replacement MOL' });
assert.equal(useMoleculeStore.getState().tabs[0].location.draftKet, undefined, 'Opening a MOL replacement cannot retain a preferred KET from the previous structure');
assert.equal(useMoleculeStore.getState().tabs[0].location.draftMolfile, 'replacement MOL');
console.log('PASS: real tab store removes stale KET when opening a MOL-only replacement');
const { ketcherKind } = await import('../apps/desktop/src/components/editor-area/page-kinds/ketcher.tsx');
const macroLocation = { kind: 'ketcher', draftKet: saved[1].ket, draftMolfile: '' };
assert.deepEqual(ketcherKind.fromPayload({ kind: 'ketcher', ...ketcherKind.serialize(macroLocation) }), macroLocation, 'The persisted page location round-trips a KET-only macromolecule');
