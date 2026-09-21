import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createViewerLifetime } from '../plugins/burette-agent/ui/local-viewer-lifetime.mjs';

test('close disposes synchronously, clears context, stops polling and never reopens', async () => {
  const events = [];
  let finish;
  const lifetime = createViewerLifetime({
    dispose: () => events.push('dispose'), showClosed: () => events.push('closed'),
    clearContext: async () => events.push('clear'), requestTeardown: async () => events.push('teardown'),
    persist: () => new Promise(resolve => { events.push('persist'); finish = resolve; }),
  });
  lifetime.schedule(() => events.push('poll'), 0);
  const closing = lifetime.close({ notifyHost: true });
  assert.equal(lifetime.closed, true);
  assert.deepEqual(events, ['dispose', 'closed', 'clear', 'persist', 'teardown']);
  lifetime.schedule(() => events.push('resurrect'), 0);
  assert.equal(lifetime.close(), closing);
  finish();
  await closing;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(events, ['dispose', 'closed', 'clear', 'persist', 'teardown']);
});

test('host teardown does not request another teardown and tolerates a disconnected host', async () => {
  let disposed = false;
  const lifetime = createViewerLifetime({
    dispose: () => { disposed = true; }, showClosed() {},
    clearContext: async () => { throw new Error('Disconnected'); },
    persist: () => assert.fail('Host unmount must not end the session'),
    requestTeardown: () => assert.fail('Recursive teardown'),
  });
  await lifetime.detach();
  assert.equal(disposed, true);
});

test('host unmount stops local work without closing the retained session', async () => {
  const events = [];
  const lifetime = createViewerLifetime({
    dispose: value => events.push(value), clearContext: async () => events.push('clear'),
    persist: () => assert.fail('Session was destroyed'),
    showClosed: () => assert.fail('Unmount was presented as a terminal close'),
    requestTeardown: () => assert.fail('Host already owns unmount'),
  });
  lifetime.schedule(() => assert.fail('Polling survived unmount'), 0);
  const detached = lifetime.detach();
  assert.equal(lifetime.detach(), detached);
  await detached;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(events, [{ terminal: false }, 'clear']);
});
