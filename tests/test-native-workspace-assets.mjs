import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createWorkspaceAssets } from '../plugins/burette-agent/ui/native-workspace-assets.mjs';

for (const omitTerminalCursor of [false, true]) test(`workspace asset chunks verify final bytes with omitted terminal cursor=${omitTerminalCursor}`, async () => {
  const previous = globalThis.window;
  globalThis.window = { fetch };
  const contents = randomBytes(1024 * 1024);
  const packed = gzipSync(contents);
  const entry = { mimeType: 'application/octet-stream', packedBytes: packed.length, byteCount: contents.length, sha256: createHash('sha256').update(contents).digest('hex') };
  let active = 0, peak = 0, progress = 0;
  const calls = [];
  const assets = createWorkspaceAssets({ manifest: { assets: { 'test.bin': entry } }, isClosed: () => false,
    onProgress: ({ transferredBytes }) => { progress = transferredBytes; },
    exchange: async ({ asset: { offset } }) => {
      calls.push(offset);
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      const end = Math.min(offset + 192 * 1024, packed.length);
      return { dataBase64: packed.subarray(offset, end).toString('base64'), ...(end < packed.length ? { nextOffset: end } : omitTerminalCursor ? {} : { nextOffset: null }) };
    },
  });
  try {
    const url = await assets.asset('test.bin');
    assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), contents);
    assert.equal(peak, 4);
    assert.equal(progress, packed.length);
    await assets.asset('test.bin');
    assert.equal(calls.length, Math.ceil(packed.length / (192 * 1024)));
    entry.sha256 = '0'.repeat(64);
    assets.dispose();
    await assert.rejects(assets.asset('test.bin'), /integrity/);
  } finally { assets.dispose(); globalThis.window = previous; }
});

test('workspace assets reject missing intermediate and invalid terminal continuations', async () => {
  const previous = globalThis.window;
  globalThis.window = { fetch };
  const contents = randomBytes(256 * 1024);
  const packed = gzipSync(contents);
  const entry = { mimeType: 'application/octet-stream', packedBytes: packed.length, byteCount: contents.length, sha256: createHash('sha256').update(contents).digest('hex') };
  try {
    for (const fault of ['missing-intermediate', 'invalid-terminal', 'truncated']) {
      const assets = createWorkspaceAssets({ manifest: { assets: { 'test.bin': entry } }, isClosed: () => false,
        exchange: async ({ asset: { offset } }) => {
          const end = Math.min(offset + 192 * 1024, packed.length);
          const terminal = end === packed.length;
          const nextOffset = terminal ? (fault === 'invalid-terminal' ? 0 : null) : (fault === 'missing-intermediate' ? undefined : end);
          return { dataBase64: packed.subarray(offset, end - (fault === 'truncated' ? 1 : 0)).toString('base64'), nextOffset };
        },
      });
      try { await assert.rejects(assets.asset('test.bin'), /continuation|incomplete/); }
      finally { assets.dispose(); }
    }
  } finally { globalThis.window = previous; }
});
