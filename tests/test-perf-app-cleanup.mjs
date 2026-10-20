import assert from 'node:assert/strict';
import { PerfApp } from '../scripts/perf-journey-app.mjs';

// Use the real method with a deterministic clock and delayed observations;
// importing the harness does not construct or launch any app.
const method = PerfApp.prototype.closeAllTabs.toString().replace(/^async closeAllTabs/, 'async function');
function fixture(count, { refused = false, stale = false, retainedLauncher = false, afterClose } = {}) {
  let now = 10000, polls = 0, pending = null, acknowledged = false;
  const launcher = { id: 'launcher', kind: 'launcher' };
  let tabs = Array.from({ length: count }, (_, index) => ({ id: `file-${index}`, path: `/${index}.pdb`, kind: 'file' }));
  if (retainedLauncher || !count) tabs.push(launcher);
  let observation;
  const publish = (at = now) => {
    observation = { reportedAt: new Date(at).toISOString(), activeTabId: tabs[0].id, tabs: [...tabs],
      bounds: { documents: { total: tabs.filter(tab => tab.path).length }, tabs: { total: tabs.length } } };
    if (acknowledged && afterClose) observation = afterClose(observation);
  };
  publish(9000);
  const calls = [];
  const cleanup = new Function('sleep', 'Date', `return (${method});`)(async ms => {
    now += ms;
    if (pending && ++polls === 3) {
      if (!refused) {
        tabs = tabs.filter(tab => tab.id !== pending);
        if (!tabs.length) tabs.push(launcher);
      }
      pending = null;
      acknowledged = true;
    }
    publish(stale ? 9000 : now);
  }, { now: () => now, parse: Date.parse });
  const app = {
    owned: true,
    observe: () => observation,
    act(action) {
      calls.push(action);
      now += 10;
      if (action.operation === 'close') { pending = action.tabId; polls = 0; }
      else publish(now);
    },
  };
  return { app, calls, run: () => cleanup.call(app), replaceObservation: value => { observation = value; } };
}

