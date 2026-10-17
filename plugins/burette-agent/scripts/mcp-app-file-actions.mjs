import { constants } from 'node:fs';
import { copyFile, mkdir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';

// Plugin updates can remove the original bundled example while its workspace
// still owns a source snapshot. Preserve its extension for Launch Services.
export async function mcpFileActionPath(sessionDir, session, document) {
  try { return await realpath(document.path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const folder = join(sessionDir, 'open-files', document.id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const name = basename(document.label).replace(/\.(?:gz|bgz|bgzf)$/iu, '');
  const destination = join(folder, name);
  const source = join(sessionDir, document.id === session.documents[0].id ? 'source' : `source-${document.id}`);
  try { await copyFile(source, destination, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const path = await realpath(destination);
  if (path !== join(await realpath(folder), name)) throw new Error('Workspace file must not be a symbolic link.');
  return path;
}
