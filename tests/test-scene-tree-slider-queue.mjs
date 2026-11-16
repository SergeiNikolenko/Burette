import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync('PreviewExtension/Web/viewer.js', 'utf8');
const scenarios = [
  {
    queue: 'Measurement', inFlight: 'sceneTreeMeasurementDrain',
    stream: 'streamSceneTreeMeasurementParam', apply: 'applySceneTreeMeasurementParam',
    first: ['measurement-a', 'text-size', 0],
    moves: value => ['measurement-a', 'text-size', value],
    other: ['measurement-a', 'line-size', 2], finalOther: ['measurement-a', 'line-size', 3],
    otherRef: ['measurement-b', 'text-size', 4],
  },
  {
    queue: 'Param', inFlight: 'sceneTreeParamDrain',
    stream: 'streamSceneTreeReprParam', apply: 'applySceneTreeReprParam',
    first: ['representation-a', 'sizeFactor', 0],
    moves: value => ['representation-a', 'sizeFactor', value],
    other: ['representation-a', 'thicknessFactor', 2], finalOther: ['representation-a', 'thicknessFactor', 3],
    otherRef: ['representation-b', 'sizeFactor', 4],
  },
  {
    queue: 'Alpha', inFlight: 'sceneTreeAlphaDrain',
    stream: 'streamSceneTreeReprAlpha', apply: 'applySceneTreeReprAlpha',
    first: ['representation-a', 0], moves: value => ['representation-a', value],
    other: ['representation-b', 0.2], finalOther: ['representation-b', 0.3],
    otherRef: ['representation-c', 0.4],
  },
];

for (const scenario of scenarios) {
  const start = source.indexOf(`  let ${scenario.inFlight} =`);
  const functionStart = source.indexOf(`  async function ${scenario.stream}(`, start);
  const end = source.indexOf('\n  }', functionStart) + 4;
  assert.ok(start >= 0 && functionStart > start && end > functionStart);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const applied = [];
  let active = 0;
  let maximumActive = 0;
  const stream = new Function(scenario.apply,
    source.slice(start, end) + `\nreturn ${scenario.stream};`)(async (...args) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    applied.push(args);
    if (applied.length === 1) await blocked;
    active--;
  });
  const running = stream(...scenario.first);
  for (let value = 1; value <= 100; value++) await stream(...scenario.moves(value / 100));
  await stream(...scenario.other);
  await stream(...scenario.otherRef);
  await stream(...scenario.finalOther);
  assert.deepEqual(applied, [scenario.first], `${scenario.queue}: pending input never starts a concurrent write`);
  release();
  await running;
  assert.deepEqual(applied, [scenario.first, scenario.moves(1), scenario.finalOther, scenario.otherRef],
    `${scenario.queue}: preserve each target/control's last value, with no backlog of pointer moves`);
  assert.equal(maximumActive, 1, `${scenario.queue}: state writes remain serialized`);
  await stream(...scenario.moves(0.5));
  assert.deepEqual(applied.at(-1), scenario.moves(0.5), `${scenario.queue}: next gesture drains normally`);
}
console.log('Scene slider queues preserve final values across controls and targets, coalesce 100 moves, and serialize writes.');

