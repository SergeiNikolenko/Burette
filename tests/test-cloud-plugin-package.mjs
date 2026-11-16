import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('built cloud ZIP resolves every declared component and contains no local runtime', () => {
  const built = JSON.parse(execFileSync(process.execPath, ['scripts/build-cloud-plugin.mjs'], { cwd: root, encoding: 'utf8' }));
  const entries = execFileSync('unzip', ['-Z1', built.zip], { encoding: 'utf8' }).trim().split('\n');
  const read = (name) => execFileSync('unzip', ['-p', built.zip, name], { encoding: 'utf8' });
  const manifest = JSON.parse(read('.codex-plugin/plugin.json'));
  assert.equal(manifest.name, 'burette-cloud-viewer');
  assert.equal(manifest.id, undefined);
  assert.deepEqual(JSON.parse(read(manifest.mcpServers.replace(/^\.\//, ''))), {
    mcpServers: { burette_cloud: { url: 'https://burette-plugin.vercel.app/mcp?client=burette-cloud' } },
  });
  for (const field of ['composerIcon', 'logo']) {
    assert.ok(entries.includes(manifest.interface[field].replace(/^\.\//, '')));
  }
  assert.ok(entries.includes('skills/preview-molecular-structures/SKILL.md'));
  for (const entry of entries.filter((e) => !e.endsWith('/'))) {
    assert.match(entry, /^(\.codex-plugin\/plugin\.json|\.mcp\.json|README\.md|skills\/preview-molecular-structures\/SKILL\.md|assets\/(app-icon|composer-icon)\.png)$/);
  }
  const local = JSON.parse(readFileSync(new URL('../plugins/burette-agent/.mcp.json', import.meta.url)));
  assert.ok(local.mcpServers.burette_agent_mcp.command);
  console.log(JSON.stringify(built));
});
