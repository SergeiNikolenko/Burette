import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMcpAppOperation } from '../scripts/mcp-app-session.mjs';
import { pendingMcpActions } from '../scripts/mcp-app-action-log.mjs';
import { createMolecularScene } from '../scripts/molecular-scene.mjs';
import { createWorkspaceCheckpoint } from '../plugins/burette-agent/ui/native-workspace-checkpoint.mjs';

test('showing an exported scene preserves restored tabs and queues its canonical authorized path', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'burette-molecular-presentation-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const original = new URL('../samples/mini.pdb', import.meta.url).pathname;
  const session = await runMcpAppOperation({ operation: 'open', file: original, workspace: true });
  const directory = join(tmpdir(), 'burette-mcp-app', session.sessionId);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storageKey = `burette.molecule.session.mcp-${session.sessionId}`;
  const savedWorkspace = JSON.stringify({ state: { documents: [],
    tabs: [{ id: 'file-1', location: { kind: 'file', path: original } }], activeTabId: 'file-1', recentStructures: [] }, version: 0 });
  const exchange = input => runMcpAppOperation({ operation: 'exchange', sessionId: session.sessionId, token: session.token, ...input });
  await exchange({ checkpoint: { key: 'workspace', value: JSON.stringify({ [storageKey]: savedWorkspace }) } });

  await mkdir(join(scratch, 'scenes'));
  await symlink(join(scratch, 'scenes'), join(scratch, 'scene-alias'), 'dir');
  const scenePath = join(scratch, 'scene-alias', 'export.png.mvsj');
  const { scene } = await createMolecularScene(session.documents);
  await writeFile(scenePath, JSON.stringify(scene));
  const requestId = randomUUID();
  const jobDirectory = join(directory, 'molecular-jobs', requestId);
  await mkdir(jobDirectory, { recursive: true });
  // This retained completion fixture tests presentation independently of
  // browser rendering, which has separate real-browser acceptance tests.
  await writeFile(join(jobDirectory, 'job.json'), JSON.stringify({ requestId, sessionId: session.sessionId,
    status: 'completed', result: { scenePath, nativeAttachment: { supported: true } } }));

  const shown = await runMcpAppOperation({ operation: 'molecular', command: 'present', sessionId: session.sessionId, requestId });
  const checkpoint = await createWorkspaceCheckpoint({ sessionId: session.sessionId,
    exchange: input => exchange({ presentationId: shown.presentationId, ...input }) });
  t.after(() => checkpoint.dispose());
  assert.equal(checkpoint.restored, true);
  assert.equal(checkpoint.storage.getItem(storageKey), savedWorkspace);
  const normalizedScene = await realpath(scenePath);
  assert.notEqual(normalizedScene, scenePath);
  assert.ok(shown.documents.some(document => document.path === normalizedScene));
  const actions = await pendingMcpActions(directory);
  assert.deepEqual(actions.map(({ action }) => action), [{ type: 'open_files', paths: [normalizedScene], view: 'auto' }]);
  const delivered = await exchange({ presentationId: shown.presentationId });
  assert.deepEqual(delivered.actions, actions);
});
