import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localFileAction } from '../scripts/local-file-actions.mjs';

const path = new URL('../samples/mini.pdb', import.meta.url).pathname;

test('file actions authorize before executing and never accept arbitrary programs or app paths', async () => {
  const executions = [];
  const options = { authorize: () => true, platform: 'darwin', execute: async (program, args) => {
    executions.push({ program, args });
    return { stdout: JSON.stringify([{ appPath: '/Applications/Fixture.app', name: 'Fixture', bundleId: 'test.fixture' }]) };
  } };
  await assert.rejects(localFileAction({ type: 'reveal', path }, { ...options, authorize: () => false }), /not authorized/u);
  await assert.rejects(localFileAction({ type: 'shell', path }, options), /Unsupported/u);
  assert.deepEqual(executions, []);
  const { targets } = await localFileAction({ type: 'list_apps', path }, options);
  assert.equal(targets.length, 1);
  assert.equal(executions[0].args.at(-1), path);
  assert.ok(!executions[0].args[3].includes(path), 'file paths must never be interpolated into script code');
  await localFileAction({ type: 'open_with', path, targetId: targets[0].id }, options);
  assert.deepEqual(executions.at(-1), { program: '/usr/bin/open', args: ['-a', '/Applications/Fixture.app', path] });
  await assert.rejects(localFileAction({ type: 'open_with', path, targetId: '/bin/sh' }, options), /not registered/u);
  await localFileAction({ type: 'reveal', path }, options);
  assert.deepEqual(executions.at(-1), { program: '/usr/bin/open', args: ['-R', path] });
  await localFileAction({ type: 'open_default', path }, options);
  assert.deepEqual(executions.at(-1), { program: '/usr/bin/open', args: [path] });
});

test('non-macOS hosts report unavailable file integration without launching anything', async () => {
  const options = { authorize: () => true, platform: 'linux', execute: () => assert.fail('Unexpected process') };
  assert.deepEqual(await localFileAction({ type: 'list_apps', path }, options), { targets: [], supported: false });
  await assert.rejects(localFileAction({ type: 'reveal', path }, options), /require macOS/u);
});

test('icons use only fixed destinations or discovered apps and bound returned PNG data', async () => {
  const executions = [];
  const png = 'iVBORw0KGgoAAAANSUhEUg==';
  const options = { authorize: () => true, platform: 'darwin', execute: async (program, args) => {
    executions.push(args);
    return { stdout: args.length === 6 ? png : JSON.stringify([{ appPath: '/Applications/Fixture.app', name: 'Fixture' }]) };
  } };
  assert.deepEqual(await localFileAction({ type: 'app_icon', path, targetId: 'finder' }, options), { iconUrl: `data:image/png;base64,${png}` });
  const { targets } = await localFileAction({ type: 'list_apps', path }, options);
  await localFileAction({ type: 'app_icon', path, targetId: targets[0].id }, options);
  assert.equal(executions.at(-1).at(-1), '/Applications/Fixture.app');
  await assert.rejects(localFileAction({ type: 'app_icon', path, targetId: '/etc/passwd' }, options), /not registered/u);
  await assert.rejects(localFileAction({ type: 'app_icon', path, targetId: 'finder' }, { ...options, execute: async () => ({ stdout: 'iVBORw0KGgo' + 'x'.repeat(50000) }) }), /Invalid application icon/u);
});
