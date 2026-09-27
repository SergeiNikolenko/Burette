import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const functionBody = name => {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  }\n', start);
  assert.ok(start >= 0 && end > start, `${name} exists`);
  return source.slice(start, end + 4);
};
const fieldsStart = source.indexOf('  const SCENE_TREE_MEASUREMENT_FIELDS = {');
assert.ok(fieldsStart >= 0, 'measurement field table exists');
const fieldsTable = source.slice(fieldsStart, source.indexOf('\n  };', fieldsStart) + 5);

const posted = [];
const actions = [];
const streamed = [];
const undo = [];
const nodes = {
  'label-ref': { label: 'Label', hidden: false, measurementEditable: true },
  'polymer-ref': { label: 'Polymer', hidden: false },
};
const measurementTargets = {
  'label-ref': [{ transform: { ref: 'label-repr', params: {
    customText: '', textColor: 0x000000, textSize: 0.5, borderWidth: 0.2,
  } } }],
};
const deps = {
  activeConfig: { appViewer: true },
  document: {
    body: { classList: { contains: () => false } },
  },
  window: {},
  sceneTreeNodeByRef: (_nodes, ref) => nodes[ref],
  sceneTreeNodes: () => [],
  activeMolstarViewer: () => ({}),
  sceneTreeMeasurementTargets: (_viewer, ref) => measurementTargets[ref] || [],
  SCENE_TREE_UNIFORM_COLORS: [{ value: 0x000000 }, { value: 0xffffff }],
  sceneTreeColorHex: value => `#${value.toString(16).padStart(6, '0')}`,
  captureMolstarSceneUndoSnapshot: label => ({ label }),
  pushMolstarEditUndoSnapshot: snapshot => undo.push(snapshot.label),
  streamSceneTreeMeasurementParam: async (...args) => { streamed.push(args); },
  postHostMessage: message => { posted.push(message); return true; },
  runMolstarSceneEdit: (name, action) => { actions.push(name); return action(); },
  toggleSceneTreeVisibility: () => actions.push('visibility'),
  focusSceneTreeNode: () => actions.push('focus'),
  removeSceneTreeNode: () => actions.push('remove'),
  openSceneTreeMenu: (...args) => actions.push(['settings', ...args]),
};
const menu = new Function(...Object.keys(deps), `
  let molstarNativeMenuSerial = 0;
  let sceneTreeNativeMenuPending = null;
  ${fieldsTable}
  ${functionBody('sceneTreeMeasurementParam')}
  ${functionBody('sceneTreeMeasurementValue')}
  ${functionBody('showNativeMeasurementMenu')}
  ${functionBody('handleSceneTreeNativeMenuResult')}
  return { showNativeMeasurementMenu, handleSceneTreeNativeMenuResult };
`)(...Object.values(deps));
const reply = (request, event, id, value) =>
  menu.handleSceneTreeNativeMenuResult({ requestId: request.requestId, event, id, value });

// A measurement label carries every label setting in the native menu itself,
// so no in-page settings popover is needed to reach them.
assert.equal(menu.showNativeMeasurementMenu('label-ref', { clientX: 12, clientY: 24 }), true);
const label = posted[0];
assert.equal(label.type, 'sceneTreeContextMenu');
assert.deepEqual(label.items.filter(entry => entry.id?.startsWith('measurement:')), [
  { kind: 'text', id: 'measurement:custom-text', label: 'Custom text', value: '', placeholder: 'Automatic value' },
  { kind: 'swatches', id: 'measurement:text-color', colors: ['#000000', '#ffffff'], active: '#000000' },
  { kind: 'number', id: 'measurement:text-size', label: 'Text size', value: 0.5, min: 0.1, max: 10, step: 0.01 },
  { kind: 'number', id: 'measurement:border-width', label: 'Text border', value: 0.2, min: 0, max: 0.5, step: 0.01 },
]);

// Live values reach the scene, and one undo step per control lands on close.
reply(label, 'select', 'measurement:text-size', 0.8);
reply(label, 'select', 'measurement:text-size', 1.1);
reply(label, 'select', 'measurement:custom-text', 'Salt bridge');
reply(label, 'select', 'measurement:text-color', '#ffffff');
reply(label, 'select', 'measurement:text-color', 'red');
assert.deepEqual(streamed, [
  ['label-ref', 'text-size', 0.8],
  ['label-ref', 'text-size', 1.1],
  ['label-ref', 'custom-text', 'Salt bridge'],
  ['label-ref', 'text-color', 0xffffff],
]);
reply(label, 'select', 'visibility');
assert.deepEqual(actions.splice(0), ['visibility of Label', 'visibility']);
reply(label, 'closed');
assert.deepEqual(undo, ['text size of Label', 'custom text of Label', 'text colour of Label']);
reply(label, 'select', 'remove');
assert.deepEqual(actions, [], 'a closed menu ignores late replies');

// Other rows use the shared adapter through openSceneTreeMenu.
assert.equal(menu.showNativeMeasurementMenu('polymer-ref', { clientX: 12, clientY: 24 }), false);
assert.equal(posted.length, 1);

// Hosts without NSMenu fall back to the in-page menu.
assert.equal(menu.showNativeMeasurementMenu('label-ref', { clientX: 20, clientY: 30 }), true);
reply(posted[1], 'unsupported');
assert.deepEqual(actions, [['settings', 'label-ref', 20, 30]]);
deps.activeConfig.appViewer = false;
assert.equal(menu.showNativeMeasurementMenu('label-ref', { clientX: 0, clientY: 0 }), false);
console.log('Scene tree native menu transport and measurement settings passed');
