#!/usr/bin/env node
// Repeated native latency campaign. CUA Close All Tabs is a per-run rendezvous;
// collection of memory snapshots belongs to the separate scale UI campaign.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PerfApp } from './perf-journey-app.mjs';
import { reduceScaleOpen, repeatRunIntegrity, summarizeScaleRepeats } from './perf-scalability-repeat-metrics.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = { runs: 10, fixtures: join(root, 'build/perf-scale-fixtures') };
for (let index = 0; index < process.argv.slice(2).length; index++) {
  const args = process.argv.slice(2), key = args[index], value = args[++index];
  if (!['--app', '--out', '--runs', '--fixtures'].includes(key) || !value) throw Error('Usage: perf-scalability-repeat.mjs --app <dev.app> --out <fresh.json> [--runs 10] [--fixtures <directory>]');
  options[key.slice(2)] = key === '--runs' ? Number(value) : resolve(value);
}
if (!options.app || !options.out || !Number.isInteger(options.runs) || options.runs < 1 || options.runs > 30) throw Error('--app and --out are required; --runs must be an integer from 1 to 30');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runPath = index => `${options.out}.run-${String(index + 1).padStart(2, '0')}.json`;
const outputs = [options.out, ...Array.from({ length: options.runs }, (_, index) => runPath(index)).flatMap(path => [path, `${path}.trace.jsonl`, `${path}.ready`])];
if (outputs.some(path => fs.existsSync(path))) throw Error('Refusing to overwrite existing campaign evidence');
fs.mkdirSync(dirname(options.out), { recursive: true });
fs.mkdirSync(options.fixtures, { recursive: true });
options.fixtures = fs.realpathSync(options.fixtures);
const contents = fs.readFileSync(join(root, 'samples/mini.pdb'));
const paths = Array.from({ length: 1000 }, (_, index) => join(options.fixtures, `scale-${String(index).padStart(4, '0')}.pdb`));
for (const path of paths) {
  if (!fs.existsSync(path)) fs.writeFileSync(path, contents, { flag: 'wx' });
  if (!fs.readFileSync(path).equals(contents)) throw Error(`Fixture changed: ${path}`);
}
const sourcePaths = ['scripts/perf-scalability-repeat.mjs', 'scripts/perf-scalability-repeat-metrics.mjs', 'scripts/perf-scalability-metrics.mjs',
  'scripts/perf-journey-app.mjs', 'scripts/perf-journey-metrics.mjs', 'apps/desktop/src/hooks/use-app-file-open.ts',
  'apps/desktop/src/lib/perf-trace.ts', 'apps/desktop/src/lib/perf-journeys.ts', 'apps/desktop/src/stores/molecule-store.ts',
  'apps/desktop/src-tauri/src/commands/documents.rs', 'apps/desktop/src-tauri/src/preview/runtime.rs', 'apps/desktop/src-tauri/src/perf_trace.rs'];
