import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { navigationLink, registerSessionLink } from '../scripts/burette-deep-links.mjs';

test('desktop links encode paths and reject non-navigation inputs', () => {
  const path = '/tmp/молекула & #.pdb';
  assert.equal(new URL(navigationLink('open', path, '')).searchParams.get('path'), path);
  for (const [kind, value] of [['pdb', '1HTB?run=x'], ['open', 'relative'], ['session', '../x'], ['run', 'ls']]) {
    assert.throws(() => navigationLink(kind, value));
  }
});

test('desktop session links keep credentials private and reject browser sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'burette-link-test-'));
  try {
    const sessionDir = join(root, 'session');
    await mkdir(sessionDir);
    const session = { apiVersion: 'burette-agent-cli/v1', mode: 'desktop-app', token: 'private-fixture', initialPaths: ['/tmp/fixture.pdb'] };
    await writeFile(join(sessionDir, 'session.json'), JSON.stringify(session));
    const link = await registerSessionLink(sessionDir, { home: root, flavor: '' });
    assert.ok(!link.includes(session.token) && !link.includes(sessionDir));
    const record = join(root, 'Library/Application Support/com.local.BuretteV10/deep-links', `${new URL(link).pathname.slice(1)}.json`);
    assert.deepEqual(JSON.parse(await readFile(record)), { sessionDir: await realpath(sessionDir), token: session.token });
    assert.equal((await stat(record)).mode & 0o777, 0o600);
    await writeFile(join(sessionDir, 'session.json'), JSON.stringify({ ...session, mode: 'browser-preview' }));
    await assert.rejects(registerSessionLink(sessionDir, { home: root }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
