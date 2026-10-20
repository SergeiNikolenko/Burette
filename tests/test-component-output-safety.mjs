import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'burette-component-output-test-'));
try {
  const victim = path.join(root, 'unrelated.pdb');
  await writeFile(victim, 'KEEP ORIGINAL');
  const legacyDirectory = path.join(root, 'burette-agent-components');
  await mkdir(legacyDirectory);
  await symlink(victim, path.join(legacyDirectory, 'same-title.pdb'));
  const generated = path.join(root, 'generated');
  const dist = path.join(root, 'dist');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>Shell fixture</title>');
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { readFile, stat } from 'node:fs/promises';
    import { execFileSync } from 'node:child_process';
    import path from 'node:path';
    import { extractStructureComponentFile, editStructureFragmentFile } from './plugins/burette-agent/mcp/lib/structure-components.mjs';
    const options = { file: 'samples/structures/proteins/1htb.pdb', component: 'ligand', chain: 'A', compId: 'NAD', seq: 377, title: 'same-title' };
    const outputs = await Promise.all([
      extractStructureComponentFile(options),
      extractStructureComponentFile(options),
      editStructureFragmentFile({ ...options, operation: 'remove_to_new_file' }),
      editStructureFragmentFile({ ...options, operation: 'replace_to_new_file', replacementFile: 'samples/mini.pdb' }),
    ]);
    assert.equal(new Set(outputs.map(output => output.outputPath)).size, 4);
    for (const output of outputs) {
      assert.equal(path.dirname(path.dirname(output.outputPath)), process.env.BURETTE_BROWSER_DEV_GENERATED_FILES_ROOT);
      assert.equal((await stat(path.dirname(output.outputPath))).mode & 0o777, 0o700);
      assert.equal((await stat(output.outputPath)).mode & 0o777, 0o600);
      assert.equal(path.basename(output.outputPath), 'same-title.pdb');
      assert.match(await readFile(output.outputPath, 'utf8'), /^(ATOM|HETATM)/m);
    }
    assert.equal(outputs[0].atomCount, 44);
    assert.equal(outputs[1].atomCount, 44);
    assert.equal(outputs[2].removedAtomCount, 44);
    assert.equal(outputs[3].insertedAtomCount, 9);
    // Open a real browser shell on A; its recorded generated-root grant must
    // also admit later independent results B, C and D.
    const opened = JSON.parse(execFileSync(process.execPath, ['scripts/burette-agent.mjs', 'open', '--mode', 'browser-agent-shell', '--session-dir', path.join(process.env.TMPDIR, 'session'), outputs[0].outputPath], { encoding: 'utf8' }));
    try {
      const session = JSON.parse(await readFile(path.join(opened.result.sessionDir, 'session.json'), 'utf8'));
      assert.ok(session.allowedRoots.includes(process.env.BURETTE_BROWSER_DEV_GENERATED_FILES_ROOT));
      for (const output of outputs) {
        const response = await fetch(new URL('/@fs' + output.outputPath, opened.result.url), { headers: { Authorization: 'Bearer ' + session.token } });
        assert.equal(response.status, 200);
        assert.match(await response.text(), /^(ATOM|HETATM)/m);
      }
    } finally { process.kill(opened.result.processId, 'SIGTERM'); }
  `], { env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root, BURETTE_BROWSER_DEV_GENERATED_FILES_ROOT: generated, BURETTE_AGENT_SHELL_DIST_DIR: dist }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(await readFile(victim, 'utf8'), 'KEEP ORIGINAL');
  const linkedRoot = path.join(root, 'linked-generated');
  await symlink(generated, linkedRoot);
  const rejectedRoot = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { createGeneratedOutputDirectory } from './scripts/generated-files-root.mjs';
    await assert.rejects(createGeneratedOutputDirectory('component-'), /owned directory/);
  `], { env: { ...process.env, BURETTE_BROWSER_DEV_GENERATED_FILES_ROOT: linkedRoot }, encoding: 'utf8' });
  assert.equal(rejectedRoot.status, 0, rejectedRoot.stderr);

} finally {
  await rm(root, { recursive: true, force: true });
}