{
  const f = fixture(3);
  assert.deepEqual(await f.run(), { closed: 3, documents: 0 });
  assert.deepEqual(f.calls.map(action => [action.operation, action.tabId]), [['close', 'file-0'], ['close', 'file-1'], ['close', 'file-2']]);
}
{
  const f = fixture(1);
  assert.equal(f.app.observe().bounds.tabs.total, 1, 'opening a file replaces the launcher');
  assert.deepEqual(await f.run(), { closed: 1, documents: 0 });
  assert.deepEqual(f.app.observe().tabs, [{ id: 'launcher', kind: 'launcher' }]);
  assert.equal(f.app.observe().bounds.tabs.total, 1, 'last-file close creates a launcher without reducing tab count');
}
{
  const f = fixture(1, { retainedLauncher: true });
  assert.deepEqual(await f.run(), { closed: 1, documents: 0 });
}
for (const afterClose of [
  observation => ({ ...observation, bounds: { documents: { total: 1 }, tabs: { total: 1 } } }),
  observation => ({ ...observation, bounds: { documents: { total: 0 }, tabs: { total: 2 } } }),
  observation => ({ ...observation, tabs: [{ id: 'file-0', kind: 'launcher' }] }),
]) {
  const f = fixture(1, { afterClose });
  await assert.rejects(f.run(), /refused close, or no progress/);
  assert.equal(f.calls.length, 1, 'target disappearance alone cannot establish progress or valid bounds');
}
{
  const f = fixture(1, { refused: true });
  await assert.rejects(f.run(), /refused close, or no progress/);
  assert.equal(f.calls.length, 1, 'a refused close must not be retried 32 times');
}
{
  const f = fixture(1, { stale: true });
  await assert.rejects(f.run(), /stale observation/);
  assert.equal(f.calls.length, 1, 'target absence in a stale snapshot is not confirmation');
}
{
  const f = fixture(0);
  assert.deepEqual(await f.run(), { closed: 0, documents: 0 });
  assert.equal(f.calls[0].operation, 'focus', 'an initially empty snapshot requires a fresh acknowledgement');
}
for (const [documents, tabs] of [[10, 10], [0, 1000]]) {
  const f = fixture(0);
  f.replaceObservation({ reportedAt: new Date(9000).toISOString(), tabs: [], bounds: { documents: { total: documents }, tabs: { total: tabs } } });
  await assert.rejects(f.run(), /cannot confirm an empty workspace/);
  assert.equal(f.calls.length, 0);
}
{
  const f = fixture(33);
  await assert.rejects(f.run(), /limited to 32/);
  assert.equal(f.calls.length, 0, 'large scale sessions need the separate CUA close campaign');
}
{
  const f = fixture(32);
  assert.equal((await f.run()).closed, 32, 'the final allowed close still requires and accepts verified emptiness');
}
{
  const f = fixture(1);
  f.app.owned = false;
  await assert.rejects(f.run(), /does not own/);
  assert.equal(f.calls.length, 0);
}
{
  const act = new Function('spawnSync', 'process', 'agentCli', `return (${PerfApp.prototype.act.toString().replace(/^act/, 'function')});`)(
    () => ({ stdout: JSON.stringify({ ok: true, result: { action: { id: 'last-close' } } }) }), { execPath: 'node' }, 'unused');
  const app = { assertUnlocked() {}, sessionDir: 'unused' };
  act.call(app, { type: 'manage_tabs' });
  assert.equal(app.lastActionId, 'last-close');
}
for (const mode of ['delayed', 'wrong-id', 'legacy', 'cleanup-failed']) {
  let now = 0, running = true, polls = 0, terminatedAt = null;
  const lines = [];
  const app = {
    options: { foreground: false }, bundleId: 'owned', owned: true,
    lastActionId: mode === 'legacy' ? undefined : 'last-close',
    pids: () => running ? [42] : [],
    closeAllTabs: async () => { if (mode === 'cleanup-failed') throw Error('refused cleanup'); },
    trace: { lines, sync() {
      polls++;
      if (now >= 1_000 && !lines.length) lines.push({ name: 'agent:action', detail: { id: mode === 'wrong-id' ? 'old-action' : 'last-close' } });
    } },
  };
  const quit = new Function('sleep', 'Date', 'hostInventory', 'frontmostBundleId', 'spawnSync', 'process', 'console',
    `return (${PerfApp.prototype.quit.toString().replace(/^async quit/, 'async function')});`)(
    async ms => { now += ms; }, { now: () => now },
    (operation, pid) => { assert.equal(operation, 'terminate'); assert.equal(pid, 42); terminatedAt = now; running = false; },
    () => 'other-app', () => { throw Error('unexpected focus change'); },
    { kill: () => { throw Error('graceful termination should suffice'); } }, { error() {} });
  if (mode === 'cleanup-failed') {
    await assert.rejects(quit.call(app), /Preserving owned app after unconfirmed cleanup/);
    assert.equal(app.owned, true, 'retain ownership for explicit UI cleanup');
    assert.equal(running, true);
    assert.equal(terminatedAt, null, 'refused cleanup must never terminate or kill the app');
    assert.equal(app.quitDiagnostics.cleanupFailure, 'refused cleanup');
    assert.equal(app.quitDiagnostics.traceDrain.status, 'cleanup-refused');
    continue;
  }
  await quit.call(app);
  assert.equal(app.owned, false);
  assert.ok(polls >= 3, 'drain polls and post-termination sync both run');
  if (mode === 'delayed') {
    assert.equal(terminatedAt, 1_000, 'do not terminate before the real close acknowledgement is captured');
    assert.equal(app.quitDiagnostics.traceDrain.status, 'confirmed');
  } else {
    assert.equal(terminatedAt, mode === 'legacy' ? 1_200 : 3_000, 'missing legacy/action marks remain bounded');
    assert.equal(app.quitDiagnostics.traceDrain.status, mode === 'legacy' ? 'no-action-id' : 'timeout');
  }
  assert.equal(app.quitDiagnostics.cleanupFailure, null);
}
{
  const app = { pids: () => [], quitDiagnostics: { traceDrain: { status: 'confirmed', actionId: 'old-run' } } };
  await PerfApp.prototype.quit.call(app);
  assert.deepEqual(app.quitDiagnostics, { cleanupFailure: null, traceDrain: { status: 'not-running' } });
}
console.log('Native perf app cleanup tests passed');
