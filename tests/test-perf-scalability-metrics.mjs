import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reduceScaleSwitches, scaleFocusScene, scaleIntegrity } from '../scripts/perf-scalability-metrics.mjs';

const actions = Array.from({ length: 24 }, (_, index) => ({ startedAt: 1000 + index * 100, documentId: String(index) }));
const lines = actions.map(action => ({ at: action.startedAt + 10, name: 'document:visible', ms: 25,
  detail: { kind: 'tab', documentId: action.documentId, blankFrames: 0, loads: 0, remounted: false } }));
const starts = actions.map(action => ({ at: action.startedAt + 10, name: 'tab:switch', detail: { documentId: action.documentId } }));
lines.push(...starts);
const reduction = reduceScaleSwitches(lines, actions, 4000);
assert.equal(reduction.switches.length, 24);
assert.equal(reduction.summary.visibleMs.p95, 25);
assert.equal(reduceScaleSwitches(lines.slice(1), actions, 4000).integrity.missingActionIndices[0], 0);
assert.equal(reduceScaleSwitches([...lines, lines[1]], actions, 4000).integrity.ambiguousActionIndices[0], 1);
assert.equal(reduceScaleSwitches([{ ...lines[0], detail: { kind: 'tab', documentId: 'wrong' } }], actions, 4000).switches.length, 0);
const samples = [1, 10, 100, 1000].map((total, index, totals) => ({ total, added: total - (totals[index - 1] ?? 0),
  tracedDocumentsAdded: total - (totals[index - 1] ?? 0), registeredBounds: { documents: { total } } }));
const report = { samples, switches: reduction.switches, switchActions: actions, switchIntegrity: reduction.integrity,
  traceProtocol: 'sequenced', traceDiagnostics: { droppedEntries: 0, failedBatches: 0, malformedLines: 0, rotationGaps: 0 },
  close: { bounds: { documents: { total: 0 } } } };
