import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { snapshotNativeResources } from '../plugins/burette-agent/mcp/lib/native-resource-snapshot.mjs';
import { readMcpAppAsset } from '../scripts/mcp-app-assets.mjs';

test('mounted server retains one resource generation after installer removes its cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'burette-resource-test-'));
  let resources;
  try {
    const bytes = Buffer.from('export const version = 1;');
    const packed = gzipSync(bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const manifest = { assets: { 'shell/index.js': { sha256, packedBytes: packed.length, byteCount: bytes.length } } };
    await mkdir(join(root, 'native-workspace'));
    await writeFile(join(root, 'native-workspace', 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'native-workspace', `${sha256}.gz`), packed);
    await writeFile(join(root, 'native-workspace.html'), '<html>workspace</html>');
    await writeFile(join(root, 'local-viewer.html'), '<html>compact</html>');
    resources = await snapshotNativeResources(root);
    await rm(root, { recursive: true });
    assert.equal(resources.workspace, '<html>workspace</html>');
    assert.equal(resources.compact, '<html>compact</html>');
    assert.deepEqual(await readMcpAppAsset({ manifest: true }, resources.assetRoot), { manifest });
    assert.deepEqual(await readMcpAppAsset({ path: 'shell/index.js' }, resources.assetRoot), { dataBase64: packed.toString('base64'), nextOffset: null });
    resources.dispose();
    await assert.rejects(access(resources.assetRoot));
  } finally { resources?.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('a new server removes generations left by servers that were killed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'burette-resource-test-'));
  const exited = spawnSync(process.execPath, ['-e', '']);
  const orphan = join(tmpdir(), `burette-mcp-resources-${exited.pid}-orphan`);
  const live = join(tmpdir(), `burette-mcp-resources-${process.ppid}-live`);
  let resources;
  try {
    await mkdir(join(root, 'native-workspace'));
    await writeFile(join(root, 'native-workspace.html'), '');
    await writeFile(join(root, 'local-viewer.html'), '');
    await mkdir(orphan);
    await mkdir(live);
    resources = await snapshotNativeResources(root);
    await assert.rejects(access(orphan));
    await access(live);
    assert.match(resources.assetRoot, new RegExp(`burette-mcp-resources-${process.pid}-`));
  } finally {
    resources?.dispose();
    await Promise.all([root, orphan, live].map((path) => rm(path, { recursive: true, force: true })));
  }
});
