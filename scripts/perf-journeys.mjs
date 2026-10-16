#!/usr/bin/env node
// Journey benchmark for a packaged perf build.
//
//   BURETTE_DEV_FLAVOR=perf BURETTE_TAURI_DEVTOOLS=1 ./scripts/build.sh
//   node scripts/perf-journeys.mjs --app build/Burette-perf.app --runs 10
//   node scripts/perf-journeys.mjs --compare build/reports/perf-journeys-before.json
//
// The app starts with BURETTE_PERF_TRACE=1 and is driven through a desktop
// agent session, so a journey takes keyboard focus only at launch, and only
// after the keyboard and mouse have been idle for --idle-seconds. Every
// number comes from PerfTrace.jsonl in the app's cache directory; see
// docs/performance.md for the line format.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import { PerfApp } from './perf-journey-app.mjs';
import { percentile, frameIntervals, mainThread, record, summarize, budgetFailures, compareSummaries, printSummary } from './perf-journey-metrics.mjs';
const sleep = ms => new Promise(done => setTimeout(done, ms));

function samplePaths(largeDir) {
  const sample = path => join(repoRoot, path);
  const large = name => (largeDir ? join(largeDir, name) : null);
  return [
    { key: 'pdb', path: sample('samples/structures/proteins/1htb.pdb') },
    { key: 'sdf', path: sample('samples/structures/small-molecules/caffeine.sdf') },
    { key: 'xyz', path: sample('samples/structures/demo/bimp.v000.xyz'), frames: 20 },
    { key: 'csv', path: sample('samples/large/moses_10k.csv') },
    { key: 'molj', path: sample('apps/burette-public-plugin/public/demo-scenes/bimp.v000.xyz.molj') },
    { key: 'poses', path: sample('samples/structures/small-molecules/imatinib-poses.sdf'), poses: 8 },
    { key: 'smi-10k', path: large('moses_10k.smi') },
    { key: 'sdf-10k', path: large('moses_10k.sdf') },
    { key: 'cif-large', path: large('4UG0.cif') },
  ].filter(file => file.path && existsSync(file.path));
}

