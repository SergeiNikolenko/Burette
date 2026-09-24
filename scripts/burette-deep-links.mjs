import { mkdir, open, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { namespaceForFlavor } from './dev-namespace.mjs';

export function navigationLink(kind, value, flavor = process.env.BURETTE_DEV_FLAVOR) {
  const namespace = namespaceForFlavor(flavor);
  const scheme = namespace.isDev ? `burette-${namespace.slug}` : 'burette';
  const url = new URL(`${scheme}://${kind}`);
  if (kind === 'pdb') {
    if (!/^[0-9][a-z0-9]{3}$/i.test(value)) throw new Error('Expected a four-character PDB ID.');
    url.pathname = `/${value.toUpperCase()}`;
  } else if (kind === 'open' || kind === 'project') {
    if (!value.startsWith('/') || value.length > 4096 || /[\x00-\x1f\x7f]/u.test(value)) throw new Error('Expected an absolute local path.');
    url.searchParams.set('path', value);
  } else if (kind === 'session' && /^[0-9a-f-]{36}$/.test(value)) {
    url.pathname = `/${value}`;
  } else throw new Error('Unsupported link route.');
  return url.href;
}

export async function registerSessionLink(sessionDir, { home = homedir(), flavor = process.env.BURETTE_DEV_FLAVOR } = {}) {
  sessionDir = await realpath(sessionDir);
  const handle = await open(join(sessionDir, 'session.json'), 'r');
  let session;
  try {
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw new Error('Session manifest is too large.');
    session = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally { await handle.close(); }
  if (session.apiVersion !== 'burette-agent-cli/v1' || session.mode !== 'desktop-app' || typeof session.token !== 'string' || !session.token || !Array.isArray(session.initialPaths) || !session.initialPaths.length || session.initialPaths.length > 32) {
    throw new Error('Expected an initialized desktop Burette session.');
  }
  const namespace = namespaceForFlavor(flavor);
  const registry = join(home, 'Library', 'Application Support', namespace.appId, 'deep-links');
  await mkdir(registry, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  await writeFile(join(registry, `${id}.json`), JSON.stringify({ sessionDir, token: session.token }), { mode: 0o600, flag: 'wx' });
  return navigationLink('session', id, flavor);
}