const sourceFiles = sourcePaths.map(path => ({ path, sha256: hash(fs.readFileSync(join(root, path))) }));
function sourceRevision() {
  const result = spawnSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'commit_id'], { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 4096 });
  const valid = value => /^[a-f0-9]{40,64}$/i.test(value);
  if (result.status === 0 && valid(result.stdout.trim())) return { revision: result.stdout.trim(), revisionMethod: 'jj' };
  const readMetadata = (path, limit = 4096) => {
    const fd = fs.openSync(path, 'r');
    try {
      if (fs.fstatSync(fd).size > limit) throw Error('Source metadata exceeds its bound');
      return fs.readFileSync(fd, 'utf8').trim();
    } finally { fs.closeSync(fd); }
  };
  try {
    const dotgit = join(root, '.git');
    const gitdir = fs.statSync(dotgit).isDirectory() ? dotgit : resolve(root, readMetadata(dotgit).replace(/^gitdir:\s*/, ''));
    const head = readMetadata(join(gitdir, 'HEAD'));
    if (valid(head)) return { revision: head, revisionMethod: 'worktree-HEAD' };
    const ref = /^ref:\s+(refs\/[\w./-]+)$/.exec(head)?.[1];
    if (!ref || ref.split('/').includes('..')) throw Error('Unsupported source HEAD');
    const common = fs.existsSync(join(gitdir, 'commondir')) ? resolve(gitdir, readMetadata(join(gitdir, 'commondir'))) : gitdir;
    for (const base of new Set([gitdir, common])) {
      const path = join(base, ref);
      if (fs.existsSync(path)) {
        const value = readMetadata(path);
        if (valid(value)) return { revision: value, revisionMethod: 'worktree-loose-ref' };
      }
    }
    const packed = readMetadata(join(common, 'packed-refs'), 8 * 1024 * 1024);
    const value = packed.split('\n').find(line => line.endsWith(` ${ref}`))?.split(' ')[0];
    if (value && valid(value)) return { revision: value, revisionMethod: 'worktree-packed-ref' };
  } catch { /* Source file hashes remain available when no revision can be resolved. */ }
  return { revision: null, revisionMethod: 'unavailable' };
}
const revision = sourceRevision();
const campaign = {
  startedAt: new Date().toISOString(), requestedRuns: options.runs, runs: [], status: 'running',
  sourceSnapshot: { ...revision, files: sourceFiles, sha256: hash(JSON.stringify(sourceFiles)),
    scope: 'Current checkout and harness files; this does not establish which checkout produced an existing app binary.' },
  fixture: { directory: options.fixtures, count: paths.length, eachBytes: contents.length, eachSha256: hash(contents), pathsSha256: hash(JSON.stringify(paths)) },
  metricDefinitions: {
    ackMs: 'Driver action invocation to CLI acknowledgement, including transport and polling.',
    firstAdmissionMs: 'Driver invocation to document:added for the first requested new path.',
    firstActiveVisibleMs: 'Optional driver invocation to matching document:visible completion (WKWebView rAF-visible iframe, not OS-presented molecular frame). A ready handshake can end the existing journey before a visibility mark.',
    firstActiveReadyMs: 'Driver invocation to matching document:ready handshake; independent observation must confirm that same new path active and ready.',
  },
  limitations: ['Incremental 1/10/100/1000 tiny identical PDB files in each fresh process; OS file caches are not flushed.',
    'No memory collector runs in this timed series. Simultaneously visible scenes, large molecules and scientific correctness are not evaluated.',
    'Observed summaries retain exploratory latencies from failed or legacy runs; validated summaries include only runs with passing integrity.',
    'Foreground built-in display requested; actual display and changing system load are recorded. CUA closes all tabs between repetitions.'],
};
fs.writeFileSync(options.out, '{}\n', { flag: 'wx' });
const save = run => {
  if (run) fs.writeFileSync(run.reportPath, JSON.stringify(run, null, 2) + '\n');
  campaign.summary = summarizeScaleRepeats(campaign.runs);
  fs.writeFileSync(options.out, JSON.stringify(campaign, null, 2) + '\n');
};
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function waitFor(app, label, predicate, timeout = 60000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    app.assertUnlocked();
    const observation = app.observe();
    if (predicate(observation)) return observation;
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${label}`);
    await sleep(100);
  }
}

for (let index = 0; index < options.runs; index++) {
  const run = { index: index + 1, reportPath: runPath(index), startedAt: new Date().toISOString(), samples: [], failure: null, status: 'launching', loadAverage: loadavg() };
  fs.writeFileSync(run.reportPath, '{}\n', { flag: 'wx' });
  campaign.runs.push(run);
  save(run);
  let app;
  try {
    app = new PerfApp(options.app, { foreground: true, idleSeconds: 0, screen: 'built-in' });
    run.app = { path: app.path, bundleId: app.bundleId, version: app.version, executableSha256: app.executableSha256 };
    campaign.app ??= run.app;
    if (campaign.app.executableSha256 !== run.app.executableSha256) throw Error('Executable changed during the campaign');
    run.session = app.sessionDir;
    run.rawTracePath = `${run.reportPath}.trace.jsonl`;
    run.sourceSnapshotSha256 = campaign.sourceSnapshot.sha256;
    run.fixtureSha256 = campaign.fixture.eachSha256;
    app.trace.evidencePath = run.rawTracePath;
    fs.writeFileSync(run.rawTracePath, '', { flag: 'wx' });
    await app.launch();
    run.screen = app.screen;
    const initial = await waitFor(app, 'fresh empty workspace', observation => observation?.bounds?.documents?.total === 0);
    run.initialBounds = initial.bounds;
    await sleep(1500);
    let previous = 0;
    for (const total of [1, 10, 100, 1000]) {
      const requested = paths.slice(previous, total);
      const sample = { total, added: requested.length, firstRequestedPath: requested[0], startedAt: null, finishedAt: null, status: 'opening' };
      run.samples.push(sample);
      run.status = `opening-${total}`;
      save(run);
      console.error(`repeat ${index + 1}/${options.runs}: opening ${requested.length}, total ${total}`);
      sample.startedAt = Date.now();
      app.act({ type: 'open_files', paths: requested }, 180000);
      sample.ackMs = Date.now() - sample.startedAt;
      const observation = await waitFor(app, `new active ${requested[0]} at ${total} documents`, current =>
        current?.bounds?.documents?.total === total && current.activeDocument?.path === requested[0]
        && current.activeDocument.ready === true && Date.parse(current.reportedAt) >= sample.startedAt);
      sample.registeredBounds = observation.bounds;
      sample.activeObservation = observation.activeDocument;
      // Trace delivery is delayed by up to one flush interval. Its event clock,
      // not this settling delay, determines admission/visible/ready latencies.
      await sleep(1600);
      app.trace.sync();
      sample.finishedAt = Date.now();
      Object.assign(sample, reduceScaleOpen(app.trace.lines, sample), { status: 'observed' });
      previous = total;
      save(run);
    }
  } catch (error) {
    run.failure = error.stack ?? String(error);
    console.error(run.failure);
    save(run);
  } finally {
    run.sessionPreserved = Boolean(app);
    if (app) {
      try {
        if (app.pids().length && (app.observe()?.bounds?.documents?.total ?? 0) > 0) {
          run.status = 'waiting-for-cua-close';
          run.closeRendezvous = `${run.reportPath}.ready`;
          save(run);
          fs.writeFileSync(run.closeRendezvous, `Run ${index + 1}: use CUA File > Close All Tabs.\n`, { flag: 'wx' });
          console.error(`READY run ${index + 1}: ${run.closeRendezvous}`);
          const closed = await waitFor(app, 'CUA Close All Tabs', current => current?.bounds?.documents?.total === 0, 300000);
          run.cleanup = { method: 'CUA File > Close All Tabs', documents: closed.bounds.documents.total, confirmedAt: closed.reportedAt };
        } else run.cleanup = { method: 'already empty', documents: app.observe()?.bounds?.documents?.total ?? null };
        await sleep(1600);
        app.trace.sync();
      } catch (error) {
        run.cleanup = { ...run.cleanup, failure: String(error.stack ?? error).slice(0, 1600) };
      }
      try { await app.quit(); }
      catch (error) { run.quitFailure = String(error.stack ?? error).slice(0, 1600); }
      run.quitDiagnostics = app.quitDiagnostics ?? null;
      if (run.quitDiagnostics?.traceDrain?.status !== 'confirmed' || run.quitDiagnostics?.cleanupFailure || run.quitDiagnostics?.finalSyncFailure) {
        run.quitFailure ??= 'Owned cleanup/final trace drain was not confirmed; see quitDiagnostics.';
      }
      try {
        app.trace.sync();
        run.samples = run.samples.map(sample => Number.isFinite(sample.startedAt) && Number.isFinite(sample.finishedAt) ? reduceScaleOpen(app.trace.lines, sample) : sample);
      } catch (error) {
        run.finalReductionFailure = String(error.stack ?? error).slice(0, 1600);
        run.failure ??= run.finalReductionFailure;
      }
      run.traceDiagnostics = { ...app.trace.diagnostics };
      try { run.rawTraceSha256 = run.rawTracePath ? hash(fs.readFileSync(run.rawTracePath)) : null; }
      catch (error) { run.failure ??= String(error.stack ?? error).slice(0, 1600); }
    }
    // A failed stage can be incomplete; preserve its missing values rather
    // than manufacturing zero latency or treating an old active viewer as new.
    for (const sample of run.samples) sample.measurementFailures ??= ['stage did not complete'];
    try { run.integrity = repeatRunIntegrity(run); }
    catch (error) {
      run.failure ??= String(error.stack ?? error).slice(0, 1600);
      run.integrity = { status: 'fail', failures: ['Final integrity reduction failed; see failure.'] };
    }
    run.status = run.integrity.status === 'pass' ? 'complete' : 'exploratory-or-failed';
    run.finishedAt = new Date().toISOString();
    run.loadAverageEnd = loadavg();
    save(run);
    if (app && run.integrity.status === 'pass') {
      try {
        if (app.pids().length) throw Error('Owned app is still running after shutdown.');
        execFileSync('/usr/bin/trash', [app.sessionDir]);
        run.sessionPreserved = false;
      } catch (error) {
        run.quitFailure = String(error.stack ?? error).slice(0, 1600);
        run.integrity = { status: 'fail', failures: [...run.integrity.failures, 'Session cleanup failed; see quitFailure.'] };
        run.status = 'exploratory-or-failed';
      }
      save(run);
    }
  }
  if (run.cleanup?.documents !== 0 || run.cleanup?.failure || run.quitFailure) break;
}
campaign.finishedAt = new Date().toISOString();
campaign.integrity = { status: campaign.runs.length === options.runs && campaign.runs.every(run => run.integrity?.status === 'pass') ? 'pass' : 'fail',
  expectedRuns: options.runs, recordedRuns: campaign.runs.length, validatedRuns: campaign.runs.filter(run => run.integrity?.status === 'pass').length };
campaign.status = campaign.integrity.status === 'pass' ? 'complete' : 'exploratory-or-failed';
save();
if (campaign.integrity.status !== 'pass') process.exitCode = 1;