// Run the real symmetry DOM listeners, shared parameter queue and undo helpers.
const dom = new JSDOM('<div data-ref="symmetry"><label><input type="range" min="0" max="5" step="0.1" data-scene-tree-symmetry-scale="1"><span class="buret-tree-menu-slider-value"></span></label></div>');
const document = dom.window.document;
const readFunction = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const listener = event => {
  const start = source.indexOf(`      document.addEventListener('${event}', event => {\n        const control = event.target.closest('[data-scene-tree-symmetry-scale]');`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n      });', start) + 10);
};
const queueStart = source.indexOf('  let sceneTreeParamDrain =');
const queueFunction = source.indexOf('  async function streamSceneTreeReprParam(', queueStart);
const queueEnd = source.indexOf('\n  }', queueFunction) + 4;
let releaseRepresentation;
const representationBusy = new Promise(resolve => { releaseRepresentation = resolve; });
const applied = [];
const captured = [];
const undo = [];
const runtime = new Function('document', 'applySceneTreeReprParam', 'updateSceneTreeAssemblySymmetry', 'captureMolstarSceneUndoSnapshot', 'pushMolstarEditUndoSnapshot', `
  const sceneTreeControlUndoSnapshots = new WeakMap();
  function activeMolstarViewer() { return {}; }
  function sceneTreeNodes() { return []; }
  function sceneTreeNodeByRef() { return { label: 'Global Symmetry' }; }
  function runMolstarSceneEdit() { throw new Error('input/change must use the gesture snapshot, not create another edit'); }
  ${source.slice(queueStart, queueEnd)}
  ${readFunction('beginSceneTreeControlUndo')}
  ${readFunction('commitSceneTreeControlUndo')}
  ${listener('input')}
  ${listener('change')}
  return streamSceneTreeReprParam;
`)(document, async (...args) => { applied.push(['representation', ...args]); await representationBusy; },
  async (ref, patch) => { applied.push(['symmetry', ref, patch.scale]); },
  label => { const snapshot = { label }; captured.push(snapshot); return snapshot; }, snapshot => undo.push(snapshot));
