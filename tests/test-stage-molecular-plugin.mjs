import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

test('composed package preserves baseline UI while replacing the built backend', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'burette-molecular-stage-'));
  const base = join(directory, 'baseline'), output = join(directory, 'composed');
  const files = {
    '.codex-plugin/plugin.json': '{"name":"burette","version":"baseline-ui"}',
    'assets/native-workspace/manifest.json': '{"assets":{}}',
    'assets/native-workspace.html': '<html>native UI sentinel</html>',
    'browser-shell-dist/index.html': '<html>browser UI sentinel</html>',
    'preview-web/viewer.js': '/* preview UI sentinel */',
    'mcp/lib/obsolete-chunk.mjs': 'obsolete backend',
  };
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(base, path)), { recursive: true });
      await writeFile(join(base, path), content);
    }
    await run(process.execPath, [join(root, 'scripts/stage-molecular-plugin.mjs'), '--base-plugin', base, '--output', output], { timeout: 30000 });
    for (const [path, content] of Object.entries(files).filter(([path]) => /^(assets|browser-shell-dist|preview-web)\//u.test(path))) {
      assert.equal(await readFile(join(output, path), 'utf8'), content);
    }
    await assert.rejects(readFile(join(output, 'mcp/lib/obsolete-chunk.mjs')), { code: 'ENOENT' });
    assert.equal(await readFile(join(output, 'scripts/molecular-worker.mjs'), 'utf8'),
      await readFile(join(root, 'plugins/burette-agent/scripts/molecular-worker.mjs'), 'utf8'));
    const provenance = JSON.parse(await readFile(join(output, '.burette-autonomous-build.json'), 'utf8'));
    assert.equal(provenance.basePluginVersion, 'baseline-ui');
    assert.match(provenance.nativeAssetManifestSha256, /^[a-f\d]{64}$/u);
    assert.equal(JSON.parse(await readFile(join(output, '.burette-agent-install.json'), 'utf8')).repoRoot, root.slice(0, -1));
    await assert.rejects(run(process.execPath, [join(root, 'scripts/stage-molecular-plugin.mjs'), '--base-plugin', base, '--output', output]), /already exists/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
