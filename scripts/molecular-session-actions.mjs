import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { appendMcpDocuments } from './mcp-app-documents.mjs';
import { runMolecularJob, getMolecularJob, cancelMolecularJob } from './molecular-jobs.mjs';

export const molecularSessionRoot = join(homedir(), '.burette', 'molecular-sessions');
export const molecularCapabilities = { dataReady: true, requiresMountedPanel: false,
  operations: ['inspect', 'contacts', 'buried_area', 'align', 'render'],
  persistence: 'local-snapshot', maxConcurrentJobs: 1 };

export async function molecularSessionAction(sessionDir, session, input) {
  const reference = { sessionDir, requestId: input.requestId };
  if (input.command === 'status') return getMolecularJob(reference);
  if (input.command === 'cancel') return cancelMolecularJob(reference);
  if (input.command === 'add_files') {
    const result = await appendMcpDocuments(sessionDir, input.paths, { allowClosedPanel: true });
    return { sessionId: session.sessionId, documents: result.session.documents, molecular: molecularCapabilities };
  }
  if (input.command === 'present') {
    if (input.requestId) {
      const job = await getMolecularJob(reference);
      if (job.status !== 'completed' || !job.result?.scenePath) throw new Error('A completed scene export is required.');
      if (job.result.nativeAttachment?.supported === false) throw new Error(job.result.nativeAttachment.reason);
      session = (await appendMcpDocuments(sessionDir, [job.result.scenePath], { allowClosedPanel: true })).session;
    }
    const presentationId = randomUUID();
    const temporary = join(sessionDir, `presentation.${presentationId}.tmp`);
    await writeFile(temporary, JSON.stringify({ presentationId }), { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(sessionDir, 'presentation.json'));
    // An explicit attachment reopens the panel, while scientific jobs and
    // source snapshots remain owned by the session throughout its closure.
    await unlink(join(sessionDir, 'closed.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return { ...session, presentationId, ready: false, molecular: molecularCapabilities };
  }
  if (input.command !== 'run') throw new Error('Unknown molecular session command.');
  const documents = session.documents.map((document, index) => ({ ...document,
    path: join(sessionDir, index === 0 ? 'source' : `source-${document.id}`) }))
    .filter(document => ['pdb', 'ent', 'mmcif', 'cif'].includes(document.format));
  if (!documents.length) throw new Error('This session has no PDB or mmCIF source for autonomous work.');
  return runMolecularJob({ ...reference, sessionId: session.sessionId, documents,
    action: input.action, waitMs: input.waitMs ?? 0 });
}
