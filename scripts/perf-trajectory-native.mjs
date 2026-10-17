#!/usr/bin/env node
// Native file-backed trajectory capability, seek latency and coordinate proof.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { PerfApp } from './perf-journey-app.mjs';
import { stats } from './perf-journey-metrics.mjs';
import { memorySnapshot } from './perf-memory.mjs';
import { checkTrajectoryCoordinates, isExpectedTrajectorySizeGuard, trajectoryActionResult } from './perf-trajectory-proof.mjs';
import { trajectoryPauseRendezvous } from './perf-trajectory-pause.mjs';

const sleep = ms => new Promise(done => setTimeout(done, ms));
const args = process.argv.slice(2);
function option(name, fallback) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; }
const appPath = option('--app');
const output = option('--out') && resolve(option('--out'));
const phase = option('--phase', 'after');
const runs = Number(option('--runs', '10'));
const samples = Number(option('--memory-samples', '3'));
const cases = option('--cases', 'small,large,huge,massive').split(',');
if (!appPath || !output || !['before', 'after'].includes(phase) || !Number.isInteger(runs) || runs < 1 || runs > 30 || !Number.isInteger(samples) || samples < 0 || samples > 10) {
  throw new Error('Usage: node scripts/perf-trajectory-native.mjs --app PERF.app --out fresh.json --phase before|after [--runs 10] [--memory-samples 3] [--pause-rendezvous] [--hold]');
}
if (existsSync(output) || existsSync(`${output}.trace.jsonl`) || existsSync(`${output}.ready`) || existsSync(`${output}.finish`)) throw new Error('Refusing to overwrite native evidence.');
const referencePath = resolve(option('--reference', 'build/perf-trajectory-fixtures/reference.json'));
const referenceBytes = readFileSync(referencePath);
const reference = JSON.parse(referenceBytes);
const corpus = cases.map(name => {
  const item = reference.trajectories.find(item => item.name === name);
  if (!item) throw new Error(`Unknown corpus case ${name}.`);
  return item;
});
function fingerprint(path) {
  const fd = openSync(path, 'r');
  try {
    const metadata = statSync(path);
    const partSize = Math.min(1024 * 1024, metadata.size);
    const prefix = Buffer.alloc(partSize), suffix = Buffer.alloc(partSize);
    readSync(fd, prefix, 0, partSize, 0);
    readSync(fd, suffix, 0, partSize, metadata.size - partSize);
    return { path, bytes: metadata.size, mtimeMs: metadata.mtimeMs, inode: metadata.ino,
      fingerprintMethod: 'sha256 of first and last 1 MiB, not a whole-source hash',
      prefixSha256: createHash('sha256').update(prefix).digest('hex'), suffixSha256: createHash('sha256').update(suffix).digest('hex') };
  } finally { closeSync(fd); }
}
const app = new PerfApp(appPath, { screen: option('--screen', 'built-in'), idleSeconds: 0, foreground: args.includes('--foreground') });
const report = { schema: 'burette-native-trajectory-v1', phase, startedAt: new Date().toISOString(), app: { path: app.path, bundleId: app.bundleId, version: app.version, executableSha256: app.executableSha256 },
  reference: { path: referencePath, sha256: createHash('sha256').update(referenceBytes).digest('hex'), synthetic: reference.synthetic, atomCount: reference.atomCount },
  sourceFiles: [fingerprint(reference.topology), ...corpus.map(item => fingerprint(item.path))], runs,
  pausePrecondition: args.includes('--pause-rendezvous') ? 'manual-native-screenshot-per-open' : 'not-established', cases: [], failures: [],
  limitations: ['Agent frame-action completion and document-ready marks do not prove OS presentation timing.', 'Memory snapshots run after timing. Their maximum is a sampled lower bound, not a continuous peak.', 'Coordinate queries inspect actual current native viewer models. Current observation does not expose source time/unit-cell metadata; those remain independently tested decoder contracts.'] };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
