import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderNativeWorkspaceXyz } from '../scripts/native-workspace-xyzrender.mjs';

test('native rendering rejects path-bearing configuration and unbounded input before execution', async () => {
  const execute = () => assert.fail('Unexpected process');
  await assert.rejects(renderNativeWorkspaceXyz({ controls: { customConfigPath: '/private/config.json' } }, { execute }), /custom config/u);
  await assert.rejects(renderNativeWorkspaceXyz({ controls: { extraArguments: '--output /private/result' } }, { execute }), /extra CLI/u);
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: '../../txt' }, { execute }), /Unsupported/u);
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: 'xyz', inputDataBase64: 'A'.repeat(700000) }, { execute }), /512 KiB/u);
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: 'xyz' }, { execute }), /authorized source/u);
});

test('native rendering validates the selected trajectory frame before starting a process', async () => {
  const execute = () => assert.fail('Unexpected process');
  const inputDataBase64 = Buffer.from('1\nfirst\nH 0 0 0\n1\nsecond\nH 1 0 0\n').toString('base64');
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: 'xyz', inputDataBase64, activeModel: 2 }, { execute }), /out of range/u);
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: 'xyz', inputDataBase64, activeModel: -1 }, { execute }), /Invalid XYZ frame/u);
});
