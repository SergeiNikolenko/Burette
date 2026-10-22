import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkTrajectoryCoordinates, isExpectedTrajectorySizeGuard, trajectoryActionResult } from '../scripts/perf-trajectory-proof.mjs';
import { readPauseAcknowledgement, trajectoryPauseRendezvous } from '../scripts/perf-trajectory-pause.mjs';

const sizeLimitMessage = 'Action open_docking_view failed: fixture.xtc is larger than the 75 MB preview limit';
assert.equal(isExpectedTrajectorySizeGuard(sizeLimitMessage, 'before', 75 * 1024 * 1024 + 1), true);
assert.equal(isExpectedTrajectorySizeGuard(sizeLimitMessage, 'after', 1e9), false);
assert.equal(isExpectedTrajectorySizeGuard(sizeLimitMessage, 'before', 75 * 1024 * 1024), false);
for (const message of ['OPEN_FAILED', 'The view could not be opened.', '75 MB', 'preview limit', 'unrelated failure', null]) {
  assert.equal(isExpectedTrajectorySizeGuard(message, 'before', 1e9), false);
}

const envelope = (type, result, command = type) => ({ ok: true, action: { type, status: 'completed', result: { ok: true, command, result } } });
const opened = envelope('open_docking_view', { documentId: 'e1906fa486982313' });
assert.equal(trajectoryActionResult(opened, 'open_docking_view').documentId, 'e1906fa486982313');
const failedResult = { ok: false, command: 'open_docking_view', error: { code: 'OPEN_FAILED', message: sizeLimitMessage } };
const failed = { ok: false, action: { type: 'open_docking_view', status: 'failed', result: failedResult } };
for (const failure of [failed, { ok: true, action: { ...failed.action, status: 'completed' } }]) {
  assert.throws(() => trajectoryActionResult(failure, 'open_docking_view'), error => error.message === sizeLimitMessage
    && isExpectedTrajectorySizeGuard(error.message, 'before', 1e9));
}
for (const failure of [
  { ...failed, action: { ...failed.action, type: 'query_atoms' } },
  { ...failed, action: { ...failed.action, result: { ...failedResult, command: 'queryAtoms' } } },
  { ...failed, action: { ...failed.action, result: { ...failedResult, error: { code: 123, message: sizeLimitMessage } } } },
  { ...failed, action: { ...failed.action, result: { ...failedResult, error: { code: 'OPEN_FAILED', message: { detail: sizeLimitMessage } } } } },
]) {
  assert.throws(() => trajectoryActionResult(failure, 'open_docking_view'), error => !isExpectedTrajectorySizeGuard(error.message, 'before', 1e9));
}
assert.throws(() => trajectoryActionResult({ ...failed, action: { ...failed.action, result: { ...failedResult, error: { code: 'OPEN_FAILED', message: 'x'.repeat(2000) } } } }, 'open_docking_view'), error => error.message.length === 1200);
for (const patch of [{ ok: false }, { action: { ...opened.action, status: 'failed' } }, { action: { ...opened.action, type: 'query_atoms' } },
  { action: { ...opened.action, result: { ...opened.action.result, ok: false } } },
  { action: { ...opened.action, result: { ...opened.action.result, command: 'queryAtoms' } } }]) {
  assert.throws(() => trajectoryActionResult({ ...opened, ...patch }, 'open_docking_view'), /completed/);
}
for (const documentId of [undefined, null, '', ' ', ' id', 42, 'x'.repeat(513)]) {
  assert.throws(() => trajectoryActionResult(envelope('open_docking_view', { documentId }), 'open_docking_view'), /identify/);
}