const input = document.querySelector('input');
const first = runtime('representation', 'sizeFactor', 1);
for (let index = 1; index <= 10; index++) {
  input.value = String(index / 10);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
assert.equal(document.querySelector('span').textContent, '1');
assert.equal(captured.length, 1, 'continuous symmetry input captures only one undo snapshot');
assert.equal(undo.length, 0, 'dragging does not commit undo entries');
input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
assert.deepEqual(undo, captured, 'release commits the single gesture snapshot');
releaseRepresentation();
await first;
assert.deepEqual(applied, [['representation', 'representation', 'sizeFactor', 1], ['symmetry', 'symmetry', 1]],
  'symmetry shares serialized backpressure and retains its final scale');
input.value = '2';
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.deepEqual(applied.at(-1), ['symmetry', 'symmetry', 2], 'next gesture applies symmetry before release');
assert.equal(undo.length, 1);
input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
assert.equal(undo.length, 2, 'each gesture creates one undo entry');
dom.window.close();
console.log('Symmetry scale streams before release, shares the bounded parameter queue, and commits one undo snapshot per gesture.');

// Undo/Redo must wait for every accepted live-control write before restoring.
// Only the scene storage boundary is replaced; queue and history code is real.
const functionText = name => {
  const match = new RegExp(`  (?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, `missing ${name}`);
  return source.slice(match.index, source.indexOf('\n  }', match.index) + 4);
};
const queueText = scenario => {
  const start = source.indexOf(`  let ${scenario.inFlight} =`);
  const fnStart = source.indexOf(`  async function ${scenario.stream}(`, start);
  return source.slice(start, source.indexOf('\n  }', fnStart) + 4);
};
let scene = { size: 2, scale: 2, alpha: 1, text: 2 };
let restored = 0;
const undoStack = [];
const redoStack = [];
const gates = new Map();
const hold = key => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  gates.set(key, promise);
  return () => { gates.delete(key); release(); };
};
const dependencies = {
  molstarEditUndoStack: undoStack, molstarEditRedoStack: redoStack,
  applySceneTreeReprParam: async (_ref, _name, value) => { await gates.get('size'); scene.size = value; },
  updateSceneTreeAssemblySymmetry: async (_ref, patch) => { scene.scale = patch.scale; },
  applySceneTreeReprAlpha: async (_ref, value) => { await gates.get('alpha'); scene.alpha = value; },
  applySceneTreeMeasurementParam: async (_ref, _field, value) => { await gates.get('text'); scene.text = value; },
  captureMolstarSceneUndoSnapshot: label => ({ kind: 'scene', label, state: { ...scene } }),
  restoreMolstarEditUndoSnapshot: async snapshot => { restored++; scene = { ...snapshot.state }; },
  activeMolstarViewer: () => ({}), sceneTreeNodes: () => [], sceneTreeNodeByRef: () => ({ label: 'Global Symmetry' }),
  notifyMolstarEditHistoryChanged() {}, setStatus() {}, hideStatus() {}, setTimeout() {}, isQuickLookHost: () => false,
};
const history = new Function(...Object.keys(dependencies), `
  const MOLSTAR_EDIT_HISTORY_LIMIT = 20;
  const sceneTreeControlUndoSnapshots = new WeakMap();
  ${scenarios.map(queueText).join('\n')}
  ${['beginSceneTreeControlUndo', 'commitSceneTreeControlUndo', 'pushMolstarHistorySnapshot',
    'pushMolstarEditUndoSnapshot', 'captureMolstarHistoryCounterpart', 'waitForSceneTreeControlUpdates',
    'undoMolstarLastEdit', 'redoMolstarLastEdit'].map(functionText).join('\n')}
  return { streamSceneTreeReprParam, streamSceneTreeReprAlpha, streamSceneTreeMeasurementParam,
    beginSceneTreeControlUndo, commitSceneTreeControlUndo, undoMolstarLastEdit, redoMolstarLastEdit };
`)(...Object.values(dependencies));
const releaseSize = hold('size');
const releaseAlpha = hold('alpha');
const releaseText = hold('text');
const control = {};
history.beginSceneTreeControlUndo(control, 'symmetry', 'symmetry scale');
const sizeDrain = history.streamSceneTreeReprParam('representation', 'sizeFactor', 1);
await history.streamSceneTreeReprParam('symmetry', 'scale', 1, { kind: 'symmetry' });
const alphaDrain = history.streamSceneTreeReprAlpha('representation', 0.9);
await history.streamSceneTreeReprAlpha('representation', 0.4);
const textDrain = history.streamSceneTreeMeasurementParam('measurement', 'text-size', 1);
await history.streamSceneTreeMeasurementParam('measurement', 'text-size', 0.5);
history.commitSceneTreeControlUndo(control);
const undoPending = history.undoMolstarLastEdit();
await Promise.resolve();
assert.equal(undoStack.length, 1, 'history is not consumed while live writes are pending');
assert.equal(restored, 0);
releaseSize(); await sizeDrain;
assert.equal(restored, 0, 'Undo also waits for opacity and measurement writes');
releaseAlpha(); await alphaDrain;
assert.equal(restored, 0, 'Undo waits for the last active slider family');
releaseText(); await textDrain;
await undoPending;
assert.deepEqual(scene, { size: 2, scale: 2, alpha: 1, text: 2 }, 'Undo restores the pre-gesture scene after draining');
assert.deepEqual(redoStack[0].state, { size: 1, scale: 1, alpha: 0.4, text: 0.5 }, 'Redo captures final queued values, not an intermediate scene');
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(scene, { size: 2, scale: 2, alpha: 1, text: 2 }, 'no pending slider write survives the restore');
assert.equal(restored, 1);
const releaseRedoSize = hold('size');
const redoSizeDrain = history.streamSceneTreeReprParam('representation', 'sizeFactor', 0.8);
const redoPending = history.redoMolstarLastEdit();
await Promise.resolve();
assert.equal(restored, 1, 'Redo waits before capturing and restoring too');
releaseRedoSize(); await redoSizeDrain; await redoPending;
assert.deepEqual(scene, { size: 1, scale: 1, alpha: 0.4, text: 0.5 });
assert.equal(undoStack.at(-1).state.size, 0.8, 'Redo captures its counterpart only after the pending write');
console.log('Undo/Redo wait for parameter, opacity and measurement drains; restored scenes and redo counterparts retain the intended values.');