assert.equal(scaleIntegrity(report).status, 'pass');
const legacy = structuredClone(report);
legacy.samples[3].tracedDocumentsAdded = 399;
legacy.traceProtocol = 'legacy';
assert.equal(scaleIntegrity(legacy).status, 'fail');
assert.equal(scaleIntegrity(legacy).documents[3].missing, 501, 'zero diagnostics do not conceal legacy truncation');
assert.ok(scaleIntegrity(legacy).failures.some(message => message.includes('no sequence')));
assert.equal(scaleIntegrity({ ...report, switches: reduction.switches.slice(0, 6) }).status, 'fail');
assert.equal(scaleIntegrity({ ...report, traceDiagnostics: { ...report.traceDiagnostics, rotationGaps: 1 } }).status, 'fail');
for (const quitDiagnostics of [null, { cleanupFailure: 'refused', traceDrain: { status: 'confirmed' } },
  { cleanupFailure: null, traceDrain: { status: 'timeout' } }]) {
  assert.equal(scaleIntegrity({ ...report, switchMetricDefinitions: {}, quitDiagnostics }).status, 'fail');
}
{
  const [warm, cold] = actions.slice(0, 2);
  const mixed = reduceScaleSwitches([
    ...starts.slice(0, 2),
    { ...lines[0], detail: { ...lines[0].detail, remounted: false } },
    { at: cold.startedAt + 11, name: 'iframe:mount', detail: { documentId: cold.documentId } },
    { ...lines[1], name: 'document:ready', ms: 35 },
  ], [warm, cold], 1300);
  assert.equal(mixed.integrity.matched, 2);
  assert.equal(mixed.integrity.visible, 1);
  assert.equal(mixed.integrity.readyTerminal, 1);
  assert.equal(mixed.subsets['mounted-warm'].count, 1);
  assert.equal(mixed.subsets.remounted.count, 1);
  assert.equal(mixed.switches[0].readyTerminalMs, null, 'warm frames do not invent ready handshakes');
  assert.equal(mixed.switches[1].visibleMs, null, 'ready fallback does not invent rAF visibility');
  assert.equal(mixed.switches[1].readyTerminalMs, 45);
  const readyOnly = [starts[1], { ...lines[1], name: 'document:ready', ms: 35 }];
  assert.equal(reduceScaleSwitches(readyOnly, [cold], 1300).integrity.matched, 0, 'missing visible is not evidence of a cold mount or scene readiness');
  assert.equal(reduceScaleSwitches(readyOnly, [warm], cold.startedAt).integrity.matched, 0, 'ready cannot cross an action boundary');
  assert.equal(reduceScaleSwitches(readyOnly, [{ ...cold, documentId: 'other' }], 1300).integrity.matched, 0);
  const acrossCliBoundary = [starts[0], { ...lines[0], ms: 120 },
    { at: 1150, name: 'tab:switch', detail: { documentId: 'next' } }];
  assert.equal(scaleFocusScene(acrossCliBoundary, warm, 1100).status, 'complete', 'completion is bounded by actual focus, not early next CLI invocation');
  assert.equal(scaleFocusScene(acrossCliBoundary, warm, 1100).terminalAt, 1130);
  acrossCliBoundary[2].at = 1120;
  assert.equal(scaleFocusScene(acrossCliBoundary, warm, 1100).status, 'pending', 'a terminal after actual next focus cannot count');
}
{
  // Exercise the real harness helper without importing its app-launching entrypoint.
  const source = readFileSync(new URL('../scripts/perf-scalability.mjs', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('async function focusReady('), source.indexOf('function ownedRss('));
  // observedTab has no documentId; identity belongs to activeSurface in the
  // same fresh observation as the matching active path and readiness.
  const tab = { id: 't', index: 0, kind: 'file', title: 'target.pdb', path: '/target.pdb', active: false }, actions = [];
  let observation = { reportedAt: new Date(900).toISOString(), activeTabId: 't',
    activeDocument: { path: tab.path, ready: true }, activeSurface: { kind: 'viewer', documentId: 'd' } };
  let now = 1000;
  const marks = [{ at: 1000, name: 'tab:switch', detail: { documentId: 'd' } },
    { at: 1003, name: 'iframe:mount', detail: { documentId: 'd' } },
    { at: 1000, name: 'document:visible', ms: 20, detail: { documentId: 'd', kind: 'tab', remounted: true, loads: 0 } }];
  const app = { observe: () => observation, act: () => {}, trace: { lines: marks, sync() {} } };
  const wait = async (_label, predicate) => {
    assert.equal(predicate(), false, 'old ready target snapshot must not satisfy a new focus');
    observation = { ...observation, reportedAt: new Date(1001).toISOString(), activeDocument: { path: '/predecessor.pdb', ready: true } };
    assert.equal(predicate(), false, 'fresh predecessor ready is not target ready');
    observation.activeDocument = { path: tab.path, ready: false };
    assert.equal(predicate(), false);
    observation.activeDocument.ready = true;
    observation.activeSurface = null;
    assert.equal(predicate(), false, 'a ready path without a viewer identity is not enough');
    observation.activeSurface = { kind: 'viewer', documentId: 'd' };
    assert.equal(predicate(), false, 'cached ready before the new mount must not release the next focus');
    marks.push({ at: 1000, name: 'document:ready', ms: 200, detail: { documentId: 'd', kind: 'tab', loads: 1 } });
    assert.equal(predicate(), false, 'observation must be fresh relative to the actual scene terminal too');
    observation.reportedAt = new Date(1201).toISOString();
    now = 1300;
    assert.equal(predicate(), true);
  };
  const focus = new Function('app', 'waitFor', 'Date', 'scaleFocusScene', `${helper}; return focusReady;`)(app, wait, { now: () => now, parse: Date.parse }, scaleFocusScene);
  await focus(tab, actions);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].documentId, 'd');
  assert.deepEqual(actions[0].readyObservation, { reportedAt: new Date(1201).toISOString(), tabId: 't', documentId: 'd', path: tab.path, ready: true, sceneTerminalAt: 1200 });
  const action = actions[0];
  assert.equal(reduceScaleSwitches(marks, [action], 1500).integrity.readyObserved, 1);
  assert.equal(reduceScaleSwitches(marks, [action], 1500).switches[0].sceneReadyMs, 200);
  action.readyObservation = { ...action.readyObservation, path: '/predecessor.pdb' };
  assert.equal(reduceScaleSwitches(marks, [action], 1500).integrity.matched, 0);
}
console.log('Native scale measurement integrity tests passed');
