import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

// App-only resume data, isolated inside one already-authorized session. Neither
// keys nor values are paths, and these bytes never enter model-visible state.
export async function mcpAppCheckpoint(directory, input) {
  if (!/^(workspace|[a-f0-9]{64})$/u.test(input.key || '')) throw new Error('Invalid checkpoint key.');
  const path = join(directory, `checkpoint-${input.key}.json`);
  if (input.value === undefined) {
    const value = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    return { value };
  }
  if (typeof input.value !== 'string' || Buffer.byteLength(input.value) > 699052) throw new Error('Checkpoint exceeds its payload limit.');
  if (input.key === 'workspace') {
    const entries = JSON.parse(input.value);
    if (!entries || Array.isArray(entries) || typeof entries !== 'object' || Object.keys(entries).length > 2) throw new Error('Invalid workspace checkpoint.');
    for (const [key, value] of Object.entries(entries)) {
      if (!/^burette\.(molecule\.session|tab-workspaces)\.mcp-[a-f0-9-]{36}$/u.test(key) || typeof value !== 'string') throw new Error('Invalid workspace storage key.');
    }
  } else {
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(input.value)) throw new Error('Invalid compressed scene.');
    const bytes = Buffer.from(input.value, 'base64');
    if (bytes.length > 512 * 1024) throw new Error('Compressed scene exceeds 512 KiB.');
    const snapshot = JSON.parse(gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8'));
    if (!snapshot?.data || snapshot.behaviour || snapshot.onLoadMarkdownCommands) throw new Error('Unsupported scene checkpoint.');
    const existing = (await readdir(directory)).filter(name => /^checkpoint-[a-f0-9]{64}\.json$/u.test(name));
    if (!existing.includes(`checkpoint-${input.key}.json`) && existing.length >= 8) throw new Error('Workspace scene checkpoint limit reached.');
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, input.value, { mode: 0o600 });
  await rename(temporary, path);
  return { saved: true };
}