writeFileSync(`${output}.trace.jsonl`, '', { flag: 'wx' });
app.trace.evidencePath = `${output}.trace.jsonl`;
const save = () => writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
try {
  await app.launch();
  for (const item of corpus) {
    const result = { name: item.name, path: item.path, bytes: item.bytes, frameCount: item.frames, open: [], seeks: [], memory: [], failures: [], pauseAcceptances: [] };
    report.cases.push(result);
    for (let run = 0; run < runs; run++) {
      console.error(`trajectory: ${item.name}, run ${run + 1}/${runs}, opening ${item.bytes} bytes`);
      await app.closeAllTabs();
      app.trace.sync();
      const startedAt = Date.now();
      let opened;
      try {
        opened = trajectoryActionResult(app.act({ type: 'open_docking_view', receptorPath: reference.topology, ligandPaths: [item.path] }, 120_000), 'open_docking_view');
      } catch (error) {
        const expectedGuard = isExpectedTrajectorySizeGuard(error.message, phase, item.bytes);
        result.open.push({ run, rejected: true, expectedGuard, rejectionReason: expectedGuard ? 'legacy-75mb-size-limit' : 'unknown-or-unexpected', error: error.message.slice(0, 1200) });
        if (!expectedGuard) result.failures.push(`open ${run}: ${error.message}`);
        if (expectedGuard) break;
        save(); continue;
      }
      const ready = await app.trace.waitFor(`${item.name} native viewer ready`, line => (line.name === 'document:ready' || line.name === 'journey:timeout') && line.detail?.documentId === opened.documentId && line.at >= startedAt - 1, 120_000);
      if (ready.name === 'journey:timeout') throw new Error(`${item.name} native viewer readiness timed out.`);
      result.open.push({ run, rejected: false, documentId: opened.documentId, readyTraceMs: ready.at + ready.ms - startedAt, actionToReadyWallMs: Date.now() - startedAt });
      if (args.includes('--pause-rendezvous')) {
        result.pauseAcceptances.push({ run, ...await trajectoryPauseRendezvous({ output, name: item.name, run,
          pid: app.pids()[0], sessionDir: app.sessionDir, documentId: opened.documentId, assertUnlocked: () => app.assertUnlocked() }) });
        save();
      }
      for (const expected of item.checks) {
        app.trace.sync();
        const beforeSeek = Date.now();
        const seekResponse = app.act({ type: 'set_structure_pose', index: expected.frame }, 30_000);
        const seek = trajectoryActionResult(seekResponse, 'set_structure_pose');
        if (seek.index !== expected.frame) throw new Error(`Native seek did not acknowledge requested frame ${expected.frame}.`);
        const action = await app.trace.waitFor('native frame action', line => line.name === 'agent:action'
          && line.detail?.id === seekResponse.action.id && line.detail?.type === 'set_structure_pose' && line.at >= beforeSeek - 1, 10_000);
        const response = app.act({ type: 'query_atoms', selectionVersion: 1, expression: { fields: { atom_id: [1, 5000, 10000] } }, limit: 3 }, 30_000);
        let coordinates;
        try {
          coordinates = checkTrajectoryCoordinates(trajectoryActionResult(response, 'query_atoms', 'queryAtoms'), expected);
        } catch (error) {
          const encoded = JSON.stringify(response);
          result.failedSeek = { run, requestedFrame: expected.frame, expected, error: String(error.message ?? error).slice(0, 1200),
            response: Buffer.byteLength(encoded, 'utf8') <= 32768 ? response : { truncated: true, prefix: Buffer.from(encoded).subarray(0, 32000).toString('utf8') } };
          save();
          throw error;
        }
        result.seeks.push({ run, frame: expected.frame, actionCompletedMs: action.ms, ...coordinates, referenceTimePs: expected.timePs, referenceCellSizeAngstrom: expected.cellSizeAngstrom, referenceCellAnglesDegrees: expected.cellAnglesDegrees });
      }
      console.error(`trajectory: ${item.name}, run ${run + 1}/${runs}, ${item.checks.length} frame checks passed`);
      if (run === runs - 1) {
        // Memory inventory is deliberately outside all latency intervals.
        for (let index = 0; index < samples; index++) {
          const pid = app.pids()[0];
          if (!pid) throw new Error('Owned native perf app exited before memory sampling.');
          result.memory.push(await memorySnapshot(pid, app.bundleId));
          if (index + 1 < samples) await sleep(1_000);
        }
      }
      app.trace.forget(startedAt - 1);
      save();
    }
    result.openReadyMs = stats(result.open.filter(value => !value.rejected).map(value => value.readyTraceMs));
    result.frameActionCompletedMs = stats(result.seeks.map(value => value.actionCompletedMs));
    result.coordinateChecks = result.seeks.length * 3;
    save();
  }
  if (args.includes('--hold')) {
    writeFileSync(`${output}.ready`, JSON.stringify({ pid: app.pids()[0], sessionDir: app.sessionDir, lastCase: report.cases.at(-1)?.name }), { flag: 'wx' });
    console.error(`Native trajectory viewer ready for screenshot; create ${output}.finish to clean up.`);
    const deadline = Date.now() + 10 * 60_000;
    while (!existsSync(`${output}.finish`)) {
      if (Date.now() > deadline) throw new Error('Screenshot hold timed out after ten minutes.');
      app.assertUnlocked(); await sleep(250);
    }
  }
} catch (error) { report.failures.push(String(error.message ?? error).slice(0, 1200)); process.exitCode = 1; }
finally {
  const failureMessage = error => String(error?.message ?? error).slice(0, 1200);
  try { app.trace.sync(); }
  catch (error) { report.failures.push(`Native pre-quit trace sync failed: ${failureMessage(error)}`); }
  let quitFailure;
  try { await app.quit(); }
  catch (error) { quitFailure = failureMessage(error); }
  if (!quitFailure && app.owned === true) quitFailure = 'Owned app remains active after quit; coordinated cleanup is required.';
  if (quitFailure) report.failures.push(`Native quit failed: ${quitFailure}`);
  report.quitDiagnostics = { ...app.quitDiagnostics, ...(quitFailure ? { quitFailure } : {}) };
  if (quitFailure && !report.quitDiagnostics.traceDrain) report.quitDiagnostics.traceDrain = { status: 'quit-failed' };
  report.traceDiagnostics = app.trace.diagnostics;
  if (app.quitDiagnostics?.cleanupFailure) report.failures.push(`Native cleanup failed: ${failureMessage(app.quitDiagnostics.cleanupFailure)}`);
  if (app.quitDiagnostics?.finalSyncFailure) report.failures.push(`Native final trace sync failed: ${failureMessage(app.quitDiagnostics.finalSyncFailure)}`);
  if (app.quitDiagnostics && app.quitDiagnostics.traceDrain?.status !== 'confirmed') {
    report.failures.push(`Native final action trace drain was not confirmed: ${app.quitDiagnostics.traceDrain?.status || 'missing'}.`);
  }
  const invalidTraceCounters = ['droppedEntries', 'failedBatches', 'duplicateEntries', 'malformedLines', 'rotationGaps']
    .filter(key => report.traceDiagnostics?.[key] !== 0);
  if (invalidTraceCounters.length) report.failures.push(`Native trace integrity failed: ${invalidTraceCounters.join(', ')}.`);
  for (const item of report.cases) report.failures.push(...item.failures.map(failure => `${item.name}: ${failureMessage(failure)}`));
  report.sessionDir = app.sessionDir;
  report.sessionPreserved = Boolean(report.failures.length || quitFailure);
  if (!report.sessionPreserved) {
    const trashed = spawnSync('/usr/bin/trash', [app.sessionDir]);
    if (trashed.error || trashed.status !== 0) {
      report.sessionPreserved = true;
      report.failures.push(`Native session cleanup failed: ${failureMessage(trashed.error || trashed.stderr || `exit ${trashed.status}`)}`);
    }
  }
  report.endedAt = new Date().toISOString();
  report.failure = report.failures[0] ?? null;
  if (report.failures.length) process.exitCode = 1;
  save();
}
console.log(JSON.stringify({ output, failures: report.failures, cases: report.cases.map(item => ({ name: item.name, open: item.openReadyMs, seek: item.frameActionCompletedMs, coordinateChecks: item.coordinateChecks, rejected: item.open.some(value => value.rejected) })) }));
