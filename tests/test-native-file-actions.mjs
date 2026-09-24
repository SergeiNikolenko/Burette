import assert from 'node:assert/strict';
import { browserFileAction } from '../apps/desktop/src/lib/browser-file-actions.ts';

const fetchBefore = globalThis.fetch;
const requests = [];
try {
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options.method, action: JSON.parse(options.body) });
    return Response.json({ targets: [{ id: 'app-1', name: 'Maestro' }] });
  };
  const actions = [
    { type: 'list_apps', path: '/authorized/pose.sdf' },
    { type: 'open_with', path: '/authorized/pose.sdf', targetId: 'app-1' },
    { type: 'open_default', path: '/authorized/pose.sdf' },
    { type: 'reveal', path: '/authorized/pose.sdf' },
  ];
  for (const action of actions) {
    assert.deepEqual(await browserFileAction(action), { targets: [{ id: 'app-1', name: 'Maestro' }] });
  }
  assert.deepEqual(requests, actions.map(action => ({ url: '/__burette/file-action', method: 'POST', action })));
  const count = requests.length;
  for (const path of ['burette-ketcher:browser-123/sketch.sdf', 'burette-sdf:selection/pose.sdf', '', 'relative.sdf']) {
    assert.deepEqual(await browserFileAction({ type: 'list_apps', path }), { targets: [], supported: false });
    await assert.rejects(browserFileAction({ type: 'open_default', path }), /Save this generated structure/);
  }
  assert.equal(requests.length, count, 'Virtual documents never reach filesystem transport');
  globalThis.fetch = async () => Response.json({ error: 'Document is not authorized' }, { status: 403 });
  await assert.rejects(browserFileAction(actions[1]), /Document is not authorized/);
  globalThis.fetch = async () => Response.json({ error: 'Application unavailable' });
  await assert.rejects(browserFileAction(actions[1]), /Application unavailable/);
} finally {
  globalThis.fetch = fetchBefore;
}
console.log('native file-action dispatch and error propagation passed');
