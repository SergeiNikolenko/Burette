import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const maxBytes = 16 * 1024 * 1024;
const workspaceExtensions = new Set(['.pdb', '.ent', '.pdbqt', '.cif', '.mmcif', '.sdf', '.sd', '.mol', '.smi', '.smiles', '.csv', '.tsv', '.mvsj', '.mvsx', '.ket', '.rxn', '.xyz']);

export async function snapshotMcpDocuments(files, workspace, existing = []) {
  if (!Array.isArray(files) || !files.length || files.length > 8 || files.some(file => typeof file !== 'string' || !file)) throw new Error('Provide between 1 and 8 file paths.');
  const paths = [...new Set(await Promise.all(files.map(file => realpath(file))))];
  const additions = paths.filter(path => !existing.some(item => item.path === path));
  if (existing.length + additions.length > 8) throw new Error('A native workspace supports at most 8 files.');
  const snapshots = [];
  let totalBytes = existing.reduce((sum, item) => sum + item.byteCount, 0);
  for (const path of additions) {
    const extension = extname(path).toLowerCase();
    if (!(workspace ? workspaceExtensions.has(extension) : ['.pdb', '.cif', '.mmcif'].includes(extension))) throw new Error('Unsupported native workspace file format.');
    const info = await stat(path);
    if (!info.isFile() || info.size > maxBytes || info.size === 0) throw new Error('Structure must be a nonempty regular file of at most 16 MiB.');
    const bytes = await readFile(path);
    totalBytes += bytes.length;
    if (!bytes.length || totalBytes > maxBytes) throw new Error('Native workspace sources exceed 16 MiB in total or are empty.');
    snapshots.push({ bytes, document: { id: randomUUID(), label: basename(path), path, format: ['.cif', '.mmcif'].includes(extension) ? 'mmcif' : extension.slice(1), byteCount: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } });
  }
  return { paths, snapshots };
}

// The model-facing open_files action authorizes new paths. The app-only source
// exchange never does. Serialize catalog updates across MCP server processes.
export async function appendMcpDocuments(sessionDir, files) {
  const lockPath = join(sessionDir, 'documents.lock');
  const deadline = Date.now() + 5000;
  let lock;
  while (!lock) {
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('Another file addition is still in progress. Retry this workspace; do not open another pane.');
      await delay(25);
    }
  }
  try {
    if (await stat(join(sessionDir, 'closed.json')).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    })) throw new Error('Viewer is closed.');
    const session = JSON.parse(await readFile(join(sessionDir, 'session.json'), 'utf8'));
    if (!session.workspace) throw new Error('Adding files requires the full native workspace.');
    const { paths, snapshots } = await snapshotMcpDocuments(files, true, session.documents);
    if (snapshots.length) {
      for (const item of snapshots) await writeFile(join(sessionDir, `source-${item.document.id}`), item.bytes, { mode: 0o600 });
      session.documents.push(...snapshots.map(item => item.document));
      const temporary = join(sessionDir, `session-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(session), { mode: 0o600 });
      await rename(temporary, join(sessionDir, 'session.json'));
    }
    return { session, paths };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
