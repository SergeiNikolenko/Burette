import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const json = path => readFile(path, 'utf8').then(JSON.parse);

// A key claims one temporary session directory across processes. session.json
// is the commit marker: create must publish it only after sources and state.
export async function openMcpSession(root, input, create) {
  const key = input.openRequestId;
  if (key != null && (typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))) fail('INVALID_OPEN_REQUEST', 'openRequestId must be a UUID v4.');
  const structure = input.structure;
  if (structure != null && (!input.workspace || input.view !== 'ketcher' || input.file != null || input.additionalFiles?.length
    || !['smi', 'mol', 'sdf', 'ket'].includes(structure.format)
    || typeof structure.content !== 'string' || !structure.content.trim() || Buffer.byteLength(structure.content) > 65536)) {
    fail('INVALID_OPEN_REQUEST', 'Provide either a file or a Ketcher structure (smi, mol, sdf, ket; nonempty, at most 64 KiB).');
  }
  const paths = structure == null ? [input.file, ...(input.additionalFiles || [])] : [];
  if (paths.some(path => typeof path !== 'string' || !path || path.length > 4096)) fail('INVALID_OPEN_REQUEST', 'Provide nonempty file paths of at most 4096 characters.');
  const fingerprint = createHash('sha256').update(JSON.stringify({ paths: paths.map(path => resolve(path)),
    structure: structure == null ? null : { format: structure.format, content: structure.content },
    workspace: !!input.workspace, view: input.view || 'auto', displayMode: input.displayMode || 'inline' })).digest('hex');
  const sessionId = key?.toLowerCase() || randomUUID(), dir = join(root, sessionId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  let claimed = false;
  try { await mkdir(dir, { mode: 0o700 }); claimed = true; }
  catch (error) { if (error.code !== 'EEXIST' || !key) throw error; }
  if (claimed) {
    try {
      await writeFile(join(dir, 'open-request.tmp'), JSON.stringify({ fingerprint }), { mode: 0o600, flag: 'wx' });
      await rename(join(dir, 'open-request.tmp'), join(dir, 'open-request.json'));
      return { ...await create(sessionId, dir), reused: false };
    } catch (error) {
      // Never remove a published session even if future post-commit work fails.
      const committed = await stat(join(dir, 'session.json')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (!committed) await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }
  const deadline = Date.now() + 2000;
  do {
    try {
      const request = await json(join(dir, 'open-request.json'));
      if (request.fingerprint !== fingerprint) fail('OPEN_REQUEST_CONFLICT', 'openRequestId is already bound to different paths or workspace options.');
      const session = await json(join(dir, 'session.json'));
      const closed = await json(join(dir, 'closed.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (closed) fail('OPEN_REQUEST_CLOSED', 'This openRequestId belongs to a closed viewer. Use a new request ID only for an intentional new workspace.');
      const state = await json(join(dir, 'observe.json'));
      return { ...session, reused: true, ready: state.ready === true && Date.now() - Date.parse(state.updatedAt) < 15000 };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(25);
  } while (Date.now() < deadline);
  fail('OPEN_REQUEST_BUSY', 'This openRequestId is still initializing or was interrupted. Retry the same ID; do not create a duplicate workspace. Interrupted initialization needs explicit recovery.');
}
