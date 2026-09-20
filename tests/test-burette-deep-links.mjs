import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { navigationLink, registerSessionLink } from '../scripts/burette-deep-links.mjs';
import { namespaceForFlavor, patchTree } from '../scripts/dev-namespace.mjs';

const root = await mkdtemp(join(tmpdir(), 'burette-deep-links-test-'));
try {
  assert.equal(navigationLink('pdb', '1htb', ''), 'burette://pdb/1HTB');
  assert.equal(navigationLink('pdb', '1htb', 'links-test'), 'burette-linkstest://pdb/1HTB');
  for (const [kind, value] of [['pdb', 'abcd'], ['pdb', '1HTB?run=x'], ['open', 'relative'], ['session', '../x'], ['run', 'ls']]) {
    assert.throws(() => navigationLink(kind, value));
  }
  const path = '/tmp/молекула & #.pdb';
  assert.equal(new URL(navigationLink('open', path)).searchParams.get('path'), path);
  const sessionDir = join(root, 'session');
  await mkdir(sessionDir);
  const manifest = { apiVersion: 'burette-agent-cli/v1', mode: 'desktop-app', token: 'test-token', initialPaths: [path] };
  await writeFile(join(sessionDir, 'session.json'), JSON.stringify(manifest));
  const link = await registerSessionLink(sessionDir, { home: root, flavor: 'links' });
  assert.match(link, /^burette-links:\/\/session\/[0-9a-f-]{36}$/);
  const record = join(root, 'Library/Application Support/com.local.BuretteV10.Dev.links/deep-links', `${new URL(link).pathname.slice(1)}.json`);
  const registration = JSON.parse(await readFile(record, 'utf8'));
  assert.equal(registration.token, manifest.token);
  assert.equal((await stat(record)).mode & 0o777, 0o600);
  assert.ok(!link.includes(manifest.token) && !link.includes(sessionDir));
  await writeFile(join(sessionDir, 'session.json'), JSON.stringify({ ...manifest, mode: 'browser-preview' }));
  await assert.rejects(registerSessionLink(sessionDir, { home: root }));
  await writeFile(join(sessionDir, 'session.json'), ' '.repeat(65537));
  await assert.rejects(registerSessionLink(sessionDir, { home: root }), /too large/);
  const permissions = await readFile('apps/desktop/src-tauri/permissions/burette.toml', 'utf8');
  for (const command of ['drain_deep_links', 'claim_agent_session']) assert.ok(permissions.includes(`"${command}"`), `${command} requires desktop IPC permission`);
  const plist = await readFile('apps/desktop/src-tauri/AppMetadata.plist', 'utf8');
  await writeFile(join(root, 'Info.plist'), plist);
  const namespaceScript = await readFile('scripts/dev-namespace.mjs', 'utf8');
  await writeFile(join(root, 'dev-namespace.mjs'), namespaceScript);
  patchTree(root, namespaceForFlavor('links'));
  assert.equal(await readFile(join(root, 'dev-namespace.mjs'), 'utf8'), namespaceScript);
  assert.match(await readFile(join(root, 'Info.plist'), 'utf8'), /<string>burette-links<\/string>/);
  console.log('Deep link generation, private registration, bounds and dev isolation passed.');
} finally { await rm(root, { recursive: true, force: true }); }
