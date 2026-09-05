import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

const root = join(tmpdir(), 'burette-mcp-app');
const maxSourceBytes = 16 * 1024 * 1024;
const maxStateBytes = 64 * 1024;
const apiVersion = 'burette-mcp-app/v1';
const actions = new Set(['focus_ligand', 'select_residues', 'reset_camera', 'clear_selection', 'set_display_mode']);

async function writeJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

function directory(sessionId) {
  if (!/^[0-9a-f-]{36}$/u.test(sessionId || '')) throw new Error('Invalid MCP App session ID.');
  return join(root, sessionId);
}

async function readSession(sessionId) {
  return JSON.parse(await readFile(join(directory(sessionId), 'session.json'), 'utf8'));
}

// The CLI owns this transport. MCP only forwards bounded operations to it.
export async function runMcpAppOperation(input) {
  if (input.operation === 'open') {
    const path = await realpath(input.file);
    const extension = extname(path).toLowerCase();
    if (!['.pdb', '.cif', '.mmcif'].includes(extension)) throw new Error('MCP App currently supports PDB and mmCIF files only.');
    const info = await stat(path);
    if (!info.isFile() || info.size > maxSourceBytes || info.size === 0) throw new Error('Structure must be a nonempty regular file of at most 16 MiB.');
    const bytes = await readFile(path);
    if (bytes.length > maxSourceBytes) throw new Error('Structure exceeds 16 MiB.');
    const sessionId = randomUUID();
    const sessionDir = directory(sessionId);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await mkdir(sessionDir, { mode: 0o700 });
    await mkdir(join(sessionDir, 'actions'), { mode: 0o700 });
    const session = { apiVersion, sessionId, token: randomUUID(), label: basename(path), format: extension === '.pdb' ? 'pdb' : 'mmcif', byteCount: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    // Snapshot the authorized file once; later source changes cannot silently change this scene.
    await writeFile(join(sessionDir, 'source'), bytes, { mode: 0o600 });
    await writeJson(join(sessionDir, 'session.json'), session);
    await writeJson(join(sessionDir, 'observe.json'), { ready: false, revision: 0, displayMode: 'inline' });
    return { ...session, ready: false };
  }
  const session = await readSession(input.sessionId);
  const sessionDir = directory(session.sessionId);
  if (input.operation === 'observe') {
    const state = JSON.parse(await readFile(join(sessionDir, 'observe.json'), 'utf8'));
    return { apiVersion, sessionId: session.sessionId, label: session.label, sha256: session.sha256, ...state, ready: state.ready === true && Date.now() - Date.parse(state.updatedAt) < 15000 };
  }
  if (input.operation === 'act') {
    if (!actions.has(input.action?.type)) throw new Error('Unsupported MCP App action.');
    if (Buffer.byteLength(JSON.stringify(input.action)) > 8192) throw new Error('Action exceeds 8 KiB.');
    if (input.action.type === 'set_display_mode' && !['inline', 'fullscreen'].includes(input.action.mode)) throw new Error('Display mode must be inline or fullscreen.');
    const state = await runMcpAppOperation({ operation: 'observe', sessionId: session.sessionId });
    if (!state.ready) throw new Error('Viewer is not mounted and ready. Open the MCP App before controlling it.');
    const pending = await readdir(join(sessionDir, 'actions'));
    if (pending.length >= 128) throw new Error('Session action limit reached; open a new session.');
    const actionId = randomUUID();
    await writeJson(join(sessionDir, 'actions', `${actionId}.json`), { actionId, action: input.action, status: 'queued' });
    return { sessionId: session.sessionId, actionId, status: 'queued' };
  }
  if (input.operation !== 'exchange' || input.token !== session.token) throw new Error('Invalid MCP App capability.');
  if (input.source === true) {
    const offset = input.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset >= session.byteCount) throw new Error('Invalid source offset.');
    const bytes = await readFile(join(sessionDir, 'source'));
    const end = Math.min(offset + 192 * 1024, bytes.length);
    return { config: { label: session.label, format: session.format, byteCount: session.byteCount, binary: false, showPanelControls: true, enablePreviewDocks: true, defaultPreviewDocks: [], defaultLayoutState: { left: 'hidden', right: 'hidden', top: 'hidden', bottom: 'hidden' }, theme: 'auto' }, dataBase64: bytes.subarray(offset, end).toString('base64'), nextOffset: end < bytes.length ? end : null };
  }
  if (input.state) {
    if (Buffer.byteLength(JSON.stringify(input.state)) > maxStateBytes) throw new Error('Viewer state exceeds 64 KiB.');
    await writeJson(join(sessionDir, 'observe.json'), { ...input.state, updatedAt: new Date().toISOString() });
  }
  if (input.completed) {
    const actionId = input.completed.actionId;
    if (!/^[0-9a-f-]{36}$/u.test(actionId || '')) throw new Error('Invalid action ID.');
    if (Buffer.byteLength(JSON.stringify(input.completed)) > maxStateBytes) throw new Error('Action result exceeds 64 KiB.');
    const path = join(sessionDir, 'actions', `${actionId}.json`);
    const action = JSON.parse(await readFile(path, 'utf8'));
    if (action.status === 'queued') await writeJson(path, { ...action, status: input.completed.error ? 'failed' : 'completed', result: input.completed.result, error: input.completed.error });
  }
  const records = await Promise.all((await readdir(join(sessionDir, 'actions'))).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(sessionDir, 'actions', name), 'utf8'))));
  return { actions: records.filter(item => item.status === 'queued').slice(0, 1) };
}
