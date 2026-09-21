import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMcpAppAsset } from '../scripts/mcp-app-assets.mjs';

test('packaged assets use an exact manifest and bounded chunks, never arbitrary paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'burette-assets-test-'));
  try {
    const bytes = Buffer.alloc(200 * 1024, 42);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const manifest = { assets: { 'app.js': { sha256, packedBytes: bytes.length } } };
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(root, `${sha256}.gz`), bytes);
    assert.deepEqual(await readMcpAppAsset({ manifest: true }, root), { manifest });
    const first = await readMcpAppAsset({ path: 'app.js' }, root);
    const second = await readMcpAppAsset({ path: 'app.js', offset: first.nextOffset }, root);
    assert.deepEqual(Buffer.concat([first, second].map(part => Buffer.from(part.dataBase64, 'base64'))), bytes);
    assert.equal(first.nextOffset, 192 * 1024);
    assert.equal(second.nextOffset, null);
    for (const path of ['../manifest.json', '/etc/passwd', 'constructor', '__proto__']) {
      await assert.rejects(readMcpAppAsset({ path }, root), /Unknown/);
    }
    for (const offset of [-1, 0.1, bytes.length, Infinity]) {
      await assert.rejects(readMcpAppAsset({ path: 'app.js', offset }, root), /offset/);
    }
    await rm(join(root, `${sha256}.gz`));
    await symlink(join(root, 'manifest.json'), join(root, `${sha256}.gz`));
    await assert.rejects(readMcpAppAsset({ path: 'app.js' }, root), /symbolic link/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
