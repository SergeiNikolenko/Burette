import { randomUUID } from 'node:crypto';
import { link, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Publish an already validated workbench artifact without exposing partial bytes
// or truncating an earlier export when disk writes fail.
export async function writeWorkbenchArtifact(path, bytes, { overwrite = false } = {}) {
  const temporaryPath = resolve(dirname(path), `.burette-export-${randomUUID()}.tmp`);
  let created = false;
  try {
    const temporary = await open(temporaryPath, 'wx', 0o600);
    created = true;
    try {
      await temporary.writeFile(bytes);
      if ((await temporary.stat()).size !== bytes.length) throw new Error('The artifact write was incomplete.');
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    // link atomically refuses even a concurrently created destination.
    if (overwrite) await rename(temporaryPath, path);
    else await link(temporaryPath, path);
  } finally {
    if (created) await unlink(temporaryPath).catch(() => undefined);
  }
}