function parseArgs(argv) {
  const options = {
    app: process.env.BURETTE_PERF_APP || join(repoRoot, `build/Burette-${process.env.BURETTE_DEV_FLAVOR || 'perf'}.app`),
    runs: 10,
    enforceBudgets: false,
    foreground: false,
    journeys: ['launch', 'open', 'tab', 'pose', 'trajectory', 'spin'],
    files: null,
    largeDir: process.env.BURETTE_PERF_LARGE_DIR || null,
    out: null,
    compare: null,
    idleSeconds: 4,
    screen: 'secondary',
    keepRunning: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${arg} needs a value.`);
      index += 1;
      return next;
    };
    if (arg === '--app') options.app = resolve(value());
    else if (arg === '--runs') options.runs = Number(value());
    else if (arg === '--journeys') options.journeys = value().split(',').map(item => item.trim()).filter(Boolean);
    else if (arg === '--files') options.files = value().split(',').map(item => item.trim()).filter(Boolean);
    else if (arg === '--large-dir') options.largeDir = resolve(value());
    else if (arg === '--out') options.out = resolve(value());
    else if (arg === '--compare') options.compare = resolve(value());
    else if (arg === '--idle-seconds') options.idleSeconds = Number(value());
    else if (arg === '--screen') options.screen = value();
    else if (arg === '--enforce-budgets') options.enforceBudgets = true;
    else if (arg === '--foreground') options.foreground = true;
    else if (arg === '--keep-running') options.keepRunning = true;
    else throw new Error(`Unknown option ${arg}.`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 100) throw new Error('--runs must be an integer from 1 to 100.');
  if (!Number.isFinite(options.idleSeconds) || options.idleSeconds < 0) throw new Error('--idle-seconds must be non-negative.');
  for (const journey of options.journeys) if (!['launch', 'open', 'tab', 'pose', 'trajectory', 'spin'].includes(journey)) throw new Error(`Unknown journey ${journey}.`);
  return options;
}

async function openAndWait(app, file, timeoutMs = 90_000) {
  const { trace } = app;
  trace.sync();
  const before = Date.now() - 1;
  app.act({ type: 'open_files', paths: [file.path] }, timeoutMs);
  const action = await trace.waitFor('the open action', line => line.name === 'agent:action' && line.detail?.type === 'open_files' && line.at >= before, 10_000);
  const added = await trace.waitFor(`${basename(file.path)} to be added`, line => line.name === 'document:added' && line.detail?.path?.endsWith(file.path.slice(-512)) && line.at >= action.at - 1, timeoutMs);
  const documentId = added.detail.documentId;
  const done = await trace.waitFor(`${basename(file.path)} to be ready`, line => (line.name === 'document:ready' || line.name === 'journey:timeout') && line.detail?.documentId === documentId && line.at >= action.at - 1, timeoutMs);
  // Work that trails the ready message (deferred layout, inspector reads)
  // belongs to the journey too.
  await sleep(2_000);
  trace.sync();
  const readyAt = done.at + done.ms;
  const lines = trace.between(action.at - 1, readyAt + 2_000);
  const ofDocument = lines.filter(line => line.detail?.documentId === documentId);
  const rendered = ofDocument.find(line => line.name === 'viewer:status' && line.detail?.message?.startsWith('[web] Rendered'));
  const visible = ofDocument.find(line => line.name === 'document:visible');
  const main = mainThread(trace.lines, action.at, readyAt + 2_000);
  return {
    documentId,
    renderer: added.detail.renderer,
    timedOut: done.name === 'journey:timeout',
    values: {
      renderedStatusMs: rendered ? rendered.at - action.at : null,
      readyMs: done.name === 'journey:timeout' ? null : readyAt - action.at,
      visibleMs: visible ? visible.at + visible.ms - action.at : null,
      parsingStatusMessages: ofDocument.filter(line => line.name === 'viewer:status' && /Parsing structure/.test(line.detail?.message ?? '')).length,
      foldingReads: main.foldingReads,
      editorMainMs: main.editorMainMs,
      loads: ofDocument.filter(line => line.name === 'iframe:load').length,
      ipcCalls: main.ipcCalls,
      ipcMainMs: main.ipcMainMs,
      stallMs: main.stallMs,
      frameP95Ms: percentile(frameIntervals(trace.lines, action.at, readyAt), 0.95),
    },
    slowest: main.slowest,
  };
}

async function journeyLaunch(app, options, results) {
  const samples = {};
  const notes = new Set();
  results.launch = { samples, notes: [] };
  for (let run = 0; run < options.runs; run += 1) {
    console.error(`launch ${run + 1}/${options.runs}`);
    await app.quit();
    const { startedAt, shell } = await app.launch();
    await sleep(8_000);
    app.assertUnlocked();
    app.trace.sync();
    const lines = app.trace.between(startedAt, startedAt + 15_000);
    const setup = lines.find(line => line.name === 'app:setup');
    const script = lines.find(line => line.name === 'mark:app:script-start');
    const main = mainThread(lines, startedAt, startedAt + 15_000);
    const blocks = lines.filter(line => (line.name === 'main-queue:late' && line.ms >= 50) || (line.source === 'ipc' && line.mainThread && line.ms >= 50));
    const settledAt = Math.max(shell.at, ...blocks.map(line => line.at + line.ms));
    record(samples, {
      setupMs: setup ? setup.at - startedAt : null,
      scriptStartMs: script ? script.at - startedAt : null,
      shellVisibleMs: shell.at - startedAt,
      settledMs: settledAt - startedAt,
      stallMs: main.stallMs,
      ipcMainMs: main.ipcMainMs,
      probeCalls: main.probeCalls,
      probeMainMs: main.probeMainMs,
    });
    main.slowest.forEach(item => notes.add(item.replace(/ \d+ms$/, '')));
    app.trace.forget(startedAt);
  }
  results.launch = { samples, notes: [...notes] };
}

async function journeyOpen(app, files, options, results) {
  for (const file of files) {
    const samples = {};
    const notes = new Set();
    results[`open:${file.key}`] = { file: file.path, samples, notes: [] };
    let renderer = null;
    for (let run = 0; run < options.runs; run += 1) {
      if (run === 0) {
        await app.quit();
        await app.launch();
        await sleep(6_000);
      }
      console.error(`open:${file.key} ${run + 1}/${options.runs}`);
      const opened = await openAndWait(app, file);
      renderer = opened.renderer;
      record(samples, opened.values);
      if (run === 0) record(samples, { coldRenderedStatusMs: opened.values.renderedStatusMs });
      if (opened.timedOut) notes.add('journey timed out');
      opened.slowest.forEach(item => notes.add(item.replace(/ \d+ms$/, '')));
      await app.closeAllTabs();
      await sleep(500);
      app.trace.forget(Date.now() - 60_000);
    }
    results[`open:${file.key}`] = { file: file.path, renderer, samples, notes: [...notes] };
  }
}

async function journeyTab(app, files, options, results) {
  const keys = ['pdb', 'xyz', 'sdf', 'csv'];
  const tabFiles = keys.map(key => files.find(file => file.key === key)).filter(Boolean);
  await app.closeAllTabs();
  for (const file of tabFiles) await openAndWait(app, file);
  const tabs = (app.observe()?.tabs ?? []).filter(tab => tab?.path);
  if (tabs.length < 2) throw new Error('The tab journey needs at least two open file tabs.');
  const samples = {};
  const notes = new Set();
  const count = Math.max(tabs.length * 3, options.runs * 2);
  const firstTab = Math.max(0, tabs.findIndex(tab => tab.active));
  for (let index = 0; index < count; index += 1) {
    const tab = tabs[(firstTab + index + 1) % tabs.length];
    app.trace.sync();
    const before = Date.now() - 1;
    app.act({ type: 'manage_tabs', operation: 'focus', tabId: tab.id }, 15_000);
    const action = await app.trace.waitFor('the focus action', line => line.name === 'agent:action' && line.detail?.type === 'manage_tabs' && line.at >= before, 10_000);
    const switched = await app.trace.waitFor('the tab switch', line => line.name === 'tab:switch' && line.at >= action.at - 1, 10_000);
    const visible = await app.trace.waitFor('the tab to paint', line => line.name === 'document:visible' && line.detail?.documentId === switched.detail.documentId && line.at >= switched.at - 1, 15_000);
    await sleep(1_200);
    app.trace.sync();
    const lines = app.trace.between(switched.at, switched.at + 1_000);
    const main = mainThread(app.trace.lines, switched.at, switched.at + 1_000);
    record(samples, {
      visibleMs: visible.ms,
      blankFrames: visible.detail.blankFrames,
      loads: visible.detail.loads + (visible.detail.remounted ? 1 : 0),
      commits: visible.detail.commits,
      ipcCalls: main.ipcCalls,
      ipcMainMs: main.ipcMainMs,
      stallMs: main.stallMs,
      frameP95Ms: percentile(frameIntervals(app.trace.lines, switched.at, switched.at + 1_000), 0.95),
    });
    main.slowest.forEach(item => notes.add(item.replace(/ \d+ms$/, '')));
  }
  results['tab:switch'] = { files: tabFiles.map(file => file.key), samples, notes: [...notes] };
  await app.closeAllTabs();
}

async function journeySteps(app, file, actionType, count, options, results, name) {
  await app.closeAllTabs();
  await openAndWait(app, file);
  const samples = {};
  const notes = new Set();
  const steps = Math.max(count * 2, options.runs * 2);
  for (let index = 0; index < steps; index += 1) {
    app.trace.sync();
    const before = Date.now() - 1;
    app.act({ type: actionType, index: (index + 1) % count }, 15_000);
    const action = await app.trace.waitFor(`the ${actionType} action`, line => line.name === 'agent:action' && line.detail?.type === actionType && line.at >= before, 10_000);
    await sleep(300);
    app.trace.sync();
    const lines = app.trace.between(action.at, action.at + action.ms + 300);
    const main = mainThread(app.trace.lines, action.at, action.at + action.ms + 300);
    record(samples, {
      stepMs: action.ms,
      stallMs: main.stallMs,
      frameP95Ms: percentile(frameIntervals(app.trace.lines, action.at, action.at + action.ms + 300), 0.95),
    });
    main.slowest.forEach(item => notes.add(item.replace(/ \d+ms$/, '')));
  }
  results[name] = { file: file.path, samples, notes: [...notes] };
  await app.closeAllTabs();
}

async function journeySpin(app, file, options, results) {
  await app.closeAllTabs();
  await openAndWait(app, file, 180_000);
  const samples = {};
  for (let run = 0; run < options.runs; run += 1) {
    app.act({ type: 'set_scene_motion', mode: 'spin' }, 15_000);
    const from = Date.now() + 500;
    await sleep(4_500);
    const to = Date.now();
    app.act({ type: 'set_scene_motion', mode: 'off' }, 15_000);
    await sleep(1_500);
    app.trace.sync();
    const intervals = frameIntervals(app.trace.lines, from, to);
    record(samples, {
      frameP95Ms: percentile(intervals, 0.95),
      onTimeShare: intervals.length ? intervals.filter(value => value <= 16.7).length / intervals.length : null,
      stallMs: mainThread(app.trace.lines, from, to).stallMs,
    });
  }
  results['spin:large-cif'] = { file: file.path, samples, notes: [] };
  await app.closeAllTabs();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = samplePaths(options.largeDir).filter(file => !options.files || options.files.includes(file.key));
  for (const key of options.files ?? []) {
    if (!files.some(file => file.key === key)) throw new Error(`Sample ${key} is missing or unknown.`);
  }
  const byKey = key => files.find(file => file.key === key);
  const fixtureDetails = files.map(file => {
    const bytes = readFileSync(file.path);
    return { key: file.key, path: file.path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const results = {};
  const startedAt = new Date().toISOString();
  const out = options.out ?? join(repoRoot, 'build/reports', `perf-journeys-${startedAt.replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(out), { recursive: true });
  const app = new PerfApp(options.app, options);
  app.trace.evidencePath = `${out}.trace.jsonl`;
  writeFileSync(app.trace.evidencePath, '');
  const load = loadavg();
  if (load[0] > 4) console.error(`Load average is ${load[0].toFixed(1)}; numbers from a busy Mac are not a baseline.`);
  const journeys = new Set(options.journeys);
  const skippedJourneys = [];
  let failure = null;
  try {
    if (journeys.has('launch')) await journeyLaunch(app, options, results);
    if (!app.pids().length) {
      await app.launch();
      await sleep(6_000);
    }
    if (journeys.has('open')) await journeyOpen(app, files, options, results);
    if (journeys.has('tab')) await journeyTab(app, files, options, results);
    if (journeys.has('pose') && byKey('poses')) await journeySteps(app, byKey('poses'), 'set_sdf_pose_index', byKey('poses').poses, options, results, 'pose:step');
    if (journeys.has('trajectory') && byKey('xyz')) await journeySteps(app, byKey('xyz'), 'set_structure_pose', byKey('xyz').frames, options, results, 'trajectory:step');
    if (journeys.has('spin') && byKey('cif-large')) await journeySpin(app, byKey('cif-large'), options, results);
    for (const [journey, key] of [['pose', 'poses'], ['trajectory', 'xyz'], ['spin', 'cif-large']]) {
      if (journeys.has(journey) && !byKey(key)) skippedJourneys.push({ journey, reason: `Missing sample ${key}` });
    }
  } catch (error) {
    failure = error?.stack || String(error);
  } finally {
    app.trace.sync();
    if (!options.keepRunning) {
      await app.quit();
      spawnSync('/usr/bin/trash', [app.sessionDir]);
    }
  }
  const summary = summarize(results);
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    app: { path: app.path, bundleId: app.bundleId, version: app.version, executableSha256: app.executableSha256 },
    harnessCommit: spawnSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    screen: app.screen ?? null,
    foregroundRequested: options.foreground,
    loadAverage: load,
    loadAverageEnd: loadavg(),
    runs: options.runs,
    tracePath: app.trace.evidencePath,
    files: files.map(file => file.key),
    fixtureDetails,
    requestedJourneys: options.journeys,
    skippedJourneys,
    failure,
    results,
    summary,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(summary);
  for (const [journey, result] of Object.entries(results)) {
    if (result.notes?.length) console.log(`${journey}: slowest main-thread work: ${result.notes.slice(0, 8).join(', ')}`);
  }
  console.log(`report: ${out}`);
  if (failure) console.error(failure);
  if (skippedJourneys.length) console.error(`Skipped: ${JSON.stringify(skippedJourneys)}`);
  const failures = budgetFailures(summary);
  let failed = Boolean(failure) || skippedJourneys.length > 0 || (options.enforceBudgets && failures.length > 0) || Object.values(results).some(result => result.notes?.includes('journey timed out'));
  if (failures.length) {
    console.log(`over budget:\n  ${failures.join('\n  ')}`);
  }
  if (options.compare) {
    const before = JSON.parse(readFileSync(options.compare, 'utf8')).summary;
    const { rows, regressions } = compareSummaries(before, summary);
    console.log('\n| journey | metric | before p50 / p95 | after p50 / p95 | |');
    console.log('| --- | --- | --- | --- | --- |');
    rows.forEach(row => console.log(row));
    if (regressions.length) {
      failed = true;
      console.log(`p95 regressions:\n  ${regressions.join('\n  ')}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => {
  console.error(error?.stack || String(error));
  process.exitCode = 2;
});