// Exercise the real CLI session serialization without launching an app. A mock
// consumer only completes the queued action; the CLI owns the returned shape.
const session = await mkdtemp(join(tmpdir(), 'burette-trajectory-proof-'));
try {
  await writeFile(join(session, 'session.json'), JSON.stringify({ apiVersion: 'burette-agent-cli/v1', mode: 'desktop-app', token: 'proof-test' }));
  for (const completion of [opened.action, failed.action]) {
    await writeFile(join(session, 'actions.json'), JSON.stringify({ actions: [] }));
    const cli = promisify(execFile)(process.versions.bun ? 'node' : process.execPath,
      ['scripts/burette-agent.mjs', 'act', '--session-dir', session, JSON.stringify({ type: 'open_docking_view', receptorPath: '/fixture.pdb', ligandPaths: ['/fixture.xtc'] }), '--wait-ms', '5000']);
    const deadline = Date.now() + 4000;
    let queued;
    while (!queued && Date.now() < deadline) {
      // The CLI rewrites actions.json in place, so a poll can observe it mid-write.
      const state = await readFile(join(session, 'actions.json'), 'utf8').then(JSON.parse).catch(() => ({ actions: [] }));
      queued = state.actions[0];
      if (queued) await writeFile(join(session, 'actions.json'), JSON.stringify({ actions: [{ ...queued, status: completion.status, result: completion.result }] }));
      else await new Promise(resolve => setTimeout(resolve, 20));
    }
    const { stdout } = await cli;
    assert.ok(queued, 'CLI queued the docking action');
    const response = JSON.parse(stdout).result;
    if (completion.status === 'completed') assert.equal(trajectoryActionResult(response, 'open_docking_view').documentId, 'e1906fa486982313');
    else assert.throws(() => trajectoryActionResult(response, 'open_docking_view'), error => error.message === sizeLimitMessage);
  }
} finally { await rm(session, { recursive: true, force: true }); }

const expected = { frame: 9348, positions: { 0: [0, 1, 2], 4999: [3, 4, 5], 9999: [6, 7, 8] } };
const query = () => ({ total: 3, coordinateSpace: 'scene', units: 'angstrom', atoms: [
  { atom_id: 1, modelIndex: 9348, position: [0, 1, 2] }, { atom_id: 5000, modelIndex: 9348, position: [3, 4, 5] }, { atom_id: 10000, modelIndex: 9348, position: [6, 7, 8] },
] });
assert.deepEqual(trajectoryActionResult(envelope('query_atoms', query(), 'queryAtoms'), 'query_atoms', 'queryAtoms'), query());
assert.deepEqual(checkTrajectoryCoordinates(query(), expected).atoms.map(atom => atom.sourceIndex), [0, 4999, 9999]);
const reordered = query(); reordered.atoms.reverse(); reordered.atoms[0].atom_id = '10000';
assert.deepEqual(checkTrajectoryCoordinates(reordered, expected).atoms.map(atom => atom.sourceIndex), [9999, 4999, 0]);
const tolerance = query(); tolerance.atoms[0].position[0] = 0.00005;
assert.equal(checkTrajectoryCoordinates(tolerance, expected).atoms[0].maxErrorAngstrom, 0.00005);

for (const position of [[0, 1], [0, 1, 2, 3], [0, NaN, 2], [0, Infinity, 2], [0, null, 2], ['0', 1, 2], new Array(3), null]) {
  const actual = query(); actual.atoms[0].position = position;
  assert.throws(() => checkTrajectoryCoordinates(actual, expected), /coordinate vector/);
  const invalidReference = structuredClone(expected); invalidReference.positions[0] = position;
  assert.throws(() => checkTrajectoryCoordinates(query(), invalidReference), /coordinate vector/);
}
for (const id of [5000, 2, true, null, undefined, 1.5, '1garbage']) {
  const actual = query(); actual.atoms[0].atom_id = id;
  if (id === 5000) actual.atoms[0].position = [...expected.positions[4999]];
  assert.throws(() => checkTrajectoryCoordinates(actual, expected), /atom IDs/);
}
for (const patch of [{ total: 4 }, { atoms: [] }, { atoms: new Array(3) }, { coordinateSpace: 'model' }, { units: 'nm' }, { units: undefined }]) {
  assert.throws(() => checkTrajectoryCoordinates({ ...query(), ...patch }, expected));
}
const mismatch = query(); mismatch.atoms[1].position[1] += 0.001;
assert.throws(() => checkTrajectoryCoordinates(mismatch, expected), /Coordinate mismatch/);
// The failed 11 GB campaign queried source frame 9350 after requesting 9348.
// Even periodically identical coordinates cannot substitute for the right frame.
for (const modelIndex of [9350, 9445, undefined, null, '9348', NaN]) {
  const drifted = query(); drifted.atoms[0].modelIndex = modelIndex;
  assert.throws(() => checkTrajectoryCoordinates(drifted, expected), /Frame mismatch/);
}
for (const frame of [undefined, null, -1, 1.5]) {
  assert.throws(() => checkTrajectoryCoordinates(query(), { ...expected, frame }), /requested source frame/);
}

