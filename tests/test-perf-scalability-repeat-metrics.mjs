import assert from 'node:assert/strict';
import { reduceScaleOpen, repeatRunIntegrity, summarizeScaleRepeats } from '../scripts/perf-scalability-repeat-metrics.mjs';

const sample = { startedAt: 1000, finishedAt: 5000, total: 1, added: 1, ackMs: 500, firstRequestedPath: '/new.pdb',
  registeredBounds: { documents: { total: 1 } }, activeObservation: { path: '/new.pdb', ready: true } };
const mark = (name, at, detail, ms) => ({ name, at, detail, ms, source: 'web', stream: 'one', seq: at });
const lines = [mark('document:added', 1050, { documentId: 'new', path: '/new.pdb' }),
  mark('document:ready', 1051, { documentId: 'old' }, 1),
  mark('document:ready', 900, { documentId: 'new' }, 1),
  mark('document:visible', 1051, { documentId: 'new' }, 149),
  mark('document:ready', 1051, { documentId: 'new' }, 249)];
const result = reduceScaleOpen(lines, sample);
assert.equal(result.firstAdmissionMs, 50);
assert.equal(result.firstActiveVisibleMs, 200);
assert.equal(result.firstActiveReadyMs, 300, 'unrelated or pre-action readiness never satisfies a new open');
assert.deepEqual(result.measurementFailures, []);
assert.deepEqual(reduceScaleOpen(lines.filter(line => line.name !== 'document:visible'), sample).measurementFailures, [], 'ready is the primary endpoint; visibility is supplementary');
const staleActive = reduceScaleOpen(lines, { ...sample, activeObservation: { path: '/old.pdb', ready: true } });
assert.equal(staleActive.firstActiveReadyMs, null);
assert.ok(staleActive.measurementFailures.some(message => message.includes('independent observation')));
assert.equal(reduceScaleOpen(lines.filter(line => line.name !== 'document:ready'), sample).firstActiveReadyMs, null);
const duplicate = reduceScaleOpen([...lines, lines[0]], sample);
assert.equal(duplicate.documentId, null, 'ambiguous admission must not fabricate an active document identity');
const run = { samples: [1, 10, 100, 1000].map((total, index, totals) => ({ ...result, total, added: total - (totals[index - 1] ?? 0),
  tracedDocumentsAdded: total - (totals[index - 1] ?? 0), tracedUniqueDocumentsAdded: total - (totals[index - 1] ?? 0),
  registeredBounds: { documents: { total } } })), cleanup: { documents: 0 },
  traceDiagnostics: { droppedEntries: 0, failedBatches: 0, malformedLines: 0, rotationGaps: 0 } };
run.integrity = repeatRunIntegrity(run);
assert.equal(run.integrity.status, 'pass');
const legacy = structuredClone(run);
legacy.samples[3].tracedDocumentsAdded = legacy.samples[3].tracedUniqueDocumentsAdded = 399;
legacy.samples.forEach(row => { row.traceProtocol = 'legacy-or-incomplete'; });
legacy.integrity = repeatRunIntegrity(legacy);
assert.equal(legacy.integrity.status, 'fail');
assert.equal(legacy.integrity.documents[3].missing, 501);
const summary = summarizeScaleRepeats([run, legacy]);
assert.equal(summary[1000].observed.ackMs.n, 2);
assert.equal(summary[1000].validated.ackMs.n, 1);
assert.equal(repeatRunIntegrity({ ...run, cleanup: { documents: 900 } }).status, 'fail');
assert.equal(repeatRunIntegrity({ ...run, cleanup: { documents: 0, failure: 'interrupted' } }).status, 'fail');
console.log('Repeated native scale reduction tests passed');
