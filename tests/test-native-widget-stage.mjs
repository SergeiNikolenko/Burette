import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

// Exercise the same no-.git stage consumed by build.sh's isolated app build.
const root = await mkdtemp(path.join(os.tmpdir(), 'burette-stage-test-'));
try {
  const pin = JSON.parse(await readFile(new URL('../config/native-widget.json', import.meta.url)));
  const bundle = path.join(root, 'plugins/burette-native-bundle');
  const put = async (file, contents) => {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  };
  await put('config/native-widget.json', JSON.stringify(pin));
  await mkdir(path.join(root, 'scripts'));
  await cp(new URL('../scripts/stage-native-widget.mjs', import.meta.url), path.join(root, 'scripts/stage-native-widget.mjs'));
  const prefix = 'plugins/burette-native-bundle/';
  await put(prefix + '.native-widget-source.json', JSON.stringify(pin));
  await put(prefix + '.codex-plugin/plugin.json', JSON.stringify({ name: 'burette', version: pin.version }));
  for (const file of ['assets/native-workspace.html', 'assets/local-viewer.html',
    'mcp/registrations/local-viewer/register.mjs', 'mcp/lib/server-bundle.mjs',
    'scripts/mcp-app-session.mjs', 'scripts/install-local.mjs']) await put(prefix + file, 'fixture');
  const data = Buffer.from('test module');
  const sha256 = createHash('sha256').update(data).digest('hex');
  await put(prefix + 'assets/native-workspace/manifest.json', JSON.stringify({ assets: { entry: { sha256, byteCount: data.length } } }));
  const asset = prefix + `assets/native-workspace/${sha256}.gz`;
  await put(asset, gzipSync(data));
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/stage-native-widget.mjs')], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  await put(asset, gzipSync(Buffer.from('corrupted')));
  assert.match(run().stderr, /integrity mismatch/);
  await put(asset, gzipSync(data));
  await put(prefix + '.native-widget-source.json', JSON.stringify({ commit: '0'.repeat(40) }));
  assert.match(run().stderr, /Stale native widget stage/);
  await put(prefix + '.native-widget-source.json', JSON.stringify(pin));
  await rm(path.join(bundle, 'assets/native-workspace.html'));
  assert.match(run().stderr, /Missing native widget file/);
} finally { await rm(root, { recursive: true, force: true }); }
console.log('Native widget staging integrity tests passed');
