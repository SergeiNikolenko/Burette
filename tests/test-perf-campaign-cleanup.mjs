import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { scaleIntegrity } from '../scripts/perf-scalability-metrics.mjs';
import { repeatRunIntegrity } from '../scripts/perf-scalability-repeat-metrics.mjs';

// Execute the drivers' actual finally blocks, replacing native/filesystem
// effects. This exercises failures without launching, stopping or sampling apps.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const scaleSource = await readFile(new URL('../scripts/perf-scalability.mjs', import.meta.url), 'utf8');
const repeatSource = await readFile(new URL('../scripts/perf-scalability-repeat.mjs', import.meta.url), 'utf8');
const scaleStart = scaleSource.lastIndexOf('} finally {') + '} finally {'.length;
const repeatStart = repeatSource.lastIndexOf('  } finally {') + '  } finally {'.length;
assert.ok(scaleStart > 20 && repeatStart > 20);
const scaleBody = scaleSource.slice(scaleStart, scaleSource.indexOf('\n}\nif (report.failure)', scaleStart));
const repeatBody = repeatSource.slice(repeatStart, repeatSource.indexOf('\n  }\n  if (run.cleanup?', repeatStart));
const finalizeScale = new AsyncFunction('app', 'report', 'save', 'reduceScaleSwitches', 'scaleIntegrity', 'loadavg', 'execFileSync', 'console', scaleBody);
const finalizeRepeat = new AsyncFunction('app', 'run', 'save', 'fs', 'sleep', 'waitFor', 'index', 'reduceScaleOpen', 'hash', 'repeatRunIntegrity', 'loadavg', 'execFileSync', 'console', repeatBody);
const quiet = { error() {} };

function fixture() {
  const lines = [], samples = [];
  for (const [index, total] of [1, 10, 100, 1000].entries()) {
    const added = total - (samples.at(-1)?.total ?? 0);
    for (let row = 0; row < added; row++) lines.push({ name: 'document:added', at: index + 1, stream: 'one', seq: lines.length + 1, detail: { documentId: `${total}-${row}` } });
    samples.push({ total, added, startedAt: index + 1, finishedAt: index + 1, tracedDocumentsAdded: added,
      tracedUniqueDocumentsAdded: added, registeredBounds: { documents: { total } }, measurementFailures: [], traceProtocol: 'sequenced' });
  }
  return { lines, samples };
}

function mockApp(scenario, lines) {
  let quits = 0;
  const diagnostics = { droppedEntries: 0, failedBatches: 0, malformedLines: 0, rotationGaps: 0,
    duplicateEntries: 0, sequenceGaps: 0, readerOverflows: 0, oversizedLines: 0, integrityErrors: 0 };
  const app = { sessionDir: '/owned/session', pids: () => scenario === 'refused' ? [600] : [],
    observe: () => ({ bounds: { documents: { total: 0 } } }),
    trace: { lines, diagnostics,
      sync() { if (scenario === 'sticky') { diagnostics.sequenceGaps = 1; diagnostics.integrityErrors = 1; throw Error('sticky reader failed'); } },
      between(from, to) { if (scenario === 'recount') throw Error('sticky recount failed'); return lines.filter(line => from <= line.at && line.at <= to); },
    },
    async quit() {
      quits++;
      this.quitDiagnostics = { cleanupFailure: scenario === 'refused' ? 'dirty draft' : null,
        traceDrain: { status: scenario === 'drain' ? 'timeout' : 'confirmed' } };
      if (scenario === 'final-sync') this.quitDiagnostics.finalSyncFailure = 'late trace error';
      if (scenario === 'refused') throw Error('preserving dirty app ' + 'x'.repeat(3000));
    },
  };
  return { app, quits: () => quits };
}