const pauseDir = await mkdtemp(join(tmpdir(), 'burette-trajectory-pause-'));
try {
  const output = join(pauseDir, 'evidence.json'), screenshot = join(pauseDir, 'paused.png');
  const ready = `${output}.pause-massive-1.ready`, finish = `${output}.pause-massive-1.finish`;
  const pending = trajectoryPauseRendezvous({ output, name: 'massive', run: 0, pid: 123, sessionDir: pauseDir, documentId: 'doc', assertUnlocked: () => {} });
  const marker = JSON.parse(await readFile(ready, 'utf8'));
  assert.equal(marker.run, 1); assert.equal(marker.documentId, 'doc');
  await writeFile(screenshot, 'test screenshot boundary');
  await writeFile(finish, JSON.stringify({ paused: true, evidencePath: screenshot }));
  assert.equal((await pending).evidencePath, screenshot);
  await assert.rejects(trajectoryPauseRendezvous({ output, name: 'massive', run: 0 }), /overwrite/);
  assert.throws(() => readPauseAcknowledgement(finish, Date.now() + 60_000), /fresh/);
  for (const acknowledgement of [{ paused: false, evidencePath: screenshot }, { paused: true, evidencePath: 'relative.png' }, { paused: true }]) {
    await writeFile(finish, JSON.stringify(acknowledgement));
    assert.throws(() => readPauseAcknowledgement(finish, 0), /paused:true/);
  }
  await writeFile(finish, 'x'.repeat(2049));
  assert.throws(() => readPauseAcknowledgement(finish, 0), /2 KiB/);
} finally { await rm(pauseDir, { recursive: true, force: true }); }

// Exercise the actual driver finally block without starting or stopping any
// app. Refused dirty/stale cleanup must still save the report and keep session.
const driver = await readFile(new URL('../scripts/perf-trajectory-native.mjs', import.meta.url), 'utf8');
const finalStart = driver.lastIndexOf('\nfinally {'), finalEnd = driver.indexOf('\n}\nconsole.log', finalStart);
assert.ok(finalStart >= 0 && finalEnd > finalStart);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const finalize = new AsyncFunction('app', 'report', 'spawnSync', 'save', 'process', driver.slice(finalStart + '\nfinally {'.length, finalEnd));
for (const scenario of ['refused', 'primary-failed', 'item-failed', 'sync-failed', 'trace-invalid', 'trace-missing', 'success', 'trash-failed']) {
  const report = { failures: ['refused', 'primary-failed'].includes(scenario) ? ['Original scientific failure'] : [],
    cases: scenario === 'item-failed' ? [{ name: 'massive', failures: ['coordinate mismatch'] }] : [] };
  let saved, quits = 0, trashed = 0;
  const diagnostics = { droppedEntries: 0, failedBatches: 0, duplicateEntries: 0, malformedLines: 0, rotationGaps: 0 };
  if (scenario === 'trace-invalid') diagnostics.droppedEntries = 1;
  if (scenario === 'trace-missing') delete diagnostics.rotationGaps;
  const app = { sessionDir: '/owned/session', owned: false, trace: { diagnostics, sync() { if (scenario === 'sync-failed') throw new Error('trace unavailable'); } },
    async quit() {
      quits++;
      this.quitDiagnostics = { traceDrain: { status: scenario === 'refused' ? 'cleanup-refused' : 'confirmed' } };
      if (scenario === 'refused') { this.owned = true; throw new Error('dirty draft refused ' + 'x'.repeat(3000)); }
    } };
  const processState = {};
  await finalize(app, report, () => { trashed++; return { status: scenario === 'trash-failed' ? 1 : 0, stderr: 'trash refused' }; }, () => { saved = structuredClone(report); }, processState);
  assert.equal(quits, 1, 'a trace error does not bypass safe quit');
  assert.ok(saved.endedAt);
  assert.equal(saved.failure, saved.failures[0] ?? null);
  assert.equal(saved.sessionDir, '/owned/session');
  assert.equal(saved.sessionPreserved, scenario !== 'success');
  assert.equal(trashed, ['success', 'trash-failed'].includes(scenario) ? 1 : 0);
  assert.equal(processState.exitCode, scenario === 'success' ? undefined : 1);
  if (scenario === 'refused') {
    assert.equal(saved.failure, 'Original scientific failure');
    assert.equal(saved.quitDiagnostics.quitFailure.length, 1200);
    assert.equal(saved.quitDiagnostics.traceDrain.status, 'cleanup-refused');
  }
}
console.log('Native trajectory coordinate proof rejects incomplete, non-finite, duplicate, wrong-space/unit and mismatched samples.');
