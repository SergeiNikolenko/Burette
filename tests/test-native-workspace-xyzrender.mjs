import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderNativeWorkspaceXyz } from '../scripts/native-workspace-xyzrender.mjs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

test('native rendering rejects path-bearing configuration and unbounded input before execution', async () => {
  const execute = () => assert.fail('Unexpected process');
  await assert.rejects(renderNativeWorkspaceXyz({ controls: { customConfigPath: '/private/config.json' } }, { execute }), /custom config/u);
  await assert.rejects(renderNativeWorkspaceXyz({ controls: { extraArguments: '--output /private/result' } }, { execute }), /extra CLI/u);
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: '../../txt' }, { execute }), /Unsupported/u);
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: 'xyz', inputDataBase64: 'A'.repeat(700000) }, { execute }), /512 KiB/u);
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: 'xyz' }, { execute }), /authorized source/u);
  await assert.rejects(renderNativeWorkspaceXyz({ orientation: [NaN, 0, 0] }, { execute }), /Orientation/u);
  await assert.rejects(renderNativeWorkspaceXyz({ animation: { frames: 100000 } }, { execute }), /frames/u);
  await assert.rejects(renderNativeWorkspaceXyz({ exportFormat: '../../txt' }, { execute }), /export format/u);
});

const hasRenderer = [join(homedir(), '.local/bin/xyzrender'), '/opt/homebrew/bin/xyzrender', '/usr/local/bin/xyzrender',
  ...String(process.env.PATH || '').split(delimiter).filter(Boolean).map(path => join(path, 'xyzrender'))].some(existsSync);
test('binary artifacts can exceed the SVG cap but cannot exceed 16 MiB', { skip: !hasRenderer }, async () => {
  let artifactSize = 600 * 1024;
  const execute = async (_binary, args) => {
    await writeFile(args[args.indexOf('-o') + 1], '<svg/>');
    await writeFile(args[args.indexOf('-go') + 1], Buffer.alloc(artifactSize));
    return { stdout: '', stderr: '' };
  };
  const input = { inputExtension: 'xyz', inputDataBase64: Buffer.from('1\nhydrogen\nH 0 0 0\n').toString('base64'), animation: { size: 128, frames: 4 } };
  const result = await renderNativeWorkspaceXyz(input, { execute });
  assert.equal(Buffer.from(result.gifBase64, 'base64').length, artifactSize);
  artifactSize = 16 * 1024 * 1024 + 1;
  await assert.rejects(renderNativeWorkspaceXyz(input, { execute }), /exceeds 16 MiB/u);
});

test('periodic orientation rejection cannot silently return an unrotated render or export', { skip: !hasRenderer }, async () => {
  let calls = 0;
  const execute = async () => { calls++; throw new Error('--ref is not supported for periodic structures'); };
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: 'xyz',
    inputDataBase64: Buffer.from('1\nLattice="2 0 0 0 2 0 0 0 2"\nH 0 0 0\n').toString('base64'),
    orientationRef: '1\nreference\nH 0 0 0\n', orientation: [0, 30, 0], exportFormat: 'png',
  }, { execute }), /orientation references are not supported for periodic/u);
  assert.equal(calls, 1, 'never retry without the requested orientation');
});
test('installed renderer returns a real orientation, tiny GIF and PNG rather than only an SVG', { skip: !hasRenderer, timeout: 60000 }, async () => {
  const input = { inputExtension: 'xyz', inputDataBase64: Buffer.from('3\nwater\nO 0 0 0\nH 0.9572 0 0\nH -0.239 0.927 0\n').toString('base64'), controls: { canvasSize: 128 } };
  const first = await renderNativeWorkspaceXyz({ ...input, orientation: [0, 0, 0] });
  assert.match(first.orientationRef, /^3\n/u);
  const rotated = await renderNativeWorkspaceXyz({ ...input, orientationRef: first.baseOrientationRef, orientation: [0, 45, 0] });
  assert.notEqual(rotated.orientationRef, first.orientationRef);
  assert.notEqual(rotated.svg, first.svg);
  const animated = await renderNativeWorkspaceXyz({ ...input, animation: { mode: 'rotation', size: 128, frames: 4, fps: 4 } });
  assert.match(Buffer.from(animated.gifBase64, 'base64').subarray(0, 6).toString(), /^GIF8[79]a$/u);
  const exported = await renderNativeWorkspaceXyz({ ...input, exportFormat: 'png' });
  assert.equal(Buffer.from(exported.artifactBase64, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('native rendering validates the selected trajectory frame before starting a process', async () => {
  const execute = () => assert.fail('Unexpected process');
  const inputDataBase64 = Buffer.from('1\nfirst\nH 0 0 0\n1\nsecond\nH 1 0 0\n').toString('base64');
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: 'xyz', inputDataBase64, activeModel: 2 }, { execute }), /out of range/u);
  await assert.rejects(renderNativeWorkspaceXyz({ inputExtension: 'xyz', inputDataBase64, activeModel: -1 }, { execute }), /Invalid XYZ frame/u);
});