for (const scenario of ['success', 'primary', 'refused', 'sticky', 'recount', 'reducer', 'integrity', 'drain', 'final-sync', 'trash']) {
  test(`scale finally persists ${scenario} and preserves failed sessions`, async () => {
    const { lines, samples } = fixture(), { app, quits } = mockApp(scenario, lines);
    const report = { startedAt: new Date(0).toISOString(), samples, failure: scenario === 'primary' ? 'original failure' : null,
      switches: Array(24).fill({}), switchActions: Array(24).fill({}), switchMeasurement: { expected: 24, finishedAt: 5 },
      switchMetricDefinitions: {}, switchSummary: { visibleMs: { n: 24, p95: 20 } },
      switchIntegrity: { matched: 24, readyObserved: 24, missingActionIndices: [], ambiguousActionIndices: [] },
      close: { bounds: { documents: { total: 0 } } } };
    let saved, trashed = 0;
    await finalizeScale(app, report, () => { saved = structuredClone(report); }, () => {
      if (scenario === 'reducer') throw Error('reducer failed');
      return { switches: report.switches, summary: report.switchSummary, subsets: {}, integrity: report.switchIntegrity };
    }, value => { if (scenario === 'integrity') throw Error('integrity reduction failed'); return scaleIntegrity(value); }, () => [0, 0, 0], () => {
      trashed++; if (scenario === 'trash') throw Error('trash refused');
    }, quiet);
    assert.equal(quits(), 1);
    assert.ok(saved.finishedAt);
    assert.equal(saved.integrity.status, scenario === 'success' ? 'pass' : 'fail');
    assert.equal(saved.sessionPreserved, scenario !== 'success');
    assert.equal(trashed, ['success', 'trash'].includes(scenario) ? 1 : 0);
    if (scenario === 'primary') assert.equal(saved.failure, 'original failure');
    if (scenario === 'refused') assert.equal(saved.shutdownFailure.length, 1600);
    if (scenario === 'sticky') assert.equal(saved.traceDiagnostics.integrityErrors, 1);
  });
}

for (const scenario of ['success', 'primary', 'refused', 'sticky', 'reducer', 'integrity', 'drain', 'final-sync', 'hash', 'trash']) {
  test(`repeat finally persists ${scenario} and never validates missing drain`, async () => {
    const { lines, samples } = fixture(), { app, quits } = mockApp(scenario, lines);
    const run = { samples, rawTracePath: '/owned/trace', failure: scenario === 'primary' ? 'original failure' : null };
    let saved, trashed = 0;
    await finalizeRepeat(app, run, () => { saved = structuredClone(run); }, {
      writeFileSync() { throw Error('Unexpected CUA rendezvous in empty-workspace fixture'); },
      readFileSync() { if (scenario === 'hash') throw Error('trace file missing'); return 'trace'; },
    }, async () => {}, async () => { throw Error('Unexpected native wait'); }, 0, (_lines, sample) => {
      if (scenario === 'reducer') throw Error('reducer failed'); return sample;
    }, () => 'hash', value => { if (scenario === 'integrity') throw Error('integrity reduction failed'); return repeatRunIntegrity(value); }, () => [0, 0, 0], () => {
      trashed++; if (scenario === 'trash') throw Error('trash refused');
    }, quiet);
    assert.equal(quits(), 1);
    assert.ok(saved.finishedAt);
    assert.equal(saved.integrity.status, scenario === 'success' ? 'pass' : 'fail');
    assert.equal(saved.status, scenario === 'success' ? 'complete' : 'exploratory-or-failed');
    assert.equal(saved.sessionPreserved, scenario !== 'success');
    assert.equal(trashed, ['success', 'trash'].includes(scenario) ? 1 : 0);
    assert.equal(saved.quitDiagnostics.traceDrain.status, scenario === 'drain' ? 'timeout' : 'confirmed');
    if (scenario === 'primary') assert.equal(saved.failure, 'original failure');
    if (scenario === 'sticky') assert.equal(saved.traceDiagnostics.integrityErrors, 1);
  });
}
