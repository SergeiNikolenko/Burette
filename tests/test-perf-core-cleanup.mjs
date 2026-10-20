import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the real driver finally block without launching a native app.
const source = readFileSync(new URL('../scripts/perf-journeys.mjs', import.meta.url), 'utf8');
const start = source.lastIndexOf('  } finally {') + '  } finally {'.length;
const end = source.indexOf('\n  const summary = summarize(results);', start);
assert.ok(start > 0 && end > start);
const body = source.slice(start, end).replace(/\n  }\s*$/, '');
const run = new (Object.getPrototypeOf(async function () {}).constructor)(
  'app', 'options', 'skippedJourneys', 'failure', 'spawnSync', 'console',
  `let sessionPreserved = true; ${body}; return { failure, sessionPreserved };`,
);
for (const mode of ['success', 'primary-failure', 'sync-failure', 'quit-refused', 'missing-drain', 'trace-gap', 'trash-failed', 'keep-running', 'skipped']) {
  const diagnostics = { droppedEntries: 0, failedBatches: 0, duplicateEntries: 0, malformedLines: 0, rotationGaps: 0, sequenceGaps: mode === 'trace-gap' ? 1 : 0 };
  let quitCalls = 0, trashCalls = 0;
  const app = {
    sessionDir: 'synthetic-session',
    quitDiagnostics: { traceDrain: { status: 'confirmed', actionId: 'previous-run' } },
    trace: { diagnostics, sync() { if (mode === 'sync-failure') throw Error('sticky integrity error'); } },
    async quit() {
      quitCalls++;
      this.quitDiagnostics = { traceDrain: { status: mode === 'missing-drain' ? 'timeout' : 'confirmed' } };
      if (mode === 'quit-refused') throw Error('dirty draft refused close');
    },
  };
  const result = await run(app, { keepRunning: mode === 'keep-running' }, mode === 'skipped' ? ['missing-fixture'] : [],
    mode === 'primary-failure' ? 'original failure' : null,
    (command, args) => { trashCalls++; assert.equal(command, '/usr/bin/trash'); assert.deepEqual(args, ['synthetic-session']); return { status: mode === 'trash-failed' ? 1 : 0 }; },
    { error() {} });
  assert.equal(quitCalls, mode === 'keep-running' ? 0 : 1, mode);
  assert.equal(result.sessionPreserved, mode !== 'success', mode);
  assert.equal(trashCalls, ['success', 'trash-failed'].includes(mode) ? 1 : 0, mode);
  assert.equal(Boolean(result.failure), !['success', 'keep-running', 'skipped'].includes(mode), mode);
  if (mode === 'primary-failure') assert.equal(result.failure, 'original failure');
}
assert.match(source, /quitDiagnostics: options\.keepRunning \? null : app\.quitDiagnostics/);
console.log('Core native driver cleanup tests passed');
