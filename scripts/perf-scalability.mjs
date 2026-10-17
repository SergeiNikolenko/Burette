#!/usr/bin/env node
// Native scale acceptance. Close All Tabs through CUA after the ready marker;
// the driver measures that real menu path, then stops only its owned app.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PerfApp } from './perf-journey-app.mjs';
import { mainThread } from './perf-journey-metrics.mjs';
import { reduceScaleSwitches, scaleFocusScene, scaleIntegrity } from './perf-scalability-metrics.mjs';
import { memorySnapshot } from './perf-memory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [appPath, output, fixturePath] = process.argv.slice(2);
if (!appPath || !output || !fixturePath) throw Error('Usage: perf-scalability.mjs <dev.app> <fresh-report.json> <fixture-directory>');
const out = resolve(output), fixtures = resolve(fixturePath);
if (fs.existsSync(out) || fs.existsSync(`${out}.ready`)) throw Error('Refusing to overwrite evidence');
fs.mkdirSync(dirname(out), { recursive: true });
fs.mkdirSync(fixtures, { recursive: true });
const contents = fs.readFileSync(join(root, 'samples/mini.pdb'));
const paths = Array.from({ length: 1000 }, (_, index) => join(fixtures, `scale-${String(index).padStart(4, '0')}.pdb`));
for (const path of paths) {
  if (!fs.existsSync(path)) fs.writeFileSync(path, contents, { flag: 'wx' });
  if (!fs.readFileSync(path).equals(contents)) throw Error(`Fixture changed: ${path}`);
}
const sleep = ms => new Promise(done => setTimeout(done, ms));
const app = new PerfApp(resolve(appPath), { foreground: true, idleSeconds: 0, screen: 'built-in' });
app.trace.evidencePath = `${out}.trace.jsonl`;
fs.writeFileSync(app.trace.evidencePath, '', { flag: 'wx' });
const report = {
  startedAt: new Date().toISOString(), app: { path: app.path, executableSha256: app.executableSha256 },
  fixture: { path: fixtures, count: paths.length, eachBytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') },
  session: app.sessionDir, loadAverage: loadavg(), samples: [], switches: [], switchActions: [], failure: null,
  memoryScope: 'Native footprint snapshots cover app PID, PPID descendants and same-user XPC processes proven by resource coalition ID/bundle. Snapshots with attributionComplete:false are partial. Point samples are not continuous peaks; snapshots run outside timed actions.',
};
const save = () => fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
const documentTotal = () => app.observe()?.bounds?.documents?.total ?? 0;
async function waitFor(label, predicate, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    app.assertUnlocked();
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${label}`);
    await sleep(100);
  }
}
async function focusReady(tab, actions) {
  const previousAt = Date.parse(app.observe()?.reportedAt);
  const action = { startedAt: Date.now(), previousReportedAt: previousAt, finishedAt: null,
    tabId: tab.id, documentId: null, path: tab.path };
  actions.push(action);
  app.act({ type: 'manage_tabs', operation: 'focus', tabId: tab.id });
  action.finishedAt = Date.now();
  let readyObservation;
  await waitFor(`fresh ready viewer ${tab.path}`, () => {
    const observation = app.observe(), at = Date.parse(observation?.reportedAt);
    const matches = at >= action.startedAt && at > previousAt && observation.activeTabId === tab.id && observation.activeDocument?.path === tab.path
      && observation.activeSurface?.kind === 'viewer'
      && typeof observation.activeSurface.documentId === 'string' && observation.activeSurface.documentId.length > 0;
    if (!matches) return false;
    action.documentId = observation.activeSurface.documentId;
    app.trace.sync();
    const scene = scaleFocusScene(app.trace.lines, action);
    if (scene.status === 'ambiguous') throw Error(`Ambiguous focus journey for ${tab.path}`);
    // Fresh path/ready may still describe the previous incarnation of this
    // document. A remounted scene must finish its own post-mount ready journey.
    if (scene.status !== 'complete' || observation.activeDocument?.ready !== true || at < scene.terminalAt) return false;
    readyObservation = observation;
    action.sceneJourneyAt = scene.journey.at;
    action.sceneClassification = scene.classification;
    action.sceneTerminalAt = scene.terminalAt;
    return true;
  });
  const observation = readyObservation;
  action.documentId = observation.activeSurface.documentId;
  action.readyWallMs = Date.now() - action.startedAt;
  action.readyObservation = { reportedAt: observation.reportedAt, tabId: observation.activeTabId,
    documentId: action.documentId, path: observation.activeDocument.path, ready: observation.activeDocument.ready,
    sceneTerminalAt: action.sceneTerminalAt };
  return action;
}
function ownedRss() {
  const parents = new Set(app.pids());
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8' })
    .split('\n').map(row => row.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
  return rows.filter(row => parents.has(Number(row[1])) || parents.has(Number(row[2])))
    .map(row => ({ pid: Number(row[1]), parent: Number(row[2]), rssKiB: Number(row[3]), executable: row[4] }));
}
async function ownedMemory() {
  const pids = app.pids();
  if (pids.length !== 1) return { attributionComplete: false, error: `Expected one owned app PID, found ${pids.length}.` };
  try {
    return await memorySnapshot(pids[0], app.bundleId);
  } catch (error) {
    return { attributionComplete: false, error: error.message };
  }
}
try {
  await app.launch();
  await sleep(3000);
  report.memoryAtLaunch = await ownedMemory();
  let old = 0;
  for (const total of [1, 10, 100, 1000]) {
    const started = Date.now();
    console.error(`scale: opening ${total - old}, total ${total}`);
    app.act({ type: 'open_files', paths: paths.slice(old, total) }, 180000);
    const ackMs = Date.now() - started;
    await waitFor(`${total} registered documents`, () => documentTotal() === total);
    await waitFor('active viewer ready', () => app.observe()?.activeDocument?.ready === true);
    await sleep(2000);
    app.trace.sync();
    const events = app.trace.between(started, Date.now());
    const added = events.filter(event => event.name === 'document:added');
    const firstReady = events.find(event => event.name === 'document:ready');
    const finishedAt = Date.now();
    report.samples.push({ total, added: total - old, ackMs, startedAt: started, finishedAt,
      firstReadyMs: firstReady ? firstReady.at + (firstReady.ms ?? 0) - started : null,
      tracedDocumentsAdded: added.length, registeredBounds: app.observe()?.bounds,
      tracedUniqueDocumentsAdded: new Set(added.map(event => event.detail?.documentId)).size,
      activeReady: app.observe()?.activeDocument?.ready,
      mainThread: mainThread(app.trace.lines, started, finishedAt), rss: ownedRss(), memory: await ownedMemory(),
    });
    old = total;
    save();
  }
  const tabs = (app.observe()?.tabs ?? []).filter(tab => tab.path).slice(0, 8);
  if (tabs.length !== 8) throw Error(`Expected 8 addressable tabs, observed ${tabs.length}`);
  // Visit the same eight viewers before measuring. They are not assumed warm:
  // a smaller viewer cache can evict earlier frames during this pass.
  report.preparationActions = [];
  for (const tab of tabs) {
    await focusReady(tab, report.preparationActions);
    await sleep(400);
  }
  const measurementStartedAt = Date.now();
  report.switchMeasurement = { expected: 24, startedAt: measurementStartedAt, finishedAt: null };
  report.switchMetricDefinitions = { readyWallMs: 'Action start to post-terminal fresh matching active-path ready observation; includes CLI, trace delivery and polling overhead.',
    visibleMs: 'Existing iframe rAF visibility, not OS presentation; nullable if ready terminal precedes visibility.',
    sceneReadyMs: 'Action start to matching post-mount document-ready terminal, or already-mounted warm-frame visibility; excludes trace delivery/polling delay.',
    readyTerminalMs: 'Existing document:ready completion minus action start; absent for already-ready mounted frames.',
    classification: 'remounted requires matching iframe:mount; mounted-warm requires visible remounted:false, loads:0 and no new ready terminal; otherwise unknown.' };
  for (let index = 0; index < 24; index++) {
    const tab = tabs[index % tabs.length];
    await focusReady(tab, report.switchActions);
    await sleep(300);
    app.trace.sync();
    save();
  }
  // The transport flushes once a second. Reduce after the final flush rather
  // than dropping fast switches whose mark arrives after the next action.
  await sleep(1500);
  app.trace.sync();
  report.switchMeasurement.finishedAt = Date.now();
  const reduction = reduceScaleSwitches(app.trace.lines, report.switchActions, report.switchMeasurement.finishedAt);
  report.switches = reduction.switches;
  report.switchSummary = reduction.summary;
  report.switchSubsets = reduction.subsets;
  report.switchIntegrity = reduction.integrity;
  report.rssAfterSwitches = ownedRss();
  report.memoryAfterSwitches = await ownedMemory();
  fs.writeFileSync(`${out}.ready`, 'Use CUA File > Close All Tabs; driver will observe zero documents.\n', { flag: 'wx' });
  console.error('READY: capture native UI, then use File > Close All Tabs through CUA.');
  const closeStart = Date.now();
  await waitFor('CUA close all tabs', () => documentTotal() === 0, 240000);
  await sleep(1500);
  app.trace.sync();
  const closeEvents = app.trace.between(closeStart, Date.now());
  report.close = {
    interval: { startedAt: closeStart, finishedAt: Date.now(), includesManualUiWait: true,
      meaning: 'Rendezvous interval includes manual native UI review and close action; not close duration.' },
    bounds: app.observe()?.bounds,
    commands: Object.fromEntries(['grid_close_runtime', 'close_opened_source_document', 'close_opened_source_documents'].map(name => [name, closeEvents.filter(event => event.source === 'ipc' && event.name === name).length])),
    mainThread: mainThread(app.trace.lines, closeStart, Date.now()), rss: ownedRss(),
  };
  report.close.memory = await ownedMemory();
  // Retained-memory plateau requires a second settled sample after close.
  await sleep(10000);
  report.close.memoryAfterSettling = await ownedMemory();
} catch (error) {
  report.failure = error.stack ?? String(error);
  console.error(report.failure);
} finally {
  // Preserve partial evidence even if shutdown fails. Final acceptance is only
  // computed after the owned app has drained its last cleanup acknowledgement.
  report.sessionPreserved = true;
  save();
  try { await app.quit(); } catch (error) {
    report.failure ??= `Owned shutdown failed: ${error.message}`;
    report.shutdownFailure = String(error.stack ?? error).slice(0, 1600);
  }
  report.quitDiagnostics = app.quitDiagnostics ?? null;
  try {
    app.trace.sync();
    if (report.switchMeasurement?.finishedAt) {
      const reduction = reduceScaleSwitches(app.trace.lines, report.switchActions, report.switchMeasurement.finishedAt);
      report.switches = reduction.switches;
      report.switchSummary = reduction.summary;
      report.switchSubsets = reduction.subsets;
      report.switchIntegrity = reduction.integrity;
    }
    // Recount only after the final drain; a sticky reader failure invalidates
    // reduction but must never prevent saving the final failed report.
    for (const sample of report.samples) {
      const added = app.trace.between(sample.startedAt, sample.finishedAt).filter(event => event.name === 'document:added');
      sample.tracedDocumentsAdded = added.length;
      sample.tracedUniqueDocumentsAdded = new Set(added.map(event => event.detail?.documentId)).size;
    }
  } catch (error) {
    report.finalReductionFailure = String(error.stack ?? error).slice(0, 1600);
    report.failure ??= report.finalReductionFailure;
  }
  report.traceDiagnostics = app.trace.diagnostics;
  const additions = app.trace.lines.filter(event => event.name === 'document:added' && event.at >= Date.parse(report.startedAt));
  report.traceProtocol = additions.length > 0 && additions.every(event => typeof event.stream === 'string' && Number.isSafeInteger(event.seq)) ? 'sequenced' : 'legacy-or-incomplete';
  try { report.integrity = scaleIntegrity(report); }
  catch (error) {
    report.failure ??= String(error.stack ?? error).slice(0, 1600);
    report.integrity = { status: 'fail', failures: ['Final integrity reduction failed; see failure.'] };
  }
  report.performanceBudgets = {
    switchVisibleP95Ms: { limit: 100, observed: report.switchSummary?.visibleMs?.p95 ?? null,
      n: report.switchSummary?.visibleMs?.n ?? 0,
      status: report.integrity.status !== 'pass' || report.switchSummary?.visibleMs?.n !== 24 ? 'unverified'
        : report.switchSummary.visibleMs.p95 <= 100 ? 'pass' : 'fail' },
  };
  if (report.integrity.status !== 'pass' && !report.failure) report.failure = `Measurement integrity failed: ${report.integrity.failures.join('; ')}`;
  report.finishedAt = new Date().toISOString();
  report.loadAverageEnd = loadavg();
  save();
  if (!report.failure && report.integrity.status === 'pass') {
    try {
      if (app.pids().length) throw Error('Owned app is still running after shutdown.');
      execFileSync('/usr/bin/trash', [app.sessionDir]);
      report.sessionPreserved = false;
    } catch (error) {
      report.failure = String(error.stack ?? error).slice(0, 1600);
      report.integrity = { status: 'fail', failures: [...report.integrity.failures, 'Session cleanup failed; see failure.'] };
      report.performanceBudgets.switchVisibleP95Ms.status = 'unverified';
    }
    save();
  }
  if (report.sessionPreserved) console.error(`Preserving failed session evidence: ${app.sessionDir}`);
}
if (report.failure) process.exitCode = 1;
