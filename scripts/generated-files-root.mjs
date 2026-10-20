import { lstat, mkdir, mkdtemp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function browserGeneratedFilesRoot() {
  return process.env.BURETTE_BROWSER_DEV_GENERATED_FILES_ROOT
    ? resolve(process.env.BURETTE_BROWSER_DEV_GENERATED_FILES_ROOT)
    : resolve(homedir(), 'Desktop', 'Burette Generated Files');
}

export async function createGeneratedOutputDirectory(prefix) {
  const root = browserGeneratedFilesRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()
    || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o022)))) {
    throw new Error('Generated files root must be an owned directory without shared write access');
  }
  return mkdtemp(join(root, prefix));
}
