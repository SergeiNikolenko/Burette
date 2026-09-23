import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const stateValues = [];
let cursor, effects, handler;
const exports = {};
new Function('require', 'exports', ts.transpile(readFileSync('apps/desktop/src/hooks/use-app-native-menu.ts', 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}))(name => {
  if (name === 'react') return {
    useState: initial => { const i = cursor++; if (!(i in stateValues)) stateValues[i] = initial; return [stateValues[i], value => { stateValues[i] = value; }]; },
    useEffect: effect => effects.push(effect), useMemo: callback => callback(), useCallback: callback => callback,
    useRef: value => { const i = cursor++; if (!(i in stateValues)) stateValues[i] = { current: value }; return stateValues[i]; },
  };
  if (name === './use-menu-events') return { useMenuEvents: options => { handler = options.handleNativeMenuCommand; } };
  if (name === '../lib/native-menu-paths') return { fileBackedViewerDocumentPath: doc => doc.path, isAbsoluteNativeFilePath: path => path.startsWith('/'), nativeOpenDocumentPaths: () => [] };
  if (name === '../lib/native-menu') return { nextDocumentRegistryRevision: () => 1 };
  if (name === '../lib/tauri') return { isTauriRuntime: () => false };
  return new Proxy({}, { get: () => () => {} });
}, exports);
const calls = [];
const state = {
  activeDocument: { id: 'sdf', path: '/collection.sdf', extension: 'sdf', renderer: 'molstar' },
  activeTabId: 'tab', activeTab: { id: 'tab', location: { kind: 'document', path: '/collection.sdf' } },
  tabs: [{ id: 'tab', location: { kind: 'document' } }], recentStructures: [], documents: [], textDocuments: [],
};
const options = {
  state, gridMenuState: null, actions: { openDockTab: (...args) => calls.push(['dock', ...args]) },
  openDocuments: async (...args) => calls.push(['open', ...args]),
};
function render() { cursor = 0; effects = []; exports.useAppNativeMenu(options); }
render();
await handler({ command: 'analyze.chemical-space' });
assert.deepEqual(calls, [['open', ['/collection.sdf'], undefined, { rendererMode: 'grid2d' }, { inActiveTab: true, shouldApply: calls[0][4].shouldApply }]]);
assert.equal(calls[0][4].shouldApply(), true);
state.activeDocument = { ...state.activeDocument, id: 'grid', renderer: 'grid2d' };
render(); effects.at(-1)();
assert.equal(calls.length, 1, 'wait for mounted grid records');
options.gridMenuState = { hasMolecules: true, saveEnabled: false };
render(); effects.at(-1)();
assert.equal(calls.length, 1, 'wait until collection indexing completes');
options.gridMenuState.saveEnabled = true;
render(); effects.at(-1)();
assert.deepEqual(calls.at(-1), ['dock', 'bottom', 'chemical-space']);
render(); effects.at(-1)();
assert.equal(calls.length, 2, 'dispatch only once');
state.activeDocument.renderer = 'molstar'; options.gridMenuState = null;
render(); await handler({ command: 'analyze.chemical-space' });
state.activeTabId = 'other'; render(); effects.at(-1)();
assert.equal(calls.at(-1)[4].shouldApply(), false, 'late native open must not replace another tab');
state.activeTabId = 'tab'; state.activeDocument.renderer = 'grid2d'; options.gridMenuState = { hasMolecules: true, saveEnabled: true };
render(); effects.at(-1)();
state.activeDocument.renderer = 'molstar'; render();
assert.equal(calls.at(-1)[4].shouldApply(), false, 'returning to the source must not revive a cancelled open');
assert.equal(calls.filter(call => call[0] === 'dock').length, 1, 'cancel when leaving target tab');
console.log('native collection analysis transition passed');

// Opening a 2D collection in Mol* may replace its coordinates, but it must not
// discard the original record properties during that RDKit alignment step.
const grid = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
const functions = ['alignedSdfRecordTextsForMolstar', 'serializeSdfRows', 'withSarProperties'].map(name =>
  grid.match(new RegExp(`\\n  (?:async )?function ${name}\\([^]*?\\n  \\}`, 'u'))[0]).join('\n');
const molblock = 'example\n  Burette           2D\n\n  1  0  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 C   0\nM  END';
const aligned = new Function('initRDKit', 'rdkitMolForMolstarRow', 'ensureRdkitMolCoordinates', 'alignedMolblockForMolstar', `${functions}; return alignedSdfRecordTextsForMolstar;`)(
  async () => ({}), () => ({ delete() {} }), () => {}, () => molblock,
);
const records = await aligned([{ index: 0, name: 'first', props: { PATENT_PAGE: '7' } }, { index: 1, name: 'second', props: { PATENT_PAGE: '15' } }]);
assert.equal(records.length, 2);
assert.match(records[0], /> <PATENT_PAGE>\n7\n/);
assert.match(records[1], /> <PATENT_PAGE>\n15\n/);
console.log('Molstar collection handoff preserves SD properties');
