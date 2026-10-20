import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetFailures, compareSummaries, frameIntervals, mainThread, stats, summarize } from '../scripts/perf-journey-metrics.mjs';

test('frame buckets spanning a journey boundary retain the frames inside it', () => {
  assert.deepEqual(frameIntervals([
    { name: 'frames', at: 90, detail: { intervals: [10, 20, 30] } },
    { name: 'frames', at: 150, detail: { intervals: [10, 40] } },
  ], 115, 170), [20, 30, 10]);
});

test('main-thread reporting distinguishes dispatch cost from async execution', () => {
  const lines = [
    { source: 'ipc', name: 'read_folding_result_bundle', at: 95, ms: 200, mainThread: true },
    { source: 'ipc', name: 'list_chemical_editor_targets', at: 150, ms: 0.1, mainThread: true },
    { source: 'ipc', name: 'xtb_status', at: 151, ms: 0.2, mainThread: true },
    { source: 'ipc', name: 'conformer_status', at: 152, ms: 900, mainThread: false },
  ];
  const result = mainThread(lines, 100, 300);
  assert.equal(result.foldingReads, 1);
  assert.equal(result.editorMainMs, 0.1);
  assert.equal(result.probeCalls, 2);
  assert.equal(result.probeMainMs, 0.2);
  assert.equal(result.stallMs, 200);
  assert.ok(Math.abs(result.ipcMainMs - 200.3) < 1e-9);
});

test('comparisons fail on missing journeys or p95 regressions, even when the median improved', () => {
  const before = { launch: { stallMs: stats([10, 10, 10, 10, 20]) } };
  assert.match(compareSummaries(before, {}).regressions[0], /missing/);
  assert.equal(compareSummaries(before, { launch: { stallMs: stats([5, 5, 5, 5, 50]) } }).regressions.length, 1);
  assert.equal(compareSummaries(before, { launch: { stallMs: stats([5, 5, 5, 5, 6]) } }).regressions.length, 0);
});

test('zero-load and latency budgets fail on the observed p95', () => {
  assert.deepEqual(budgetFailures({ 'tab:switch': {
    loads: stats([0, 0, 1]), visibleMs: stats([10, 10, 101]), blankFrames: stats([0]), stallMs: stats([0]),
  } }), ['tab:switch visibleMs p95 101 > 100', 'tab:switch loads p95 1 > 0']);
});

test('missing required or previously recorded metrics cannot pass', () => {
  assert.deepEqual(budgetFailures({ 'spin:large-cif': {} }), ['spin:large-cif frameP95Ms missing']);
  assert.deepEqual(compareSummaries({ tab: { loads: stats([0]) } }, { tab: {} }).regressions,
    ['tab loads missing from the new report']);
});

test('frame budgets use 16.7 ms and frame shares retain percentage precision', () => {
  assert.deepEqual(budgetFailures({ 'spin:large-cif': { frameP95Ms: stats([17]) } }),
    ['spin:large-cif frameP95Ms p95 17 > 16.7']);
  const before = summarize({ spin: { samples: { onTimeShare: [0.9567, 0.9567] } } });
  const after = summarize({ spin: { samples: { onTimeShare: [0.81, 0.81] } } });
  assert.equal(before.spin.onTimeShare.p50, 0.9567);
  assert.equal(compareSummaries(before, after).regressions.length, 1);
});
